/**
 * `editarDroga` (M06, FASE 4 point 4.2, DP-12 conservative rule). `nombre`
 * and `stockMinimo` are always editable. `unidadBaseId`/`esControlada`/
 * `tipoControl` (the "clasificación") are editable ONLY while the droga has
 * NO partida yet -- this task's binding, conservative resolution of the
 * still-open DP-12: once a partida exists, changing controlled status would
 * break the contralor ledger's continuity, so it is rejected outright with a
 * clear message instead of silently ignored (see domain/droga.ts's
 * `puedeCambiarClasificacion`). NOT a DB invariant (migration 0007 says
 * INV-DRG-001 is not enforced there) -- purely an [APP] check, re-verified
 * here against a FRESH `tieneAlgunaPartida` read every time (never trusted
 * from a stale form load).
 *
 * Optimistic concurrency: same compare-and-swap shape as
 * modules/usuarios/application/editar-usuario.ts.
 *
 * M1/M3 (review findings): the OLD version of this handler called
 * `tieneAlgunaPartida` against a plain, UNLOCKED read -- a partida inserted
 * by a concurrent transaction right after that check (but before this
 * transaction's UPDATE) would not be seen, letting the classification
 * change through despite DP-12. The fix has two layers:
 *   1. [DB, the real guarantee] migration 0028 adds
 *      `trg_droga_validar_clasificacion_inmutable`, which re-locks the
 *      droga row `FOR UPDATE` before checking for partidas -- see that
 *      migration's header for the full lock-conflict reasoning (FOR KEY
 *      SHARE vs FOR NO KEY UPDATE vs FOR UPDATE) proving this closes the
 *      race even if this application code has a bug.
 *   2. [APP, for a clean Spanish message] this handler now ALSO locks the
 *      row first (`lockDrogaParaAccion`) and re-reads it (`getDrogaParaAccion`,
 *      a FRESH statement) before deciding anything -- so its own
 *      `tieneAlgunaPartida` pre-check is correct under concurrency too, and
 *      a real race surfaces as this handler's own `DomainError` (friendly
 *      Spanish message) rather than falling through to the DB trigger's raw
 *      `INV-DRG-001` (still correct, just a less specific message).
 * Also fixes M3 for this command: a droga given de baja concurrently is
 * now detected (see the check right after the fresh read) instead of the
 * compare-and-swap silently ignoring fechaBaja/motivoBaja.
 *
 * The clasificación fields are OPTIONAL: when omitted (e.g. the form locks
 * them because the droga has partidas), the stored values are kept, taken
 * from the fresh locked read -- never from the client. `esControlada`, when
 * omitted, is derived from the effective `tipoControl` (same rule as
 * `tipoControlValido` / the DB CHECK).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import {
  CLASES_DROGA,
  MENSAJE_INSUMO_CONTROLADO,
  TIPOS_CONTROL,
  claseValida,
  tipoControlValido,
  puedeCambiarClasificacion,
  nonNegativeDecimalString,
  type ClaseDroga,
  type TipoControl,
} from "../domain/droga";
import {
  existeNombreVigente,
  getDrogaParaAccion,
  getEtiquetasUnidades,
  lockDrogaParaAccion,
  tieneAlgunaPartida,
  updateDrogaDatos,
} from "../infrastructure/droga-repository";

const editarDrogaInput = z.object({
  id: uuid,
  nombre: nonEmptyString,
  unidadBaseId: uuid.optional(),
  esControlada: z.boolean().optional(),
  tipoControl: z.enum(TIPOS_CONTROL).optional(),
  /** Migration 0063: omitted = keep the stored clase. */
  clase: z.enum(CLASES_DROGA).optional(),
  stockMinimo: nonNegativeDecimalString,
  version: z.object({
    nombre: z.string(),
    unidadBaseId: z.string(),
    esControlada: z.boolean(),
    tipoControl: z.enum(TIPOS_CONTROL),
    clase: z.enum(CLASES_DROGA),
    stockMinimo: z.string(),
  }),
});

/** PRE-parse shape -- see modules/unidades/application/crear-unidad.ts's `CrearUnidadInput` doc comment for why this is hand-written. */
export interface EditarDrogaInput {
  id: string;
  nombre: string;
  unidadBaseId?: string;
  esControlada?: boolean;
  tipoControl?: string;
  clase?: string;
  stockMinimo: string;
  version: { nombre: string; unidadBaseId: string; esControlada: boolean; tipoControl: string; clase: string; stockMinimo: string };
}

