/**
 * Purity per partida (migration 0058) for the líneas de pesaje the toma
 * workspace shows: the partidas the confirmation would draw a línea from
 * (`listPartidasElegiblesDroga` + `ordenarParaConsumo`: same candidates,
 * same order, vencidas and empty ones left out; stock reserved by any
 * preparación INICIADA is not available, migration 0071) with the PHYSICAL weight
 * each one needs for the línea's `cantidadAPesar` (= active required):
 * `fisicoParaActivo`, domain/potencia.ts -- the same function the
 * confirmation uses.
 *
 * Expiry (openspec/specs/reanalisis-partida/spec.md): every date is the vencimiento
 * VIGENTE (the latest reanálisis, else the original one). A partida por
 * vencer carries a compact warning; a vencida one with saldo is listed AFTER
 * the usable ones, flagged `vencida`, so the workspace can say why it is not
 * available (blocked until the DT acts) -- it is never part of the
 * consumption order.
 *
 * Shared by `preparaciones.toma.ver` (the saved fichas) and
 * `preparaciones.toma.previsualizarFichas` (a draft's fichas, in memory),
 * so a preview lists exactly what the saved ficha will. Not a use case:
 * callers run it inside their own transaction. Plain reads only.
 *
 * The automatic assignment (openspec/specs/reserva-stock-preparacion/spec.md R21):
 * `asignacionDeLinea` marks, for a saved ficha's línea, the partidas the
 * reserva will take and how much of each -- the same `repartirLinea` over
 * the same candidates as the reserva (R1) -- or the línea's faltante.
 */
import type { Prisma } from "@/generated/prisma/client";
import { estaVencida, ordenarParaConsumo } from "@/modules/stock/domain/reparto";
import { MENSAJE_VENCIDA_REQUIERE_DT, estadoVencimientoPartida, textoPorVencer } from "@/modules/stock/domain/vencimiento-partida";
import { diasAlertaVencimientoEnTx } from "@/modules/stock/application/dias-alerta-vencimiento";
import { dec } from "@/shared/decimal";
import { convertirCantidad, mismaMagnitud, type UnidadDeConversion } from "@/shared/decimal/convertir-unidad";
import { fisicoParaActivo } from "../domain/potencia";
import { repartirLinea } from "../domain/reparto-linea";
import { jornadaActualTenant, listPartidasElegiblesDroga } from "../infrastructure/preparacion-repository";
import type { PartidaElegible } from "../infrastructure/preparacion-repository";

/** A partida the línea could be weighed from, with the physical weight it needs. Plain strings (decimal values). */
export interface PartidaParaPesar {
  id: string;
  lote: string;
  proveedorNombre: string;
  /** Percent; `null` = not declared (100%). */
  potenciaDeclarada: string | null;
  /** In the droga's unidad base (`unidadSimbolo`), NOT the línea's unit. */
  cantidadDisponible: string;
  /** Símbolo of the droga's unidad base. */
  unidadSimbolo: string;
  /** PHYSICAL weight of THIS partida for the whole línea, in the LÍNEA's unit: cantidadAPesar x 100 / potencia. */
  cantidadAPesar: string;
  /** Vencida (vencimiento vigente < jornada): NOT available until the DT acts; listed only to explain why. */
  vencida: boolean;
  /** Compact expiry warning ("Vence en 5 días", or the vencida message); `null` when nothing to warn. */
  avisoVencimiento: string | null;
  /** What the automatic reserva takes from this partida (physical, purity-corrected), in the LÍNEA's unit; `null` = not taken, or not computed (a draft). */
  asignada: string | null;
}

/** What of a línea decides its partidas. */
export interface LineaPesable {
  drogaId: string;
  cantidadAPesar: string | null;
  esEnraseManual: boolean;
}

/** Each droga's candidate partidas, in consumption order, plus its vencidas with saldo (blocked), and the expiry context. */
export interface PartidasPorDroga {
  jornada: string;
  diasAlerta: number;
  porDroga: ReadonlyMap<string, { consumo: readonly PartidaElegible[]; vencidas: readonly PartidaElegible[] }>;
}

/** Manual-enrase líneas and líneas without cantidadAPesar are not weighed from a partida here. */
export function esLineaPesable(linea: LineaPesable): boolean {
  return !linea.esEnraseManual && linea.cantidadAPesar !== null;
}

