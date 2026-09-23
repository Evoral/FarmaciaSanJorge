"use client";

/**
 * The confirmación screen (M11, FASE 8 points 8.2/8.3). For every non-manual
 * línea, shows the system's OWN proposed split (read-only amounts, INV-S13/
 * S20) with a checkbox per eligible partida so the farmacéutico may choose
 * DIFFERENT partidas (INV-S15) -- the amounts are always recomputed by the
 * SERVER for whatever selection is submitted, never sent from here. For
 * manual-enrase lines, a required quantity input (the ONLY quantity this
 * form ever lets the user type). `motivoApertura_<lineaId>` is always
 * rendered (optional) -- `confirmarPreparacion` rejects the submission with
 * a clear message if INV-S18 requires it and it was left empty, which is
 * simpler and more honest than guessing client-side whether it will be
 * required.
 */
import { useState } from "react";
import { ReauthAwareForm } from "./reauth-aware-form";
import { confirmarPreparacionAction } from "./actions";
import type { PreparacionParaPantalla } from "@/modules/preparaciones/application/get-preparacion-para-pantalla";

export interface ConfirmarPreparacionFormProps {
  pantalla: PreparacionParaPantalla;
}

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short" }).format(new Date(`${iso}T00:00:00`));
}

export function ConfirmarPreparacionForm({ pantalla }: ConfirmarPreparacionFormProps) {
  // Which partidas start CHECKED per línea: the system's own proposal for
  // non-manual lines, EVERY eligible partida for manual lines (the pharmacist
  // narrows it down if needed -- there is no proposal to default to since the
  // quantity isn't known yet).
  const [checked, setChecked] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    for (const linea of pantalla.lineas) {
      if (linea.propuesta) {
        initial[linea.id] = new Set(linea.propuesta.map((p) => p.partidaId));
      } else {
        initial[linea.id] = new Set(linea.partidasElegibles.map((p) => p.id));
      }
    }
    return initial;
  });

  function toggle(lineaId: string, partidaId: string) {
    setChecked((prev) => {
      const next = new Set(prev[lineaId]);
      if (next.has(partidaId)) next.delete(partidaId);
      else next.add(partidaId);
      return { ...prev, [lineaId]: next };
    });
  }

  const hayStockInsuficiente = pantalla.lineas.some((l) => l.stockInsuficiente);

  return (
    <div>
      <div className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        <p className="font-semibold">Esta acción es irreversible.</p>
        <p>Al confirmar se descuenta stock de las partidas elegidas y se escribe un asiento en el libro recetario, que no se puede editar ni deshacer.</p>
      </div>

      <ReauthAwareForm action={confirmarPreparacionAction} submitLabel="Confirmar preparación" pendingLabel="Confirmando…" submitDisabled={hayStockInsuficiente}>
        <input type="hidden" name="preparacionId" value={pantalla.id} />

        <div className="flex flex-col gap-4">
          {pantalla.lineas.map((linea) => (
            <fieldset key={linea.id} className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
              <input type="hidden" name="lineaIds" value={linea.id} />
              <legend className="px-1 text-sm font-medium">
                {linea.orden + 1}. {linea.drogaNombre}
                {linea.esEnraseManual ? " (enrase manual)" : ` — ${linea.cantidadAPesar} ${linea.unidadSimbolo}`}
              </legend>

              {linea.esEnraseManual ? (
                <div className="mb-2 flex flex-col gap-1">
                  <label htmlFor={`cantidadManual_${linea.id}`} className="text-sm font-medium">
                    Cantidad real registrada ({linea.unidadSimbolo})
                  </label>
                  <input
                    id={`cantidadManual_${linea.id}`}
                    name={`cantidadManual_${linea.id}`}
                    type="text"
                    inputMode="decimal"
                    required
                    className="w-40 rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              ) : linea.stockInsuficiente ? (
                <p className="mb-2 text-sm text-red-600">Stock insuficiente: faltan {linea.faltante} {linea.unidadSimbolo}.</p>
              ) : null}

              <p className="mb-1 text-xs text-zinc-500">Partidas (elegí de cuáles descontar -- los montos los calcula el sistema):</p>
              <div className="flex flex-col gap-1">
                {linea.partidasElegibles.map((partida) => {
                  const propuesta = linea.propuesta?.find((p) => p.partidaId === partida.id);
                  return (
                    <label key={partida.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={`partida_${linea.id}`}
                        value={partida.id}
                        checked={checked[linea.id]?.has(partida.id) ?? false}
                        onChange={() => toggle(linea.id, partida.id)}
                      />
                      <span>
                        Lote {partida.lote} — disponible {partida.cantidadDisponible} — vence {fechaCorta(partida.fechaVencimiento)}
                        {partida.fechaApertura ? " — abierta" : ""}
                        {propuesta ? ` — propuesto: ${propuesta.cantidad.toString()}` : ""}
                      </span>
                    </label>
                  );
                })}
                {linea.partidasElegibles.length === 0 ? <p className="text-sm text-red-600">No hay partidas con saldo para esta droga.</p> : null}
              </div>

              <div className="mt-2 flex flex-col gap-1">
                <label htmlFor={`motivoApertura_${linea.id}`} className="text-xs text-zinc-500">
                  Motivo de apertura adicional (solo si abrís una partida nueva teniendo otra abierta con saldo)
                </label>
                <input
                  id={`motivoApertura_${linea.id}`}
                  name={`motivoApertura_${linea.id}`}
                  type="text"
                  className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            </fieldset>
          ))}
        </div>
      </ReauthAwareForm>
    </div>
  );
}
