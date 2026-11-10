"use client";

/**
 * Relevamiento inicial on /partidas/existencia-inicial (openspec/specs/existencia-inicial/spec.md
 * R5-R8, openspec/changes/planilla-existencia-inicial): whether existencia inicial can still be loaded
 * and until when, what was loaded per droga, the controlled drogas whose libro contralor does not
 * match their stock, and -- for the DT vigente only -- "Cerrar relevamiento" with their own password.
 * When closed, shows what was loaded read-only (who closed it and when, or when the plazo ended)
 * with no close control.
 */
import { SimpleForm } from "@/shared/ui/simple-form";
import { formatFecha, formatFechaIso } from "@/shared/format/fecha";
import { formatCantidadExacta } from "@/shared/format/cantidad";
import { cerrarRelevamientoInicialAction } from "./actions";
import { PasswordInput } from "@/shared/ui/password-input";
import type { DrogaFaltanCargarRaw } from "../application/get-planilla-relevamiento";
import type { CorreccionesRelevamientoResult } from "../application/get-correcciones-relevamiento";

export interface RelevamientoInicialPanelProps {
  abierto: boolean;
  cerradoEn: Date | null;
  cerradoPor: string | null;
  /** `YYYY-MM-DD`, `null` while no cierre diario is signed. */
  fechaLimite: string | null;
  cargadoPorDroga: readonly { drogaId: string; drogaNombre: string; partidas: number }[];
  contralorActivo: boolean;
  diferencias: readonly { drogaId: string; drogaNombre: string; unidadSimbolo: string; saldoContralor: string | null; stockFisico: string }[];
  puedeCerrar: boolean;
  zonaHoraria: string;
  totalFilasPlanilla: number;
  faltanCargar: readonly DrogaFaltanCargarRaw[];
  correcciones?: CorreccionesRelevamientoResult;
}

