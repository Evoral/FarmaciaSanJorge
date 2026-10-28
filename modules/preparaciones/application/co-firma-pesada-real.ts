/**
 * The DT co-firma of a pesada real outside the tolerance (openspec/specs/pesada-real/spec.md), in the "Marcar como preparada"
 * / "Recalcular reserva" / confirmation form itself: the DT picks themselves and types their own password. Verified in
 * its own transaction (the stock co-firma, `verificarCoFirmaDtEnTx`: failed attempts are audited and count towards the
 * DT's lockout), then the command runs with the verified DT id -- the same structure as "Registrar pérdida"
 * (./registrar-perdida-reserva.ts). Permiso `preparaciones.confirmar`, not the stock module's.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { verificarCoFirmaDtEnTx } from "@/modules/stock/application/verificar-co-firma-dt";
import type { CoFirmaPesadaInput } from "./confirmar-preparacion";

export const verificarCoFirmaPesadaCommand = defineCommand({
  name: "preparaciones.pesada.verificarCoFirmaDt",
  permiso: "preparaciones.confirmar",
  input: z.object({ dtUsuarioId: uuid, password: z.string().min(1) }),
  audit: { skip: true, reason: "Audits CONDITIONALLY (failed attempts only) inside verificarCoFirmaDtEnTx -- see modules/stock/application/verificar-co-firma-dt.ts." },
  handler: async ({ tx, session, input }) => ({ output: await verificarCoFirmaDtEnTx(tx, session, input) }),
});

/**
 * The verified DT id, or `undefined` when the form sent no co-firma (no pesada outside the tolerance). The plan
 * decides whether it was needed: a co-firma sent for a pesada inside the tolerance is simply not recorded.
 */
export async function autorizacionDePesadaReal(input: CoFirmaPesadaInput): Promise<string | undefined> {
  if (!input.dtUsuarioId && !input.dtPassword) return undefined;
  if (!input.dtUsuarioId || !input.dtPassword) {
    throw new DomainError("Para la co-firma elegí el Director Técnico e ingresá su contraseña.", { fields: ["dtUsuarioId", "dtPassword"] });
  }
  const coFirma = await verificarCoFirmaPesadaCommand.execute({ dtUsuarioId: input.dtUsuarioId, password: input.dtPassword });
  if (!coFirma.ok) throw new DomainError(coFirma.message, { fields: ["dtPassword"] });
  return coFirma.dtUsuarioId;
}
