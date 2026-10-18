/**
 * D8 (docs/specs/libro-recetario-y-contralor.md §1, migration 0082): the receta's ONE SISTEMA asiento in the libro
 * recetario, written after every ítem of the transaction was confirmed (`confirmarPreparacionEnTx`,
 * ./confirmar-preparacion.ts), inside the caller's transaction -- by "Imprimir etiquetas" (`confirmarReservasReceta`)
 * with every ítem it confirmed, and by the legacy single path (`confirmarPreparacion`) with its one preparación.
 *
 *   1. Friendly INV-L24 pre-check: the receta has no por-receta asiento yet (the partial unique index is the backstop).
 *   2. `asiento_preparacion` + `detalle_asiento` rows, then the `asiento_recetario` (`insertAsientoRecetario`): one
 *      number and one snapshot -- paciente/médico from the receta, the fórmula of each ítem (drogas only) joined by " | ",
 *      the detalle lines of every ítem with a continuous `orden` (domain/asiento-receta.ts). Correlativo and hash (V4)
 *      are assigned by the DB.
 *   3. One `asiento_contralor` EGRESO per controlled movimiento of every ítem, now that the asiento id exists
 *      (INV-L08, same transaction).
 *
 * Not a use case on its own: the caller declares the permiso, the step-up and the audit.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { formatearMedicoTexto, formatearPacienteTexto } from "../domain/preparacion";
import { ensamblarDetallesReceta, formatearFormulaReceta, preparacionesDelAsiento, type ItemDelAsiento } from "../domain/asiento-receta";
import { getAsientoSistemaDeReceta, insertAsientoContralorEgreso, insertAsientoRecetario, type RecetaContextoAsiento } from "../infrastructure/preparacion-repository";
import { mensajeParaInvariante } from "../domain/mensajes-invariantes";
import type { EgresoControlado } from "./confirmar-preparacion";

export interface ItemParaAsiento extends ItemDelAsiento {
  egresosControlados: readonly EgresoControlado[];
}

export async function registrarAsientoRecetaEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { contexto: RecetaContextoAsiento; items: readonly ItemParaAsiento[] },
): Promise<{ id: string; numeroCorrelativo: string }> {
  const { contexto, items } = input;
  if (items.length === 0) throw new DomainError("No hay ítems confirmados para registrar en el libro recetario.");

  const existente = await getAsientoSistemaDeReceta(tx, session.tenantId, contexto.recetaId);
  if (existente) {
    throw new DomainError(`Esta receta ya está registrada en el libro recetario (asiento Nº ${existente.numeroCorrelativo}): no se puede registrar otro asiento.`);
  }

  try {
    const asiento = await insertAsientoRecetario(tx, {
      tenantId: session.tenantId,
      recetaId: contexto.recetaId,
      preparaciones: preparacionesDelAsiento(items),
      pacienteTexto: formatearPacienteTexto(contexto.pacienteNombre, contexto.pacienteApellido),
      medicoTexto: formatearMedicoTexto(contexto.medicoNombre, contexto.medicoApellido, contexto.medicoMatricula),
      formulaTexto: formatearFormulaReceta(items),
      registradoPorId: session.usuario.id,
      detalles: ensamblarDetallesReceta(items),
    });

    for (const item of [...items].sort((a, b) => a.numero - b.numero)) {
      for (const egreso of item.egresosControlados) {
        await insertAsientoContralorEgreso(tx, {
          tenantId: session.tenantId,
          drogaId: egreso.drogaId,
          drogaDescripcion: egreso.drogaNombre,
          cantidad: egreso.cantidad,
          unidadMedidaId: egreso.unidadBaseId,
          movimientoStockId: egreso.movimientoId,
          asientoRecetarioId: asiento.id,
          registradoPorId: session.usuario.id,
        });
      }
    }

    return asiento;
  } catch (e) {
    // Same mapping as confirmar-preparacion.ts#comoErrorDeDominio (not imported: that module imports this one).
    const mapped = mapDbError(e);
    throw mapped instanceof InvariantViolationError ? new DomainError(mensajeParaInvariante(mapped.invariantCode), { cause: mapped }) : mapped;
  }
}
