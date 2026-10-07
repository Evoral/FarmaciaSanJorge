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
 *
 * "Otros nombres" (docs/specs/sinonimos-droga.md) are saved with the rest of
 * the form, same rows as the alta: `sinonimos` is the full list as edited
 * (row `i` = form field `sinonimo-i`) and `sinonimosCargados` the ids of the
 * synonyms the form showed. Omitted = synonyms
 * untouched. A loaded synonym that was removed, blanked or retyped to another
 * name is given de baja; a new text is added (checked like `crearDroga`'s);
 * synonyms added by someone else after the form loaded are never removed.
 * Removals run before the name check, so the droga can be renamed to one of
 * its own synonyms in the same save. Each change is audited as its own
 * `droga_alias` row.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
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
import { normalizarTexto } from "../domain/normalizar";
import { SINONIMO_MAX_LARGO, limpiarSinonimo, mensajeConflictoNombre } from "../domain/sinonimo";
import {
  existeNombreVigente,
  getDrogaParaAccion,
  getEtiquetasUnidades,
  lockDrogaParaAccion,
  tieneAlgunaPartida,
  updateDrogaDatos,
} from "../infrastructure/droga-repository";
import { insertSinonimo, listSinonimosDeDroga, quitarSinonimo } from "../infrastructure/sinonimo-repository";

const editarDrogaInput = z.object({
  id: uuid,
  nombre: nonEmptyString,
  unidadBaseId: uuid.optional(),
  esControlada: z.boolean().optional(),
  tipoControl: z.enum(TIPOS_CONTROL).optional(),
  /** Migration 0063: omitted = keep the stored clase. */
  clase: z.enum(CLASES_DROGA).optional(),
  stockMinimo: nonNegativeDecimalString,
  sinonimos: z.array(z.string().max(SINONIMO_MAX_LARGO, `Como máximo ${SINONIMO_MAX_LARGO} caracteres.`)).max(50).optional(),
  sinonimosCargados: z.array(uuid).max(50).default([]),
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
  /** The "Otros nombres" rows as edited, positional (row `i` = field `sinonimo-i`); omitted = synonyms untouched. */
  sinonimos?: string[];
  /** Ids of the synonyms the form showed when loaded. */
  sinonimosCargados?: string[];
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

    const sinonimos = input.sinonimos ? await planificarSinonimos(tx, session.tenantId, input.id, input.nombre, input.sinonimos, input.sinonimosCargados) : null;
    const auditarSinonimo = (entidadId: string, accion: TipoAccion, valores: { valorAnterior?: Prisma.InputJsonValue; valorNuevo: Prisma.InputJsonValue }) =>
      auditRecord(tx, { tenantId: session.tenantId, usuarioId: session.usuario.id, entidad: "droga_alias", entidadId, accion, ...valores });

    const sinonimosQuitados: string[] = [];
    if (sinonimos) {
      const now = new Date();
      for (const quitado of sinonimos.quitar) {
        // Already gone (removed concurrently): nothing to undo.
        if (!(await quitarSinonimo(tx, session.tenantId, quitado.id, now))) continue;
        sinonimosQuitados.push(quitado.texto);
        await auditarSinonimo(quitado.id, TipoAccion.BAJA, {
          valorAnterior: { sinonimo: quitado.texto, drogaId: input.id, droga: actual.nombre, fechaBaja: null },
          valorNuevo: { fechaBaja: now.toISOString() },
        });
      }
    }

    // Accent/case-insensitive, against other vigente drogas AND every vigente synonym, this droga's own included
    // (docs/specs/sinonimos-droga.md). Only when the name changes: an untouched name never blocks other edits.
    if (input.nombre !== actual.nombre) {
      const conflicto = await existeNombreVigente(tx, session.tenantId, input.nombre, input.id);
      if (conflicto) throw new ValidationError(mensajeConflictoNombre(conflicto, input.id), { fields: ["nombre"] });
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

    if (sinonimos) {
      for (const nuevo of sinonimos.agregar) {
        const ocupado = await existeNombreVigente(tx, session.tenantId, nuevo.texto, input.id);
        if (ocupado) throw new ValidationError(mensajeConflictoNombre(ocupado, input.id), { fields: [nuevo.campo] });
        const alias = await insertSinonimo(tx, { tenantId: session.tenantId, drogaId: input.id, texto: nuevo.texto, aliasNormalizado: nuevo.aliasNormalizado, creadoPorId: session.usuario.id });
        await auditarSinonimo(alias.id, TipoAccion.CREAR, {
          valorNuevo: { sinonimo: nuevo.texto, aliasNormalizado: nuevo.aliasNormalizado, drogaId: input.id, droga: input.nombre },
        });
      }
    }

    const unidadBaseNueva = cambiaClasificacion ? unidadBaseId : actual.unidadBaseId;
    // Readable names for the audit row, taken NOW: later renames must not rewrite history.
    const unidades = await getEtiquetasUnidades(tx, [actual.unidadBaseId, unidadBaseNueva]);
    const etiquetaUnidad = (id: string) => unidades.get(id) ?? null;

    return {
      output: { id: input.id, sinonimosAgregados: sinonimos?.agregar.map((a) => a.texto) ?? [], sinonimosQuitados },
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
          ...(sinonimos ? { sinonimos: sinonimos.antes } : {}),
        },
        valorNuevo: {
          nombre: input.nombre,
          unidadBaseId: unidadBaseNueva,
          unidadBase: etiquetaUnidad(unidadBaseNueva),
          esControlada: cambiaClasificacion ? esControlada : actual.esControlada,
          tipoControl: cambiaClasificacion ? tipoControl : actual.tipoControl,
          clase,
          stockMinimo: input.stockMinimo.toString(),
          ...(sinonimos ? { sinonimos: sinonimos.despues } : {}),
        },
      },
    };
  },
});

