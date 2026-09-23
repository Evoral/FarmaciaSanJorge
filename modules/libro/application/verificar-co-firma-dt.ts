/**
 * `verificarCoFirmaDt(dtUsuarioId, password)` for FASE 9's anulación de
 * asiento (M12 point 9.2, DP-08b: "co-firma en el mismo acto, igual que
 * ajustes"). This is the module's OWN `defineCommand` instance of the
 * pattern `modules/stock/application/verificar-co-firma-dt.ts` establishes
 * -- that file's doc comment says explicitly that a future caller needing a
 * different `permiso` (this one: `libro.anulacion.solicitar`, not
 * `stock.ajuste.registrar`) needs its own instance, since `defineCommand`'s
 * `permiso` is fixed per use case.
 *
 * Reuses `modules/stock/domain/co-firma.ts` UNCHANGED (pure decision table,
 * no I/O -- cross-module domain imports are not restricted by
 * eslint.config.mjs, only `infrastructure/` reach-ins are), but uses this
 * module's OWN `infrastructure/co-firma-repository.ts` (see that file's doc
 * comment for why it cannot import the stock module's copy).
 *
 * See the stock module's file for the full rationale behind every
 * non-obvious choice here (rate limiting reusing usuario.intentos_fallidos,
 * the generic error message, auditing failures only, why this throws
 * nothing on a rejected co-signature). Kept in lockstep with that file on
 * purpose -- do not let the two drift on behavior, only on permiso/imports.
 *
 * D7 (user decision, 2026-09-23): `requireRecentReauth` runs BEFORE the
 * handler evaluates any DT credential -- an operator whose OWN step-up has
 * expired can no longer spend the DT's password attempts by calling this
 * command over and over (the final `anularAsientoCommand`/
 * `rectificarAsientoCommand` already required the requester's re-auth, but
 * only AFTER this command had already run and possibly locked out the DT).
 * Same fix applied in lockstep to `modules/stock/application/verificar-co-firma-dt.ts`.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { verifyPassword } from "@/modules/auth/domain/password";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { record as auditRecord, TipoAccion } from "@/shared/audit";
import { decideCoFirma } from "@/modules/stock/domain/co-firma";
import { resolveDtCandidato, esDtVigenteHoy, recordCoFirmaFailure, recordCoFirmaSuccess } from "../infrastructure/co-firma-repository";

export const CO_FIRMA_LIBRO_GENERIC_ERROR =
  "No se pudo validar la contraseña del Director Técnico. Verificá el usuario y la contraseña, o que la designación esté vigente.";

const verificarCoFirmaDtInput = z.object({
  dtUsuarioId: uuid,
  password: z.string().min(1),
});

export interface VerificarCoFirmaDtLibroInput {
  dtUsuarioId: string;
  password: string;
}

export type CoFirmaLibroResult = { ok: true; dtUsuarioId: string } | { ok: false; message: string };

export const verificarCoFirmaDtLibroCommand = defineCommand<VerificarCoFirmaDtLibroInput, CoFirmaLibroResult>({
  name: "libro.anulacion.verificarCoFirmaDt",
  // The operator requesting the anulación must already hold
  // libro.anulacion.solicitar -- see this file's module doc comment.
  permiso: "libro.anulacion.solicitar",
  // D7 (2026-09-23): the requester's OWN step-up, checked BEFORE any DT
  // credential is evaluated -- see this file's module doc comment.
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: verificarCoFirmaDtInput,
  audit: { skip: true, reason: "Audits CONDITIONALLY (failed attempts only) via a manual auditRecord call -- see this file's module doc comment." },
  handler: async ({ tx, session, input }) => {
    const candidate = await resolveDtCandidato(tx, session.tenantId, input.dtUsuarioId);

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
      await recordCoFirmaSuccess(tx, candidate!.usuarioId);
      const output: CoFirmaLibroResult = { ok: true, dtUsuarioId: candidate!.usuarioId };
      return { output };
    }

    if (decision === "PASSWORD_INCORRECTA" && candidate) {
      const intentosFallidos = candidate.intentosFallidos + 1;
      const lockedOut = intentosFallidos >= AUTH_POLICY.maxFailedLoginAttempts;
      const bloqueadoHasta = lockedOut ? new Date(now.getTime() + AUTH_POLICY.lockoutMinutes * 60 * 1000) : null;
      await recordCoFirmaFailure(tx, candidate.usuarioId, { intentosFallidos, bloqueadoHasta });
    }

    await auditRecord(tx, {
      tenantId: session.tenantId,
      usuarioId: session.usuario.id,
      entidad: "co_firma_dt",
      entidadId: input.dtUsuarioId,
      accion: TipoAccion.AUTORIZAR,
      motivo: `Co-firma de Director Técnico rechazada para anulación de asiento (motivo interno: ${decision}).`,
    });

    const output: CoFirmaLibroResult = { ok: false, message: CO_FIRMA_LIBRO_GENERIC_ERROR };
    return { output };
  },
});

export async function verificarCoFirmaDtLibro(input: VerificarCoFirmaDtLibroInput): Promise<CoFirmaLibroResult> {
  return verificarCoFirmaDtLibroCommand.execute(input);
}
