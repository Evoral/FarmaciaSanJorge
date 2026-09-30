"use client";

/**
 * "Presupuesto" of the receta being loaded (docs/specs/presupuesto-receta.md):
 * the price the client sees at the counter before anything is saved.
 * Recalculates by itself ~600 ms after the items stop changing -- but only
 * once they are complete enough to price (domain/presupuesto.ts's
 * `itemsListosParaPresupuesto`) -- and on demand ("Recalcular"). A response
 * that arrives after a newer request was sent is ignored. Never blocks the
 * submit: it is information, not a gate.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { presupuestarRecetaAction } from "./actions";
import type { PresupuestoState } from "./action-state";
import { itemsListosParaPresupuesto } from "../domain/presupuesto";
import type { ItemPresupuestable } from "../domain/presupuesto";
import { formatNumero } from "@/shared/format/cantidad";

const DEBOUNCE_MS = 600;

function precio(valor: string): string {
  return `$${formatNumero(valor, 2)}`;
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {children}
    </span>
  );
}

export function PresupuestoPanel({ items }: { items: ItemPresupuestable[] }) {
  const itemsJson = JSON.stringify(items);
  const listos = itemsListosParaPresupuesto(items);
  // The last answer, with the draft it was computed for: shown (marked as updating) until the next one arrives.
  const [ultimo, setUltimo] = useState<{ json: string; respuesta: PresupuestoState } | null>(null);
  const [calculando, setCalculando] = useState(false);
  const ultimaSolicitud = useRef(0);
  const resultado = ultimo?.respuesta ?? null;

  const calcular = useCallback(async (json: string) => {
    const solicitud = ++ultimaSolicitud.current;
    setCalculando(true);
    let respuesta: PresupuestoState;
    try {
      respuesta = await presupuestarRecetaAction(json);
    } catch {
      respuesta = { status: "error", message: "No se pudo calcular el presupuesto." };
    }
    // A newer request was sent meanwhile: this answer is stale.
    if (solicitud !== ultimaSolicitud.current) return;
    setUltimo({ json, respuesta });
    setCalculando(false);
  }, []);

  useEffect(() => {
    if (!listos) {
      // Invalidate any request still in flight: its items are no longer the form's.
      ultimaSolicitud.current++;
      return;
    }
    const timer = setTimeout(() => void calcular(itemsJson), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [itemsJson, listos, calcular]);

  return (
    <section aria-labelledby="presupuesto-heading" aria-live="polite" className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="presupuesto-heading" className="text-lg font-medium">
          Presupuesto
        </h2>
        <button type="button" onClick={() => void calcular(itemsJson)} disabled={!listos || (calculando && ultimo?.json === itemsJson)} className="btn btn-secondary btn-sm">
          {listos && calculando ? "Calculando…" : "Recalcular"}
        </button>
      </div>
      {listos && ultimo !== null && ultimo.json !== itemsJson ? <p className="mb-1 text-xs text-zinc-500">Actualizando con los últimos cambios…</p> : null}

      {!listos ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Completá la droga, la unidad y la cantidad de cada componente para ver el precio.</p>
      ) : resultado === null ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Calculando el precio…</p>
      ) : resultado.status === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {resultado.message}
        </p>
      ) : !resultado.presupuesto.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {resultado.presupuesto.mensaje}
        </p>
      ) : (
        <>
          {resultado.presupuesto.faltantesReceta.length > 0 ? (
            // Stock shared by the receta's items: the most important warning here, never a block.
            <div role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              <ul className="list-disc pl-5">
                {resultado.presupuesto.faltantesReceta.map((f) => (
                  <li key={f.drogaNombre} className="font-medium">
                    {f.mensaje}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mb-2 text-2xl font-semibold">
            {precio(resultado.presupuesto.total)}
            {!resultado.presupuesto.totalCompleto ? <span className="ml-2 text-sm font-normal text-zinc-600 dark:text-zinc-400">(sin los ítems que no se pudieron calcular)</span> : null}
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {resultado.presupuesto.items.map((item) => (
              <li key={item.indice} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Ítem {item.indice}:</span>
                {item.ok ? (
                  <>
                    <span>{precio(item.precioFinal)}</span>
                    {item.esParcial ? <Badge>Parcial: {item.enraseManual.join(", ")} se completa al preparar</Badge> : null}
                    {item.faltantes.map((f) => (
                      <Badge key={f.drogaNombre}>
                        Falta stock: {f.drogaNombre} (faltan {formatNumero(f.cantidad, 3)} {f.unidadSimbolo})
                      </Badge>
                    ))}
                  </>
                ) : (
                  <span className="text-red-600">{item.mensaje}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">Precio orientativo con el stock y la regla de precios de hoy; los ítems se cubren en orden con el mismo stock. No reserva stock ni guarda nada (otras recetas pendientes no se descuentan).</p>
        </>
      )}
    </section>
  );
}
