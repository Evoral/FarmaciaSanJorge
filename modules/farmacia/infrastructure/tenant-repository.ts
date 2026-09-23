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
}

/**
 * Updates ONLY the 4 columns fsj_app is granted UPDATE on, post-migration
 * 0020 (razon_social, nombre_fantasia, domicilio, matricula_farmacia).
 * Never touches cuit / zona_horaria / fecha_baja / fecha_activacion_contralor
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
    },
  });
}
