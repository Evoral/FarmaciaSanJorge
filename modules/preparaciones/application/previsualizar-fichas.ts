/**
 * `previsualizarFichas`: the fichas técnicas a receta's UNSAVED ítems would
 * get -- the live preview of the toma workspace
 * (/preparaciones/recetas/[recetaId]) while its edit form has changes. Same
 * draft the form serializes as `itemsJson`; nothing is saved: the real
 * ficha is generated when the receta is saved
 * (modules/recetas/application/generar-fichas-y-cotizaciones.ts).
 *
 * Per ítem, entirely in memory: the líneas with the SAME code path
 * `fichas.generar` uses (`resolverFormulaBorrador` + `calcularLineasFicha`),
 * so the preview is exactly what saving will store, plus the partidas each
 * línea would be weighed from (./partidas-para-pesar.ts, same as the saved
 * fichas of `preparaciones.toma.ver`). Each ítem is checked on its own
 * (`itemInput`, the receta's own schema): an ítem that is incomplete or
 * cannot be computed (V1-V9, a droga dada de baja...) gets a message
 * instead of its líneas; the others are still computed.
 *
 * `preparaciones.iniciar`, like the workspace. A query: only plain reads --
 * no ficha, no lock, nothing audited.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import { calcularLineasFicha, resolverFormulaBorrador } from "@/modules/elaboracion/application/calcular-lineas-ficha";
import { itemInput } from "@/modules/recetas/application/crear-receta";
import { mensajeNoFatal } from "@/modules/recetas/application/presupuestar-receta";
import type { LineaDeFichaToma } from "./get-toma-receta";
import { cargarPartidasPorDroga, esLineaPesable, partidasDeLinea } from "./partidas-para-pesar";

/** One ítem's previewed ficha, or why it cannot be shown yet. Líneas carry plain strings (decimal values). */
export type FichaPrevista = { ok: true; lineas: LineaDeFichaToma[] } | { ok: false; mensaje: string };

const previsualizarFichasInput = z.object({
  // Validated one by one below, so an incomplete ítem does not hide the others' previews.
  items: z.array(z.unknown()).min(1, "La receta debe tener al menos un ítem."),
});

export type PrevisualizarFichasWireInput = z.input<typeof previsualizarFichasInput>;
type ItemBorrador = z.infer<typeof itemInput>;
type LineaSinPartidas = Omit<LineaDeFichaToma, "partidas">;

const MENSAJE_ITEM_INCOMPLETO = "Completá los datos del ítem para ver su ficha técnica.";

/** The ítem's ficha líneas, in memory, exactly as `fichas.generar` would store them. */
async function lineasDelItem(tx: Prisma.TransactionClient, tenantId: string, item: ItemBorrador): Promise<LineaSinPartidas[]> {
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
    cantidadTeorica: l.cantidadTeorica ? l.cantidadTeorica.toString() : null,
    excesoAplicado: l.excesoAplicado.toString(),
    cantidadAPesar: l.cantidadAPesar ? l.cantidadAPesar.toString() : null,
    unidadSimbolo: l.unidadSimbolo,
    esEnraseManual: l.esEnraseManual,
    orden: l.orden,
  }));
}

export const previsualizarFichasQuery = defineQuery({
  name: "preparaciones.toma.previsualizarFichas",
  permiso: "preparaciones.iniciar",
  input: previsualizarFichasInput,
  handler: async ({ tx, session, input }): Promise<FichaPrevista[]> => {
    // 1. Each ítem's líneas; an ítem that cannot be computed gets its message.
    const porItem: ({ ok: true; lineas: LineaSinPartidas[] } | { ok: false; mensaje: string })[] = [];
    for (const crudo of input.items) {
      const item = itemInput.safeParse(crudo);
      if (!item.success) {
        porItem.push({ ok: false, mensaje: MENSAJE_ITEM_INCOMPLETO });
        continue;
      }
      try {
        porItem.push({ ok: true, lineas: await lineasDelItem(tx, session.tenantId, item.data) });
      } catch (error) {
        const mensaje = mensajeNoFatal(error);
        if (mensaje === null) throw error;
        porItem.push({ ok: false, mensaje });
      }
    }

    // 2. The partidas of every pesable línea, each droga loaded once.
    const partidasPorDroga = await cargarPartidasPorDroga(
      tx,
      session.tenantId,
      porItem.flatMap((p) => (p.ok ? p.lineas.filter(esLineaPesable).map((l) => l.drogaId) : [])),
    );
    return porItem.map((p) => (p.ok ? { ok: true, lineas: p.lineas.map((linea) => ({ ...linea, partidas: partidasDeLinea(partidasPorDroga, linea) })) } : p));
  },
});

export async function previsualizarFichas(input: PrevisualizarFichasWireInput): Promise<FichaPrevista[]> {
  return previsualizarFichasQuery.execute(input);
}
