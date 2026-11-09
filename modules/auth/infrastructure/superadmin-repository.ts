/**
 * Superadmin login and platform sessions (migration 0124). fsj_app has no privilege on the platform tables: every call
 * here goes through a SECURITY DEFINER function. No Prisma model maps them on purpose.
 */
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/shared/db/client";

export interface SuperadminLoginCandidate {
  superadminId: string;
  passwordHash: string;
  estado: string;
  bloqueadoHasta: Date | null;
}

/** Called by `login()` only when no usuario has this email. `null` for an unknown email. */
export async function resolveSuperadminLoginByEmail(email: string): Promise<SuperadminLoginCandidate | null> {
  const rows = await getPrismaClient().$queryRaw<
    { superadmin_id: string; password_hash: string; estado: string; bloqueado_hasta: Date | null }[]
  >`SELECT superadmin_id, password_hash, estado::text AS estado, bloqueado_hasta FROM fsj.superadmin_resolve_login(${email})`;
  const row = rows[0];
  if (!row) return null;
  return { superadminId: row.superadmin_id, passwordHash: row.password_hash, estado: row.estado, bloqueadoHasta: row.bloqueado_hasta };
}

export interface MetaSolicitud {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Correct password already verified. Creates the session and audits LOGIN; returns its absolute expiry. */
export async function iniciarSesionPlataforma(tx: Prisma.TransactionClient, superadminId: string, tokenHash: string, meta: MetaSolicitud): Promise<Date> {
  const rows = await tx.$queryRaw<{ expira_en: Date }[]>`
    SELECT fsj.plataforma_iniciar_sesion(${superadminId}::uuid, ${tokenHash}, ${meta.ip}, ${meta.userAgent}, ${meta.requestId}) AS expira_en`;
  return rows[0]!.expira_en;
}

/** Wrong password: counts it, locks at `maxIntentos`. Returns the consecutive failures. */
export async function registrarLoginFallidoPlataforma(
  tx: Prisma.TransactionClient,
  superadminId: string,
  politica: { maxIntentos: number; bloqueadoHasta: Date },
  meta: MetaSolicitud,
): Promise<number> {
  const rows = await tx.$queryRaw<{ intentos: number }[]>`
    SELECT fsj.plataforma_login_fallido(${superadminId}::uuid, ${politica.maxIntentos}::int, ${politica.bloqueadoHasta}::timestamptz, ${meta.ip}, ${meta.requestId}) AS intentos`;
  return rows[0]?.intentos ?? 0;
}

/** The identity of a live platform session, `null` otherwise (lifecycle checked in SQL only). */
export async function validarSesionPlataforma(
  tx: Prisma.TransactionClient,
  tokenHash: string,
): Promise<{ superadminId: string; email: string; nombre: string } | null> {
  const rows = await tx.$queryRaw<{ superadmin_id: string; email: string; nombre: string }[]>`
    SELECT superadmin_id, email, nombre FROM fsj.plataforma_validar_sesion(${tokenHash})`;
  const row = rows[0];
  return row ? { superadminId: row.superadmin_id, email: row.email, nombre: row.nombre } : null;
}

export async function cerrarSesionPlataforma(tx: Prisma.TransactionClient, tokenHash: string, meta: MetaSolicitud): Promise<void> {
  await tx.$executeRaw`SELECT fsj.plataforma_cerrar_sesion(${tokenHash}, ${meta.ip}, ${meta.requestId})`;
}
