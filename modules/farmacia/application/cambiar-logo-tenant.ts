/**
 * `cambiarLogoTenant` (docs/specs/logo-farmacia.md): the farmacia uploads the logo shown in the navigation bar.
 * Same permiso as the rest of the farmacia's data (`config.editar`). The file is checked by
 * `validarArchivoLogo` (domain/logo.ts) first thing in the handler, not by zod, so every step keeps its own
 * message. The audit row records the type and size, never the bytes.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { validarArchivoLogo } from "../domain/logo";
import { getMarcaTenant, updateLogoTenant } from "../infrastructure/tenant-repository";

const cambiarLogoTenantInput = z.object({ archivo: z.unknown() });

export const cambiarLogoTenantCommand = defineCommand({
  name: "farmacia.cambiarLogo",
  permiso: "config.editar",
  input: cambiarLogoTenantInput,
  audit: { entidad: "tenant", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const { bytes, tipo } = await validarArchivoLogo(input.archivo);
    const actual = await getMarcaTenant(tx, session.tenantId);
    if (!actual) throw new NotFoundError("No se encontró la farmacia.");

    const actualizadoEn = new Date();
    await updateLogoTenant(tx, session.tenantId, { bytes, tipo, actualizadoEn });

    return {
      output: { id: session.tenantId },
      audit: {
        entidadId: session.tenantId,
        valorAnterior: { logoTipo: actual.logoTipo, logoActualizadoEn: actual.logoActualizadoEn?.toISOString() ?? null },
        valorNuevo: { logoTipo: tipo, logoBytes: bytes.byteLength, logoActualizadoEn: actualizadoEn.toISOString() },
      },
    };
  },
});

export async function cambiarLogoTenant(input: { archivo: unknown }): Promise<{ id: string }> {
  return cambiarLogoTenantCommand.execute(input);
}
