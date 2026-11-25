/**
 * "Imprimir ficha técnica" from the toma workspace (/preparaciones/recetas/[recetaId]): the stored ficha with, for each
 * corrected línea (U.I., or a lot below 100 % purity), the grams the bench weighs from each lot -- the ficha only holds
 * the ACTIVE amount (openspec/specs/unidad-internacional/spec.md UI6). The lots are the preparación's:
 *   1. CONFIRMADA: its EGRESO_PREPARACION movements, with the factor they applied (snapshot);
 *   2. INICIADA: its reservas;
 *   3. none: the lots chosen in the pesada en borrador (migration 0090) when they cover the línea, else the automatic
 *      split (R21, `repartirLinea`, the same candidates and order as the reserva).
 * A marked droga with no lot of the línea's kind prints "Cantidad manual" (UI7). A línea whose lots apply no correction,
 * a faltante or an enrase manual prints as the stored ficha does. Nothing is written; the stored ficha never changes.
 *
 * `fichas.imprimir`, like the ficha's own print route (modules/elaboracion).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { dec } from "@/shared/decimal";
import { convertirCantidad, mismaMagnitud } from "@/shared/decimal/convertir-unidad";
import { formatNumero } from "@/shared/format/cantidad";
import { getFichaParaImprimirEnTx, type FichaParaImprimir } from "@/modules/elaboracion/application/get-ficha-para-imprimir";
import {
  renderFichaTecnicaPdf,
  type FichaTecnicaPdfResult,
  type LotePesadaImprimir,
  type PesadaDeLineaImprimir,
} from "@/modules/elaboracion/application/imprimir-ficha-tecnica-pdf";
import { POTENCIA_SIN_CORRECCION } from "../domain/potencia";
import { partidasCompatiblesConLinea, repartirLinea } from "../domain/reparto-linea";
import {
  getBorradoresDeFicha,
  getLineasParaPreparacion,
  getPartidasFrescas,
  getPreparacionVivaDeFicha,
  listEgresosDeLineasDePreparacion,
  listReservasDePreparacion,
} from "../infrastructure/preparacion-repository";
import type { LineaParaPantalla } from "../infrastructure/preparacion-repository";
import { cargarPartidasPorDroga, esLineaPesable } from "./partidas-para-pesar";

/** "100.000 U.I./g" for a U.I. lot, "98 %" for a lot below 100 %, `null` when the lot applies no correction. */
export function textoFactorLote(potencia: string | null | undefined, actividad: string | null | undefined): string | null {
  if (actividad !== null && actividad !== undefined) return `${formatNumero(actividad)} U.I./g`;
  if (potencia !== null && potencia !== undefined && dec(potencia).lessThan(POTENCIA_SIN_CORRECCION)) return `${formatNumero(potencia)} %`;
  return null;
}

/** The lots of a línea, only when one of them corrects the amount (otherwise the stored ficha already reads right). */
function pesadaPorLotes(lotes: LotePesadaImprimir[]): PesadaDeLineaImprimir | null {
  const conCantidad = lotes.filter((l) => !dec(l.cantidad).isZero());
  return conCantidad.some((l) => l.factor !== null) ? { tipo: "LOTES", lotes: conCantidad } : null;
}

function agrupar<T>(filas: readonly T[], clave: (fila: T) => string): Map<string, T[]> {
  const porClave = new Map<string, T[]>();
  for (const fila of filas) porClave.set(clave(fila), [...(porClave.get(clave(fila)) ?? []), fila]);
  return porClave;
}

const imprimirFichaDeTomaInput = z.object({ fichaId: uuid });

export const imprimirFichaDeTomaQuery = defineQuery({
  name: "preparaciones.toma.imprimirFicha",
  permiso: "fichas.imprimir",
  input: imprimirFichaDeTomaInput,
  handler: async ({ tx, session, input }) => getFichaYPesadaDeTomaEnTx(tx, session.tenantId, input.fichaId),
});

/**
 * Same read inside the caller's transaction (not a use case: the caller already authorized `fichas.imprimir`).
 * Exported so DB tests can exercise it inside a rolled-back transaction.
 */
export async function getFichaYPesadaDeTomaEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fichaId: string,
): Promise<{ ficha: FichaParaImprimir; pesada: Map<number, PesadaDeLineaImprimir> }> {
  const ficha = await getFichaParaImprimirEnTx(tx, tenantId, fichaId);
  const lineas = (await getLineasParaPreparacion(tx, tenantId, fichaId)).filter(esLineaPesable);
  const preparacion = await getPreparacionVivaDeFicha(tx, tenantId, fichaId);
  const pesada = new Map<number, PesadaDeLineaImprimir>();
  const poner = (linea: LineaParaPantalla, valor: PesadaDeLineaImprimir | null) => {
    if (valor) pesada.set(linea.orden, valor);
  };

  if (preparacion?.estado === "CONFIRMADA") {
    const porLinea = agrupar(await listEgresosDeLineasDePreparacion(tx, tenantId, preparacion.id), (e) => e.lineaPesajeId);
    for (const linea of lineas) {
      const egresos = porLinea.get(linea.id) ?? [];
      if (egresos.some((e) => e.equivalenciaManual)) {
        const total = egresos.reduce((suma, e) => suma.plus(e.cantidad), dec(0));
        poner(linea, { tipo: "MANUAL", cantidad: total.toString(), unidadSimbolo: linea.unidadStock.simbolo });
        continue;
      }
      poner(
        linea,
        pesadaPorLotes(
          egresos.map((e) => ({ lote: e.lote, cantidad: e.cantidad, unidadSimbolo: e.unidadSimbolo, factor: textoFactorLote(e.potenciaAplicada, e.actividadAplicada) })),
        ),
      );
    }
    return { ficha, pesada };
  }

  if (preparacion) {
    const reservas = await listReservasDePreparacion(tx, tenantId, preparacion.id);
    const partidas = new Map(
      (await getPartidasFrescas(tx, tenantId, [...new Set(reservas.map((r) => r.partidaId))], preparacion.id)).map((p) => [p.id, p]),
    );
    const porLinea = agrupar(reservas, (r) => r.lineaPesajeId);
    for (const linea of lineas) {
      const deLinea = porLinea.get(linea.id) ?? [];
      const manual = deLinea.find((r) => r.equivalenciaManual);
      if (manual) {
        poner(linea, { tipo: "MANUAL", cantidad: manual.cantidadManual, unidadSimbolo: linea.unidadStock.simbolo });
        continue;
      }
      const lotes: LotePesadaImprimir[] = [];
      for (const r of deLinea) {
        const p = partidas.get(r.partidaId);
        if (p) lotes.push({ lote: p.lote, cantidad: r.cantidad, unidadSimbolo: linea.unidadStock.simbolo, factor: textoFactorLote(p.potenciaDeclarada, p.actividadDeclarada) });
      }
      poner(linea, pesadaPorLotes(lotes));
    }
    return { ficha, pesada };
  }

  const borradores = await getBorradoresDeFicha(tx, tenantId, fichaId);
  const partidasPorDroga = await cargarPartidasPorDroga(tx, tenantId, lineas.map((l) => l.drogaId));
  for (const linea of lineas) {
    const tipoMagnitud = linea.unidad.tipoMagnitud;
    const esActividad = tipoMagnitud === "ACTIVIDAD";
    const compatibles = partidasCompatiblesConLinea(partidasPorDroga.porDroga.get(linea.drogaId)?.consumo ?? [], tipoMagnitud);
    const borrador = borradores.get(linea.id);
    if (linea.seDosificaEnUi && compatibles.length === 0) {
      poner(linea, { tipo: "MANUAL", cantidad: borrador?.cantidadManual ?? null, unidadSimbolo: linea.unidadStock.simbolo });
      continue;
    }
    if (!esActividad && !mismaMagnitud(linea.unidad, linea.unidadStock)) continue;
    const requerida = esActividad ? dec(linea.cantidadAPesar!) : convertirCantidad(dec(linea.cantidadAPesar!), linea.unidad, linea.unidadStock);
    // The lots chosen in the draft (still in consumption order) when they cover the línea, else the automatic split.
    const elegidas = compatibles.filter((p) => borrador?.partidaIds.includes(p.id));
    const porEleccion = elegidas.length > 0 ? repartirLinea(elegidas, requerida, partidasPorDroga.jornada, false, linea.unidadStock) : null;
    const reparto = porEleccion?.ok ? porEleccion : repartirLinea(compatibles, requerida, partidasPorDroga.jornada, false, linea.unidadStock);
    if (!reparto.ok) continue;
    const porId = new Map(compatibles.map((p) => [p.id, p]));
    poner(
      linea,
      pesadaPorLotes(
        reparto.partes.map((parte) => {
          const p = porId.get(parte.partidaId)!;
          return { lote: p.lote, cantidad: parte.cantidad.toString(), unidadSimbolo: linea.unidadStock.simbolo, factor: textoFactorLote(p.potenciaDeclarada, p.actividadDeclarada) };
        }),
      ),
    );
  }
  return { ficha, pesada };
}

/** The PDF the toma workspace's "Imprimir ficha técnica" opens (app/api/preparaciones/fichas/[id]/pdf/route.ts). */
export async function imprimirFichaDeTomaPdf(fichaId: string): Promise<FichaTecnicaPdfResult> {
  const { ficha, pesada } = await imprimirFichaDeTomaQuery.execute({ fichaId });
  return renderFichaTecnicaPdf(ficha, pesada);
}
