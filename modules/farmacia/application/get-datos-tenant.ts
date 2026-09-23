/**
 * `getDatosTenant` (FASE 3 point 3.10a): returns the FULL institutional
 * record of the current session's tenant -- including the 4 non-editable
 * fields (cuit, zonaHoraria, fechaBaja, fechaActivacionContralor) -- so the
 * UI can show them read-only with an explanation instead of hiding them.
 * `config.ver` is granted to ALL FIVE roles (migration 0002), so this is
 * intentionally a wide-open read.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { getTenantDetalle } from "../infrastructure/tenant-repository";
import type { TenantDetalle } from "../infrastructure/tenant-repository";

const getDatosTenantInput = z.object({});

export const getDatosTenantQuery = defineQuery({
  name: "farmacia.getDatosTenant",
  permiso: "config.ver",
  input: getDatosTenantInput,
  handler: async ({ tx, session }) => {
    const tenant = await getTenantDetalle(tx, session.tenantId);
    if (!tenant) {
      // Should not happen for a valid session (the tenant row is what
      // resolved the session's tenantId in the first place), but a
      // defense-in-depth check beats returning `null` silently.
      throw new NotFoundError("No se encontró la farmacia.");
    }
    return tenant;
  },
});

export async function getDatosTenant(): Promise<TenantDetalle> {
  return getDatosTenantQuery.execute({});
}
