/**
 * The excipiente of a preparación (migration 0092, openspec/specs/excipiente-preparacion/spec.md): a droga of clase
 * EXCIPIENTE chosen in the toma workspace's ficha with its quantity (the droga's unidad base). It is not a línea de
 * pesaje -- fichas are immutable and the receta is not altered -- so it has its own steps, run inside the callers'
 * transactions:
 *   - `reservarExcipienteEnTx` ("Marcar como preparada"): the oldest lots first, automatic (abiertas, then FEFO,
 *     `repartirLinea` as an enrase: physical, no purity correction), one `reserva_stock` row per partida without
 *     línea; the preparación keeps the droga, the quantity and the fórmula's text ("Ludipress 12,5 g").
 *   - `replanificarExcipienteEnTx` + `guardarReservaExcipienteEnTx` ("Recalcular reserva", "Registrar pérdida"):
 *     the same plan again, computed before the caller deletes the reservas and written after.
 *   - `consumirExcipienteEnTx` ("Imprimir etiquetas"): EGRESO_PREPARACION without línea over the reserved partidas,
 *     re-split against fresh balances. Never contralor (an EXCIPIENTE can not be controlled, 0063) and never a
 *     detalle line of the libro (insumos are left out of it): it is in the asiento's fórmula.
 * The DB refuses a línea-less reserva/egreso that is not the preparación's excipiente (0092's triggers).
 *
 * Lock order: the callers lock the excipiente's candidate partidas (`partidasCandidatasExcipienteEnTx`) in the SAME
 * id-ordered statement as the líneas' (security audit P3-02: two statements could deadlock against
 * `confirmarReservasReceta`'s single one). `planificar`'s own lock then only re-locks rows this transaction holds.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { Decimal, dec } from "@/shared/decimal";
import { DomainError } from "@/shared/errors";
import { formatNumero } from "@/shared/format/cantidad";
import { estaVencida } from "@/modules/stock/domain/reparto";
import { repartirLinea } from "../domain/reparto-linea";
import {
  deleteReservasExcipiente,
  getDrogaExcipiente,
  getExcipienteDePreparacion,
  getPartidasFrescas,
  insertEgresoPreparacion,
  insertReservasExcipiente,
  listPartidasElegiblesDroga,
  listReservasExcipiente,
  lockPartidasParaConfirmacion,
  setExcipienteEstructurado,
} from "../infrastructure/preparacion-repository";

/** The excipiente to reserve: a droga of clase EXCIPIENTE and its quantity in the droga's unidad base. */
export interface ExcipienteAReservar {
  drogaId: string;
  cantidad: Decimal;
}

/** What the audit records of the excipiente's reserva (a type alias: it goes into the audit's JSON as is). */
export type ResumenExcipiente = {
  droga: string;
  cantidad: string;
  partidas: { partidaId: string; cantidad: string }[];
};

/** The droga, refused unless it is a vigente EXCIPIENTE of this tenant. */
async function drogaExcipienteValida(tx: Prisma.TransactionClient, tenantId: string, drogaId: string) {
  const droga = await getDrogaExcipiente(tx, tenantId, drogaId);
  if (!droga || !droga.esExcipiente) throw new DomainError("El excipiente elegido no es un excipiente del catálogo: recargá la página.", { fields: ["excipienteDrogaId"] });
  if (!droga.vigente) throw new DomainError(`El excipiente ${droga.nombre} está dado de baja: elegí otro.`, { fields: ["excipienteDrogaId"] });
  return droga;
}

/**
 * The split of `cantidad` over `partidaIds` (locked here, re-read fresh; `preparacionId`'s own reservas available),
 * abiertas first then FEFO, expired ones left out. Refused with the shortfall when they do not cover it.
 */
async function planificar(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { preparacionId: string; droga: { nombre: string; unidadSimbolo: string }; cantidad: Decimal; partidaIds: readonly string[]; jornada: string; mensajeFaltante: string },
): Promise<{ partidaId: string; cantidad: Decimal }[]> {
  await lockPartidasParaConfirmacion(tx, tenantId, input.partidaIds);
  const frescas = await getPartidasFrescas(tx, tenantId, input.partidaIds, input.preparacionId);
  const usables = frescas.filter((p) => !estaVencida(p.fechaVencimiento, input.jornada));
  const resultado = repartirLinea(usables, input.cantidad, input.jornada, true);
  if (!resultado.ok) {
    throw new DomainError(
      `Stock insuficiente del excipiente ${input.droga.nombre}: faltan ${formatNumero(resultado.faltante.toString())} ${input.droga.unidadSimbolo}. ${input.mensajeFaltante}`,
      { fields: ["excipienteCantidad"] },
    );
  }
  return resultado.partes.map((p) => ({ partidaId: p.partidaId, cantidad: p.cantidad }));
}

