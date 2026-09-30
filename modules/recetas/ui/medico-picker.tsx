"use client";

/** Médico search-or-quick-create for the receta form -- same shape as paciente-picker.tsx (own copy: matrícula instead of DNI, no DP-24 restriction for médicos). */
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { errorFieldsOf } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { DetachedForm } from "@/shared/ui/detached-form";
import { buscarMedicosParaRecetaAction, crearMedicoRapidoAction } from "./actions";
import { JURISDICCIONES_MATRICULA, JURISDICCION_MATRICULA_LABELS } from "@/modules/medicos/domain/medico";
import { IDLE_BUSCAR_PERSONA_STATE, IDLE_CREAR_PERSONA_STATE } from "./action-state";

function BuscarButton({ label, pending, form }: { label: string; pending: boolean; form: string }) {
  return (
    <button type="submit" form={form} disabled={pending} className="btn btn-secondary">
      {pending ? "Buscando…" : label}
    </button>
  );
}

function CrearButton({ label, pending, form }: { label: string; pending: boolean; form: string }) {
  return (
    <button type="submit" form={form} disabled={pending} className="btn btn-primary">
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
  const [buscarState, buscarAction, buscarPending] = useActionState(buscarMedicosParaRecetaAction, IDLE_BUSCAR_PERSONA_STATE);
  const [crearState, crearAction, crearPending] = useActionState(crearMedicoRapidoAction, IDLE_CREAR_PERSONA_STATE);
  // Neither form is reset on success: the search keeps its term next to its results, and a successful quick
  // create selects the new médico (this picker then swaps the form out for the selection).
  const { onSubmit: onBuscarSubmit } = useFormSubmit(buscarAction);
  const { onSubmit: onCrearSubmit } = useFormSubmit(crearAction);
  const crearFormRef = useRef<HTMLFormElement>(null);
  useFieldErrors(crearFormRef, errorFieldsOf(crearState));
  const [modo, setModo] = useState<"buscar" | "crear">("buscar");
  const [elegido, setElegido] = useState("");
  const selectId = useId();
  // The receta form wraps this picker: its sub-forms are DetachedForms (a <form> cannot contain another <form>).
  const buscarFormId = useId();
  const crearFormId = useId();

  useEffect(() => {
    if (crearState.status === "success" && crearState.persona.id !== selectedId) {
      onSelect(crearState.persona.id, `${crearState.persona.apellido}, ${crearState.persona.nombre}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crearState]);

  return (
    <fieldset className="card p-4" disabled={disabled}>
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
              <DetachedForm id={buscarFormId} action={buscarAction} onSubmit={onBuscarSubmit} aria-label="Buscar médico" />
              <div className="mb-2 flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="medico-q" className="text-sm">
                    Apellido o matrícula
                  </label>
                  <input id="medico-q" name="q" type="text" form={buscarFormId} className="input input-sm" />
                </div>
                <BuscarButton label="Buscar" pending={buscarPending} form={buscarFormId} />
              </div>
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
                    className="btn btn-primary"
                  >
                    Seleccionar
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <DetachedForm id={crearFormId} ref={crearFormRef} action={crearAction} onSubmit={onCrearSubmit} aria-label="Crear médico" />
              <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="medico-nombre" className="text-sm">
                  Nombre
                </label>
                <input id="medico-nombre" name="nombre" required form={crearFormId} className="input input-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="medico-apellido" className="text-sm">
                  Apellido
                </label>
                <input id="medico-apellido" name="apellido" required form={crearFormId} className="input input-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="medico-matricula" className="text-sm">
                  Matrícula
                </label>
                <input id="medico-matricula" name="matricula" required form={crearFormId} className="input input-sm" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="medico-matricula-jurisdiccion" className="text-sm">
                  Jurisdicción
                </label>
                <select id="medico-matricula-jurisdiccion" name="matriculaJurisdiccion" defaultValue="PROVINCIAL" required form={crearFormId} className="input input-sm">
                  {JURISDICCIONES_MATRICULA.map((j) => (
                    <option key={j} value={j}>
                      {JURISDICCION_MATRICULA_LABELS[j]}
                    </option>
                  ))}
                </select>
              </div>
              <CrearButton label="Crear médico" pending={crearPending} form={crearFormId} />
              {crearState.status === "error" ? (
                <p role="alert" className="w-full text-sm text-red-600">
                  {crearState.message}
                </p>
              ) : null}
              </div>
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
