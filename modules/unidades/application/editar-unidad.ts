/**
 * `editarUnidad` (M05, FASE 4 point 4.1, INV-M04). `esBase` is deliberately
 * NOT editable here (only set at creation, `crear-unidad.ts`) -- toggling it
 * on an already-in-use unit has no clear business meaning the plan defines,
 * and leaving it out keeps this command from having to reason about
 * INV-M02's partial unique index racing a concurrent edit.
 *
 * `tipoMagnitud`/`factorABase` are accepted from the form but DROPPED from
 * the actual UPDATE when the unit is already `usada` (INV-M04) -- the UI
 * disables those two fields once `usada` is true (so the submitted values
 * are simply the current ones, `version.tipoMagnitud`/`version.factorABase`),
 * and this command mirrors that server-side: it never attempts to change
 * them for a used unit, rather than relying solely on the DB trigger to
 * reject the attempt. Codigo/nombre/simbolo stay editable regardless of
 * `usada` (plan §9 M05: "todo excepto factor_a_base/tipo_magnitud sigue
 * editable" per migration 0006's own comment).
 *
 * Optimistic concurrency: same compare-and-swap shape as
 * modules/usuarios/application/editar-usuario.ts (no dedicated version
 * column on `fsj.unidad_medida`; the submitted field values ARE the version).
 *
 * M3 (review finding): locks the target row FIRST (`lockUnidadParaAccion`)
 * and reads its current state with a FRESH statement only afterward -- see
 * modules/proveedores/application/dar-de-baja-proveedor.ts's doc comment
 * for the race this closes. Also now rejects an edit of a unidad given de
 * baja concurrently (previously the compare-and-swap never looked at
 * fechaBaja/motivoBaja).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, positiveDecimalString } from "@/shared/validation";
import { TIPOS_MAGNITUD } from "../domain/unidad";
import { existeCodigo, getUnidadParaAccion, lockUnidadParaAccion, updateUnidadDatos } from "../infrastructure/unidad-repository";

const editarUnidadInput = z.object({
  id: z.string().uuid(),
  codigo: nonEmptyString.toUpperCase(),
  nombre: nonEmptyString,
  simbolo: nonEmptyString,
  tipoMagnitud: z.enum(TIPOS_MAGNITUD),
  factorABase: positiveDecimalString,
  version: z.object({
    codigo: z.string(),
    nombre: z.string(),
    simbolo: z.string(),
    tipoMagnitud: z.enum(TIPOS_MAGNITUD),
    factorABase: z.string(),
  }),
});

/** PRE-parse shape -- see crear-unidad.ts's `CrearUnidadInput` doc comment for why this is hand-written rather than `z.infer`. */
export interface EditarUnidadInput {
  id: string;
  codigo: string;
  nombre: string;
  simbolo: string;
  tipoMagnitud: string;
  factorABase: string;
  version: { codigo: string; nombre: string; simbolo: string; tipoMagnitud: string; factorABase: string };
}

export const CONCURRENCY_MESSAGE = "La unidad fue modificada por otra persona, recargá.";

export const editarUnidadCommand = defineCommand({
  name: "unidades.editar",
  permiso: "unidades.editar",
  input: editarUnidadInput,
  audit: { entidad: "unidad_medida", accion: "MODIFICAR" },
  handler: async ({ tx, input }) => {
    const locked = await lockUnidadParaAccion(tx, input.id);
    if (!locked) throw new NotFoundError("Unidad de medida no encontrada.");

    const actual = await getUnidadParaAccion(tx, input.id);
    if (!actual) throw new NotFoundError("Unidad de medida no encontrada.");

    // M3: a unidad given de baja concurrently (after this edit's form was
    // loaded, before it was submitted) is a conflict.
    if (actual.fechaBaja !== null) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (
      actual.codigo !== input.version.codigo ||
      actual.nombre !== input.version.nombre ||
      actual.simbolo !== input.version.simbolo ||
      actual.tipoMagnitud !== input.version.tipoMagnitud ||
      actual.factorABase !== input.version.factorABase
    ) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (input.codigo !== actual.codigo && (await existeCodigo(tx, input.codigo, input.id))) {
      throw new ValidationError("Ya existe una unidad con ese código.");
    }

    // INV-M04: once usada, tipoMagnitud/factorABase are immutable -- drop
    // them from the UPDATE entirely (rather than sending the same value,
    // which would still be safe against the trigger but is clearer intent).
    const puedeCambiarClasificacion = !actual.usada;
    if (!puedeCambiarClasificacion && (input.tipoMagnitud !== actual.tipoMagnitud || !input.factorABase.equals(actual.factorABase))) {
      throw new ValidationError("La magnitud y el factor no se pueden modificar: esta unidad ya fue usada (INV-M04).");
    }

    const updated = await updateUnidadDatos(
      tx,
      {
        id: input.id,
        codigo: input.codigo,
        nombre: input.nombre,
        simbolo: input.simbolo,
        ...(puedeCambiarClasificacion ? { tipoMagnitud: input.tipoMagnitud, factorABase: input.factorABase.toString() } : {}),
      },
      {
        codigo: actual.codigo,
        nombre: actual.nombre,
        simbolo: actual.simbolo,
        tipoMagnitud: actual.tipoMagnitud,
        factorABase: actual.factorABase,
      },
    );
    if (!updated) throw new ConflictError(CONCURRENCY_MESSAGE);

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { codigo: actual.codigo, nombre: actual.nombre, simbolo: actual.simbolo, tipoMagnitud: actual.tipoMagnitud, factorABase: actual.factorABase },
        valorNuevo: {
          codigo: input.codigo,
          nombre: input.nombre,
          simbolo: input.simbolo,
          tipoMagnitud: puedeCambiarClasificacion ? input.tipoMagnitud : actual.tipoMagnitud,
          factorABase: puedeCambiarClasificacion ? input.factorABase.toString() : actual.factorABase,
        },
      },
    };
  },
});

export async function editarUnidad(input: EditarUnidadInput): Promise<{ id: string }> {
  return editarUnidadCommand.execute(input);
}
