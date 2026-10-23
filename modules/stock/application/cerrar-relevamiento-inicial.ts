/**
 * Relevamiento inicial (docs/specs/existencia-inicial.md R6-R8).
 *
 * - `getRelevamientoInicialQuery`: the window's state, what was loaded per
 *   droga and, with the contralor digital activo, the controlled drogas whose
 *   contralor saldo differs from their physical stock.
 * - `cerrarRelevamientoInicial`: the DT vigente, themselves, confirming with
 *   their OWN password (same two-step as the reanálisis: the password check
 *   commits its own audit even when the close is refused). Irreversible
 *   (INV-S26). Refused while any controlled droga differs (R8).
 */
import { z } from "zod";
import { defineCommand, defineQuery, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { formatCantidadExacta } from "@/shared/format/cantidad";
import { diferenciasControladas, type EstadoRelevamientoInicial, type SaldoControlada } from "../domain/existencia-inicial";
import {
  cerrarRelevamientoInicial as updateCerrarRelevamiento,
  contarExistenciaInicialPorDroga,
  getEstadoRelevamientoInicial,
  listSaldosControladas,
  lockTenantRelevamiento,
  type ExistenciaInicialPorDroga,
} from "../infrastructure/existencia-inicial-repository";
import { getFechaActivacionContralor } from "../infrastructure/partida-repository";
import { esDtVigenteHoy } from "../infrastructure/co-firma-repository";
import { verificarPasswordDtPartidaCommand } from "./verificar-password-dt-partida";

export interface RelevamientoInicialResult {
  estado: EstadoRelevamientoInicial;
  cargadoPorDroga: ExistenciaInicialPorDroga[];
  contralorActivo: boolean;
  /** Only with the contralor activo (R8); empty = the close is not blocked by it. */
  diferenciasControladas: SaldoControlada[];
  /** The session's usuario is the DT vigente today: the only one who sees the close action. */
  puedeCerrar: boolean;
}

async function diferenciasSiContralorActivo(tx: Parameters<typeof listSaldosControladas>[0], tenantId: string) {
  const contralorActivo = (await getFechaActivacionContralor(tx, tenantId)) !== null;
  return { contralorActivo, diferencias: contralorActivo ? diferenciasControladas(await listSaldosControladas(tx, tenantId)) : [] };
}

export const getRelevamientoInicialQuery = defineQuery({
  name: "stock.relevamiento_inicial.ver",
  permiso: "stock.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<RelevamientoInicialResult> => {
    const estado = await getEstadoRelevamientoInicial(tx, session.tenantId);
    const cargadoPorDroga = await contarExistenciaInicialPorDroga(tx, session.tenantId);
    const { contralorActivo, diferencias } = await diferenciasSiContralorActivo(tx, session.tenantId);
    const puedeCerrar = estado.abierto && (await esDtVigenteHoy(tx, session.tenantId, session.usuario.id));
    return { estado, cargadoPorDroga, contralorActivo, diferenciasControladas: diferencias, puedeCerrar };
  },
});

export async function getRelevamientoInicial(): Promise<RelevamientoInicialResult> {
  return getRelevamientoInicialQuery.execute({});
}

function describirDiferencia(d: SaldoControlada): string {
  const saldo = d.saldoContralor === null ? "sin apertura" : formatCantidadExacta(d.saldoContralor, d.unidadSimbolo);
  return `${d.drogaNombre}: contralor ${saldo}, stock ${formatCantidadExacta(d.stockFisico, d.unidadSimbolo)}`;
}

/** NOT exported -- reachable only through `cerrarRelevamientoInicial`, below. */
const cerrarRelevamientoInicialInternalCommand = defineCommand({
  name: "stock.relevamiento_inicial.cerrar",
  permiso: "stock.ajuste.autorizar",
  input: z.object({}),
  audit: { entidad: "tenant", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session }) => {
    await lockTenantRelevamiento(tx, session.tenantId);
    if (!(await esDtVigenteHoy(tx, session.tenantId, session.usuario.id))) {
      throw new DomainError("Solo el Director Técnico vigente (titular o suplente) puede cerrar el relevamiento inicial.");
    }

    const estado = await getEstadoRelevamientoInicial(tx, session.tenantId);
    if (!estado.abierto) throw new DomainError("El relevamiento inicial ya está cerrado.");

    const { diferencias } = await diferenciasSiContralorActivo(tx, session.tenantId);
    if (diferencias.length > 0) {
      throw new DomainError(
        `No se puede cerrar: el libro contralor no coincide con el stock de ${diferencias.map(describirDiferencia).join("; ")}.`,
      );
    }

    const cargado = await contarExistenciaInicialPorDroga(tx, session.tenantId);
    const cerradoEn = await updateCerrarRelevamiento(tx, session.tenantId, session.usuario.id);
    return {
      output: { cerradoEn },
      audit: {
        entidadId: session.tenantId,
        valorAnterior: { relevamientoInicialCerradoEn: null },
        valorNuevo: {
          relevamientoInicialCerradoEn: cerradoEn.toISOString(),
          drogas: cargado.length,
          partidas: cargado.reduce((total, d) => total + d.partidas, 0),
        },
      },
    };
  },
});

export async function cerrarRelevamientoInicial(input: { password: string }, options?: ExecuteOptions): Promise<{ cerradoEn: Date }> {
  const verificacion = await verificarPasswordDtPartidaCommand.execute({ password: input.password }, options);
  if (!verificacion.ok) throw new DomainError(verificacion.message, { fields: ["password"] });
  return cerrarRelevamientoInicialInternalCommand.execute({}, options);
}