export function RelevamientoInicialPanel({
  abierto,
  cerradoEn,
  cerradoPor,
  fechaLimite,
  cargadoPorDroga,
  contralorActivo,
  diferencias,
  puedeCerrar,
  zonaHoraria,
  totalFilasPlanilla,
  faltanCargar,
  correcciones,
}: RelevamientoInicialPanelProps) {
  const partidas = cargadoPorDroga.reduce((total, d) => total + d.partidas, 0);

  return (
    <section className="panel">
      <div className="panel-body flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Existencia inicial</h2>
          {abierto ? (
            <>
              <p className="text-sm text-zinc-500">
                Cargá en la planilla cada envase que ya estaba en la farmacia al empezar a usar el sistema, con lote, vencimiento y cantidad como figuran en el envase. Los envases del mismo lote se suman en una sola partida al pasar a stock.
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Se puede cargar hasta que el Director Técnico cierre el relevamiento
                {fechaLimite ? `, como máximo hasta el ${formatFechaIso(fechaLimite)}` : " (el plazo empieza a correr con el primer cierre diario firmado)"}.
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {partidas === 0
                  ? "Todavía no se cargó ninguna partida."
                  : `Cargadas: ${partidas === 1 ? "1 partida" : `${partidas} partidas`} de ${cargadoPorDroga.length === 1 ? "1 droga" : `${cargadoPorDroga.length} drogas`}.`}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-500">
                {cerradoPor && cerradoEn
                  ? `Relevamiento cerrado por ${cerradoPor} el ${formatFecha(cerradoEn, zonaHoraria)}.`
                  : fechaLimite
                    ? `El plazo de relevamiento inicial finalizó el ${formatFechaIso(fechaLimite)}.`
                    : "El relevamiento inicial se encuentra cerrado."}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {partidas === 0
                  ? "No se cargaron partidas durante el relevamiento."
                  : `Total cargado: ${partidas === 1 ? "1 partida" : `${partidas} partidas`} de ${cargadoPorDroga.length === 1 ? "1 droga" : `${cargadoPorDroga.length} drogas`}.`}
              </p>
            </>
          )}
        </div>

        {!abierto && cargadoPorDroga.length > 0 ? (
          <div className="mt-2">
            <h3 className="text-sm font-semibold">Cargado por droga</h3>
            <div className="mt-2 divide-y divide-zinc-200 border-y border-zinc-200 text-sm">
              {cargadoPorDroga.map((d) => (
                <div key={d.drogaId} className="flex items-center justify-between py-2">
                  <span className="font-medium text-zinc-900">{d.drogaNombre}</span>
                  <span className="text-zinc-600">{d.partidas === 1 ? "1 partida" : `${d.partidas} partidas`}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {abierto && contralorActivo && diferencias.length > 0 ? (
          <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">El libro contralor no coincide con el stock de estas drogas controladas:</p>
            <ul className="mt-1 list-disc pl-5">
              {diferencias.map((d) => (
                <li key={d.drogaId}>
                  {d.drogaNombre}: contralor {d.saldoContralor === null ? "sin apertura" : formatCantidadExacta(d.saldoContralor, d.unidadSimbolo)}, stock{" "}
                  {formatCantidadExacta(d.stockFisico, d.unidadSimbolo)}
                </li>
              ))}
            </ul>
            <p className="mt-1">Hasta que coincidan no se puede cerrar el relevamiento.</p>
          </div>
        ) : null}

        {abierto && puedeCerrar ? (
          <div className="border-t border-zinc-200 pt-4">
            <h3 className="text-sm font-semibold">Cerrar relevamiento</h3>
            <p className="mb-3 text-sm text-zinc-500">
              Al cerrarlo ya no se puede cargar existencia inicial, y no se vuelve a abrir. Desde entonces el stock entra solo por compras.
            </p>

            <SimpleForm
              action={cerrarRelevamientoInicialAction}
              submitLabel="Cerrar relevamiento"
              submitVariant="secondary"
              className="flex flex-col gap-4 max-w-md"
            >
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-800/50 flex flex-col gap-2">
                <p className="text-xs text-zinc-700 dark:text-zinc-300">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">Cargado:</span>{" "}
                  {partidas} partida{partidas === 1 ? "" : "s"} de {cargadoPorDroga.length} droga{cargadoPorDroga.length === 1 ? "" : "s"}.
                </p>
                {faltanCargar.length > 0 ? (
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      Faltan cargar ({faltanCargar.length}):
                    </span>{" "}
                    {faltanCargar.map((d) => d.nombre).join(", ")}
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                    No hay drogas pendientes en Faltan cargar.
                  </p>
                )}
              </div>

              {totalFilasPlanilla > 0 ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="font-medium">
                    La planilla todavía tiene <span className="tabular-nums font-bold">{totalFilasPlanilla}</span> fila{totalFilasPlanilla === 1 ? "" : "s"} sin pasar a stock.
                  </p>
                  <label className="mt-2 flex items-center gap-2 cursor-pointer font-medium text-xs sm:text-sm">
                    <input type="checkbox" name="descartarFilas" value="true" className="checkbox size-4" />
                    Descartar las {totalFilasPlanilla} fila{totalFilasPlanilla === 1 ? "" : "s"} de la planilla
                  </label>
                </div>
              ) : null}

              {/* Correcciones del relevamiento (R7) */}
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50 flex flex-col gap-2.5">
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Correcciones realizadas
                </p>
                {(!correcciones || (correcciones.movimientos.length === 0 && correcciones.datos.length === 0)) ? (
                  <p className="text-zinc-500">No se realizaron correcciones durante el relevamiento.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {correcciones.movimientos.length > 0 ? (
                      <div>
                        <p className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Correcciones de cantidad ({correcciones.movimientos.length}):
                        </p>
                        <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                          {correcciones.movimientos.map((m) => (
                            <li key={m.id} className="py-1 flex flex-col gap-0.5">
                              <div className="flex items-center justify-between font-mono">
                                <span className="font-sans font-medium text-zinc-800 dark:text-zinc-200">
                                  {m.drogaNombre} <span className="text-zinc-500 font-mono">(lote {m.lote})</span>
                                </span>
                                <span className={m.tipo === "CORRECCION_INICIAL_SUMA" ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                                  {m.tipo === "CORRECCION_INICIAL_SUMA" ? "+ " : "- "}
                                  {m.cantidad} {m.unidadSimbolo}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                <span>Por {m.registradoPor}{m.observacion ? ` · "${m.observacion}"` : ""}</span>
                                <span>{formatFecha(m.registradoEn, zonaHoraria)}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {correcciones.datos.length > 0 ? (
                      <div className="mt-1">
                        <p className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                          Correcciones de datos ({correcciones.datos.length}):
                        </p>
                        <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                          {correcciones.datos.map((d) => (
                            <li key={d.id} className="py-1 flex flex-col gap-0.5">
                              <span className="font-sans font-medium text-zinc-800 dark:text-zinc-200">
                                {d.drogaNombre} <span className="text-zinc-500 font-mono">(lote actual {d.loteActual})</span>
                              </span>
                              <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                                {d.loteAnterior !== d.loteNuevo && d.loteNuevo ? (
                                  <span>Lote: &quot;{d.loteAnterior}&quot; &rarr; &quot;{d.loteNuevo}&quot; </span>
                                ) : null}
                                {d.fechaVencimientoAnterior !== d.fechaVencimientoNuevo ? (
                                  <span>Vencimiento: {d.fechaVencimientoAnterior ?? "no vence"} &rarr; {d.fechaVencimientoNuevo ?? "no vence"} </span>
                                ) : null}
                                {d.proveedorAnterior !== d.proveedorNuevo ? (
                                  <span>Proveedor: {d.proveedorAnterior ?? "sin proveedor"} &rarr; {d.proveedorNuevo ?? "sin proveedor"}</span>
                                ) : null}
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                                <span>Por {d.realizadoPor}</span>
                                <span>{formatFecha(d.ocurridoEn, zonaHoraria)}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="relevamiento-password" className="field-label">
                  Tu contraseña (Director Técnico)
                </label>
                <PasswordInput id="relevamiento-password" name="password" autoComplete="current-password" required className="input" />
              </div>
            </SimpleForm>
          </div>
        ) : null}
      </div>
    </section>
  );
}
