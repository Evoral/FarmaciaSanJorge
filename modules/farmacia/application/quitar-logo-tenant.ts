/** `quitarLogoTenant` (docs/specs/logo-farmacia.md): removes the farmacia's logo; the navbar goes back to the generic one. */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { getMarcaTenant, updateLogoTenant } from "../infrastructure/tenant-repository";

export const quitarLogoTenantCommand = defineCommand({
  name: "farmacia.quitarLogo",
  permiso: "config.editar",
  input: z.object({}),
  audit: { entidad: "tenant", accion: "MODIFICAR" },
  handler: async ({ tx, session }) => {
    const actual = await getMarcaTenant(tx, session.tenantId);
    if (!actual) throw new NotFoundError("No se encontró la farmacia.");

    await updateLogoTenant(tx, session.tenantId, null);

    return {
      output: { id: session.tenantId },
      audit: {
        entidadId: session.tenantId,
        valorAnterior: { logoTipo: actual.logoTipo, logoActualizadoEn: actual.logoActualizadoEn?.toISOString() ?? null },
        valorNuevo: { logoTipo: null, logoActualizadoEn: null },
      },
    };
  },
});

export async function quitarLogoTenant(): Promise<{ id: string }> {
  return quitarLogoTenantCommand.execute({});
}
