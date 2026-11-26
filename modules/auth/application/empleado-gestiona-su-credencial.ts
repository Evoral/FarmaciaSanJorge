/**
 * The preamble every "manage my OWN credential" use case shares (`configurarPin`, `registrarCredencialOperador`,
 * `eliminarCredencialOperador`): the session's usuario row must exist, must not be a cuenta de sector (it never holds a
 * credential of its own, the empleado does), optionally must not be an Administrador-only usuario (it never acts as an
 * operador), and optionally must prove identity with the CURRENT password. Each caller says its own error texts.
 */
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/shared/errors";
import type { AuthenticatedSession } from "../domain/session";
import { verifyPassword } from "../domain/password";
import { loadEsSoloAdministrador, loadUsuarioParaPassword } from "../infrastructure/usuario-repository";

export interface OpcionesGuardaCredencialPropia {
  /** Said when the session's own usuario row is not found (should be unreachable). */
  noSePudo: string;
  /** Said for a cuenta de sector. */
  sector: string;
  /** When present, a usuario whose only role is Administrador is rejected with this text. */
  administrador?: string;
  /** When present, the current password is verified (the inline proof of identity). */
  passwordActual?: string;
}

/** Throws a `DomainError` unless the session's usuario may manage their own credential; returns the loaded usuario row. */
export async function assertEmpleadoGestionaSuCredencial(tx: Prisma.TransactionClient, session: AuthenticatedSession, opciones: OpcionesGuardaCredencialPropia) {
  const usuario = await loadUsuarioParaPassword(tx, session.usuario.id);
  if (!usuario) {
    // Should be unreachable (the session's own usuario row always exists), but never trust it silently.
    throw new DomainError(opciones.noSePudo);
  }
  if (session.sector || usuario.esSector) {
    throw new DomainError(opciones.sector);
  }
  if (opciones.administrador !== undefined && (await loadEsSoloAdministrador(tx, session.usuario.id))) {
    throw new DomainError(opciones.administrador);
  }
  if (opciones.passwordActual !== undefined && !(await verifyPassword(usuario.passwordHash, opciones.passwordActual))) {
    throw new DomainError("La contraseña actual no es correcta.");
  }
  return usuario;
}
