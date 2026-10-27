/**
 * Prisma-backed access supporting `verificar-co-firma-dt.ts` for FASE 9's
 * anulación de asiento (M12 point 9.2, DP-08b co-firma en el mismo acto).
 * Own small copy of the same four functions
 * `modules/stock/infrastructure/co-firma-repository.ts` already has --
 * `modules/libro` cannot import `modules/stock/infrastructure/**`
 * (eslint.config.mjs's `appBoundaryPatterns` block forbids any
 * `modules/**\/*.ts` from reaching into another module's `infrastructure/`
 * layer, not just `app/**`), so this is a deliberate duplication, the same
 * pattern `modules/directores-tecnicos/infrastructure/designacion-repository.ts#getUsuarioParaDesignar`
 * and `modules/preparaciones/infrastructure/preparacion-repository.ts`'s
 * "Receta state transitions" section already establish for this codebase.
 * The pure decision table (`decideCoFirma`/`estaBloqueado`) has NO such
 * restriction -- it is domain code, not infrastructure -- so
 * `verificar-co-firma-dt.ts` imports it directly from
 * `@/modules/stock/domain/co-firma` instead of duplicating it.
 */
import type { Prisma } from "@/generated/prisma/client";

export interface DtCandidato {
  usuarioId: string;
  passwordHash: string | null;
  estado: string;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
  debeCambiarPassword: boolean;
}

/** Looks up `dtUsuarioId` IN `tenantId` ONLY -- same non-enumeration discipline as the stock module's twin. */
export async function resolveDtCandidato(tx: Prisma.TransactionClient, tenantId: string, dtUsuarioId: string): Promise<DtCandidato | null> {
  const row = await tx.usuario.findUnique({
    where: { id: dtUsuarioId, tenantId },
    select: { id: true, passwordHash: true, estado: true, intentosFallidos: true, bloqueadoHasta: true, debeCambiarPassword: true },
  });
  if (!row) return null;
  return {
    usuarioId: row.id,
    passwordHash: row.passwordHash,
    estado: row.estado,
    intentosFallidos: row.intentosFallidos,
    bloqueadoHasta: row.bloqueadoHasta,
    debeCambiarPassword: row.debeCambiarPassword,
  };
}

/** `fsj.es_dt_vigente(usuario, fecha)` at the tenant's CURRENT jornada -- mirrors the DB's own final backstop (the anulación trigger, INV-U05). */
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
  /** Also the Administrador: flagged "(Admin)" in the picker (`shared/format/usuario.ts`). */
  esAdministrador: boolean;
}

/** Usuarios currently DT vigente (TITULAR or SUPLENTE, today) -- feeds the anulación form's DT picker. */
export async function listDtVigentesParaCoFirma(tx: Prisma.TransactionClient, tenantId: string): Promise<DtParaCoFirma[]> {
  const rows = await tx.$queryRaw<{ usuario_id: string; nombre: string; apellido: string; es_administrador: boolean }[]>`
    SELECT DISTINCT u.id AS usuario_id, u.nombre, u.apellido,
      EXISTS (
        SELECT 1 FROM fsj.usuario_rol ur JOIN fsj.rol r ON r.tenant_id = ur.tenant_id AND r.id = ur.rol_id
        WHERE ur.tenant_id = u.tenant_id AND ur.usuario_id = u.id AND r.es_administrador
      ) AS es_administrador
    FROM fsj.usuario u
    JOIN fsj.designacion_director_tecnico d ON d.tenant_id = u.tenant_id AND d.usuario_id = u.id
    WHERE u.tenant_id = ${tenantId}::uuid
      AND u.debe_cambiar_password = false
      AND fsj.es_dt_vigente(u.id, fsj.jornada_actual(${tenantId}::uuid))
    ORDER BY u.apellido, u.nombre
  `;
  return rows.map((row) => ({ usuarioId: row.usuario_id, nombre: row.nombre, apellido: row.apellido, esAdministrador: row.es_administrador }));
}

export interface PoliticaBloqueo {
  maxIntentos: number;
  /** Lockout expiry applied when this failure reaches `maxIntentos`. */
  bloqueadoHasta: Date;
}

/** Atomic increment (audit P3-03), same as `modules/auth/infrastructure/usuario-repository.ts#recordLoginFailure`. Returns the new count. */
export async function recordCoFirmaFailure(tx: Prisma.TransactionClient, usuarioId: string, politica: PoliticaBloqueo): Promise<number> {
  const rows = await tx.$queryRaw<{ intentos_fallidos: number }[]>`
    UPDATE fsj.usuario
    SET intentos_fallidos = intentos_fallidos + 1,
        bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= ${politica.maxIntentos} THEN ${politica.bloqueadoHasta}::timestamptz ELSE NULL END
    WHERE id = ${usuarioId}::uuid
    RETURNING intentos_fallidos
  `;
  return rows[0]?.intentos_fallidos ?? 0;
}

export async function recordCoFirmaSuccess(tx: Prisma.TransactionClient, usuarioId: string): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { intentosFallidos: 0, bloqueadoHasta: null },
  });
}