/** The candidate partidas of every droga in `drogaIds`, loaded once per droga (no query at all when there is none). */
export async function cargarPartidasPorDroga(tx: Prisma.TransactionClient, tenantId: string, drogaIds: Iterable<string>): Promise<PartidasPorDroga> {
  const pendientes = new Set(drogaIds);
  const porDroga = new Map<string, { consumo: PartidaElegible[]; vencidas: PartidaElegible[] }>();
  if (pendientes.size === 0) return { jornada: "", diasAlerta: 0, porDroga };
  const jornada = await jornadaActualTenant(tx, tenantId);
  const diasAlerta = await diasAlertaVencimientoEnTx(tx, tenantId);
  for (const drogaId of pendientes) {
    const partidas = await listPartidasElegiblesDroga(tx, tenantId, drogaId);
    porDroga.set(drogaId, {
      consumo: ordenarParaConsumo(partidas, jornada),
      vencidas: partidas.filter((p) => estaVencida(p.fechaVencimiento, jornada)),
    });
  }
  return { jornada, diasAlerta, porDroga };
}

function avisoVencimiento(partida: PartidaElegible, jornada: string, diasAlerta: number): string | null {
  const estado = estadoVencimientoPartida(partida.fechaVencimiento, jornada, diasAlerta);
  if (estado === "VENCIDA") return MENSAJE_VENCIDA_REQUIERE_DT;
  if (estado === "POR_VENCER" && partida.fechaVencimiento !== null) return textoPorVencer(partida.fechaVencimiento, jornada);
  return null;
}

/** The línea's partidas with what to weigh from each one (usable ones first, then the blocked vencidas); `null` for a línea that is not pesable. */
export function partidasDeLinea(partidasPorDroga: PartidasPorDroga, linea: LineaPesable): PartidaParaPesar[] | null {
  const activo = linea.cantidadAPesar;
  if (linea.esEnraseManual || activo === null) return null;
  const { jornada, diasAlerta } = partidasPorDroga;
  const deDroga = partidasPorDroga.porDroga.get(linea.drogaId);
  const aPesar = (p: PartidaElegible, vencida: boolean): PartidaParaPesar => ({
    id: p.id,
    lote: p.lote,
    proveedorNombre: p.proveedorNombre,
    potenciaDeclarada: p.potenciaDeclarada,
    cantidadDisponible: p.cantidadDisponible,
    unidadSimbolo: p.unidadSimbolo,
    cantidadAPesar: fisicoParaActivo(activo, p.potenciaDeclarada).toString(),
    vencida,
    avisoVencimiento: avisoVencimiento(p, jornada, diasAlerta),
    asignada: null,
  });
  return [...(deDroga?.consumo ?? []).map((p) => aPesar(p, false)), ...(deDroga?.vencidas ?? []).map((p) => aPesar(p, true))];
}

/** A saved ficha's línea, with the units the split needs (línea unit, droga's unidad base -- R12). */
export interface LineaConUnidades extends LineaPesable {
  unidad: UnidadDeConversion;
  unidadStock: UnidadDeConversion;
}

/** The automatic assignment of a línea (R21): its partidas with `asignada` set on the ones the reserva takes, in consumption order, or its faltante. */
export interface AsignacionDeLinea {
  partidas: PartidaParaPesar[];
  /** In the línea's unit (active terms); `null` when the droga has the stock. */
  faltante: string | null;
}

/**
 * The partidas of a pesable línea (`partidasDeLinea`) with the automatic plan over its candidates: `repartirLinea`,
 * the same split and order as the reserva. `null` for a línea that is not pesable or whose unit can not be converted
 * into the droga's unidad base (the reserva refuses it with its own message).
 */
export function asignacionDeLinea(partidasPorDroga: PartidasPorDroga, linea: LineaConUnidades): AsignacionDeLinea | null {
  const partidas = partidasDeLinea(partidasPorDroga, linea);
  if (partidas === null || linea.cantidadAPesar === null || !mismaMagnitud(linea.unidad, linea.unidadStock)) return null;
  const consumo = partidasPorDroga.porDroga.get(linea.drogaId)?.consumo ?? [];
  const requeridaStock = convertirCantidad(dec(linea.cantidadAPesar), linea.unidad, linea.unidadStock);
  const resultado = repartirLinea(consumo, requeridaStock, partidasPorDroga.jornada, false);
  if (!resultado.ok) {
    return { partidas, faltante: convertirCantidad(resultado.faltante, linea.unidadStock, linea.unidad).toFixed() };
  }
  const porPartida = new Map(resultado.partes.map((parte) => [parte.partidaId, convertirCantidad(parte.cantidad, linea.unidadStock, linea.unidad).toString()]));
  return { partidas: partidas.map((p) => ({ ...p, asignada: porPartida.get(p.id) ?? null })), faltante: null };
}
