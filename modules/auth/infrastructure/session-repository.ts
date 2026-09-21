/**
 * Prisma-backed access to `fsj.sesion` / `fsj.usuario` / `fsj.tenant` for
 * M02 session lifecycle. All tenant-scoped reads/writes go through
 * `withTenantTransaction` (INV-T01); `resolveSessionTenant` is the one
 * deliberate exception -- see migration
 * 0009_sesion_tenant_resolver for why it has to be.
 */
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/shared/db/client";
import { withTenantTransaction } from "@/shared/db/transaction";
import { isPermiso, type Permiso } from "../domain/permisos";

export interface NewSesionRow {
  tenantId: string;
  usuarioId: string;
  tokenHash: string;
  ip: string | null;
  userAgent: string | null;
  expiraEn: Date;
}

export interface SesionRow {
  id: string;
  tenantId: string;
  usuarioId: string;
  creadaEn: Date;
  ultimoUsoEn: Date;
  expiraEn: Date;
  revocadaEn: Date | null;
  reautenticadaEn: Date | null;
}

const SESION_ROW_SELECT = {
  id: true,
  tenantId: true,
  usuarioId: true,
  creadaEn: true,
  ultimoUsoEn: true,
  expiraEn: true,
  revocadaEn: true,
  reautenticadaEn: true,
} as const;

/** Inserts a new `fsj.sesion` row using an ALREADY OPEN tenant transaction -- factored out of `insertSesion` so callers that must create a session as part of a larger atomic operation (e.g. `login()`, which also increments/resets `intentos_fallidos` in the same commit) can do so without nesting a second top-level Prisma transaction (which would open a second, independent connection/transaction against the pooler -- see modules/auth/application/login.ts for why that would be unsafe). */
export async function insertSesionInTx(tx: Prisma.TransactionClient, row: NewSesionRow): Promise<SesionRow> {
  return tx.sesion.create({
    data: {
      tenantId: row.tenantId,
      usuarioId: row.usuarioId,
      tokenHash: row.tokenHash,
      ip: row.ip ?? undefined,
      userAgent: row.userAgent ?? undefined,
      expiraEn: row.expiraEn,
    },
    select: SESION_ROW_SELECT,
  });
}

/** Inserts a new `fsj.sesion` row, opening its own tenant transaction. `tenantId` MUST already come from an authenticated/verified source (the usuario record), never from client input. */
export async function insertSesion(row: NewSesionRow): Promise<SesionRow> {
  return withTenantTransaction(row.tenantId, (tx) => insertSesionInTx(tx, row));
}

/**
 * RLS bootstrap ONLY: resolves which tenant a (hashed) session token
 * belongs to, via the SECURITY DEFINER function from migration
 * 0009_sesion_tenant_resolver. Returns `null` if no session with that
 * hash exists at all (this leaks only "a session with this hash exists
 * somewhere", not anything about its validity -- every real validity
 * check happens afterwards, through the normal tenant-scoped path).
 *
 * Deliberately does NOT use `withTenantTransaction` (there is no tenant
 * to set yet) or `withPlatformTransaction` (RLS would then hide the row
 * regardless of the SECURITY DEFINER function's own privileges, since the
 * SELECT that matters happens inside that function, not in this query).
 * Runs directly against the shared Prisma client.
 */
export async function resolveSessionTenant(tokenHash: string): Promise<string | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRaw<{ tenant_id: string | null }[]>`
    SELECT fsj.sesion_resolve_tenant(${tokenHash}) AS tenant_id
  `;
  return rows[0]?.tenant_id ?? null;
}

export interface UsuarioConPermisos {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  estado: string;
  permisos: ReadonlySet<Permiso>;
}

