/**
 * `presupuestarReceta` (docs/specs/presupuesto-receta.md): the price of a
 * receta WHILE it is being loaded -- same draft the form serializes as
 * `itemsJson`, no receta id, nothing saved. Permiso `cotizaciones.calcular`
 * (the same people who may cotizar a saved item).
 *
 * Per item, entirely in memory: the ficha's lines with the SAME code path
 * `fichas.generar` uses (`calcularLineasFicha`: base units, weighing
 * parameters, pure calculator). Then all items' costs CUMULATIVELY in
 * item order, each item priced on its own cost with the open regla's
 * precio mínimo + tramos (`cotizarItemsAcumulado`, same
 * reparto rules as `cotizaciones.calcular`): each item sees only the stock
 * the previous ones left, so two items needing the same droga cannot both
 * look covered, and a droga the whole receta needs more of than exists is
 * reported (`faltantesReceta`). An item that cannot be
 * priced (V1-V9, a droga dada de baja...) gets a message instead of a
 * price; the others are still priced. No regla configured -> one message
 * for the whole presupuesto.
 *
 * INV-R02: only plain reads -- no ficha, no cotización, no lock, no
 * reservation is written or taken. A query, so nothing is audited (fichas
 * and cotizaciones are excluded from the audit trail anyway, plan §14).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import { DomainError, ValidationError } from "@/shared/errors";
import { calcularLineasFicha, resolverFormulaBorrador } from "@/modules/elaboracion/application/calcular-lineas-ficha";
import { cargarReglaPrecioVigente, cotizarItemsAcumulado, type LineaACostear } from "@/modules/precios/application/cotizar-lineas";
import { MENSAJE_SIN_REGLA_PRECIO, armarPresupuesto, faltantesDeReceta, presupuestoItemDesdeCotizacion } from "../domain/presupuesto";
import type { Presupuesto, PresupuestoItem } from "../domain/presupuesto";
import { itemInput } from "./crear-receta";

export type { Presupuesto, PresupuestoItem };

const presupuestarRecetaInput = z.object({
  items: z.array(itemInput).min(1, "La receta debe tener al menos un ítem."),
});

export type PresupuestarRecetaWireInput = z.input<typeof presupuestarRecetaInput>;
type ItemBorrador = z.infer<typeof itemInput>;

/** The message shown instead of an item's price, or `null` for an unexpected error (rethrown, not hidden). Shared with `preparaciones.toma.previsualizarFichas`. */
export function mensajeNoFatal(error: unknown): string | null {
  if (error instanceof DomainError || error instanceof ValidationError) return error.message;
  // decimal.js rejects a malformed quantity with a plain Error.
  if (error instanceof Error && error.message.startsWith("[DecimalError]")) return "El ítem tiene una cantidad que no es un número válido.";
  return null;
}

/** The item's ficha lines, in memory, ready to be costed. */
async function lineasDelItem(tx: Prisma.TransactionClient, tenantId: string, item: ItemBorrador): Promise<LineaACostear[]> {
  const formula = await resolverFormulaBorrador(tx, tenantId, {
    formaFarmaceutica: item.formaFarmaceutica,
    cantidadUnidades: item.cantidadUnidades,
    fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
    cantidadTotal: item.cantidadTotal,
    unidadTotalId: item.unidadTotalId ?? null,
    componentes: item.componentes,
  });
  const lineas = await calcularLineasFicha(tx, tenantId, formula.item, formula.componentes);
  return lineas.map((l) => ({
    drogaId: l.drogaId,
    drogaNombre: l.drogaNombre,
    unidadSimbolo: l.unidadSimbolo,
    unidad: { factorABase: String(l.unidadMedida.factorABase), tipoMagnitud: l.unidadMedida.tipoMagnitud },
    cantidadAPesar: l.cantidadAPesar,
    esEnraseManual: l.esEnraseManual,
    orden: l.orden,
  }));
}

export async function presupuestar(tx: Prisma.TransactionClient, tenantId: string, items: readonly ItemBorrador[]): Promise<Presupuesto> {
  const regla = await cargarReglaPrecioVigente(tx, tenantId);
  if (!regla) return { ok: false, mensaje: MENSAJE_SIN_REGLA_PRECIO };

  // 1. Each item's ficha lines; an item that cannot be computed gets its message.
  const porItem: ({ ok: true; lineas: LineaACostear[] } | { ok: false; mensaje: string })[] = [];
  for (const item of items) {
    try {
      porItem.push({ ok: true, lineas: await lineasDelItem(tx, tenantId, item) });
    } catch (error) {
      const mensaje = mensajeNoFatal(error);
      if (mensaje === null) throw error;
      porItem.push({ ok: false, mensaje });
    }
  }

  // 2. The computable items costed together, in order, against the same stock.
  const cotizaciones = await cotizarItemsAcumulado(
    tx,
    tenantId,
    porItem.flatMap((p) => (p.ok ? [p.lineas] : [])),
    regla,
  );
  let siguiente = 0;
  const resultado: PresupuestoItem[] = porItem.map((p, i) =>
    p.ok ? presupuestoItemDesdeCotizacion(i + 1, cotizaciones[siguiente++]!) : { indice: i + 1, ok: false, mensaje: p.mensaje },
  );
  return armarPresupuesto(resultado, faltantesDeReceta(cotizaciones));
}

export const presupuestarRecetaQuery = defineQuery({
  name: "recetas.presupuestar",
  permiso: "cotizaciones.calcular",
  input: presupuestarRecetaInput,
  handler: async ({ tx, session, input }): Promise<Presupuesto> => presupuestar(tx, session.tenantId, input.items),
});

export async function presupuestarReceta(input: PresupuestarRecetaWireInput): Promise<Presupuesto> {
  return presupuestarRecetaQuery.execute(input);
}
