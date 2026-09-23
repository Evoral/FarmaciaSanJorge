/**
 * `verificarCoFirmaDt(dtUsuarioId, password)` (M07, FASE 5 point 5.3,
 * DP-08b RESUELTA: "co-firma en el mismo acto"). Reusable by every command
 * that needs a Director Técnico's co-signature on the SAME screen as the
 * operator's own action -- today `registrar-ajuste.ts`; FASE 9's
 * anulaciones (libro recetario) are expected to reuse this unchanged (that
 * future caller will need its OWN `defineCommand` instance of this file if
 * its permiso differs from `stock.ajuste.registrar` -- `defineCommand`'s
 * `permiso` is fixed per use case, not per call).
 *
 * WHAT THIS IS NOT: it is NOT `requireRecentReauth` (shared/usecase.ts's
 * step-up) -- that re-authenticates the SESSION'S OWN user. This
 * authenticates a DIFFERENT user (the DT), who has no session here at all
 * -- this function NEVER calls `createSession`/`insertSesionInTx`; it only
 * returns a boolean-shaped result.
 *
 * WHY THIS IS `defineCommand`, NOT A PLAIN FUNCTION (like
 * `modules/auth/application/login.ts`): this codebase's ESLint config
 * (`eslint.config.mjs`) forbids importing `shared/db/transaction` directly
 * outside `modules/auth` precisely so "every business transaction goes
 * through requireSession -> authorize -> zod -> tx -> audit" is a real,
 * enforced guarantee, not a convention -- login.ts is the ONE deliberate,
 * grandfathered exception (it runs before any session exists). This
 * function DOES have a session (the operator's), so it uses `defineCommand`
 * like everything else.
 *
 * HOW RATE LIMITING SURVIVES A REJECTED CO-SIGNATURE: the handler NEVER
 * throws for "wrong password"/"unknown DT"/"inactive"/"not vigente" -- it
 * returns `{ ok: false, message }` as a NORMAL result. This matters because
 * `defineCommand`'s transaction commits on a normal return and rolls back
 * on a throw -- if a wrong password were reported by throwing, the SAME
 * rollback would silently undo the `intentos_fallidos` increment this
 * handler just wrote, defeating the lockout. Only a genuinely unexpected
 * failure (a thrown error from the repository layer) should roll back here.
 *
 * `audit: { skip: true, ... }`: the framework's OWN one-audit-per-call
 * contract assumes exactly one write every time, but this command audits
 * CONDITIONALLY (failures only -- the task requires auditing every failed
 * attempt; a successful co-signature is already captured by the caller's
 * own audit row, e.g. registrar-ajuste.ts's `autorizadoPorId`). So the
 * automatic audit is opted out, and `auditRecord` is called manually below,
 * only on the failure path.
 *
 * CALLER CONTRACT (how `autorizado_por_id` NEVER comes from client input,
 * despite the client supplying `dtUsuarioId`): the Server Action that
 * drives an ajuste (`modules/stock/ui/actions.ts#registrarAjusteAction`)
 * calls THIS command first, in its own request; only if it resolves
 * `{ ok: true, dtUsuarioId }` does that SAME server-side function go on to
 * call `registrarAjusteStockCommand.execute(...)`, passing that verified id
 * as `autorizadoPorId` -- the value never round-trips back to the browser
 * in between. The client-supplied `dtUsuarioId` only ever selects WHICH
 * user must prove they hold that password; the actual authorization is
 * this command's server-side verification. The database's own INV-U05
 * trigger (`fsj.movimiento_stock_validar_ajuste`) is the final,
 * independent backstop regardless -- it re-checks DT vigency on the INSERT
 * itself.
 *
 * D7 (user decision, 2026-09-23): `requireRecentReauth` runs BEFORE the
 * handler evaluates any DT credential -- an operator whose OWN step-up has
 * expired can no longer spend the DT's password attempts by calling this
 * command over and over (the final `registrarAjusteStockCommand` already
 * required the requester's re-auth, but only AFTER this command had
 * already run and possibly locked out the DT). Same fix applied in
 * lockstep to `modules/libro/application/verificar-co-firma-dt.ts`.
 *
 * RATE LIMITING (task-required): reuses `usuario.intentos_fallidos`/
 * `bloqueado_hasta` and `AUTH_POLICY.maxFailedLoginAttempts`/
 * `lockoutMinutes` -- the SAME fields/policy as login. This is a
 * deliberate, documented simplification (not a fresh "co-firma attempts"
 * counter): both surfaces are brute-forcing the SAME credential (the DT's
 * password), so sharing the counter is at least as safe as a separate one,
 * and reusing it avoids a schema change (this task allows at most one
 * migration, and none is needed here). A side effect worth knowing: a DT
 * who fails several co-firma attempts will also find their own LOGIN
 * temporarily locked, and vice versa -- acceptable, and arguably correct
 * (both are "someone is guessing this password").
 *
 * GENERIC MESSAGE (task-required): `CO_FIRMA_GENERIC_ERROR` is the ONLY
 * message ever shown to the operator for a rejected co-signature --
 * unknown usuario id, wrong password, inactive usuario, no vigente
 * designation, and locked-out ALL collapse to it (mirrors
 * `modules/auth/application/login.ts`'s `GENERIC_LOGIN_ERROR`). The
 * `CoFirmaDecision` computed internally is used ONLY to decide what to
 * WRITE (lockout bookkeeping, the audit's `motivo`) -- it is never returned
 * to the caller.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { verifyPassword } from "@/modules/auth/domain/password";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { record as auditRecord, TipoAccion } from "@/shared/audit";
import { decideCoFirma } from "../domain/co-firma";
import { resolveDtCandidato, esDtVigenteHoy, recordCoFirmaFailure, recordCoFirmaSuccess } from "../infrastructure/co-firma-repository";

export const CO_FIRMA_GENERIC_ERROR = "No se pudo validar la contraseña del Director Técnico. Verificá el usuario y la contraseña, o que la designación esté vigente.";

const verificarCoFirmaDtInput = z.object({
  dtUsuarioId: uuid,
  password: z.string().min(1),
});

export interface VerificarCoFirmaDtInput {
  dtUsuarioId: string;
  password: string;
}

export type CoFirmaResult = { ok: true; dtUsuarioId: string } | { ok: false; message: string };

export const verificarCoFirmaDtCommand = defineCommand<VerificarCoFirmaDtInput, CoFirmaResult>({
  name: "stock.ajuste.verificarCoFirmaDt",
  // The operator requesting a co-signature must already be able to
  // register an ajuste -- see this module's doc comment for why a future
  // caller with a different permiso (e.g. FASE 9 anulaciones) needs its own
  // defineCommand instance rather than a parameter here.
  permiso: "stock.ajuste.registrar",
  // D7 (2026-09-23): the requester's OWN step-up, checked BEFORE any DT
  // credential is evaluated -- see this file's module doc comment.
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: verificarCoFirmaDtInput,
  audit: { skip: true, reason: "Audits CONDITIONALLY (failed attempts only) via a manual auditRecord call -- see this file's module doc comment." },
  handler: async ({ tx, session, input }) => {
    // "looks up that user IN THE SESSION'S TENANT" -- tenantId comes from
    // the operator's own session, never from client input.
    const candidate = await resolveDtCandidato(tx, session.tenantId, input.dtUsuarioId);

    // ALWAYS run a real argon2 verification, even for an unknown id --
    // verifyPassword(null, ...) falls back to a dummy hash internally
    // (see modules/auth/domain/password.ts), keeping "unknown DT" and
    // "wrong password" timing-indistinguishable, same as login().
    const passwordMatches = await verifyPassword(candidate?.passwordHash ?? null, input.password);
    const esDtVigente = candidate !== null ? await esDtVigenteHoy(tx, session.tenantId, input.dtUsuarioId) : false;

    const now = new Date();
    const decision = decideCoFirma({
      found: candidate !== null,
      estado: candidate?.estado ?? null,
      bloqueadoHasta: candidate?.bloqueadoHasta ?? null,
      passwordMatches,
      esDtVigente,
      now,
    });

    if (decision === "OK") {
      // candidate is non-null whenever decision === "OK" (decideCoFirma's
      // first check is `found`).
      await recordCoFirmaSuccess(tx, candidate!.usuarioId);
      const output: CoFirmaResult = { ok: true, dtUsuarioId: candidate!.usuarioId };
      return { output };
    }

    // Only a WRONG PASSWORD for an otherwise-live, known DT counts toward
    // the lockout -- same discipline as login() (an already-locked,
    // inactive, unknown, or not-vigente candidate gains nothing from
    // further counting).
    if (decision === "PASSWORD_INCORRECTA" && candidate) {
      const intentosFallidos = candidate.intentosFallidos + 1;
      const lockedOut = intentosFallidos >= AUTH_POLICY.maxFailedLoginAttempts;
      const bloqueadoHasta = lockedOut ? new Date(now.getTime() + AUTH_POLICY.lockoutMinutes * 60 * 1000) : null;
      await recordCoFirmaFailure(tx, candidate.usuarioId, { intentosFallidos, bloqueadoHasta });
    }

    // INV-A01: audit EVERY failed co-signature attempt (task-required),
    // authored by the OPERATOR's session (the actor requesting the
    // co-signature), targeting the DT id the operator supplied -- real or
    // not, it is always a well-formed UUID by the time this runs (zod,
    // above). The `motivo` here is an internal detail for `auditoria.ver`
    // (ADM/DT only) -- it is NEVER shown to the operator, who only ever
    // sees `CO_FIRMA_GENERIC_ERROR`.
    await auditRecord(tx, {
      tenantId: session.tenantId,
      usuarioId: session.usuario.id,
      entidad: "co_firma_dt",
      entidadId: input.dtUsuarioId,
      accion: TipoAccion.AUTORIZAR,
      motivo: `Co-firma de Director Técnico rechazada (motivo interno: ${decision}).`,
    });

    const output: CoFirmaResult = { ok: false, message: CO_FIRMA_GENERIC_ERROR };
    return { output };
  },
});

export async function verificarCoFirmaDt(input: VerificarCoFirmaDtInput): Promise<CoFirmaResult> {
  return verificarCoFirmaDtCommand.execute(input);
}
