/**
 * `generarEtiqueta` (M11, FASE 8 point 8.5). FAR/DT (plan §7:
 * `etiquetas.generar`, "Preparación CONFIRMADA"). The DB's own
 * `trg_etiqueta_validar_preparacion_confirmada` trigger (migration 0013)
 * is the real backstop -- this pre-check exists purely for a clear message.
 * At most one etiqueta per preparación (`etiqueta_preparacion_key` UNIQUE,
 * migration 0013) -- generating again is rejected with a friendly message
 * instead of a raw unique violation.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { armarContenidoEtiqueta, formatearContenidoEtiqueta } from "../domain/etiqueta";
import { getPreparacionParaEtiqueta, getEtiquetaExistente, insertEtiqueta } from "../infrastructure/preparacion-repository";

const generarEtiquetaInput = z.object({ preparacionId: uuid });

export interface GenerarEtiquetaInput {
  preparacionId: string;
}

export const generarEtiquetaCommand = defineCommand({
  name: "etiquetas.generar",
  permiso: "etiquetas.generar",
  input: generarEtiquetaInput,
  // Impresión no se audita (plan §14); generación tampoco figura entre los
  // eventos INV-A01 -- pero como SÍ crea un registro nuevo (etiqueta), se
  // audita igual que cualquier otra creación para trazabilidad completa.
  audit: { entidad: "etiqueta", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const etiqueta = await generarEtiquetaEnTx(tx, session.tenantId, input.preparacionId);

    return {
      output: { id: etiqueta.id },
      audit: {
        entidadId: etiqueta.id,
        valorNuevo: { preparacionId: input.preparacionId, preparacion: etiqueta.preparacion },
      },
    };
  },
});

/**
 * The generation itself (checks + INSERT), inside the caller's transaction:
 * also run by `confirmarReservaStock` (./confirmar-reserva-stock.ts) right
 * after it confirms the preparación, in the SAME transaction. The caller
 * declares the permiso and the audit; `preparacion` is the audit's human
 * label.
 */
export async function generarEtiquetaEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  preparacionId: string,
): Promise<{ id: string; preparacion: string }> {
  const existente = await getEtiquetaExistente(tx, tenantId, preparacionId);
  if (existente) {
    throw new DomainError("Ya existe una etiqueta generada para esta preparación.");
  }

  const datos = await getPreparacionParaEtiqueta(tx, tenantId, preparacionId);
  if (!datos) {
    throw new NotFoundError("La preparación no existe o no está CONFIRMADA: solo se puede generar la etiqueta de una preparación confirmada.");
  }

  const contenido = formatearContenidoEtiqueta(armarContenidoEtiqueta(datos));
  const etiqueta = await insertEtiqueta(tx, tenantId, preparacionId, contenido);
  return {
    id: etiqueta.id,
    preparacion: `${datos.itemDescripcion ?? datos.formaFarmaceutica}${datos.asientoNumeroCorrelativo ? ` — asiento Nº ${datos.asientoNumeroCorrelativo}` : ""}`,
  };
}

export async function generarEtiqueta(input: GenerarEtiquetaInput): Promise<{ id: string }> {
  return generarEtiquetaCommand.execute(input);
}
