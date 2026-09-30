/**
 * `getDatosTenant` (FASE 3 point 3.10a): returns the FULL institutional
 * record of the current session's tenant -- including the 4 non-editable
 * fields (cuit, zonaHoraria, fechaBaja, fechaActivacionContralor) -- so the
 * UI can show them read-only with an explanation instead of hiding them.
 * Gated on `config.ver`, which migration 0046 (user decision 2026-09-28)
 * narrowed to ADMINISTRADOR only -- it was granted to all five roles by
 * migration 0002. Other flows that need tenant fields (labels, jornada /
 * time zone) read them through their own repositories and use cases, not
 * through this query, so they are unaffected.
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