/** Loads a usuario plus the UNION of permissions across every role assigned to them (M03 §7), inside an already-open tenant transaction. */
export async function loadUsuarioConPermisos(
  tx: Prisma.TransactionClient,
  usuarioId: string,
): Promise<UsuarioConPermisos | null> {
  const usuario = await tx.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      id: true,
      email: true,
      nombre: true,
      apellido: true,
      estado: true,
      rolesAsignados: {
        select: {
          rol: {
            select: {
              permisos: { select: { permiso: { select: { codigo: true } } } },
            },
          },
        },
      },
    },
  });
  if (!usuario) return null;

  const permisos = new Set<Permiso>();
  for (const asignacion of usuario.rolesAsignados) {
    for (const rolPermiso of asignacion.rol.permisos) {
      const { codigo } = rolPermiso.permiso;
      // The DB catalog is guaranteed to match PERMISO_CODES exactly (see
      // tests/db/auth-permisos.test.ts) -- this guard just avoids trusting
      // an unrecognized string into a `Permiso`-typed set if that ever
      // drifts, rather than silently mis-typing it.
      if (isPermiso(codigo)) permisos.add(codigo);
    }
  }

  return {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    estado: usuario.estado,
    permisos,
  };
}

/** Reads `fsj.sesion` by (tenant-scoped) id. */
export async function findSesionById(tx: Prisma.TransactionClient, sesionId: string): Promise<SesionRow | null> {
  return tx.sesion.findUnique({
    where: { id: sesionId },
    select: SESION_ROW_SELECT,
  });
}

/** Reads `fsj.sesion` by (globally unique) token hash, inside an already tenant-scoped transaction. */
export async function findSesionByTokenHash(tx: Prisma.TransactionClient, tokenHash: string): Promise<SesionRow | null> {
  return tx.sesion.findUnique({
    where: { tokenHash },
    select: SESION_ROW_SELECT,
  });
}

/** `fecha_baja` for the tenant (global table, no RLS) -- requireSession must reject a tenant given de baja. */
export async function loadTenantFechaBaja(tx: Prisma.TransactionClient, tenantId: string): Promise<Date | null | undefined> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { fechaBaja: true } });
  return tenant?.fechaBaja;
}

/** Idle refresh: bumps `ultimo_uso_en` to `now`. Does NOT touch `expira_en` (fixed at creation, see migration 0004 comment) -- only `ultimo_uso_en`, `revocada_en`, `reautenticada_en` are grantable columns. */
export async function touchSesion(tx: Prisma.TransactionClient, sesionId: string, now: Date): Promise<void> {
  await tx.sesion.update({ where: { id: sesionId }, data: { ultimoUsoEn: now } });
}

/** Revokes one session (logout / admin-initiated). Idempotent: revoking an already-revoked session just re-sets the same-shaped timestamp. */
export async function revokeSesion(tx: Prisma.TransactionClient, sesionId: string, now: Date): Promise<void> {
  await tx.sesion.update({ where: { id: sesionId }, data: { revocadaEn: now } });
}

/** Revokes every currently-active session for a usuario (password change, suspend/baja, credential reset -- INV-U08). Returns the number of rows revoked. */
export async function revokeAllSesionesForUsuario(
  tx: Prisma.TransactionClient,
  tenantId: string,
  usuarioId: string,
  now: Date,
): Promise<number> {
  const result = await tx.sesion.updateMany({
    where: { tenantId, usuarioId, revocadaEn: null },
    data: { revocadaEn: now },
  });
  return result.count;
}

/** Revokes every currently-active session for a usuario EXCEPT `keepSesionId` (FASE 2 point 2.4: `cambiarPassword` keeps the session that just performed the change alive, revokes every other one). Returns the number of rows revoked. */
export async function revokeOtherSesionesForUsuario(
  tx: Prisma.TransactionClient,
  tenantId: string,
  usuarioId: string,
  keepSesionId: string,
  now: Date,
): Promise<number> {
  const result = await tx.sesion.updateMany({
    where: { tenantId, usuarioId, revocadaEn: null, id: { not: keepSesionId } },
    data: { revocadaEn: now },
  });
  return result.count;
}

/** Sets `reautenticada_en` to `now` (FASE 2 point 2.5, INV-X02 -- `reautenticar()`). */
export async function marcarReautenticada(tx: Prisma.TransactionClient, sesionId: string, now: Date): Promise<void> {
  await tx.sesion.update({ where: { id: sesionId }, data: { reautenticadaEn: now } });
}
