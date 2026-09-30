"use client";

/**
 * Droga search for a componente row (6.1: "the droga picker inside the item
 * form is a query declared under recetas.crear ... and must exclude drugs
 * given de baja" -- modules/recetas/application/list-drogas-para-receta.ts).
 * Same accessible search-into-`<select>` shape as paciente/medico pickers.
 */
import { useActionState, useId, useState } from "react";
import { buscarDrogasParaRecetaAction } from "./actions";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { DetachedForm } from "@/shared/ui/detached-form";

function BuscarButton({ pending, form }: { pending: boolean; form: string }) {
  return (
    <button type="submit" form={form} disabled={pending} className="btn btn-secondary btn-sm">
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
  const [state, formAction, isPending] = useActionState(buscarDrogasParaRecetaAction, { status: "idle" as const, items: [] });
  // Not reset on success: the search term stays next to its results.
  const { onSubmit } = useFormSubmit(formAction);
  const [elegido, setElegido] = useState("");
  const selectId = useId();
  const inputId = useId();
  // The receta form wraps this picker: its search is a DetachedForm (a <form> cannot contain another <form>).
  const formId = useId();

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
          <DetachedForm id={formId} action={formAction} onSubmit={onSubmit} aria-label={`Buscar droga: ${label}`} />
          <div className="mb-1 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={inputId} className="text-xs">
                Buscar droga
              </label>
              <input id={inputId} name="q" type="text" form={formId} disabled={disabled} className="input input-sm" />
            </div>
            <BuscarButton pending={isPending} form={formId} />
          </div>
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
                <select id={selectId} size={Math.min(6, state.items.length)} value={elegido} onChange={(e) => setElegido(e.target.value)} className="min-w-56 input input-sm">
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
                className="btn btn-secondary btn-sm"
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
