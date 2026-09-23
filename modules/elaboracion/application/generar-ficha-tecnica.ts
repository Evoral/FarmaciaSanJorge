/**
 * `generarFichaTecnica` (M10, FASE 7 point 7.2). FAR/DT (plan §7:
 * `fichas.generar` -- migration 0002 seed grants FARMACEUTICO +
 * DIRECTOR_TECNICO, no other role). Loads the item_receta + its
 * componentes + drogas (frozen name only, per INV-F05 -- see
 * `ficha-repository.ts`'s `getComponentesParaFicha`) + the tenant's
 * weighing parameters, calls the EXISTING pure calculator
 * (modules/elaboracion/domain/calcular-ficha-tecnica.ts, FASE 1 point
 * 1.10 -- NOT reimplemented or modified here), maps its V1-V9 errors to
 * Spanish, and writes `ficha_tecnica` + `linea_pesaje` in ONE transaction
 * with `version` = current max + 1 under a row lock (see
 * `ficha-repository.ts`'s module doc comment for the concurrency argument).
 *
 * ============================================================================
 * INV-R05 / INV-P02 -- regeneration while a preparación exists (task
 * question, answered here with the actual schema, not a guess):
 * ============================================================================
 * This command NEVER refuses to generate a new version, regardless of the
 * state of any preparación on the item's current latest ficha. Here is why,
 * read directly from the two migrations that own these invariants:
 *
 *  - INV-R05 (migration 0012, prisma/migrations/.../0012_.../migration.sql):
 *    `ficha_tecnica` and `linea_pesaje` have NO UPDATE/DELETE grant AT ALL
 *    (`REVOKE UPDATE, DELETE, TRUNCATE ... FROM fsj_app` + a
 *    forbid_update_delete trigger that rejects even fsj_owner). This is
 *    UNCONDITIONAL immutability -- it does not check for a preparación
 *    before rejecting a write, because there is no code path that could
 *    ever attempt one: nothing in this codebase ever UPDATEs a
 *    ficha_tecnica or linea_pesaje row. "A ficha with a preparación is
 *    never modified" is therefore true, but strictly weaker than what is
 *    actually enforced -- NO ficha, with or without a preparación, is EVER
 *    modified. Versioning (a NEW row, not a modification of the old one)
 *    is the only way this schema supports "regenerating" a ficha, and nothing
 *    in migration 0012 conditions that on preparación state.
 *  - INV-P02 (migration 0013, .../0013_preparacion_etiqueta/migration.sql):
 *    `uq_preparacion_ficha_activa` is a partial unique index on
 *    `(tenant_id, ficha_tecnica_id) WHERE estado <> 'DESCARTADA'` -- it
 *    constrains preparaciones PER FICHA VERSION, not per item_receta. It
 *    says nothing about whether a NEW ficha_tecnica row (a different id,
 *    with its own, empty set of preparaciones) may be inserted while an
 *    OLDER version's preparación is INICIADA or CONFIRMADA.
 *    INV-PRP-003 (`uq_preparacion_item_confirmada`, also migration 0013) is
 *    the only invariant that reaches across versions -- it caps CONFIRMADA
 *    preparaciones at one per item_receta, but that is a constraint on
 *    CONFIRMING a preparación later (M11/FASE 8), not on generating a
 *    ficha now.
 *
 * Net effect: generating version N+1 while version N has an INICIADA
 * preparación is ALLOWED by the schema (the farmacéutico may be correcting
 * a weighing mistake mid-preparation; FASE 8 is what decides what happens
 * to the INICIADA preparación against the now-superseded ficha, out of
 * scope here). Generating N+1 after version N's preparación is CONFIRMADA
 * is also allowed by the schema -- it is operationally close to moot
 * (INV-PRP-003 already forbids ever confirming another preparación for
 * this item_receta), but nothing here manufactures a refusal the DB itself
 * does not require, per the task's own instruction to implement exactly
 * what the invariants say. `listVersionesFicha` (ficha-repository.ts)
 * exposes each version's `preparacionActual` so the UI can surface this
 * context to the farmacéutico instead of silently hiding it.
 * ============================================================================
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { calcularFichaTecnica, FichaTecnicaValidationError } from "../domain/calcular-ficha-tecnica";
import type { ComponenteInput, ItemRecetaInput, LineaPesajeCalculada, TipoMagnitud, UnidadMedidaRef } from "../domain/calcular-ficha-tecnica";
import { mensajeParaCodigoValidacion } from "../domain/mensajes-validacion";
import { siguienteVersionFicha } from "../domain/version";
import {
  lockItemRecetaParaFicha,
  getItemParaFicha,
  getComponentesParaFicha,
  getUnidadesBase,
  getParametrosPesaje,
  getMaxVersionFicha,
  insertFichaConLineas,
} from "../infrastructure/ficha-repository";

const generarFichaTecnicaInput = z.object({ itemRecetaId: uuid });

export interface GenerarFichaTecnicaInput {
  itemRecetaId: string;
}

export interface GenerarFichaTecnicaOutput {
  id: string;
  version: number;
  lineas: Array<{
    drogaId: string;
    drogaNombre: string;
    cantidadTeorica: string | null;
    excesoAplicado: string;
    cantidadAPesar: string | null;
    esEnraseManual: boolean;
    orden: number;
  }>;
}

/** Every `TipoMagnitud` a componente or the item's total actually needs, so a MISSING base unit produces one clear error instead of a `TypeError` deep inside the calculator. */
function magnitudesRequeridas(item: ItemRecetaInput, componentes: ComponenteInput[]): Set<TipoMagnitud> {
  const magnitudes = new Set<TipoMagnitud>(componentes.map((c) => c.unidadMedida.tipoMagnitud));
  if (item.unidadTotal) magnitudes.add(item.unidadTotal.tipoMagnitud);
  return magnitudes;
}

