/**
 * `cambiarEstadoRepartidor`: activates or deactivates a repartidor (`repartidores.gestionar`). Deactivating is not
 * deleting (fsj_app has no DELETE): the repartidor stops being offered for NEW envios but keeps the ones it already
 * has, and its "Hoja de envíos" can still be exported (docs/specs/envios-repartidores.md, E3 and "Casos borde").
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { cambiarActivoRepartidor, getRepartidor, lockRepartidor } from "../infrastructure/repartidor-repository";
import { REPARTIDOR_NO_ENCONTRADO_MESSAGE } from "./editar-repartidor";

/** Exported for tests/unit/repartidores-validacion.test.ts. */
export const cambiarEstadoRepartidorInput = z.object({ id: uuid, activo: z.boolean() }).strict();

export type CambiarEstadoRepartidorInput = z.infer<typeof cambiarEstadoRepartidorInput>;

export const cambiarEstadoRepartidorCommand = defineCommand({
  name: "repartidores.cambiarEstado",
  permiso: "repartidores.gestionar",
  input: cambiarEstadoRepartidorInput,
  audit: { entidad: "repartidor", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    if (!(await lockRepartidor(tx, session.tenantId, input.id))) throw new NotFoundError(REPARTIDOR_NO_ENCONTRADO_MESSAGE);

    const actual = await getRepartidor(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError(REPARTIDOR_NO_ENCONTRADO_MESSAGE);
    if (actual.activo === input.activo) {
      throw new DomainError(input.activo ? "Este repartidor ya está activo." : "Este repartidor ya está inactivo.");
    }

    await cambiarActivoRepartidor(tx, session.tenantId, input.id, input.activo);

    return {
      output: { id: input.id },
      audit: { entidadId: input.id, valorAnterior: { activo: actual.activo }, valorNuevo: { activo: input.activo } },
    };
  },
});

export async function cambiarEstadoRepartidor(input: CambiarEstadoRepartidorInput): Promise<{ id: string }> {
  return cambiarEstadoRepartidorCommand.execute(input);
}
