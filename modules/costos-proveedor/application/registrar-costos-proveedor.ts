/**
 * `registrarCostosProveedor` -- THE ONLY writer of `fsj.costo_proveedor`
 * (docs/specs/costos-proveedor.md R20, R23, R24). A manual entry (this file's
 * command, `lista_precio_id` NULL) and a confirmed list import (stage E4) go
 * through the same `registrarFilasEnTx`, so every price is validated, versioned
 * and audited by the same rules.
 *
 * ONE transaction, all or nothing (R20):
 *
 *   1. read the jornada actual on the server and validate every row's shape
 *      with `filaCostoSchema(jornada)` (R3, R8) -- done HERE and not in the
 *      command's `input` because the date rule needs the server's jornada;
 *   2. reject a proveedor or droga de baja (R12), a droga repeated in the
 *      batch (R18 "duplicada"), an unknown / de baja / other-magnitud unidad
 *      de precio (R5) and a price that rounds to zero (`validarFilaCosto`);
 *   3. `lockVigentes` for EVERY pair, BEFORE any decision (R23: the check below
 *      must read the vigente under the lock);
 *   4. optimistic check (R23): a row that carries the vigente id the user saw
 *      (`vigenteEsperadoId`, `null` = "there was none") is refused when the
 *      locked vigente is a different one;
 *   5. `planVersionar` per row (R9 refused when older, R10 skipped when equal);
 *      rows with a problem are collected and reported TOGETHER, nothing written;
 *   6. an import (stage E4) creates its `lista_precio_proveedor` HERE, through
 *      `args.crearListaPrecio`, once the plan is known and BEFORE the first write:
 *      the header is append-only (no UPDATE), so it must record the final
 *      `filas_aplicadas`, and the costo rows reference it (FK), so it must exist first;
 *   7. one server instant (`ahoraServidor`): `cerrarVigente` +
 *      `insertCostoProveedor` with that SAME instant (R2), and one audit record
 *      per created costo.
 *
 * Row errors point at the row's control (`filas.<i>.<campo>`), like
 * modules/stock/application/importar-factura-compra.ts, so the form keeps what
 * was typed and marks the offending field.
 *
 * Audit: the pipeline's built-in audit writes exactly one record, and this
 * command creates one per costo, so it opts out and calls `audit.record` itself
 * inside the same transaction (same as importarFacturaCompra).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { formatFechaIso } from "@/shared/format/fecha";
import { fieldLabel } from "@/shared/labels/field-labels";
import { uuid } from "@/shared/validation";
import { detectarDuplicados, filaCostoSchema, planVersionar, validarFilaCosto } from "../domain/costo-proveedor";
import type { PlanVersionado } from "../domain/costo-proveedor";
import {
  ahoraServidor,
  cerrarVigente,
  getDrogasParaCosto,
  getProveedorParaCosto,
  getUnidadesParaCosto,
  insertCostoProveedor,
  jornadaActualTenant,
  lockVigentes,
} from "../infrastructure/costo-proveedor-repository";
import type { CostoProveedorVigenteBloqueado, DrogaParaCosto, UnidadCosto } from "../infrastructure/costo-proveedor-repository";

/** Same ceiling as the list import's data rows (R15). */
export const MAX_FILAS_COSTOS = 5000;

/** How many row errors the message spells out; every one still marks its field. */
const MAX_ERRORES_EN_MENSAJE = 5;

/**
 * What the form sends for one row: the SHAPE is checked in `registrarFilasEnTx`
 * (`filaCostoSchema(jornada)`), so every value arrives as-is here and the
 * errors can point at `filas.<i>.<campo>`.
 */
const filaWire = z.object({
  drogaId: z.unknown().optional(),
  precioInformado: z.unknown().optional(),
  unidadPrecioId: z.unknown().optional(),
  fechaPrecio: z.unknown().optional(),
  descripcionProveedor: z.unknown().optional(),
  motivo: z.unknown().optional(),
  vigenteEsperadoId: z.unknown().optional(),
});

const registrarCostosProveedorInput = z.object({
  proveedorId: uuid,
  filas: z.array(filaWire).min(1, "Cargá al menos un costo.").max(MAX_FILAS_COSTOS, `No se pueden cargar más de ${MAX_FILAS_COSTOS} costos juntos.`),
});

/** What the form sends (every row value as typed). */
export type RegistrarCostosProveedorWireInput = z.input<typeof registrarCostosProveedorInput>;

/** One row after validation: `vigenteEsperadoId` is the vigente costo's id the user saw (`null` = none), absent = not checked. */
function filaConEsperadoSchema(jornadaActual: string) {
  return filaCostoSchema(jornadaActual).extend({ vigenteEsperadoId: uuid.nullable().optional() });
}

