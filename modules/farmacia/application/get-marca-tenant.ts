/**
 * The tenant's brand for the navigation bar (docs/specs/logo-farmacia.md): its name and, when it uploaded one, the
 * URL of its logo. `logoSrc` carries the logo's version (`logo_actualizado_en`), so a new logo is a new URL and the
 * image can be cached for good. `null` means the generic app logo.
 *
 * `permiso: "auth.login"` is the same deliberate reuse as `listOperadores`: every role always holds it
 * (PERMISOS_BASE_DE_ROL), and every signed-in usuario sees the navbar. `getLogoTenant` serves the bytes.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getLogoTenant as getLogoTenantRow, getMarcaTenant as getMarcaTenantRow } from "../infrastructure/tenant-repository";
import type { LogoTenant } from "../infrastructure/tenant-repository";

/** Served by app/api/farmacia/logo/route.ts. */
export const LOGO_TENANT_PATH = "/api/farmacia/logo";

export interface MarcaTenantVista {
  nombre: string;
  logoSrc: string | null;
}

export const getMarcaTenantQuery = defineQuery({
  name: "farmacia.getMarca",
  permiso: "auth.login",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<MarcaTenantVista | null> => {
    const marca = await getMarcaTenantRow(tx, session.tenantId);
    if (!marca) return null;
    return {
      nombre: marca.nombre,
      logoSrc: marca.logoActualizadoEn ? `${LOGO_TENANT_PATH}?v=${marca.logoActualizadoEn.getTime()}` : null,
    };
  },
});

export async function getMarcaTenant(): Promise<MarcaTenantVista | null> {
  return getMarcaTenantQuery.execute({});
}

export const getLogoTenantQuery = defineQuery({
  name: "farmacia.getLogo",
  permiso: "auth.login",
  input: z.object({}),
  handler: async ({ tx, session }) => getLogoTenantRow(tx, session.tenantId),
});

/** The current session's tenant logo, or `null` when it has none. */
export async function getLogoTenant(): Promise<LogoTenant | null> {
  return getLogoTenantQuery.execute({});
}
