/**
 * `editarRepartidor`: changes the nombre / apellido / telefono of a repartidor (`repartidores.gestionar`). The PDF
 * "Hoja de envíos" shows the current data (docs/specs/envios-repartidores.md, "Repartidor editado": no snapshot).
 *
 * Locks the row FIRST and reads its current state with a fresh statement afterwards, like
 * modules/etiqueta-tamanos/application/editar-etiqueta-tamano.ts.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { repartidorDatosShape } from "../domain/repartidor";
import { getRepartidor, lockRepartidor, updateRepartidorDatos } from "../infrastructure/repartidor-repository";

/** Exported for tests/unit/repartidores-validacion.test.ts. */
export const editarRepartidorInput = z.object({ id: uuid, ...repartidorDatosShape }).strict();

/** PRE-parse shape (raw `FormData` strings): `execute()` still runs the real zod parse. */
export interface EditarRepartidorInput {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
}

export const REPARTIDOR_NO_ENCONTRADO_MESSAGE = "Repartidor no encontrado.";

export const editarRepartidorCommand = defineCommand({
  name: "repartidores.editar",
  permiso: "repartidores.gestionar",
  input: editarRepartidorInput,
  audit: { entidad: "repartidor", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    if (!(await lockRepartidor(tx, session.tenantId, input.id))) throw new NotFoundError(REPARTIDOR_NO_ENCONTRADO_MESSAGE);

    const actual = await getRepartidor(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError(REPARTIDOR_NO_ENCONTRADO_MESSAGE);

    const nuevoValor = { nombre: input.nombre, apellido: input.apellido, telefono: input.telefono };
    await updateRepartidorDatos(tx, session.tenantId, input.id, nuevoValor);

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { nombre: actual.nombre, apellido: actual.apellido, telefono: actual.telefono },
        valorNuevo: nuevoValor,
      },
    };
  },
});

export async function editarRepartidor(input: EditarRepartidorInput): Promise<{ id: string }> {
  return editarRepartidorCommand.execute(input);
}