export type FilaCostoValidada = z.output<ReturnType<typeof filaConEsperadoSchema>>;

export type ResultadoFila = "INSERTADO" | "REEMPLAZADO" | "SIN_CAMBIOS";

export interface ResultadoRegistroCostos {
  insertados: number;
  reemplazados: number;
  sinCambios: number;
  /** Ids of the created costos (inserted and replacing), in row order. */
  ids: string[];
  /** One entry per submitted row, in order. */
  filas: { indice: number; resultado: ResultadoFila; id: string | null }[];
}

/** What `registrarFilasEnTx` knows once it has validated and planned every row, before writing. */
export interface ResumenPlanRegistro {
  /** Costos that will be written: inserted + replaced. */
  filasAplicadas: number;
  /** Rows that need no write (same price, unit and date as the vigente, R10). */
  sinCambios: number;
  /** The proveedor, for the caller's own audit. */
  proveedor: { id: string; razonSocial: string };
}

export interface RegistrarFilasArgs {
  proveedorId: string;
  /** Rows as submitted (validated here). */
  filas: readonly unknown[];
  /** `null` = manual entry (R24), unless `crearListaPrecio` is given. */
  listaPrecioId: string | null;
  /**
   * Import (E4): inserts the `lista_precio_proveedor` and returns its id. Called ONCE, after every row was
   * validated and planned and before anything is written, with the count of costos that will really be written
   * (rows planned as sin cambios do not count). Nothing has been written when a row is refused, so the header is
   * never inserted for a refused import (R20).
   */
  crearListaPrecio?: (resumen: ResumenPlanRegistro) => Promise<string>;
  /** How an error names a row: "Fila <etiqueta>". Defaults to the row's position (1-based); the import names the list's own row number. */
  etiquetaFila?: (indice: number) => string;
  /** Message of the optimistic conflict (R23); the manual form says "editabas", the import says "revisabas". */
  mensajeConflicto?: (drogaNombre: string) => string;
  /** Extra audit context; defaults to the origin of the entry. */
  contexto?: Prisma.InputJsonValue;
}

interface ErrorFila {
  indice: number;
  campo: string;
  mensaje: string;
}

function lanzarSiHayErrores(errores: readonly ErrorFila[], totalFilas: number, etiquetaFila: (indice: number) => string): void {
  if (errores.length === 0) return;
  const ordenados = [...errores].sort((a, b) => a.indice - b.indice);
  const texto = ordenados.slice(0, MAX_ERRORES_EN_MENSAJE).map((e) => (totalFilas > 1 ? `Fila ${etiquetaFila(e.indice)}: ${e.mensaje}` : e.mensaje));
  const resto = ordenados.length - texto.length;
  throw new ValidationError(resto > 0 ? `${texto.join(" ")} (y ${resto} errores más)` : texto.join(" "), {
    fields: [...new Set(ordenados.map((e) => `filas.${e.indice}.${e.campo}`))],
  });
}

function mensajeConflictoManual(drogaNombre: string): string {
  return `El costo de ${drogaNombre} cambió mientras lo editabas. Volvé a cargar la página.`;
}

interface AccionPlanificada {
  indice: number;
  fila: FilaCostoValidada;
  droga: DrogaParaCosto;
  costoUnitario: string;
  plan: PlanVersionado;
  vigente: CostoProveedorVigenteBloqueado | undefined;
}

/** The price of one version as the audit diff shows it: precio informado with its unit symbol, costo por unidad base and fecha. */
function resumenCosto(precioInformado: string, unidad: Pick<UnidadCosto, "simbolo"> | undefined, costoUnitario: string, fechaPrecio: string): Prisma.InputJsonObject {
  return { precioInformado, unidadPrecio: unidad?.simbolo ?? null, costoUnitario, fechaPrecio };
}

/**
 * The write path shared by the manual entry and the list import. Runs inside an
 * ALREADY OPEN tenant transaction (the caller's `defineCommand`). Throws before
 * writing anything when any row is refused; see the module doc comment for the order.
 */
