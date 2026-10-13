/**
 * The password step of the Director Técnico's own actions on a partida
 * (docs/specs/reanalisis-partida.md): "Registrar reanálisis" and "Marcar como
 * vencida". Only a DT vigente (titular or suplente) may perform them, and they
 * do it themselves: the session's usuario IS the DT, who confirms with THEIR
 * OWN password in the same act (like the cierre firma, user decision 6 --
 * never a PIN, never another DT's co-firma).
 *
 * It is this module's own instance of the stock co-firma
 * (`verificarCoFirmaDtEnTx`, ./verificar-co-firma-dt.ts) with the DT fixed to
 * the session's usuario -- the "own defineCommand per permiso" that file asks
 * of every new caller. That reuses, unchanged, everything that matters:
 * argon2 verification, "DT vigente today" (`fsj.es_dt_vigente`), the shared
 * lockout counters (rate limiting) and the audit of every failed attempt.
 * Never throws for a rejected password (see RATE LIMITING there): it returns
 * `{ ok: false }` so the failure bookkeeping commits.
 *
 * Permiso `stock.ajuste.autorizar` (the DT's stock-authorization permiso,
 * category operativo): no new permiso, the DT role already holds it.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { verificarCoFirmaDtEnTx } from "./verificar-co-firma-dt";

export const verificarPasswordDtPartidaCommand = defineCommand({
  name: "stock.partida.verificarPasswordDt",
  permiso: "stock.ajuste.autorizar",
  input: z.object({ password: z.string().min(1, "Ingresá tu contraseña.") }),
  audit: { skip: true, reason: "Audits CONDITIONALLY (failed attempts only) inside verificarCoFirmaDtEnTx -- see ./verificar-co-firma-dt.ts." },
  handler: async ({ tx, session, input }) => ({
    output: await verificarCoFirmaDtEnTx(tx, session, { dtUsuarioId: session.usuario.id, password: input.password }),
  }),
});
