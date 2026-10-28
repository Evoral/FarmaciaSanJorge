/**
 * `restablecerPin` (docs/specs/restablecer-pin.md): the Administrador clears
 * a usuario's PIN, e.g. because they forgot it. Only the PIN columns change
 * (hash, failed-attempt counter, block -- RP4): the password, the estado and
 * the roles stay, and no session is revoked (RP5). The PIN is mandatory, so
 * the "configurar-pin" step follows by derivation (`derivarPasosPendientes`)
 * on the usuario's next request; no new column or flag is written.
 *
 * Same permiso as `restablecerCredencial` (RP1) and the same "no sobre sí
 * mismo" rule (RP2): a usuario changes their own PIN from «Mi cuenta». Rejected
 * for a BAJA usuario, a cuenta de sector, an admin-only usuario (neither has a
 * PIN) and a usuario without a PIN (RP3).
 *
 * Locks the target row FIRST via `lockUsuarioYAdministradoresActivos` (RP6,
 * same statement/order as every other state-changing usuarios command -- see
 * admin-guard.ts's LOCK ORDER doc comment): a double click or two
 * Administradores at once yield one success and one "no tiene un PIN
 * configurado", never two audit rows.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { esAccionSobreSiMismo } from "../domain/reglas-admin";
import { lockUsuarioYAdministradoresActivos } from "../infrastructure/admin-guard";
import { limpiarPin, loadUsuarioParaRestablecerPin } from "../infrastructure/usuario-repository";

const restablecerPinInput = z.object({ usuarioId: uuid });

export type RestablecerPinInput = z.infer<typeof restablecerPinInput>;

export const restablecerPinCommand = defineCommand({
  name: "usuarios.pin.restablecer",
  permiso: "usuarios.credencial.restablecer",
  input: restablecerPinInput,
  audit: { entidad: "usuario", accion: "RESTABLECER_CREDENCIAL" },
  handler: async ({ tx, session, input }) => {
    if (esAccionSobreSiMismo(session.usuario.id, input.usuarioId)) {
      throw new DomainError("No podés restablecer tu propio PIN. Cambialo desde Mi cuenta.");
    }

    // RP6: lock the target row first -- see admin-guard.ts's LOCK ORDER doc
    // comment. `idsAdminsActivos` is unused here (no last-admin check).
    await lockUsuarioYAdministradoresActivos(tx, session.tenantId, input.usuarioId);

    const actual = await loadUsuarioParaRestablecerPin(tx, session.tenantId, input.usuarioId);
    if (!actual) throw new NotFoundError("Usuario no encontrado.");

    if (actual.estado === "BAJA") {
      throw new DomainError("El usuario está dado de baja. La baja es definitiva y no admite restablecimiento de PIN.");
    }
    if (actual.esSector) {
      throw new DomainError("Las cuentas de sector no usan PIN.");
    }
    if (actual.soloAdministrador) {
      throw new DomainError("El Administrador no usa PIN.");
    }
    if (!actual.tienePin) {
      throw new DomainError("El usuario no tiene un PIN configurado.");
    }

    await limpiarPin(tx, input.usuarioId, new Date());

    return {
      output: {},
      audit: {
        entidadId: input.usuarioId,
        motivo: "Restablecimiento de PIN por el Administrador.",
        // Never the PIN nor its hash (RP7).
        valorAnterior: { pinBloqueado: actual.pinBloqueado },
        valorNuevo: { pin: "restablecido", pinBloqueado: false },
      },
    };
  },
});

export async function restablecerPin(input: RestablecerPinInput): Promise<void> {
  await restablecerPinCommand.execute(input);
}
