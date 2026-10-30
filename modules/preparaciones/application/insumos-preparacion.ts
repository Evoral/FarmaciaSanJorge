/**
 * The insumos of a preparación (migration 0110, openspec/specs/insumos-preparacion/spec.md): the "Material" (one droga
 * of clase MATERIAL, e.g. the cápsula type) and the "insumos adicionales" (drogas of clase EXCIPIENTE or MATERIAL),
 * each with its quantity in the droga's unidad base. Exactly the excipiente's mechanics (./excipiente-preparacion.ts),
 * one plan per insumo, run inside the callers' transactions:
 *   - `reservarInsumosEnTx` ("Marcar como preparada"): validated (clase, vigente, a droga once across excipiente +
 *     material + adicionales, at most one material), recorded in `fsj.insumo_preparacion` (fórmula text included) and
 *     reserved oldest lot first, automatic, without línea.
 *   - `replanificarInsumosEnTx` + `guardarReservaInsumosEnTx` ("Recalcular reserva", "Registrar pérdida"): computed
 *     before the caller deletes the reservas, written after.
 *   - `consumirInsumosEnTx` ("Imprimir etiquetas"): EGRESO_PREPARACION without línea over each insumo's reserved
 *     partidas. Never contralor (only clase DROGA can be controlled) and never a detalle line of the libro; the
 *     adicionales of clase EXCIPIENTE are in the fórmula (`getItemPrescriptoDePreparacion`).
 * Lock order: the callers lock the candidate partidas (`partidasCandidatasInsumosEnTx`) in the same id-ordered
 * statement as the líneas' and the excipiente's; `planificarSinLinea` then only re-locks rows this transaction holds.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { Decimal, dec } from "@/shared/decimal";
import { DomainError } from "@/shared/errors";
import { claseAdmitida, drogaRepetida, nombreTipoInsumo, textoInsumo, type TipoInsumo } from "../domain/insumo";
import { planificarSinLinea } from "./excipiente-preparacion";
import {
  deleteReservasSinLinea,
  getDrogaExcipiente,
  getExcipienteDePreparacion,
  insertEgresoPreparacion,
  insertInsumosPreparacion,
  insertReservasSinLinea,
  listInsumosDePreparacion,
  listPartidasElegiblesDroga,
  listReservasSinLinea,
} from "../infrastructure/preparacion-repository";

type DrogaInsumo = NonNullable<Awaited<ReturnType<typeof getDrogaExcipiente>>>;

/** An insumo to reserve: its droga and quantity in the droga's unidad base. */
export interface InsumoAReservar {
  tipo: TipoInsumo;
  drogaId: string;
  cantidad: Decimal;
}

/** What the audit records of an insumo's reserva (a type alias: it goes into the audit's JSON as is). */
export type ResumenInsumo = {
  tipo: TipoInsumo;
  drogaId: string;
  droga: string;
  cantidad: string;
  partidas: { partidaId: string; cantidad: string }[];
};

/**
 * Refuses an invalid list (I6-I8): at most one MATERIAL, a droga at most once across the excipiente + material +
 * adicionales, each droga a vigente one of the admitted clase, every quantity > 0. Returns the drogas, in order.
 */
export async function validarInsumosEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  insumos: readonly { tipo: TipoInsumo; drogaId: string | null; cantidad?: Decimal | null }[],
  excipienteDrogaId: string | null,
) {
  if (insumos.filter((i) => i.tipo === "MATERIAL").length > 1) throw new DomainError("Solo se puede cargar un material.");
  const drogas: (DrogaInsumo | null)[] = [];
  for (const insumo of insumos) {
    if (!insumo.drogaId) {
      drogas.push(null);
      continue;
    }
    const droga = await getDrogaExcipiente(tx, tenantId, insumo.drogaId);
    const nombre = nombreTipoInsumo(insumo.tipo);
    if (!droga || !claseAdmitida(insumo.tipo, droga.clase)) {
      throw new DomainError(insumo.tipo === "MATERIAL" ? "Elegí un material del listado." : "Elegí un excipiente o material del listado.");
    }
    if (!droga.vigente) throw new DomainError(`El ${nombre} ${droga.nombre} está dado de baja: elegí otro.`);
    if (insumo.cantidad && !insumo.cantidad.greaterThan(0)) throw new DomainError(`La cantidad del ${nombre} ${droga.nombre} debe ser mayor que 0.`);
    drogas.push(droga);
  }
  const repetida = drogaRepetida([excipienteDrogaId, ...insumos.map((i) => i.drogaId)]);
  if (repetida) {
    const nombre = drogas.find((d) => d?.id === repetida)?.nombre ?? "La misma droga";
    throw new DomainError(
      repetida === excipienteDrogaId
        ? `${nombre} ya está elegido como excipiente: no lo cargues también como material o insumo.`
        : `${nombre} está cargado dos veces: dejalo en una sola fila con la cantidad total.`,
    );
  }
  return drogas;
}