export async function registrarFilasEnTx(tx: Prisma.TransactionClient, session: AuthenticatedSession, args: RegistrarFilasArgs): Promise<ResultadoRegistroCostos> {
  const { tenantId } = session;
  const { proveedorId } = args;
  let listaPrecioId = args.listaPrecioId;
  const total = args.filas.length;
  const mensajeConflicto = args.mensajeConflicto ?? mensajeConflictoManual;
  const etiquetaFila = args.etiquetaFila ?? ((indice: number) => String(indice + 1));
  const esImportacion = listaPrecioId !== null || args.crearListaPrecio !== undefined;
  const contexto = args.contexto ?? { origen: esImportacion ? "importacion_lista_precios" : "carga_manual_costo_proveedor" };

  // 1. Shape (R3, R8): the jornada comes from the server, never the client.
  const jornadaActual = await jornadaActualTenant(tx, tenantId);
  const esquema = filaConEsperadoSchema(jornadaActual);
  const erroresForma: ErrorFila[] = [];
  const filas: FilaCostoValidada[] = [];
  args.filas.forEach((cruda, indice) => {
    const resultado = esquema.safeParse(cruda);
    if (resultado.success) {
      filas.push(resultado.data);
      return;
    }
    for (const issue of resultado.error.issues) {
      const campo = issue.path.length > 0 ? String(issue.path[0]) : "drogaId";
      erroresForma.push({ indice, campo, mensaje: `${fieldLabel(campo)}: ${issue.message}` });
    }
  });
  lanzarSiHayErrores(erroresForma, total, etiquetaFila);

  // 2. Proveedor and droga must exist and not be de baja (R12); a droga appears once per batch.
  const proveedor = await getProveedorParaCosto(tx, tenantId, proveedorId);
  if (!proveedor) throw new NotFoundError("Proveedor no encontrado.");
  if (proveedor.fechaBaja !== null) throw new DomainError("El proveedor está dado de baja: no se le pueden cargar costos.", { fields: ["proveedorId"] });

  const errores: ErrorFila[] = [];
  for (const indice of detectarDuplicados(filas)) {
    errores.push({ indice, campo: "drogaId", mensaje: "La droga está repetida en la carga: dejá una sola fila por droga." });
  }

  const drogas = await getDrogasParaCosto(tx, tenantId, filas.map((fila) => fila.drogaId));
  const unidades = await getUnidadesParaCosto(tx, [...filas.map((fila) => fila.unidadPrecioId), ...[...drogas.values()].map((droga) => droga.unidadBaseId)]);
  const costosUnitarios = new Map<number, string>();
  filas.forEach((fila, indice) => {
    const droga = drogas.get(fila.drogaId);
    if (!droga) {
      errores.push({ indice, campo: "drogaId", mensaje: "La droga no existe." });
      return;
    }
    if (droga.fechaBaja !== null) {
      errores.push({ indice, campo: "drogaId", mensaje: `La droga ${droga.nombre} está dada de baja: no se le pueden cargar costos.` });
      return;
    }
    const unidadPrecio = unidades.get(fila.unidadPrecioId);
    const unidadBase = unidades.get(droga.unidadBaseId);
    if (!unidadPrecio || !unidadBase) {
      errores.push({ indice, campo: "unidadPrecioId", mensaje: "La unidad del precio elegida no existe." });
      return;
    }
    const validacion = validarFilaCosto({ precioInformado: fila.precioInformado, unidadPrecio, unidadBase });
    if (!validacion.ok) {
      errores.push({ indice, campo: validacion.problema === "COSTO_NULO" ? "precioInformado" : "unidadPrecioId", mensaje: validacion.mensaje });
      return;
    }
    costosUnitarios.set(indice, validacion.costoUnitario);
  });
  lanzarSiHayErrores(errores, total, etiquetaFila);

  // 3. Lock every pair's vigente BEFORE deciding anything (R23).
  const bloqueados = await lockVigentes(
    tx,
    tenantId,
    filas.map((fila) => ({ drogaId: fila.drogaId, proveedorId })),
  );
  const vigentePorDroga = new Map(bloqueados.map((vigente) => [vigente.drogaId, vigente]));

  // 4 + 5. Optimistic check and versioning plan, still without writing.
  const planificadas: AccionPlanificada[] = [];
  const erroresPlan: ErrorFila[] = [];
  filas.forEach((fila, indice) => {
    const droga = drogas.get(fila.drogaId)!;
    const vigente = vigentePorDroga.get(fila.drogaId);
    if (fila.vigenteEsperadoId !== undefined && (vigente?.id ?? null) !== fila.vigenteEsperadoId) {
      throw new DomainError(mensajeConflicto(droga.nombre), { fields: [`filas.${indice}.drogaId`] });
    }
    const plan = planVersionar({
      vigente: vigente ? { id: vigente.id, precioInformado: vigente.precioInformado, unidadPrecioId: vigente.unidadPrecioId, fechaPrecio: vigente.fechaPrecio } : null,
      nuevo: { precioInformado: fila.precioInformado, unidadPrecioId: fila.unidadPrecioId, fechaPrecio: fila.fechaPrecio },
    });
    if (plan.tipo === "RECHAZAR") {
      erroresPlan.push({
        indice,
        campo: "fechaPrecio",
        mensaje: `Ya hay un precio de ${droga.nombre} de este proveedor con fecha ${formatFechaIso(vigente!.fechaPrecio)}, más nuevo que el ingresado: un precio más antiguo no lo reemplaza.`,
      });
      return;
    }
    planificadas.push({ indice, fila, droga, costoUnitario: costosUnitarios.get(indice)!, plan, vigente });
  });
  lanzarSiHayErrores(erroresPlan, total, etiquetaFila);

  // 6. Import: the lista header, now that the plan (and so `filas_aplicadas`) is final and nothing was refused.
  const aEscribir = planificadas.filter((accion) => accion.plan.tipo !== "SIN_CAMBIOS");
  if (args.crearListaPrecio) {
    listaPrecioId = await args.crearListaPrecio({
      filasAplicadas: aEscribir.length,
      sinCambios: planificadas.length - aEscribir.length,
      proveedor: { id: proveedor.id, razonSocial: proveedor.razonSocial },
    });
  }

  // 7. Write: close + insert with the SAME server instant, one audit record per created costo.
  const unidadesFaltantes = aEscribir.flatMap((accion) => (accion.vigente && !unidades.has(accion.vigente.unidadPrecioId) ? [accion.vigente.unidadPrecioId] : []));
  const unidadesVigentes = unidadesFaltantes.length > 0 ? new Map([...unidades, ...(await getUnidadesParaCosto(tx, unidadesFaltantes))]) : unidades;
  const ahora = aEscribir.length > 0 ? await ahoraServidor(tx) : null;

  const resultado: ResultadoRegistroCostos = { insertados: 0, reemplazados: 0, sinCambios: 0, ids: [], filas: [] };
  for (const accion of planificadas) {
    const { indice, fila, droga, costoUnitario, plan, vigente } = accion;
    if (plan.tipo === "SIN_CAMBIOS" || ahora === null) {
      resultado.sinCambios += 1;
      resultado.filas.push({ indice, resultado: "SIN_CAMBIOS", id: null });
      continue;
    }
    if (plan.tipo === "REEMPLAZAR") await cerrarVigente(tx, tenantId, plan.cerrarId, ahora);

    const creado = await insertCostoProveedor(tx, {
      tenantId,
      drogaId: fila.drogaId,
      proveedorId,
      precioInformado: fila.precioInformado,
      unidadPrecioId: fila.unidadPrecioId,
      costoUnitario,
      fechaPrecio: fila.fechaPrecio,
      descripcionProveedor: fila.descripcionProveedor,
      listaPrecioId,
      motivo: fila.motivo,
      vigenteDesde: ahora,
      creadoPorId: session.usuario.id,
    });

    await auditRecord(tx, {
      tenantId,
      usuarioId: session.usuario.id,
      entidad: "costo_proveedor",
      entidadId: creado.id,
      accion: TipoAccion.CREAR,
      contexto,
      ...(plan.tipo === "REEMPLAZAR" && vigente
        ? { valorAnterior: resumenCosto(vigente.precioInformado, unidadesVigentes.get(vigente.unidadPrecioId), vigente.costoUnitario, vigente.fechaPrecio) }
        : {}),
      valorNuevo: {
        droga: droga.nombre,
        proveedor: proveedor.razonSocial,
        ...resumenCosto(fila.precioInformado, unidadesVigentes.get(fila.unidadPrecioId), costoUnitario, fila.fechaPrecio),
        ...(fila.descripcionProveedor ? { descripcionProveedor: fila.descripcionProveedor } : {}),
        ...(fila.motivo ? { motivo: fila.motivo } : {}),
        ...(listaPrecioId ? { listaPrecioId } : {}),
      },
    });

    resultado.ids.push(creado.id);
    if (plan.tipo === "REEMPLAZAR") resultado.reemplazados += 1;
    else resultado.insertados += 1;
    resultado.filas.push({ indice, resultado: plan.tipo === "REEMPLAZAR" ? "REEMPLAZADO" : "INSERTADO", id: creado.id });
  }
  return resultado;
}

export const registrarCostosProveedorCommand = defineCommand({
  name: "costos-proveedor.registrar",
  permiso: "costos.proveedor.gestionar",
  input: registrarCostosProveedorInput,
  audit: {
    skip: true,
    reason: "Writes one audit record per created costo (entidad costo_proveedor, CREAR, with the closed version as valorAnterior) itself, via audit.record in the same transaction -- see the module doc comment.",
  },
  handler: async ({ tx, session, input }) => {
    const output = await registrarFilasEnTx(tx, session, { proveedorId: input.proveedorId, filas: input.filas, listaPrecioId: null });
    return { output };
  },
});

export async function registrarCostosProveedor(input: RegistrarCostosProveedorWireInput): Promise<ResultadoRegistroCostos> {
  return registrarCostosProveedorCommand.execute(input);
}