interface PlanSinonimos {
  quitar: { id: string; texto: string }[];
  agregar: { texto: string; aliasNormalizado: string; campo: string }[];
  /** Vigente synonyms before / after the save, as typed, for the droga's audit row. */
  antes: string[];
  despues: string[];
}

/**
 * Turns the edited "Otros nombres" rows into removals and additions, rejecting (on the row's own field) a text that is
 * the droga's new name or repeats another row. A row matching a vigente synonym of this droga (its loaded one, or one
 * added meanwhile) keeps that synonym instead of adding a copy; loaded synonyms no row keeps are removed.
 */
async function planificarSinonimos(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  nombre: string,
  filas: string[],
  cargados: string[],
): Promise<PlanSinonimos> {
  const vigentes = (await listSinonimosDeDroga(tx, tenantId, drogaId)).map((s) => ({ id: s.id, texto: s.texto, normalizado: normalizarTexto(s.texto) }));
  const nombreNormalizado = normalizarTexto(nombre);
  const conservados = new Set<string>();
  const agregar: PlanSinonimos["agregar"] = [];
  const vistos = new Set<string>();

  for (const [i, fila] of filas.entries()) {
    const texto = limpiarSinonimo(fila);
    const aliasNormalizado = normalizarTexto(texto);
    if (aliasNormalizado.length === 0) continue;
    const campo = `sinonimo-${i}`;
    if (aliasNormalizado === nombreNormalizado) throw new ValidationError(`«${texto}» es el mismo nombre principal de la droga.`, { fields: [campo] });
    if (vistos.has(aliasNormalizado)) throw new ValidationError(`«${texto}» está repetido.`, { fields: [campo] });
    vistos.add(aliasNormalizado);

    const mismo = vigentes.find((v) => v.normalizado === aliasNormalizado);
    if (mismo) conservados.add(mismo.id);
    else agregar.push({ texto, aliasNormalizado, campo });
  }

  const loaded = new Set(cargados);
  const quitar = vigentes.filter((v) => loaded.has(v.id) && !conservados.has(v.id)).map(({ id, texto }) => ({ id, texto }));
  const quitados = new Set(quitar.map((q) => q.id));
  const ordenar = (textos: string[]) => [...textos].sort((a, b) => a.localeCompare(b, "es"));
  return {
    quitar,
    agregar,
    antes: ordenar(vigentes.map((v) => v.texto)),
    despues: ordenar([...vigentes.filter((v) => !quitados.has(v.id)).map((v) => v.texto), ...agregar.map((a) => a.texto)]),
  };
}

/** Also returns the other names this save added and removed, as stored (for the success message). */
export async function editarDroga(input: EditarDrogaInput): Promise<{ id: string; sinonimosAgregados: string[]; sinonimosQuitados: string[] }> {
  return editarDrogaCommand.execute(input);
}