/** Every partida the insumos' plans may lock: of `drogaIds`, or of the preparación's stored insumos; `[]` without any. */
export async function partidasCandidatasInsumosEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { preparacionId: string; drogaIds?: readonly string[] },
): Promise<string[]> {
  const drogaIds = input.drogaIds ?? (await listInsumosDePreparacion(tx, tenantId, input.preparacionId)).map((i) => i.drogaId);
  const ids: string[] = [];
  for (const drogaId of drogaIds) ids.push(...(await listPartidasElegiblesDroga(tx, tenantId, drogaId, input.preparacionId)).map((p) => p.id));
  return ids;
}

/** One insumo's plan over every eligible partida of its droga (its own reserva available). */
async function planDeInsumo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { preparacionId: string; tipo: TipoInsumo; drogaId: string; drogaNombre: string; unidadSimbolo: string; cantidad: Decimal; jornada: string; mensajeFaltante: string; partidaIds?: readonly string[] },
): Promise<ResumenInsumo> {
  const partidaIds = input.partidaIds ?? (await listPartidasElegiblesDroga(tx, tenantId, input.drogaId, input.preparacionId)).map((p) => p.id);
  const partes = await planificarSinLinea(tx, tenantId, {
    preparacionId: input.preparacionId,
    droga: { nombre: input.drogaNombre, unidadSimbolo: input.unidadSimbolo },
    cantidad: input.cantidad,
    partidaIds,
    jornada: input.jornada,
    mensajeFaltante: input.mensajeFaltante,
    etiqueta: `del ${nombreTipoInsumo(input.tipo)}`,
  });
  return {
    tipo: input.tipo,
    drogaId: input.drogaId,
    droga: input.drogaNombre,
    cantidad: `${input.cantidad.toString()} ${input.unidadSimbolo}`,
    partidas: partes.map((p) => ({ partidaId: p.partidaId, cantidad: p.cantidad.toString() })),
  };
}

/** Records and reserves the insumos of a just-created preparación (INICIADA), after its excipiente. `[]` = none. */
export async function reservarInsumosEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { preparacionId: string; insumos: readonly InsumoAReservar[]; jornada: string },
): Promise<ResumenInsumo[]> {
  if (input.insumos.length === 0) return [];
  const { tenantId } = session;
  const excipiente = await getExcipienteDePreparacion(tx, tenantId, input.preparacionId);
  const drogas = await validarInsumosEnTx(tx, tenantId, input.insumos, excipiente?.drogaId ?? null);
  // The MATERIAL first, then the adicionales in the order they were added.
  const filas = input.insumos
    .map((insumo, i) => ({ insumo, droga: drogas[i]! }))
    .sort((a, b) => (a.insumo.tipo === b.insumo.tipo ? 0 : a.insumo.tipo === "MATERIAL" ? -1 : 1));

  // Recorded first: the reserva rows' trigger checks the preparación's insumo drogas.
  await insertInsumosPreparacion(tx, {
    tenantId,
    preparacionId: input.preparacionId,
    insumos: filas.map(({ insumo, droga }) => ({
      tipo: insumo.tipo,
      drogaId: droga.id,
      cantidad: insumo.cantidad.toString(),
      texto: textoInsumo(droga.nombre, insumo.cantidad.toString(), droga.unidadSimbolo),
    })),
  });
  const resumenes: ResumenInsumo[] = [];
  for (const { insumo, droga } of filas) {
    const resumen = await planDeInsumo(tx, tenantId, {
      preparacionId: input.preparacionId,
      tipo: insumo.tipo,
      drogaId: droga.id,
      drogaNombre: droga.nombre,
      unidadSimbolo: droga.unidadSimbolo,
      cantidad: insumo.cantidad,
      jornada: input.jornada,
      mensajeFaltante: `Ingresá stock del ${nombreTipoInsumo(insumo.tipo)} o elegí otro.`,
    });
    await insertReservasSinLinea(tx, { tenantId, preparacionId: input.preparacionId, reservadaPorId: session.usuario.id, partes: resumen.partidas });
    resumenes.push(resumen);
  }
  return resumenes;
}

