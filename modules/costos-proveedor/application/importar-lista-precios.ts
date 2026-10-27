/**
 * `importarListaPrecios` -- confirmation of a supplier price list import
 * (openspec/specs/costos-proveedor/spec.md R13, R19-R23; CP8-CP10). Permiso `costos.proveedor.gestionar`.
 * ONE transaction, ALL OR NOTHING:
 *
 *   1. the fecha de la lista (a real day, not after the jornada, R8) and the file (SHA-256) not
 *      imported before for this proveedor (R21, with the date of that import in the message);
 *   2. the rows go through `registrarFilasEnTx` (./registrar-costos-proveedor.ts), THE only writer
 *      of `costo_proveedor` -- the same validation, versioning (R9, R10), optimistic check (R23) and audit
 *      as a manual entry; every row is dated with the list's date. ANY refused row rejects the whole
 *      confirmation with `fields: ["filas.<i>.<campo>"]` (R20) and, because the lista header is inserted
 *      only after every row passed (`crearListaPrecio`), nothing at all is written (CP8);
 *   3. the `lista_precio_proveedor` header, inside `crearListaPrecio`: `filas_aplicadas` is the count of
 *      costos really written (rows that turn out to be sin cambios do not count). The table is append-only,
 *      so the header can not be completed afterwards; and the costos reference it, so it comes before them.
 *      A unique violation on the hash (two confirmations racing) becomes the friendly R21 message;
 *   4. the synonyms the user chose to remember ("recordar equivalencia"), exactly as the invoice import does
 *      (modules/stock/application/importar-factura-compra.ts): idempotent for the same droga, refused when a
 *      vigente synonym points to ANOTHER droga, never created for a text that already is a droga's name.
 *
 * The client sends back only the rows the user kept (ASOCIADA), with the fields the command needs. The preview
 * is never trusted: every value is validated again here.
 *
 * Audit: one record per created costo (by `registrarFilasEnTx`), one for the lista header and one per synonym,
 * all with `audit.record` in the same transaction -- the pipeline's built-in audit writes exactly one, so
 * this command opts out (same as importarFacturaCompra).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, ValidationError } from "@/shared/errors";
import { formatFecha } from "@/shared/format/fecha";
import { uuid } from "@/shared/validation";
import { normalizarTextoDroga } from "@/modules/recetas/domain/importacion-receta";
import { limpiarSinonimo, SINONIMO_MAX_LARGO } from "@/modules/drogas/domain/sinonimo";
import { mensajeFechaListaInvalida, mensajeListaYaImportada } from "../domain/importacion-lista";
import {
  buscarListaPorHash,
  getContextoTemporal,
  getDrogaAlias,
  getDrogasParaCosto,
  insertDrogaAlias,
  insertListaPrecioProveedor,
} from "../infrastructure/costo-proveedor-repository";
import { MAX_FILAS_COSTOS, registrarFilasEnTx } from "./registrar-costos-proveedor";

const CONTEXTO_AUDITORIA = { origen: "importacion_lista_precios" } as const;

/**
 * One kept row as the form sends it. The SHAPE of every costo field is checked by `registrarFilasEnTx` (so the
 * errors point at `filas.<i>.<campo>`); what is only this command's business is typed here.
 */
const filaImportacionWire = z.object({
  drogaId: z.unknown().optional(),
  precioInformado: z.unknown().optional(),
  unidadPrecioId: z.unknown().optional(),
  descripcionProveedor: z.unknown().optional(),
  /** The id of the vigente costo the preview compared against (`null` = there was none): R23. */
  vigenteEsperadoId: z.unknown().optional(),
  /** "Recordar equivalencia": save the list's text as a synonym of the chosen droga. */
  recordarEquivalencia: z.boolean().optional(),
  /** The row's number in the sheet: only to name it in an error message. */
  numeroFila: z.number().int().positive().optional(),
});

const importarListaPreciosInput = z.object({
  proveedorId: uuid,
  /** `YYYY-MM-DD`, checked against the jornada inside the transaction. */
  fechaLista: z.string().trim(),
  nombreArchivo: z.string().trim().min(1, "Falta el nombre del archivo.").max(255),
  hashSha256: z.string().regex(/^[0-9a-f]{64}$/, "El hash del archivo no es válido: volvé a leerlo."),
  formato: z.enum(["XLS", "XLSX"]),
  filasLeidas: z.number().int().min(0).max(100_000),
  filas: z.array(filaImportacionWire).min(1, "No hay costos para actualizar.").max(MAX_FILAS_COSTOS, `No se pueden cargar más de ${MAX_FILAS_COSTOS} costos juntos.`),
});

/** What the form sends. */
export type ImportarListaPreciosWireInput = z.input<typeof importarListaPreciosInput>;

export interface ResultadoImportacionLista {
  listaPrecioId: string;
  insertados: number;
  reemplazados: number;
  sinCambios: number;
  /** Synonyms created. */
  equivalencias: number;
}