/** Reserves the excipiente of a just-created preparación (INICIADA) and records it on the preparación. `null` = none chosen. */
export async function reservarExcipienteEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { preparacionId: string; excipiente: ExcipienteAReservar | null; jornada: string },
): Promise<ResumenExcipiente | null> {
  if (!input.excipiente) return null;
  const { tenantId } = session;
  const droga = await drogaExcipienteValida(tx, tenantId, input.excipiente.drogaId);
  if (!input.excipiente.cantidad.greaterThan(0)) throw new DomainError("La cantidad del excipiente debe ser mayor que 0.", { fields: ["excipienteCantidad"] });

  // The fórmula's text is set first: the reserva rows' trigger checks the preparación's excipiente droga.
  await setExcipienteEstructurado(tx, tenantId, input.preparacionId, {
    drogaId: droga.id,
    cantidad: input.excipiente.cantidad.toString(),
    texto: `${droga.nombre} ${formatNumero(input.excipiente.cantidad.toString())} ${droga.unidadSimbolo}`,
  });
  const candidatas = await listPartidasElegiblesDroga(tx, tenantId, droga.id, input.preparacionId);
  const partes = await planificar(tx, tenantId, {
    preparacionId: input.preparacionId,
    droga,
    cantidad: input.excipiente.cantidad,
    partidaIds: candidatas.map((p) => p.id),
    jornada: input.jornada,
    mensajeFaltante: "Ingresá stock del excipiente o elegí otro.",
  });
  const filas = partes.map((p) => ({ partidaId: p.partidaId, cantidad: p.cantidad.toString() }));
  await insertReservasExcipiente(tx, { tenantId, preparacionId: input.preparacionId, reservadaPorId: session.usuario.id, partes: filas });
  return { droga: droga.nombre, cantidad: `${input.excipiente.cantidad.toString()} ${droga.unidadSimbolo}`, partidas: filas };
}

/**
 * Re-plans the excipiente's reserva over every eligible partida (its own reserva available) WITHOUT writing: the
 * caller deletes the preparación's reservas and then writes the result (`guardarReservaExcipienteEnTx`), so a failed
 * re-plan leaves the reserva as it was. `null` = the preparación has no excipiente.
 */
export async function replanificarExcipienteEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { preparacionId: string; jornada: string },
): Promise<ResumenExcipiente | null> {
  const { tenantId } = session;
  const excipiente = await getExcipienteDePreparacion(tx, tenantId, input.preparacionId);
  if (!excipiente) return null;
  const candidatas = await listPartidasElegiblesDroga(tx, tenantId, excipiente.drogaId, input.preparacionId);
  const partes = await planificar(tx, tenantId, {
    preparacionId: input.preparacionId,
    droga: { nombre: excipiente.drogaNombre, unidadSimbolo: excipiente.unidadSimbolo },
    cantidad: dec(excipiente.cantidad),
    partidaIds: candidatas.map((p) => p.id),
    jornada: input.jornada,
    mensajeFaltante: "Liberá la reserva y elegí otro excipiente, o ingresá stock.",
  });
  return { droga: excipiente.drogaNombre, cantidad: `${excipiente.cantidad} ${excipiente.unidadSimbolo}`, partidas: partes.map((p) => ({ partidaId: p.partidaId, cantidad: p.cantidad.toString() })) };
}

/** Writes a re-planned excipiente reserva (`replanificarExcipienteEnTx`), replacing the previous one. */
export async function guardarReservaExcipienteEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  preparacionId: string,
  resumen: ResumenExcipiente | null,
): Promise<void> {
  if (!resumen) return;
  await deleteReservasExcipiente(tx, session.tenantId, preparacionId);
  await insertReservasExcipiente(tx, { tenantId: session.tenantId, preparacionId, reservadaPorId: session.usuario.id, partes: resumen.partidas });
}

/** The partidas the excipiente's reserva holds (a pérdida may be registered on them). */
/** Every partida the excipiente's plan may lock: of `drogaId`, or of the preparación's stored excipiente; `[]` without one. */
export async function partidasCandidatasExcipienteEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { preparacionId: string; drogaId?: string },
): Promise<string[]> {
  const drogaId = input.drogaId ?? (await getExcipienteDePreparacion(tx, tenantId, input.preparacionId))?.drogaId;
  if (!drogaId) return [];
  return (await listPartidasElegiblesDroga(tx, tenantId, drogaId, input.preparacionId)).map((p) => p.id);
}

export async function partidasReservadasExcipienteEnTx(tx: Prisma.TransactionClient, tenantId: string, preparacionId: string): Promise<string[]> {
  return (await listReservasExcipiente(tx, tenantId, preparacionId)).map((r) => r.partidaId);
}

/** Descuenta the excipiente at the confirmation: EGRESO_PREPARACION without línea over its reserved partidas. No-op without excipiente. */
export async function consumirExcipienteEnTx(
  tx: Prisma.TransactionClient,
  session: AuthenticatedSession,
  input: { preparacionId: string; jornada: string },
): Promise<void> {
  const { tenantId } = session;
  const excipiente = await getExcipienteDePreparacion(tx, tenantId, input.preparacionId);
  if (!excipiente) return;
  const reservadas = await listReservasExcipiente(tx, tenantId, input.preparacionId);
  if (reservadas.length === 0) {
    throw new DomainError(`No hay stock reservado del excipiente ${excipiente.drogaNombre}: recalculá la reserva.`);
  }
  const partes = await planificar(tx, tenantId, {
    preparacionId: input.preparacionId,
    droga: { nombre: excipiente.drogaNombre, unidadSimbolo: excipiente.unidadSimbolo },
    cantidad: dec(excipiente.cantidad),
    partidaIds: reservadas.map((r) => r.partidaId),
    jornada: input.jornada,
    mensajeFaltante: "Recalculá la reserva.",
  });
  for (const parte of partes) {
    await insertEgresoPreparacion(tx, {
      tenantId,
      partidaId: parte.partidaId,
      cantidad: parte.cantidad.toString(),
      preparacionId: input.preparacionId,
      lineaPesajeId: null,
      registradoPorId: session.usuario.id,
      desvioPropuesta: false,
      potenciaAplicada: null,
    });
  }
}
