/**
 * `reactivarEtiquetaTamano`: the mirror of `darDeBajaEtiquetaTamano` -- the
 * size is offered again when printing. ADMINISTRADOR only (`config.editar`)
 * with recent re-authentication; the motivo goes to the audit trail. A size
 * that does not fit the sheet is not reactivated (docs/specs/hoja-etiquetas.md
 * R5): the form only has the motivo, so the refusal is a plain domain error and
 * the administrator edits the size first.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { nonEmptyString, uuid } from "@/shared/validation";
import { entraEnHoja } from "../domain/etiqueta-hoja";
import { getEtiquetaHoja, lockEtiquetaHojaCompartida } from "../infrastructure/etiqueta-hoja-repository";
import { cambiarActivoEtiquetaTamano, getEtiquetaTamano, lockEtiquetaTamano } from "../infrastructure/etiqueta-tamano-repository";
import { NO_ENCONTRADO_MESSAGE } from "./editar-etiqueta-tamano";
import { mensajeNoEntraEnHoja } from "./entra-en-hoja";

const reactivarEtiquetaTamanoInput = z.object({ id: uuid, motivo: nonEmptyString }).strict();

export type ReactivarEtiquetaTamanoInput = z.infer<typeof reactivarEtiquetaTamanoInput>;

export const reactivarEtiquetaTamanoCommand = defineCommand({
  name: "etiquetaTamanos.reactivar",
  permiso: "config.editar",
  input: reactivarEtiquetaTamanoInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "etiqueta_tamano", accion: "REACTIVAR" },
  handler: async ({ tx, session, input }) => {
    if (!(await lockEtiquetaTamano(tx, session.tenantId, input.id))) throw new NotFoundError(NO_ENCONTRADO_MESSAGE);

    const actual = await getEtiquetaTamano(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError(NO_ENCONTRADO_MESSAGE);
    if (actual.activo) throw new DomainError("Este tamaño no está dado de baja.");

    await lockEtiquetaHojaCompartida(tx, session.tenantId);
    const hoja = await getEtiquetaHoja(tx, session.tenantId);
    if (!entraEnHoja(hoja, actual)) throw new DomainError(`${mensajeNoEntraEnHoja(hoja)} Editalo para que entre antes de reactivarlo.`);

    await cambiarActivoEtiquetaTamano(tx, session.tenantId, input.id, true);

    return {
      output: { id: input.id },
      audit: { entidadId: input.id, motivo: input.motivo, valorAnterior: { activo: false }, valorNuevo: { activo: true } },
    };
  },
});

export async function reactivarEtiquetaTamano(input: ReactivarEtiquetaTamanoInput): Promise<{ id: string }> {
  return reactivarEtiquetaTamanoCommand.execute(input);
}
