/**
 * Prisma-backed access to `fsj.usuario` / `fsj.credencial_activacion` for
 * M02 login (2.2), activation (2.3), change-password (2.4) and
 * re-authentication (2.5). `resolveLoginByEmail` is the one deliberate RLS
 * bootstrap exception here (mirrors `resolveSessionTenant` in
 * session-repository.ts) -- see migration
 * 0010_usuario_login_resolver for why it has to be. Every other function
 * here runs inside an already-open `withTenantTransaction`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/shared/db/client";

export interface LoginCandidate {
  tenantId: string;
  usuarioId: string;
  passwordHash: string | null;
  estado: string;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

/**
 * RLS bootstrap ONLY (migration 0010, see that file's header): resolves
 * the usuario matching `email` via the SECURITY DEFINER function
 * `fsj.usuario_resolve_login`, with no tenant set. Returns `null` when no
 * usuario has that email (never a row of nulls) -- `login()`/
 * `activarCuenta()` MUST treat this identically to "found, but password/
 * credential did not match" in whatever they show the caller.
 *
 * Deliberately does NOT use `withTenantTransaction` (there is no tenant to
 * set yet) -- runs directly against the shared Prisma client, exactly like
 * `resolveSessionTenant`.
 */
export async function resolveLoginByEmail(email: string): Promise<LoginCandidate | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRaw<
    {
      tenant_id: string;
      usuario_id: string;
      password_hash: string | null;
      estado: string;
      intentos_fallidos: number;
      bloqueado_hasta: Date | null;
    }[]
  >`SELECT * FROM fsj.usuario_resolve_login(${email})`;

  const row = rows[0];
  if (!row) return null;

  return {
    tenantId: row.tenant_id,
    usuarioId: row.usuario_id,
    passwordHash: row.password_hash,
    estado: row.estado,
    intentosFallidos: row.intentos_fallidos,
    bloqueadoHasta: row.bloqueado_hasta,
  };
}

/** Successful login (FASE 2 point 2.2): resets the failed-attempt counter/lockout and stamps `ultimo_acceso`. */
export async function recordLoginSuccess(tx: Prisma.TransactionClient, usuarioId: string, now: Date): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoAcceso: now },
  });
}

export interface LoginFailureUpdate {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

/** Failed login (wrong password) for a KNOWN usuario (FASE 2 point 2.2): persists the new attempt count and, once the threshold is reached, the lockout expiry -- caller (login.ts) computes both via AUTH_POLICY before calling this. */
export async function recordLoginFailure(tx: Prisma.TransactionClient, usuarioId: string, update: LoginFailureUpdate): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: update.intentosFallidos, bloqueadoHasta: update.bloqueadoHasta },
  });
}

export interface UsuarioEmailRow {
  id: string;
  email: string;
  passwordHash: string | null;
  /** PIN re-auth feature: `null` when the usuario has no PIN configured. Included here so `cambiarPassword`/PIN commands, which already load this row to verify the current password, don't need a second round trip. */
  pinHash: string | null;
}

/** Loads the minimum needed to verify/change a usuario's own password (FASE 2 point 2.4/2.5) or PIN (PIN re-auth feature), inside an already-open tenant transaction. */
export async function loadUsuarioParaPassword(tx: Prisma.TransactionClient, usuarioId: string): Promise<UsuarioEmailRow | null> {
  return tx.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, email: true, passwordHash: true, pinHash: true } });
}

/** Sets a new password hash (FASE 2 point 2.4, `cambiarPassword`). Never touches `estado`. */
export async function updatePasswordHash(tx: Prisma.TransactionClient, usuarioId: string, passwordHash: string): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { passwordHash } });
}

// ============================================================================
// PIN re-auth feature (user decision, 2026-09-23)
// ============================================================================

export interface PinEstado {
  pinHash: string | null;
  pinBloqueado: boolean;
  pinIntentosFallidos: number;
}

