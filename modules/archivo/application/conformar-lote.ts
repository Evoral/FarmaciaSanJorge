/**
 * FASE 12 point 12.1 (user decision 4): conformar un lote de archivo.
 * `/archivo/nuevo` first previews the eligible recetas for a período
 * (`listRecetasElegiblesArchivo`, a GET query -- periodoDesde/periodoHasta/
 * ubicación are the only values that ever travel through the URL, never a
 * patient name or a receta id), then the confirm step
 * (`conformarLote`, a POST command) RE-COMPUTES the eligible set itself from
 * the same período, inside the same transaction that inserts the lote and
 * assigns every receta -- the client never supplies the receta id list, so
 * there is nothing to tamper with and no risk of a stale preview being
 * blindly trusted.
 *
 * User decision 3: `incluyeControladas` is derived from the selected
 * recetas BEFORE the lote INSERT (`derivarIncluyeControladas`), in the same
 * transaction -- migration 0042's INV-ARC-007 trigger is defense in depth,
 * not the primary mechanism (see that migration's header comment).
 */
import { z } from "zod";
import { defineCommand, defineQuery, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { esRecetaElegibleParaArchivo } from "../domain/lote-archivo";
import { listRecetasElegiblesInput, conformarLoteInput } from "../domain/filtros";
import { mensajeParaInvarianteArchivo } from "../domain/mensajes-invariantes";
import {
  listRecetasElegibles,
  lockRecetasParaArchivo,
  recheckRecetasElegibles,
  derivarIncluyeControladas,
  insertLote,
  asignarRecetasALote,
  type RecetaElegibleRow,
} from "../infrastructure/archivo-repository";

export interface RecetaElegibleItem {
  id: string;
  numeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  estado: "ENTREGADA" | "ANULADA";
  fechaIngreso: string;
}

export const listRecetasElegiblesArchivoQuery = defineQuery({
  name: "archivo.lotes.recetasElegibles",
  permiso: "archivo.lotes.gestionar",
  input: listRecetasElegiblesInput,
  handler: async ({ tx, session, input }): Promise<RecetaElegibleItem[]> => {
    const rows = await listRecetasElegibles(tx, session.tenantId, input.periodoDesde, input.periodoHasta);
    // Defensive double check (same discipline as list-jornadas-pendientes.ts):
    // the repository query already filters in SQL, this re-asserts it in
    // the pure domain function.
    return rows.filter((r) => esRecetaElegibleParaArchivo({ estado: r.estado, recetaFisicaRecibida: true, loteArchivoId: null, fechaIngreso: r.fechaIngreso }, input.periodoDesde, input.periodoHasta));
  },
});

export async function listRecetasElegiblesArchivo(input: z.infer<typeof listRecetasElegiblesInput>): Promise<RecetaElegibleItem[]> {
  return listRecetasElegiblesArchivoQuery.execute(input);
}

export interface LoteConformadoOutput {
  id: string;
  numero: string;
  cantidadRecetas: number;
  incluyeControladas: boolean;
}

export const conformarLoteCommand = defineCommand({
  name: "archivo.lotes.conformar",
  permiso: "archivo.lotes.gestionar",
  input: conformarLoteInput,
  audit: { entidad: "lote_archivo_recetas", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const elegibles: RecetaElegibleRow[] = await listRecetasElegibles(tx, session.tenantId, input.periodoDesde, input.periodoHasta);
    if (elegibles.length === 0) {
      throw new DomainError("No hay recetas elegibles para archivar en ese período.");
    }
    const recetaIds = elegibles.map((r) => r.id);

    const lockedCount = await lockRecetasParaArchivo(tx, session.tenantId, recetaIds);
    if (lockedCount !== recetaIds.length) {
      throw new DomainError("Alguna de las recetas elegibles cambió de estado justo ahora. Volvé a intentarlo.");
    }

    // Re-check eligibility of the now-LOCKED rows: `lockRecetasParaArchivo`
    // only confirmed they still EXIST, not that a concurrent transaction
    // didn't already commit one of them to a DIFFERENT lote right before
    // this lock (see that function's doc comment).
    const stillEligibleIds = await recheckRecetasElegibles(tx, session.tenantId, recetaIds);
    if (stillEligibleIds.length !== recetaIds.length) {
      throw new DomainError("Algunas recetas ya fueron asignadas a otro lote; vuelva a generar la propuesta.");
    }

    const incluyeControladas = await derivarIncluyeControladas(tx, session.tenantId, recetaIds);

    try {
      const lote = await insertLote(tx, {
        tenantId: session.tenantId,
        periodoDesde: input.periodoDesde,
        periodoHasta: input.periodoHasta,
        ubicacion: input.ubicacion,
        incluyeControladas,
        registradoPorId: session.usuario.id,
        recetaIds,
      });
      await asignarRecetasALote(tx, session.tenantId, lote.id, recetaIds);

      const output: LoteConformadoOutput = {
        id: lote.id,
        numero: lote.numero,
        cantidadRecetas: recetaIds.length,
        incluyeControladas,
      };
      return {
        output,
        audit: {
          entidadId: lote.id,
          valorNuevo: { numero: lote.numero, periodoDesde: input.periodoDesde, periodoHasta: input.periodoHasta, ubicacion: input.ubicacion, incluyeControladas, cantidadRecetas: recetaIds.length },
        },
      };
    } catch (e) {
      // Same discipline as firmar-cierre.ts's handler catch: map a DB
      // rejection (e.g. INV-ARC-007 tripping on a race) into a clear
      // Spanish DomainError instead of letting the raw error escape.
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvarianteArchivo(mapped.invariantCode));
      }
      throw mapped;
    }
  },
});

export async function conformarLote(input: z.infer<typeof conformarLoteInput>, options?: ExecuteOptions): Promise<LoteConformadoOutput> {
  return conformarLoteCommand.execute(input, options);
}
