/**
 * `crearEtiquetaTamano`: adds a size (name + width x height in mm) the
 * farmacia can print etiquetas on. ADMINISTRADOR only (`config.editar`), with
 * recent re-authentication like the other configuration commands
 * (modules/parametros/application/editar-parametro.ts). The name must be
 * unique per tenant, case-insensitively (the unique index of migration 0066
 * is the authority; the pre-check just gives a clear message).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ValidationError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { nonEmptyString } from "@/shared/validation";
import { existeNombre, insertEtiquetaTamano } from "../infrastructure/etiqueta-tamano-repository";
import { medidaMmInput } from "./medida-mm";

/** Exported for tests/unit/etiqueta-tamanos-validacion.test.ts. */
export const crearEtiquetaTamanoInput = z
  .object({
    nombre: nonEmptyString,
    anchoMm: medidaMmInput,
    altoMm: medidaMmInput,
  })
  .strict();

/** PRE-parse shape (raw `FormData` strings): `execute()` still runs the real zod parse. */
export interface CrearEtiquetaTamanoInput {
  nombre: string;
  anchoMm: string;
  altoMm: string;
}

export const NOMBRE_DUPLICADO_MESSAGE = "Ya existe un tamaño con ese nombre.";

export const crearEtiquetaTamanoCommand = defineCommand({
  name: "etiquetaTamanos.crear",
  permiso: "config.editar",
  input: crearEtiquetaTamanoInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "etiqueta_tamano", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    if (await existeNombre(tx, session.tenantId, input.nombre)) {
      throw new ValidationError(NOMBRE_DUPLICADO_MESSAGE, { fields: ["nombre"] });
    }

    const nuevo = await insertEtiquetaTamano(tx, session.tenantId, input);

    return {
      output: { id: nuevo.id },
      audit: { entidadId: nuevo.id, valorNuevo: { nombre: input.nombre, anchoMm: input.anchoMm, altoMm: input.altoMm } },
    };
  },
});

export async function crearEtiquetaTamano(input: CrearEtiquetaTamanoInput): Promise<{ id: string }> {
  return crearEtiquetaTamanoCommand.execute(input);
}
