/**
 * `crearRepartidor`: adds a person to the catalog of repartidores (openspec/specs/envios-repartidores/spec.md). Gated on
 * `repartidores.gestionar` (categoría `gestion`: ADMINISTRADOR, or whoever the role editor gives it to). Not a PIN
 * action, so no `conOperador` wrapping in the Server Action.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { repartidorDatosShape } from "../domain/repartidor";
import { insertRepartidor } from "../infrastructure/repartidor-repository";

/** Exported for tests/unit/repartidores-validacion.test.ts. */
export const crearRepartidorInput = z.object(repartidorDatosShape).strict();

/** PRE-parse shape (raw `FormData` strings): `execute()` still runs the real zod parse. */
export interface CrearRepartidorInput {
  nombre: string;
  apellido: string;
  telefono: string;
}

export const crearRepartidorCommand = defineCommand({
  name: "repartidores.crear",
  permiso: "repartidores.gestionar",
  input: crearRepartidorInput,
  audit: { entidad: "repartidor", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const nuevo = await insertRepartidor(tx, {
      tenantId: session.tenantId,
      creadoPorId: session.usuario.id,
      nombre: input.nombre,
      apellido: input.apellido,
      telefono: input.telefono,
    });

    return {
      output: { id: nuevo.id },
      audit: { entidadId: nuevo.id, valorNuevo: { nombre: input.nombre, apellido: input.apellido, telefono: input.telefono, activo: true } },
    };
  },
});

export async function crearRepartidor(input: CrearRepartidorInput): Promise<{ id: string }> {
  return crearRepartidorCommand.execute(input);
}
