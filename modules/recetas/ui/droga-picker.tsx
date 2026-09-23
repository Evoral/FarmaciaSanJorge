"use client";

/**
 * Droga search for a componente row (6.1: "the droga picker inside the item
 * form is a query declared under recetas.crear ... and must exclude drugs
 * given de baja" -- modules/recetas/application/list-drogas-para-receta.ts).
 * Same accessible search-into-`<select>` shape as paciente/medico pickers.
 */
import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { buscarDrogasParaRecetaAction } from "./actions";

function BuscarButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-zinc-700">
      {pending ? "Buscando…" : "Buscar"}
    </button>
  );
}

export interface DrogaPickerProps {
  label: string;
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, nombre: string, unidadBaseId: string, unidadBaseSimbolo: string) => void;
  disabled?: boolean;
}

export function DrogaPicker({ label, selectedId, selectedLabel, onSelect, disabled }: DrogaPickerProps) {
  const [state, formAction] = useActionState(buscarDrogasParaRecetaAction, { status: "idle" as const, items: [] });
  const [elegido, setElegido] = useState("");
  const selectId = useId();
  const inputId = useId();

  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      {selectedId ? (
        <p className="text-sm">
          <strong>{selectedLabel}</strong>{" "}
          <button type="button" onClick={() => onSelect("", "", "", "")} disabled={disabled} className="ml-2 underline">
            Cambiar
          </button>
        </p>
      ) : (
        <div>
          <form action={formAction} className="mb-1 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={inputId} className="text-xs">
                Buscar droga
              </label>
              <input id={inputId} name="q" type="text" disabled={disabled} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </div>
            <BuscarButton />
          </form>
          {state.status === "error" ? (
            <p role="alert" className="text-sm text-red-600">
              {state.message}
            </p>
          ) : null}
          {state.items.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={selectId} className="text-xs">
                  Resultados
                </label>
                <select id={selectId} size={Math.min(6, state.items.length)} value={elegido} onChange={(e) => setElegido(e.target.value)} className="min-w-56 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                  {state.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre} ({d.unidadBaseSimbolo})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={!elegido}
                onClick={() => {
                  const d = state.items.find((x) => x.id === elegido);
                  if (d) onSelect(d.id, d.nombre, d.unidadBaseId, d.unidadBaseSimbolo);
                }}
                className="rounded border border-zinc-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-zinc-700"
              >
                Elegir
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
