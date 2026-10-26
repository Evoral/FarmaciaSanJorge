/**
 * `marcarPagoReceta` (migration 0071, openspec/specs/pago-receta/spec.md): marks a receta paid or unpaid from its detail --
 * to record a payment made between the alta and the entrega, or to fix a mistake. Permiso `recetas.editar`
 * (ATP/FAR/DT, the receta-mutation permiso that is not `recetas.anular`); it is NOT tied to `esEstadoEditable`,
 * because payment after delivery is valid. Alta and entrega mark the payment through their own commands; the edit
 * (editar-receta.ts) runs the same change through `aplicarCambioPago`, so both screens obey one set of rules.
 *
 * `pagadaEn` (the transaction's time) and `pagadaPorId` (the session's usuario) are set by the server, never by
 * the client; unmarking clears all three columns. Lock BEFORE the fresh read (M3 discipline). The ANULADA receta
 * is refused with a clear message (domain/pago.ts; DB backstop INV-R13).
 *
 * Idempotent: asking for the state the receta already has is a NO-OP -- it never overwrites who paid or when, and
 * it leaves no audit row (nothing changed). So, like modules/recetas/application/importar-receta.ts, the audit
 * is declared `skip` and the row (entidad "receta", MODIFICAR, `pagada` before/after) is written here with
 * `audit.record` -- inside the same transaction -- only when the flag actually changes.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { CommandHandlerArgs } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { MENSAJE_PAGO_RECETA_ENTREGADA, decidirCambioPago, puedeDesmarcarPago, validarPagoModificable } from "../domain/pago";
import type { CambioPago } from "../domain/pago";
import { getPagoDeReceta, lockRecetaParaAccion, setPagoDeReceta } from "../infrastructure/receta-repository";

const marcarPagoRecetaInput = z.object({ id: uuid, pagada: z.boolean() });

export type MarcarPagoRecetaInput = z.infer<typeof marcarPagoRecetaInput>;

export const marcarPagoRecetaCommand = defineCommand({
  name: "recetas.marcarPago",
  permiso: "recetas.editar",
  input: marcarPagoRecetaInput,
  audit: {
    skip: true,
    reason: "Idempotent: asking for the state the receta already has changes nothing and leaves no row; a real change is audited here with audit.record in the same transaction.",
  },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const cambio = await aplicarCambioPago({ tx, session }, input.id, input.pagada);

    return { output: { id: input.id, cambio } };
  },
});

/**
 * Applies a payment change to a receta the caller has ALREADY locked (`lockRecetaParaAccion`): fresh read, estado
 * rules, the write and its audit row -- only when the flag actually changes.
 */
export async function aplicarCambioPago({ tx, session }: Pick<CommandHandlerArgs<unknown>, "tx" | "session">, id: string, pagada: boolean): Promise<CambioPago> {
  const actual = await getPagoDeReceta(tx, session.tenantId, id);
  if (!actual) throw new NotFoundError("Receta no encontrada.");

  validarPagoModificable(actual.estado);

  const cambio = decidirCambioPago(actual.pagada, pagada);
  if (cambio === "desmarcar" && !puedeDesmarcarPago(actual.estado)) {
    throw new DomainError(MENSAJE_PAGO_RECETA_ENTREGADA);
  }
  if (cambio !== "sin-cambio") {
    await setPagoDeReceta(tx, session.tenantId, id, pagada, session.usuario.id);
    await auditRecord(tx, {
      tenantId: session.tenantId,
      usuarioId: session.usuario.id,
      entidad: "receta",
      entidadId: id,
      accion: TipoAccion.MODIFICAR,
      valorAnterior: { pagada: actual.pagada },
      valorNuevo: { pagada },
    });
  }
  return cambio;
}

export async function marcarPagoReceta(input: MarcarPagoRecetaInput): Promise<{ id: string; cambio: CambioPago }> {
  return marcarPagoRecetaCommand.execute(input);
}
