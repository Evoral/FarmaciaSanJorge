/**
 * `darDeBajaEtiquetaTamano`: deactivates a size (`activo = false`) so it is no
 * longer offered when printing. The row is never deleted (fsj_app has no
 * DELETE) and can be reactivated. ADMINISTRADOR only (`config.editar`) with
 * recent re-authentication; the motivo goes to the audit trail (the table has
 * no motivo column).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { nonEmptyString, uuid } from "@/shared/validation";
import { cambiarActivoEtiquetaTamano, getEtiquetaTamano, lockEtiquetaTamano } from "../infrastructure/etiqueta-tamano-repository";
import { NO_ENCONTRADO_MESSAGE } from "./editar-etiqueta-tamano";

const darDeBajaEtiquetaTamanoInput = z.object({ id: uuid, motivo: nonEmptyString }).strict();

export type DarDeBajaEtiquetaTamanoInput = z.infer<typeof darDeBajaEtiquetaTamanoInput>;

export const darDeBajaEtiquetaTamanoCommand = defineCommand({
  name: "etiquetaTamanos.baja",
  permiso: "config.editar",
  input: darDeBajaEtiquetaTamanoInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "etiqueta_tamano", accion: "BAJA" },
  handler: async ({ tx, session, input }) => {
    if (!(await lockEtiquetaTamano(tx, session.tenantId, input.id))) throw new NotFoundError(NO_ENCONTRADO_MESSAGE);

    const actual = await getEtiquetaTamano(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError(NO_ENCONTRADO_MESSAGE);
    if (!actual.activo) throw new DomainError("Este tamaño ya está dado de baja.");

    await cambiarActivoEtiquetaTamano(tx, session.tenantId, input.id, false);

    return {
      output: { id: input.id },
      audit: { entidadId: input.id, motivo: input.motivo, valorAnterior: { activo: true }, valorNuevo: { activo: false } },
    };
  },
});

export async function darDeBajaEtiquetaTamano(input: DarDeBajaEtiquetaTamanoInput): Promise<{ id: string }> {
  return darDeBajaEtiquetaTamanoCommand.execute(input);
}
