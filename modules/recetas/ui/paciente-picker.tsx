"use client";

/**
 * Paciente search-or-quick-create for the receta form (6.1: "paciente
 * (search or quick-create reusing modules/pacientes)"). Search results
 * populate an accessible, keyboard-operable `<select>` (native, not a
 * custom listbox) -- "Seleccionar" confirms the highlighted option. Quick
 * create is a minimal inline form (nombre/apellido/DNI) that calls
 * modules/pacientes' own `crearPaciente` use case (via
 * modules/recetas/ui/actions.ts's `crearPacienteRapidoAction`) and
 * auto-selects the result.
 */
import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { buscarPacientesParaRecetaAction, crearPacienteRapidoAction } from "./actions";
import { IDLE_BUSCAR_PERSONA_STATE, IDLE_CREAR_PERSONA_STATE } from "./action-state";

function BuscarButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-secondary">
      {pending ? "Buscando…" : label}
    </button>
  );
}

function CrearButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? "Creando…" : label}
    </button>
  );
}

export interface PacientePickerProps {
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
}

export function PacientePicker({ selectedId, selectedLabel, onSelect, disabled }: PacientePickerProps) {
  const [buscarState, buscarAction] = useActionState(buscarPacientesParaRecetaAction, IDLE_BUSCAR_PERSONA_STATE);
  const [crearState, crearAction] = useActionState(crearPacienteRapidoAction, IDLE_CREAR_PERSONA_STATE);
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
    <fieldset className="card p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">Paciente</legend>

      {selectedId ? (
        <p className="mb-2 text-sm">
          Seleccionado: <strong>{selectedLabel}</strong>{" "}
          <button type="button" onClick={() => onSelect("", "")} className="ml-2 text-sm underline">
            Cambiar
          </button>
        </p>
      ) : (
        <>
          <div role="tablist" aria-label="Buscar o crear paciente" className="mb-2 flex gap-2">
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
                  <label htmlFor="paciente-q" className="text-sm">
                    Apellido o DNI
                  </label>
                  <input id="paciente-q" name="q" type="text" className="input input-sm" />
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
                    <select id={selectId} size={Math.min(6, buscarState.items.length)} value={elegido} onChange={(e) => setElegido(e.target.value)} className="min-w-64 input input-sm">
                      {buscarState.items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.apellido}, {p.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={!elegido}
                    onClick={() => {
                      const p = buscarState.items.find((x) => x.id === elegido);
                      if (p) onSelect(p.id, `${p.apellido}, ${p.nombre}`);
                    }}
                    className="btn btn-primary"
                  >
                    Seleccionar
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <form action={crearAction} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="paciente-nombre" className="text-sm">
                  Nombre
                </label>
                <input id="paciente-nombre" name="nombre" required className="input input-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="paciente-apellido" className="text-sm">
                  Apellido
                </label>
                <input id="paciente-apellido" name="apellido" required className="input input-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="paciente-dni" className="text-sm">
                  DNI (opcional)
                </label>
                <input id="paciente-dni" name="dni" className="input input-sm" />
              </div>
              <CrearButton label="Crear paciente" />
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
