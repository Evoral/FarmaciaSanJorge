/**
 * `editarEtiquetaTamano`: changes the name and/or the measures of a size.
 * ADMINISTRADOR only (`config.editar`) with recent re-authentication. Past
 * etiquetas are not affected: the size is only used at the moment of
 * printing (the PDF is rendered on demand, nothing stores the size).
 *
 * Locks the row FIRST and reads its current state with a fresh statement
 * afterwards -- same discipline as modules/unidades/application/editar-unidad.ts
 * (see modules/proveedores/application/dar-de-baja-proveedor.ts for the race
 * it closes).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { nonEmptyString, uuid } from "@/shared/validation";
import { NOMBRE_MAX_LENGTH } from "../domain/etiqueta-tamano";
import { existeNombre, getEtiquetaTamano, lockEtiquetaTamano, updateEtiquetaTamanoDatos } from "../infrastructure/etiqueta-tamano-repository";
import { NOMBRE_DUPLICADO_MESSAGE } from "./crear-etiqueta-tamano";
import { medidaMmInput } from "./medida-mm";

/** Exported for tests/unit/etiqueta-tamanos-validacion.test.ts. */
export const editarEtiquetaTamanoInput = z
  .object({
    id: uuid,
    nombre: nonEmptyString.max(NOMBRE_MAX_LENGTH, `El nombre no puede superar los ${NOMBRE_MAX_LENGTH} caracteres.`),
    anchoMm: medidaMmInput,
    altoMm: medidaMmInput,
  })
  .strict();

/** PRE-parse shape (raw `FormData` strings): `execute()` still runs the real zod parse. */
export interface EditarEtiquetaTamanoInput {
  id: string;
  nombre: string;
  anchoMm: string;
  altoMm: string;
}

export const NO_ENCONTRADO_MESSAGE = "Tamaño de etiqueta no encontrado.";

export const editarEtiquetaTamanoCommand = defineCommand({
  name: "etiquetaTamanos.editar",
  permiso: "config.editar",
  input: editarEtiquetaTamanoInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "etiqueta_tamano", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    if (!(await lockEtiquetaTamano(tx, session.tenantId, input.id))) throw new NotFoundError(NO_ENCONTRADO_MESSAGE);

    const actual = await getEtiquetaTamano(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError(NO_ENCONTRADO_MESSAGE);

    if (input.nombre.toLowerCase() !== actual.nombre.toLowerCase() && (await existeNombre(tx, session.tenantId, input.nombre, input.id))) {
      throw new ValidationError(NOMBRE_DUPLICADO_MESSAGE, { fields: ["nombre"] });
    }

    await updateEtiquetaTamanoDatos(tx, session.tenantId, input.id, { nombre: input.nombre, anchoMm: input.anchoMm, altoMm: input.altoMm });

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { nombre: actual.nombre, anchoMm: actual.anchoMm, altoMm: actual.altoMm },
        valorNuevo: { nombre: input.nombre, anchoMm: input.anchoMm, altoMm: input.altoMm },
      },
    };
  },
});

export async function editarEtiquetaTamano(input: EditarEtiquetaTamanoInput): Promise<{ id: string }> {
  return editarEtiquetaTamanoCommand.execute(input);
}
