/**
 * Prisma-backed access to `fsj.usuario` for M02 login (2.2),
 * change-password (2.4) and re-authentication (2.5).
 * `resolveLoginByEmail` is the one deliberate RLS bootstrap exception here
 * (mirrors `resolveSessionTenant` in session-repository.ts) -- see
 * migration 0010_usuario_login_resolver for why it has to be. Every other
 * function here runs inside an already-open `withTenantTransaction`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/shared/db/client";
import type { PasoPendiente } from "@/shared/auth/pasos";
import { derivarPasosPendientes, esSoloAdministrador } from "../domain/pasos-pendientes";

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
 * usuario has that email (never a row of nulls) -- `login()` MUST treat
 * this identically to "found, but password did not match" in whatever it
 * shows the caller.
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

/** Pending steps (temporary password, mandatory PIN) of a usuario, inside an already-open tenant transaction. Login uses it to pick the first page to land on. */
export async function loadPasosPendientes(tx: Prisma.TransactionClient, usuarioId: string): Promise<readonly PasoPendiente[]> {
  const row = await tx.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      debeCambiarPassword: true,
      pinHash: true,
      esSector: true,
      esTecnico: true,
      rolesAsignados: { select: { rol: { select: { esAdministrador: true } } } },
    },
  });
  if (!row) return [];
  return derivarPasosPendientes({
    debeCambiarPassword: row.debeCambiarPassword,
    tienePin: row.pinHash !== null,
    esSector: row.esSector,
    esTecnico: row.esTecnico,
    soloAdministrador: esSoloAdministrador(row.rolesAsignados.map((asignacion) => asignacion.rol)),
  });
}

/** Whether every role of the usuario is the locked ADMINISTRADOR (no PIN, CT9), read inside an already-open tenant transaction. */
export async function loadEsSoloAdministrador(tx: Prisma.TransactionClient, usuarioId: string): Promise<boolean> {
  const asignaciones = await tx.usuarioRol.findMany({ where: { usuarioId }, select: { rol: { select: { esAdministrador: true } } } });
  return esSoloAdministrador(asignaciones.map((asignacion) => asignacion.rol));
}

/** Successful login (FASE 2 point 2.2): resets the failed-attempt counter/lockout and stamps `ultimo_acceso`. */
export async function recordLoginSuccess(tx: Prisma.TransactionClient, usuarioId: string, now: Date): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoAcceso: now },
  });
}

export interface PoliticaBloqueo {
  maxIntentos: number;
  /** Lockout expiry applied when this failure reaches `maxIntentos`. */
  bloqueadoHasta: Date;
}

/**
 * Failed login (wrong password) for a KNOWN usuario (FASE 2 point 2.2). The
 * count is incremented by the UPDATE itself (audit P3-03): concurrent
 * failures serialize on the row and never overwrite each other, so parallel
 * attempts cannot dodge the lockout. Returns the new count.
 */
export async function recordLoginFailure(tx: Prisma.TransactionClient, usuarioId: string, politica: PoliticaBloqueo): Promise<number> {
  const rows = await tx.$queryRaw<{ intentos_fallidos: number }[]>`
    UPDATE fsj.usuario
    SET intentos_fallidos = intentos_fallidos + 1,
        bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= ${politica.maxIntentos} THEN ${politica.bloqueadoHasta}::timestamptz ELSE NULL END
    WHERE id = ${usuarioId}::uuid
    RETURNING intentos_fallidos
  `;
  return rows[0]?.intentos_fallidos ?? 0;
}

export interface UsuarioEmailRow {
  id: string;
  email: string;
  passwordHash: string | null;
  /** PIN re-auth feature: `null` when the usuario has no PIN configured. Included here so `cambiarPassword`/PIN commands, which already load this row to verify the current password, don't need a second round trip. */
  pinHash: string | null;
  /** Contraseña temporal: an administrator set the current password; the usuario must replace it before doing anything else. */
  debeCambiarPassword: boolean;
  esSector: boolean;
}

/** Loads the minimum needed to verify/change a usuario's own password (FASE 2 point 2.4/2.5) or PIN (PIN re-auth feature), inside an already-open tenant transaction. */
export async function loadUsuarioParaPassword(tx: Prisma.TransactionClient, usuarioId: string): Promise<UsuarioEmailRow | null> {
  return tx.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true, email: true, passwordHash: true, pinHash: true, debeCambiarPassword: true, esSector: true },
  });
}

/**
 * Completes the temporary-password change (openspec/specs/contrasena-temporal/spec.md):
 * one UPDATE that stores the usuario's own password hash and clears
 * `debeCambiarPassword`. This is the ONLY code path that clears the flag
 * (CT4, guarded by tests/unit/auth-cambiar-password-temporal.test.ts).
 */
export async function completarCambioPasswordTemporal(tx: Prisma.TransactionClient, usuarioId: string, passwordHash: string): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { passwordHash, debeCambiarPassword: false } });
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

/**
 * The PIN hashes of every OTHER usuario of the tenant (no two usuarios share a PIN, user decision 2026-10-26). Takes a
 * per-tenant transaction-scoped advisory lock first, so two usuarios choosing the same PIN at once are serialized:
 * the second one sees the first one's hash. Never returns the hashes to a caller outside the PIN uniqueness check.
 */
export async function loadPinHashesDeOtros(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<string[]> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fsj.pin:' || ${tenantId}::text))`;
  const rows = await tx.usuario.findMany({
    where: { tenantId, id: { not: usuarioId }, pinHash: { not: null } },
    select: { pinHash: true },
  });
  return rows.flatMap((row) => (row.pinHash ? [row.pinHash] : []));
}

/** A successful PASSWORD re-auth resets the PIN counter AND unblocks it (task's binding decision) -- called unconditionally on the password branch's success path, never read-then-write (idempotent regardless of prior state). */
export async function resetPinLockout(tx: Prisma.TransactionClient, usuarioId: string): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { pinIntentosFallidos: 0, pinBloqueado: false } });
}

/**
 * Persists a failed PIN attempt and, once `maxIntentos` is reached, the block.
 * Incremented by the UPDATE itself (audit P3-03), like `recordLoginFailure`:
 * parallel guesses at a 4-digit PIN cannot dodge the block. Returns the new count.
 */
export async function recordPinFailure(tx: Prisma.TransactionClient, usuarioId: string, maxIntentos: number): Promise<number> {
  const rows = await tx.$queryRaw<{ pin_intentos_fallidos: number }[]>`
    UPDATE fsj.usuario
    SET pin_intentos_fallidos = pin_intentos_fallidos + 1,
        pin_bloqueado = pin_intentos_fallidos + 1 >= ${maxIntentos}
    WHERE id = ${usuarioId}::uuid
    RETURNING pin_intentos_fallidos
  `;
  return rows[0]?.pin_intentos_fallidos ?? 0;
}