/**
 * Re-plans every insumo's reserva over its droga's eligible partidas WITHOUT writing: the caller deletes the
 * preparación's reservas and then writes the result (`guardarReservaInsumosEnTx`), so a failed re-plan leaves the
 * reserva as it was. `[]` = the preparación has no insumos.
 */
export async function replanificarInsumosEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { preparacionId: string; jornada: string },
): Promise<ResumenInsumo[]> {
  const resumenes: ResumenInsumo[] = [];
  for (const insumo of await listInsumosDePreparacion(tx, session.tenantId, input.preparacionId)) {
    resumenes.push(
      await planDeInsumo(tx, session.tenantId, {
        preparacionId: input.preparacionId,
        tipo: insumo.tipo,
        drogaId: insumo.drogaId,
        drogaNombre: insumo.drogaNombre,
        unidadSimbolo: insumo.unidadSimbolo,
        cantidad: dec(insumo.cantidad),
        jornada: input.jornada,
        mensajeFaltante: `Liberá la reserva y elegí otro ${nombreTipoInsumo(insumo.tipo)}, o ingresá stock.`,
      }),
    );
  }
  return resumenes;
}

/** Writes the re-planned insumo reservas (`replanificarInsumosEnTx`), each replacing its previous one. */
export async function guardarReservaInsumosEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  preparacionId: string,
  resumenes: readonly ResumenInsumo[],
): Promise<void> {
  for (const resumen of resumenes) {
    await deleteReservasSinLinea(tx, session.tenantId, preparacionId, resumen.drogaId);
    await insertReservasSinLinea(tx, { tenantId: session.tenantId, preparacionId, reservadaPorId: session.usuario.id, partes: resumen.partidas });
  }
}

/** Descuenta the insumos at the confirmation: EGRESO_PREPARACION without línea over each one's reserved partidas. */
export async function consumirInsumosEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { preparacionId: string; jornada: string },
): Promise<void> {
  const { tenantId } = session;
  for (const insumo of await listInsumosDePreparacion(tx, tenantId, input.preparacionId)) {
    const nombre = nombreTipoInsumo(insumo.tipo);
    const reservadas = await listReservasSinLinea(tx, tenantId, input.preparacionId, insumo.drogaId);
    if (reservadas.length === 0) throw new DomainError(`No hay stock reservado del ${nombre} ${insumo.drogaNombre}: recalculá la reserva.`);
    const resumen = await planDeInsumo(tx, tenantId, {
      preparacionId: input.preparacionId,
      tipo: insumo.tipo,
      drogaId: insumo.drogaId,
      drogaNombre: insumo.drogaNombre,
      unidadSimbolo: insumo.unidadSimbolo,
      cantidad: dec(insumo.cantidad),
      jornada: input.jornada,
      mensajeFaltante: "Recalculá la reserva.",
      partidaIds: reservadas.map((r) => r.partidaId),
    });
    for (const parte of resumen.partidas) {
      await insertEgresoPreparacion(tx, {
        tenantId,
        partidaId: parte.partidaId,
        cantidad: parte.cantidad,
        preparacionId: input.preparacionId,
        lineaPesajeId: null,
        registradoPorId: session.usuario.id,
        desvioPropuesta: false,
        potenciaAplicada: null,
      });
    }
  }
}