export const generarFichaTecnicaCommand = defineCommand({
  name: "fichas.generar",
  permiso: "fichas.generar",
  input: generarFichaTecnicaInput,
  // INV-A01 (plan §14 / migration 0012 header): generating a ficha técnica
  // has NO effect on stock or the libro recetario (INV-R02) -- the plan's
  // own permission matrix (§7, "fichas.generar/imprimir") annotates the
  // permiso itself with "Sin efecto sobre stock/libro", and §14 lists
  // "fichas técnicas" explicitly among what is NEVER audited. This is a
  // deliberate omission per an existing, confirmed invariant, not a gap.
  audit: {
    skip: true,
    reason:
      "INV-A01 / plan §14: generar (o regenerar) una ficha técnica no tiene efecto sobre stock ni el libro recetario y está explícitamente excluida de la auditoría (fichas técnicas y cotizaciones nunca se auditan).",
  },
  handler: async ({ tx, session, input }) => {
    const locked = await lockItemRecetaParaFicha(tx, session.tenantId, input.itemRecetaId);
    if (!locked) throw new NotFoundError("Ítem de receta no encontrado.");

    const item = await getItemParaFicha(tx, session.tenantId, input.itemRecetaId);
    if (!item) throw new NotFoundError("Ítem de receta no encontrado.");

    const componentesDb = await getComponentesParaFicha(tx, session.tenantId, input.itemRecetaId);

    const itemInput: ItemRecetaInput = {
      formaFarmaceutica: item.formaFarmaceutica,
      cantidadTotal: item.cantidadTotal,
      unidadTotal: item.unidadTotal,
      cantidadUnidades: item.cantidadUnidades,
      fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
    };
    const componentesInput: ComponenteInput[] = componentesDb.map((c) => ({
      drogaId: c.drogaId,
      drogaNombre: c.drogaNombre,
      cantidad: c.cantidad,
      unidadMedida: c.unidadMedida,
      modoExpresion: c.modoExpresion,
      esPrincipioActivo: c.esPrincipioActivo,
      orden: c.orden,
    }));

    const unidadesBaseParciales = await getUnidadesBase(tx);
    const requeridas = magnitudesRequeridas(itemInput, componentesInput);
    const faltante = [...requeridas].find((m) => !unidadesBaseParciales[m]);
    if (faltante) {
      throw new DomainError(
        `No hay una unidad de medida base configurada para la magnitud ${faltante}: pedile a un administrador que revise el catálogo de unidades antes de generar la ficha.`,
      );
    }
    // Safe: every magnitud actually referenced by `itemInput`/`componentesInput`
    // (the only keys the calculator ever indexes with) was just confirmed
    // present above -- a magnitud with no base unit configured would have
    // already thrown. Magnitudes NOT referenced may legitimately be absent
    // from `unidadesBaseParciales`.
    const unidadesBase = unidadesBaseParciales as Record<TipoMagnitud, UnidadMedidaRef>;

    const parametros = await getParametrosPesaje(tx, session.tenantId);

    let lineas: LineaPesajeCalculada[];
    try {
      lineas = calcularFichaTecnica(itemInput, componentesInput, parametros, unidadesBase);
    } catch (e) {
      if (e instanceof FichaTecnicaValidationError) {
        throw new DomainError(mensajeParaCodigoValidacion(e.validationCode));
      }
      throw e;
    }

    const maxVersion = await getMaxVersionFicha(tx, session.tenantId, input.itemRecetaId);
    const nueva = await insertFichaConLineas(tx, {
      tenantId: session.tenantId,
      itemRecetaId: input.itemRecetaId,
      version: siguienteVersionFicha(maxVersion),
      generadaPorId: session.usuario.id,
      lineas,
    });

    return {
      output: {
        id: nueva.id,
        version: nueva.version,
        lineas: lineas.map((l) => ({
          drogaId: l.drogaId,
          drogaNombre: l.drogaNombre,
          cantidadTeorica: l.cantidadTeorica ? l.cantidadTeorica.toString() : null,
          excesoAplicado: l.excesoAplicado.toString(),
          cantidadAPesar: l.cantidadAPesar ? l.cantidadAPesar.toString() : null,
          esEnraseManual: l.esEnraseManual,
          orden: l.orden,
        })),
      },
    };
  },
});

export async function generarFichaTecnica(input: GenerarFichaTecnicaInput): Promise<GenerarFichaTecnicaOutput> {
  return generarFichaTecnicaCommand.execute(input);
}