export const CONCURRENCY_MESSAGE = "La droga fue modificada por otra persona, recargá.";

export const editarDrogaCommand = defineCommand({
  name: "drogas.editar",
  permiso: "drogas.editar",
  input: editarDrogaInput,
  audit: { entidad: "droga", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const locked = await lockDrogaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Droga no encontrada.");

    const actual = await getDrogaParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Droga no encontrada.");

    // M3: a droga given de baja concurrently (after this edit's form was
    // loaded, before it was submitted) is a conflict.
    if (actual.fechaBaja !== null) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    if (
      actual.nombre !== input.version.nombre ||
      actual.unidadBaseId !== input.version.unidadBaseId ||
      actual.esControlada !== input.version.esControlada ||
      actual.tipoControl !== input.version.tipoControl ||
      actual.clase !== input.version.clase ||
      actual.stockMinimo !== input.version.stockMinimo
    ) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    const unidadBaseId = input.unidadBaseId ?? actual.unidadBaseId;
    const tipoControl = input.tipoControl ?? (actual.tipoControl as TipoControl);
    const esControlada = input.esControlada ?? tipoControl !== "NINGUNO";

    if (!tipoControlValido(esControlada, tipoControl)) {
      throw new ValidationError('El tipo de control debe ser "Ninguno" si y solo si la droga no es controlada.');
    }
    const clase = input.clase ?? (actual.clase as ClaseDroga);
    if (!claseValida(clase, tipoControl)) throw new ValidationError(MENSAJE_INSUMO_CONTROLADO, { fields: ["clase", "tipoControl"] });

    if (input.nombre !== actual.nombre && (await existeNombreVigente(tx, session.tenantId, input.nombre, input.id))) {
      throw new ValidationError("Ya existe una droga con ese nombre.");
    }

    const cambiaClasificacion =
      unidadBaseId !== actual.unidadBaseId || esControlada !== actual.esControlada || tipoControl !== actual.tipoControl;

    if (cambiaClasificacion) {
      const tienePartidas = await tieneAlgunaPartida(tx, session.tenantId, input.id);
      if (!puedeCambiarClasificacion(tienePartidas)) {
        throw new DomainError(
          "No se puede cambiar la unidad base, si es controlada o el tipo de control de una droga que ya tiene partidas: afectaría la continuidad del libro de contralor.",
        );
      }
    }

    const updated = await updateDrogaDatos(
      tx,
      session.tenantId,
      {
        id: input.id,
        nombre: input.nombre,
        clase,
        stockMinimo: input.stockMinimo.toString(),
        ...(cambiaClasificacion ? { clasificacion: { unidadBaseId, esControlada, tipoControl } } : {}),
      },
      {
        nombre: actual.nombre,
        unidadBaseId: actual.unidadBaseId,
        esControlada: actual.esControlada,
        tipoControl: actual.tipoControl,
        clase: actual.clase,
        stockMinimo: actual.stockMinimo,
      },
    );
    if (!updated) throw new ConflictError(CONCURRENCY_MESSAGE);

    const unidadBaseNueva = cambiaClasificacion ? unidadBaseId : actual.unidadBaseId;
    // Readable names for the audit row, taken NOW: later renames must not rewrite history.
    const unidades = await getEtiquetasUnidades(tx, [actual.unidadBaseId, unidadBaseNueva]);
    const etiquetaUnidad = (id: string) => unidades.get(id) ?? null;

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: {
          nombre: actual.nombre,
          unidadBaseId: actual.unidadBaseId,
          unidadBase: etiquetaUnidad(actual.unidadBaseId),
          esControlada: actual.esControlada,
          tipoControl: actual.tipoControl,
          clase: actual.clase,
          stockMinimo: actual.stockMinimo,
        },
        valorNuevo: {
          nombre: input.nombre,
          unidadBaseId: unidadBaseNueva,
          unidadBase: etiquetaUnidad(unidadBaseNueva),
          esControlada: cambiaClasificacion ? esControlada : actual.esControlada,
          tipoControl: cambiaClasificacion ? tipoControl : actual.tipoControl,
          clase,
          stockMinimo: input.stockMinimo.toString(),
        },
      },
    };
  },
});

export async function editarDroga(input: EditarDrogaInput): Promise<{ id: string }> {
  return editarDrogaCommand.execute(input);
}
