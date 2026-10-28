/**
 * Prisma-backed access to `fsj.tenant` for M00/FASE 3 point 3.10 (tenant
 * institutional data editing). `fsj.tenant` is a GLOBAL table (no
 * `tenant_id` column, no RLS -- it IS the tenant boundary every other
 * table's `tenant_id` points at), so every function here filters by `id`
 * explicitly instead of relying on a tenant-scoping mechanism that does not
 * exist for this table (see prisma/migrations/*_0020_tenant_datos_editables
 * for the DB-level guard: fsj_app can only UPDATE the row matching the
 * current session's tenant, INV-PL-004).
 *
 * Every function here runs inside an ALREADY OPEN tenant transaction (`tx`,
 * handed in by `shared/usecase.ts`'s `defineCommand`/`defineQuery`) --
 * nothing here opens its own transaction.
 */
import type { Prisma } from "@/generated/prisma/client";

export interface TenantDetalle {
  id: string;
  razonSocial: string;
  nombreFantasia: string | null;
  cuit: string;
  domicilio: string | null;
  matriculaFarmacia: string | null;
  telefonoFijo: string | null;
  telefonoCelular: string | null;
  zonaHoraria: string;
  fechaBaja: Date | null;
  fechaActivacionContralor: Date | null;
  creadoEn: Date;
}

/** `null` only if the session's own tenant row somehow does not exist -- should never happen for a valid session, but callers must still handle it (NotFoundError) instead of assuming. */
export async function getTenantDetalle(tx: Prisma.TransactionClient, tenantId: string): Promise<TenantDetalle | null> {
  const row = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      razonSocial: true,
      nombreFantasia: true,
      cuit: true,
      domicilio: true,
      matriculaFarmacia: true,
      telefonoFijo: true,
      telefonoCelular: true,
      zonaHoraria: true,
      fechaBaja: true,
      fechaActivacionContralor: true,
      creadoEn: true,
    },
  });
  return row;
}

export interface DatosEditablesTenant {
  razonSocial: string;
  nombreFantasia: string | null;
  domicilio: string | null;
  matriculaFarmacia: string | null;
  telefonoFijo: string | null;
  telefonoCelular: string | null;
  /** Omitted = unchanged. Writable only before the first cierre diario (migration 0105, INV-PL-005). */
  cuit?: string;
}

/**
 * Updates ONLY the columns fsj_app is granted UPDATE on: migration 0020
 * (razon_social, nombre_fantasia, domicilio, matricula_farmacia), 0089
 * (telefono_fijo, telefono_celular) and 0105 (cuit, guarded by a trigger).
 * Never touches zona_horaria / fecha_baja / fecha_activacion_contralor
 * -- defense in depth on top of (a) the zod schema in
 * ../application/editar-datos-tenant.ts not even accepting those fields as
 * input, and (b) the column-level GRANT (migration 0020) that would reject
 * them at the DB layer regardless (SQLSTATE 42501) if this function somehow
 * tried to send them.
 */
export async function updateDatosEditablesTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  datos: DatosEditablesTenant,
): Promise<void> {
  await tx.tenant.update({
    where: { id: tenantId },
    data: {
      razonSocial: datos.razonSocial,
      nombreFantasia: datos.nombreFantasia,
      domicilio: datos.domicilio,
      matriculaFarmacia: datos.matriculaFarmacia,
      telefonoFijo: datos.telefonoFijo,
      telefonoCelular: datos.telefonoCelular,
      ...(datos.cuit !== undefined ? { cuit: datos.cuit } : {}),
    },
  });
}

/** True once the tenant has signed a cierre diario: from then on its CUIT is fixed (openspec/specs/cuit-farmacia/spec.md). */
export async function tenantTieneCierreDiario(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
  const cierre = await tx.cierreDiario.findFirst({ where: { tenantId }, select: { id: true } });
  return cierre !== null;
}

/** What the navbar shows for the tenant: its name and the version of its logo (`null` = no logo, the generic one is shown). Never loads the image bytes. */
export interface MarcaTenant {
  nombre: string;
  logoTipo: string | null;
  logoActualizadoEn: Date | null;
}

export async function getMarcaTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<MarcaTenant | null> {
  const row = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { razonSocial: true, nombreFantasia: true, logoTipo: true, logoActualizadoEn: true },
  });
  if (!row) return null;
  return { nombre: row.nombreFantasia ?? row.razonSocial, logoTipo: row.logoTipo, logoActualizadoEn: row.logoActualizadoEn };
}

export interface LogoTenant {
  bytes: Uint8Array<ArrayBuffer>;
  tipo: string;
}

/** `null` when the tenant has no logo (migration 0098 keeps the columns all NULL or all set). */
export async function getLogoTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<LogoTenant | null> {
  const row = await tx.tenant.findUnique({ where: { id: tenantId }, select: { logo: true, logoTipo: true } });
  if (!row?.logo || !row.logoTipo) return null;
  return { bytes: new Uint8Array(row.logo), tipo: row.logoTipo };
}

/** Sets (or, with `null`, removes) the logo. Only the columns migration 0098 grants UPDATE on. */
export async function updateLogoTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  logo: { bytes: Uint8Array<ArrayBuffer>; tipo: string; actualizadoEn: Date } | null,
): Promise<void> {
  await tx.tenant.update({
    where: { id: tenantId },
    data: logo ? { logo: logo.bytes, logoTipo: logo.tipo, logoActualizadoEn: logo.actualizadoEn } : { logo: null, logoTipo: null, logoActualizadoEn: null },
  });
}
