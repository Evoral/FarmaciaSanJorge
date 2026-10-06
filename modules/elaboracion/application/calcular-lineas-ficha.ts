/**
 * The ONE place a ficha técnica's lines are computed from a formula:
 * loads what the pure calculator needs besides the formula itself (the
 * base unit of every magnitude and the tenant's weighing parameters),
 * runs `calcularFichaTecnica`, and turns its V1-V9 errors into Spanish
 * (`FichaNoGenerableError`, message + stable code).
 *
 * Shared by `fichas.generar` (a saved item, persisted as a new version)
 * and `recetas.presupuestar` (an unsaved draft, computed in memory only --
 * docs/specs/presupuesto-receta.md), so both always agree on the lines.
 * Not a use case: callers run it inside their own transaction.
 */
import type { Prisma } from "@/generated/prisma/client";
import { calcularFichaTecnica, FichaTecnicaValidationError } from "../domain/calcular-ficha-tecnica";
import type { ComponenteInput, FormaFarmaceutica, ItemRecetaInput, LineaPesajeCalculada, ModoExpresion, TipoMagnitud, UnidadMedidaRef } from "../domain/calcular-ficha-tecnica";
import { FichaNoGenerableError, esCodigoFichaNoGenerable } from "../domain/ficha-no-generable";
import { mensajeParaCodigoValidacion } from "../domain/mensajes-validacion";
import { getDrogasParaBorrador, getParametrosPesaje, getUnidadesBase, getUnidadesParaBorrador } from "../infrastructure/ficha-repository";
import type { UnidadBase } from "../infrastructure/ficha-repository";

export interface LineaFichaCalculada extends LineaPesajeCalculada {
  /** Símbolo of the line's base unit (what a cotización labels the line with). */
  unidadSimbolo: string;
}

/** Every `TipoMagnitud` a componente or the item's total actually needs, so a MISSING base unit produces one clear error instead of a `TypeError` deep inside the calculator. */
function magnitudesRequeridas(item: ItemRecetaInput, componentes: readonly ComponenteInput[]): Set<TipoMagnitud> {
  const magnitudes = new Set<TipoMagnitud>(componentes.map((c) => c.unidadMedida.tipoMagnitud));
  if (item.unidadTotal) magnitudes.add(item.unidadTotal.tipoMagnitud);
  return magnitudes;
}

export async function calcularLineasFicha(
  tx: Prisma.TransactionClient,
  tenantId: string,
  item: ItemRecetaInput,
  componentes: ComponenteInput[],
): Promise<LineaFichaCalculada[]> {
  const unidadesBaseParciales = await getUnidadesBase(tx);
  const faltante = [...magnitudesRequeridas(item, componentes)].find((m) => !unidadesBaseParciales[m]);
  if (faltante) {
    throw new FichaNoGenerableError(
      "SIN_UNIDAD_BASE",
      `No hay una unidad de medida base configurada para la magnitud ${faltante}: pedile a un administrador que revise el catálogo de unidades antes de generar la ficha.`,
    );
  }
  // Safe: every magnitud actually referenced by `item`/`componentes` (the
  // only keys the calculator ever indexes with) was just confirmed present
  // above. Magnitudes NOT referenced may legitimately be absent.
  const unidadesBase = unidadesBaseParciales as Record<TipoMagnitud, UnidadBase>;
  const parametros = await getParametrosPesaje(tx, tenantId);

  let lineas: LineaPesajeCalculada[];
  try {
    lineas = calcularFichaTecnica(item, componentes, parametros, unidadesBase);
  } catch (e) {
    if (e instanceof FichaTecnicaValidationError) {
      const codigo = esCodigoFichaNoGenerable(e.validationCode) ? e.validationCode : "DATOS_INVALIDOS";
      throw new FichaNoGenerableError(codigo, mensajeParaCodigoValidacion(e.validationCode));
    }
    throw e;
  }
  return lineas.map((l) => ({ ...l, unidadSimbolo: unidadesBase[l.unidadMedida.tipoMagnitud].simbolo }));
}

// ============================================================================
// Unsaved formula (a receta draft) -> calculator inputs
// ============================================================================

export interface ComponenteBorrador {
  drogaId: string;
  cantidad: string | null;
  unidadMedidaId: string;
  modoExpresion: ModoExpresion;
}

export interface FormulaBorrador {
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: number;
  fraccionDosisPorUnidad: string;
  cantidadTotal: string | null;
  unidadTotalId: string | null;
  componentes: ComponenteBorrador[];
}

const MENSAJE_REFERENCIAS_INVALIDAS = "Una o más drogas o unidades del ítem no existen o están dadas de baja.";

/**
 * Resolves a draft's droga/unidad ids to what `calcularLineasFicha` needs,
 * the way `getItemParaFicha`/`getComponentesParaFicha` do for a saved item.
 * Drogas or unidades that do not exist or are dados de baja ->
 * `DATOS_INVALIDOS`.
 */
export async function resolverFormulaBorrador(
  tx: Prisma.TransactionClient,
  tenantId: string,
  formula: FormulaBorrador,
): Promise<{ item: ItemRecetaInput; componentes: ComponenteInput[] }> {
  const unidadIds = [...formula.componentes.map((c) => c.unidadMedidaId), ...(formula.unidadTotalId ? [formula.unidadTotalId] : [])];
  const unidades = await getUnidadesParaBorrador(tx, unidadIds);
  const drogas = await getDrogasParaBorrador(
    tx,
    tenantId,
    formula.componentes.map((c) => c.drogaId),
  );

  const unidad = (id: string): UnidadMedidaRef => {
    const u = unidades.get(id);
    if (!u || !u.vigente) throw new FichaNoGenerableError("DATOS_INVALIDOS", MENSAJE_REFERENCIAS_INVALIDAS);
    return u.ref;
  };

  const componentes: ComponenteInput[] = formula.componentes.map((c) => {
    const droga = drogas.get(c.drogaId);
    if (!droga || !droga.vigente) throw new FichaNoGenerableError("DATOS_INVALIDOS", MENSAJE_REFERENCIAS_INVALIDAS);
    return {
      drogaId: c.drogaId,
      drogaNombre: droga.nombre,
      cantidad: c.cantidad,
      unidadMedida: unidad(c.unidadMedidaId),
      modoExpresion: c.modoExpresion,
    };
  });

  return {
    item: {
      formaFarmaceutica: formula.formaFarmaceutica,
      cantidadTotal: formula.cantidadTotal,
      unidadTotal: formula.unidadTotalId ? unidad(formula.unidadTotalId) : null,
      cantidadUnidades: formula.cantidadUnidades,
      fraccionDosisPorUnidad: formula.fraccionDosisPorUnidad,
    },
    componentes,
  };
}
