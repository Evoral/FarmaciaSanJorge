/**
 * Prisma-backed access supporting `verificar-co-firma-dt.ts` (FASE 5 point
 * 5.3, DP-08b RESUELTA). Reads `fsj.usuario` directly (not through
 * `modules/auth/infrastructure` or `modules/directores-tecnicos/infrastructure`)
 * because a module cannot reach into another module's infrastructure layer
 * -- see modules/usuarios/infrastructure/admin-guard.ts's header comment
 * and modules/directores-tecnicos/infrastructure/designacion-repository.ts's
 * `getUsuarioEstado` (same pattern, same justification).
 *
 * Rate limiting reuses `usuario.intentos_fallidos`/`bloqueado_hasta` --
 * the SAME columns/policy (`AUTH_POLICY.maxFailedLoginAttempts`/
 * `lockoutMinutes`) as login -- see verificar-co-firma-dt.ts's module doc
 * comment for why this is a deliberate, documented choice rather than a new
 * counter.
 */
import type { Prisma } from "@/generated/prisma/client";

export interface DtCandidato {
  usuarioId: string;
  passwordHash: string | null;
  estado: string;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

/** Looks up `dtUsuarioId` IN `tenantId` ONLY -- a client-supplied id for another tenant's usuario resolves to `null`, indistinguishable from "does not exist" (same non-enumeration discipline as `resolveLoginByEmail`). */
export async function resolveDtCandidato(tx: Prisma.TransactionClient, tenantId: string, dtUsuarioId: string): Promise<DtCandidato | null> {
  const row = await tx.usuario.findUnique({
    where: { id: dtUsuarioId, tenantId },
    select: { id: true, passwordHash: true, estado: true, intentosFallidos: true, bloqueadoHasta: true },
  });
  if (!row) return null;
  return {
    usuarioId: row.id,
    passwordHash: row.passwordHash,
    estado: row.estado,
    intentosFallidos: row.intentosFallidos,
    bloqueadoHasta: row.bloqueadoHasta,
  };
}

/** `fsj.es_dt_vigente(usuario, fecha)` (migration 0005/INV-U05) evaluated at the tenant's CURRENT jornada -- mirrors `fsj.movimiento_stock_validar_ajuste`'s own check, so the app-level decision and the DB's final backstop use the exact same rule. */
export async function esDtVigenteHoy(tx: Prisma.TransactionClient, tenantId: string, dtUsuarioId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ vigente: boolean }[]>`
    SELECT fsj.es_dt_vigente(${dtUsuarioId}::uuid, fsj.jornada_actual(${tenantId}::uuid)) AS vigente
  `;
  return rows[0]?.vigente ?? false;
}

export interface DtParaCoFirma {
  usuarioId: string;
  nombre: string;
  apellido: string;
}

/**
 * Usuarios currently DT vigente (TITULAR or SUPLENTE, today) -- feeds the
 * co-firma picker on the ajuste form. A DEDICATED read (not
 * `modules/directores-tecnicos/application/list-usuarios-elegibles.ts`,
 * gated on `dt.designar` = ADM only) because the operator registering an
 * ajuste is FAR or DT, never necessarily ADM -- see
 * `modules/stock/application/list-dt-para-co-firma.ts`'s doc comment.
 * Reads `fsj.usuario`/`fsj.designacion_director_tecnico` directly (module
 * boundary, same as every other function in this file).
 */
export async function listDtVigentesParaCoFirma(tx: Prisma.TransactionClient, tenantId: string): Promise<DtParaCoFirma[]> {
  const rows = await tx.$queryRaw<{ usuario_id: string; nombre: string; apellido: string }[]>`
    SELECT DISTINCT u.id AS usuario_id, u.nombre, u.apellido
    FROM fsj.usuario u
    JOIN fsj.designacion_director_tecnico d ON d.tenant_id = u.tenant_id AND d.usuario_id = u.id
    WHERE u.tenant_id = ${tenantId}::uuid
      AND fsj.es_dt_vigente(u.id, fsj.jornada_actual(${tenantId}::uuid))
    ORDER BY u.apellido, u.nombre
  `;
  return rows.map((row) => ({ usuarioId: row.usuario_id, nombre: row.nombre, apellido: row.apellido }));
}

export interface CoFirmaFailureUpdate {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

/** Same shape as `modules/auth/infrastructure/usuario-repository.ts#recordLoginFailure` -- a local copy (not an import) per the module-boundary rule above. */
export async function recordCoFirmaFailure(tx: Prisma.TransactionClient, usuarioId: string, update: CoFirmaFailureUpdate): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: update.intentosFallidos, bloqueadoHasta: update.bloqueadoHasta },
  });
}

/** Same shape as `recordLoginSuccess` -- a successful co-firma also clears any stale lockout on the DT's own login, since it just proved the password. */
export async function recordCoFirmaSuccess(tx: Prisma.TransactionClient, usuarioId: string): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: 0, bloqueadoHasta: null },
  });
}