/** Loads the PIN fields needed by `reautenticar()`'s PIN branch, inside an already-open tenant transaction. */
export async function loadPinEstado(tx: Prisma.TransactionClient, usuarioId: string): Promise<PinEstado | null> {
  return tx.usuario.findUnique({
    where: { id: usuarioId },
    select: { pinHash: true, pinBloqueado: true, pinIntentosFallidos: true },
  });
}

/** Sets/changes the PIN (`configurarPin`): stores the new hash and resets the failed-attempt counter/block -- a freshly (re)set PIN starts clean. */
export async function setPinHash(tx: Prisma.TransactionClient, usuarioId: string, pinHash: string, now: Date): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { pinHash, pinIntentosFallidos: 0, pinBloqueado: false, pinActualizadoEn: now },
  });
}

/** Removes the PIN entirely (`eliminarPin`, and the shared clearing done on ADM credential reset / suspensión / baja -- see modules/usuarios/infrastructure/usuario-repository.ts#cambiarEstadoUsuario). */
export async function clearPin(tx: Prisma.TransactionClient, usuarioId: string, now: Date): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { pinHash: null, pinIntentosFallidos: 0, pinBloqueado: false, pinActualizadoEn: now },
  });
}

/** A successful PASSWORD re-auth resets the PIN counter AND unblocks it (task's binding decision) -- called unconditionally on the password branch's success path, never read-then-write (idempotent regardless of prior state). */
export async function resetPinLockout(tx: Prisma.TransactionClient, usuarioId: string): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { pinIntentosFallidos: 0, pinBloqueado: false } });
}

export interface PinFailureUpdate {
  pinIntentosFallidos: number;
  pinBloqueado: boolean;
}

/** Persists a failed PIN attempt (and the block, once the threshold is reached) -- caller (`reautenticar.ts`) computes both via `AUTH_POLICY.maxFailedPinAttempts`. */
export async function recordPinFailure(tx: Prisma.TransactionClient, usuarioId: string, update: PinFailureUpdate): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { pinIntentosFallidos: update.pinIntentosFallidos, pinBloqueado: update.pinBloqueado },
  });
}

/**
 * Atomically consumes ONE activation credential (INV-AU-002, FASE 2 point
 * 2.3): a single `UPDATE ... WHERE usada_en IS NULL AND revocada_en IS
 * NULL AND vence_en > now() RETURNING`-equivalent (Prisma's `updateMany`
 * compiles to one atomic UPDATE statement with this WHERE clause, which is
 * exactly the atomicity two concurrent activation attempts need -- the
 * loser's WHERE simply matches zero rows once the winner's UPDATE has
 * committed `usada_en`). Scoped additionally to `usuarioId` so a
 * mismatched email (which resolves a different `usuarioId` than the one
 * that actually owns this `tokenHash`) naturally matches zero rows too,
 * with no separate check needed.
 *
 * Returns the number of rows updated: 1 on success, 0 for any of "wrong
 * email", "wrong/unknown code", "already used", "revoked", or "expired" --
 * `activarCuenta()` shows the SAME generic message for all of them (FASE 2
 * point 2.3).
 */
export async function consumeCredencialActivacion(
  tx: Prisma.TransactionClient,
  usuarioId: string,
  tokenHash: string,
  now: Date,
): Promise<number> {
  const result = await tx.credencialActivacion.updateMany({
    where: { usuarioId, tokenHash, usadaEn: null, revocadaEn: null, venceEn: { gt: now } },
    data: { usadaEn: now },
  });
  return result.count;
}

/** Completes activation (FASE 2 point 2.3) once the credential is consumed: sets the password hash and flips PENDIENTE_ACTIVACION -> ACTIVO (a legal transition -- migration 0002's `usuario_validar_transicion_estado`). Also clears any stale lockout state, defensively (a PENDIENTE_ACTIVACION usuario should never have one, but costs nothing to be sure). */
export async function activarUsuario(tx: Prisma.TransactionClient, usuarioId: string, passwordHash: string): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { passwordHash, estado: "ACTIVO", intentosFallidos: 0, bloqueadoHasta: null },
  });
}
