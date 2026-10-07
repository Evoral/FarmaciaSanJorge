/**
 * `agregarSinonimo` (docs/specs/sinonimos-droga.md): another name for the
 * SAME substance ("Petrolato" for "Vaselina sólida"), so it is found by
 * that name everywhere without creating a second droga. Same permiso as
 * editing the droga. Rejected when, after normalization (accents, case and
 * whitespace ignored), the text is empty, is this droga's own name, is the
 * name of another vigente droga, or is already a vigente synonym (of this
 * droga or another one). A droga dada de baja takes no new synonyms.
 *
 * Locks the droga first (`lockDrogaParaAccion`), so a concurrent baja
 * cannot slip in between the check and the insert; the DB re-checks the
 * name rules (migration 0067: uq_droga_alias_vigente, INV-DRG-002).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { normalizarTexto } from "../domain/normalizar";
import { SINONIMO_MAX_LARGO, limpiarSinonimo, mensajeConflictoNombre } from "../domain/sinonimo";
import { existeNombreVigente, getDrogaParaAccion, lockDrogaParaAccion } from "../infrastructure/droga-repository";
import { insertSinonimo } from "../infrastructure/sinonimo-repository";

const agregarSinonimoInput = z.object({
  drogaId: uuid,
  sinonimo: nonEmptyString.max(SINONIMO_MAX_LARGO, `Como máximo ${SINONIMO_MAX_LARGO} caracteres.`),
});

export type AgregarSinonimoInput = z.input<typeof agregarSinonimoInput>;

export const agregarSinonimoCommand = defineCommand({
  name: "drogas.sinonimos.agregar",
  permiso: "drogas.editar",
  input: agregarSinonimoInput,
  audit: { entidad: "droga_alias", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockDrogaParaAccion(tx, session.tenantId, input.drogaId);
    if (!locked) throw new NotFoundError("Droga no encontrada.");
    const droga = await getDrogaParaAccion(tx, session.tenantId, input.drogaId);
    if (!droga) throw new NotFoundError("Droga no encontrada.");
    if (droga.fechaBaja !== null) throw new DomainError("La droga está dada de baja: no se le pueden agregar otros nombres.");

    const texto = limpiarSinonimo(input.sinonimo);
    const aliasNormalizado = normalizarTexto(texto);
    if (aliasNormalizado.length === 0) throw new ValidationError("Escribí el otro nombre de la droga.", { fields: ["sinonimo"] });

    const conflicto = await existeNombreVigente(tx, session.tenantId, texto);
    if (conflicto) throw new ValidationError(mensajeConflictoNombre(conflicto, droga.id), { fields: ["sinonimo"] });

    const nuevo = await insertSinonimo(tx, { tenantId: session.tenantId, drogaId: droga.id, texto, aliasNormalizado, creadoPorId: session.usuario.id });

    return {
      output: { id: nuevo.id },
      audit: {
        entidadId: nuevo.id,
        valorNuevo: { sinonimo: texto, aliasNormalizado, drogaId: droga.id, droga: droga.nombre },
      },
    };
  },
});

export async function agregarSinonimo(input: AgregarSinonimoInput): Promise<{ id: string }> {
  return agregarSinonimoCommand.execute(input);
}
