"use client";

/** Médico search-or-quick-create for the receta form -- same shape as paciente-picker.tsx (own copy: matrícula instead of DNI, no DP-24 restriction for médicos). */
import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { buscarMedicosParaRecetaAction, crearMedicoRapidoAction } from "./actions";
import { IDLE_BUSCAR_PERSONA_STATE, IDLE_CREAR_PERSONA_STATE } from "./action-state";

function BuscarButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">
      {pending ? "Buscando…" : label}
    </button>
  );
}

function CrearButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
      {pending ? "Creando…" : label}
    </button>
  );
}

export interface MedicoPickerProps {
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
}

export function MedicoPicker({ selectedId, selectedLabel, onSelect, disabled }: MedicoPickerProps) {
  const [buscarState, buscarAction] = useActionState(buscarMedicosParaRecetaAction, IDLE_BUSCAR_PERSONA_STATE);
  const [crearState, crearAction] = useActionState(crearMedicoRapidoAction, IDLE_CREAR_PERSONA_STATE);
  const [modo, setModo] = useState<"buscar" | "crear">("buscar");
  const [elegido, setElegido] = useState("");
  const selectId = useId();

  useEffect(() => {
    if (crearState.status === "success" && crearState.persona.id !== selectedId) {
      onSelect(crearState.persona.id, `${crearState.persona.apellido}, ${crearState.persona.nombre}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crearState]);

  return (
    <fieldset className="rounded border border-zinc-300 p-3 dark:border-zinc-700" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">Médico</legend>

      {selectedId ? (
        <p className="mb-2 text-sm">
          Seleccionado: <strong>{selectedLabel}</strong>{" "}
          <button type="button" onClick={() => onSelect("", "")} className="ml-2 text-sm underline">
            Cambiar
          </button>
        </p>
      ) : (
        <>
          <div role="tablist" aria-label="Buscar o crear médico" className="mb-2 flex gap-2">
            <button type="button" role="tab" aria-selected={modo === "buscar"} onClick={() => setModo("buscar")} className={modo === "buscar" ? "text-sm font-medium underline" : "text-sm text-zinc-600"}>
              Buscar existente
            </button>
            <button type="button" role="tab" aria-selected={modo === "crear"} onClick={() => setModo("crear")} className={modo === "crear" ? "text-sm font-medium underline" : "text-sm text-zinc-600"}>
              Crear nuevo
            </button>
          </div>

          {modo === "buscar" ? (
            <div>
              <form action={buscarAction} className="mb-2 flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="medico-q" className="text-sm">
                    Apellido o matrícula
                  </label>
                  <input id="medico-q" name="q" type="text" className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                </div>
                <BuscarButton label="Buscar" />
              </form>
              {buscarState.status === "error" ? (
                <p role="alert" className="mb-2 text-sm text-red-600">
                  {buscarState.message}
                </p>
              ) : null}
              {buscarState.items.length > 0 ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={selectId} className="text-sm">
                      Resultados
                    </label>
                    <select id={selectId} size={Math.min(6, buscarState.items.length)} value={elegido} onChange={(e) => setElegido(e.target.value)} className="min-w-64 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                      {buscarState.items.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.apellido}, {m.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={!elegido}
                    onClick={() => {
                      const m = buscarState.items.find((x) => x.id === elegido);
                      if (m) onSelect(m.id, `${m.apellido}, ${m.nombre}`);
                    }}
                    className="rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Seleccionar
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <form action={crearAction} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="medico-nombre" className="text-sm">
                  Nombre
                </label>
                <input id="medico-nombre" name="nombre" required className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="medico-apellido" className="text-sm">
                  Apellido
                </label>
                <input id="medico-apellido" name="apellido" required className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="medico-matricula" className="text-sm">
                  Matrícula
                </label>
                <input id="medico-matricula" name="matricula" required className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              </div>
              <CrearButton label="Crear médico" />
              {crearState.status === "error" ? (
                <p role="alert" className="w-full text-sm text-red-600">
                  {crearState.message}
                </p>
              ) : null}
            </form>
          )}
        </>
      )}
    </fieldset>
  );
}