/** Prisma's "unique constraint failed" code (`mapDbError` turns it into a generic message otherwise). */
function esViolacionDeUnicidad(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

export const importarListaPreciosCommand = defineCommand({
  name: "costos-proveedor.importar-lista",
  permiso: "costos.proveedor.gestionar",
  input: importarListaPreciosInput,
  audit: {
    skip: true,
    reason:
      "Writes one audit record per created costo (via registrarFilasEnTx), one for the lista header and one per droga synonym itself, via audit.record in the same transaction -- see the module doc comment.",
  },
  handler: async ({ tx, session, input }) => {
    const { tenantId } = session;
    const { jornadaActual, zonaHoraria } = await getContextoTemporal(tx, tenantId);

    const mensajeFecha = mensajeFechaListaInvalida(input.fechaLista, jornadaActual);
    if (mensajeFecha) throw new ValidationError(mensajeFecha, { fields: ["fechaLista"] });
    if (input.filas.length > input.filasLeidas) {
      throw new ValidationError("Se quieren aplicar más filas que las leídas del archivo. Volvé a leer la lista.");
    }

    // R23: the optimistic check only exists when every row says which vigente it was compared against (`null` = none): never skipped by omission.
    const sinEsperado = input.filas.findIndex((fila) => fila.vigenteEsperadoId === undefined);
    if (sinEsperado !== -1) {
      throw new ValidationError("Falta el dato del costo vigente de una fila: volvé a leer la lista.", { fields: [`filas.${sinEsperado}.vigenteEsperadoId`] });
    }

    // R21, early and with the date; the DB unique is still the last guard (below).
    const yaImportada = await buscarListaPorHash(tx, tenantId, input.proveedorId, input.hashSha256);
    if (yaImportada) throw new DomainError(mensajeListaYaImportada(formatFecha(yaImportada.registradoEn, zonaHoraria)));

    let listaPrecioId = "";
    const resultado = await registrarFilasEnTx(tx, session, {
      proveedorId: input.proveedorId,
      // Every row of the import is dated with the list's date (R3, R13).
      filas: input.filas.map((fila) => ({ ...fila, fechaPrecio: input.fechaLista })),
      listaPrecioId: null,
      mensajeConflicto: (drogaNombre) => `El costo de ${drogaNombre} cambió mientras revisabas la lista. Volvé a leer el archivo.`,
      etiquetaFila: (indice) => String(input.filas[indice]?.numeroFila ?? indice + 1),
      contexto: CONTEXTO_AUDITORIA,
      crearListaPrecio: async ({ filasAplicadas, proveedor }) => {
        let lista: { id: string };
        try {
          lista = await insertListaPrecioProveedor(tx, {
            tenantId,
            proveedorId: input.proveedorId,
            formato: input.formato,
            nombreArchivo: input.nombreArchivo,
            hashSha256: input.hashSha256,
            fechaLista: input.fechaLista,
            filasLeidas: input.filasLeidas,
            filasAplicadas,
            registradoPorId: session.usuario.id,
          });
        } catch (error) {
          if (esViolacionDeUnicidad(error)) throw new DomainError("Esta lista ya fue importada para este proveedor.");
          throw error;
        }
        await auditRecord(tx, {
          tenantId,
          usuarioId: session.usuario.id,
          entidad: "lista_precio_proveedor",
          entidadId: lista.id,
          accion: TipoAccion.CREAR,
          contexto: CONTEXTO_AUDITORIA,
          valorNuevo: {
            proveedor: proveedor.razonSocial,
            formato: input.formato,
            nombreArchivo: input.nombreArchivo,
            hashSha256: input.hashSha256,
            fechaLista: input.fechaLista,
            filasLeidas: input.filasLeidas,
            filasAplicadas,
          },
        });
        listaPrecioId = lista.id;
        return lista.id;
      },
    });

    // "Recordar equivalencia": the list's text becomes a synonym of the droga the user chose (openspec/specs/sinonimos-droga/spec.md).
    const aRecordar = input.filas.flatMap((fila, indice) => {
      const drogaId = uuid.safeParse(fila.drogaId);
      const texto = typeof fila.descripcionProveedor === "string" ? limpiarSinonimo(fila.descripcionProveedor) : "";
      // A text longer than a synonym may be (DB limit) is not remembered; the row itself is still applied.
      return fila.recordarEquivalencia === true && drogaId.success && texto.length > 0 && texto.length <= SINONIMO_MAX_LARGO ? [{ indice, drogaId: drogaId.data, texto }] : [];
    });
    const nombresDroga = await getDrogasParaCosto(tx, tenantId, aRecordar.map((equivalencia) => equivalencia.drogaId));
    const vistos = new Set<string>();
    let equivalencias = 0;
    for (const equivalencia of aRecordar) {
      const aliasNormalizado = normalizarTextoDroga(equivalencia.texto);
      if (aliasNormalizado.length === 0 || vistos.has(aliasNormalizado)) continue;
      vistos.add(aliasNormalizado);
      // A vigente synonym of the same droga, or a text that already IS a vigente droga's name, is left as it is.
      const existente = await getDrogaAlias(tx, tenantId, aliasNormalizado);
      if (existente) {
        if (existente.drogaId === equivalencia.drogaId || existente.esNombre) continue;
        throw new DomainError(`«${equivalencia.texto}» ya está asociado a otra droga. Volvé a leer la lista.`, { fields: [`filas.${equivalencia.indice}.drogaId`] });
      }
      const alias = await insertDrogaAlias(tx, { tenantId, drogaId: equivalencia.drogaId, aliasNormalizado, texto: equivalencia.texto, creadoPorId: session.usuario.id });
      await auditRecord(tx, {
        tenantId,
        usuarioId: session.usuario.id,
        entidad: "droga_alias",
        entidadId: alias.id,
        accion: TipoAccion.CREAR,
        contexto: CONTEXTO_AUDITORIA,
        valorNuevo: { sinonimo: equivalencia.texto, aliasNormalizado, drogaId: equivalencia.drogaId, droga: nombresDroga.get(equivalencia.drogaId)?.nombre ?? null },
      });
      equivalencias += 1;
    }

    return {
      output: {
        listaPrecioId,
        insertados: resultado.insertados,
        reemplazados: resultado.reemplazados,
        sinCambios: resultado.sinCambios,
        equivalencias,
      } satisfies ResultadoImportacionLista,
    };
  },
});

export async function importarListaPrecios(input: ImportarListaPreciosWireInput): Promise<ResultadoImportacionLista> {
  return importarListaPreciosCommand.execute(input);
}
