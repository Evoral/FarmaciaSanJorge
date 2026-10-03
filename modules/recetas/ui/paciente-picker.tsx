"use client";

/**
 * Paciente search-or-quick-create for the receta form (6.1: "paciente
 * (search or quick-create reusing modules/pacientes)"). The search is an
 * autocomplete over `buscarPacientesParaRecetaAction` (POST: the term never
 * reaches a URL, DP-24). Quick create is a minimal inline form
 * (nombre/apellido/DNI) that calls modules/pacientes' own `crearPaciente`
 * use case (via `crearPacienteRapidoAction`) and auto-selects the result.
 */
import { useActionState, useCallback, useEffect, useId, useRef } from "react";
import { errorFieldsOf } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { DetachedForm } from "@/shared/ui/detached-form";
import { buscarPacientesParaRecetaAction, crearPacienteRapidoAction } from "./actions";
import { IDLE_BUSCAR_PERSONA_STATE, IDLE_CREAR_PERSONA_STATE } from "./action-state";
import { PersonaPicker, separarPrefill } from "./persona-picker";

export interface PacientePickerProps {
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
}

export function PacientePicker({ selectedId, selectedLabel, onSelect, disabled }: PacientePickerProps) {
  const search = useCallback(async (q: string) => {
    const formData = new FormData();
    formData.set("q", q);
    const result = await buscarPacientesParaRecetaAction(IDLE_BUSCAR_PERSONA_STATE, formData);
    if (result.status === "error") throw new Error(result.message);
    return result.items.map((p) => ({ value: p.id, label: `${p.nombre} ${p.apellido}` }));
  }, []);

  return (
    <PersonaPicker
      id="paciente-q"
      label="Paciente"
      entidad="paciente"
      placeholder="Apellido o DNI"
      search={search}
      selectedId={selectedId}
      selectedLabel={selectedLabel}
      onSelect={onSelect}
      disabled={disabled}
      renderCrear={({ prefill, cerrar }) => (
        <CrearPaciente
          prefill={prefill}
          onCancel={cerrar}
          onCreado={(id, label) => {
            if (id !== selectedId) onSelect(id, label);
            cerrar();
          }}
        />
      )}
    />
  );
}

function CrearPaciente({ prefill, onCreado, onCancel }: { prefill: string; onCreado: (id: string, label: string) => void; onCancel: () => void }) {
  const [crearState, crearAction, crearPending] = useActionState(crearPacienteRapidoAction, IDLE_CREAR_PERSONA_STATE);
  // Not reset on success: a successful quick create selects the new paciente and this form closes.
  const { onSubmit } = useFormSubmit(crearAction);
  const crearFormRef = useRef<HTMLFormElement>(null);
  useFieldErrors(crearFormRef, errorFieldsOf(crearState));
  // The receta form wraps this picker: the sub-form is a DetachedForm (a <form> cannot contain another <form>).
  const formId = useId();
  const { apellido, numero } = separarPrefill(prefill);

  useEffect(() => {
    if (crearState.status === "success") onCreado(crearState.persona.id, `${crearState.persona.nombre} ${crearState.persona.apellido}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crearState]);

  return (
    <>
      <DetachedForm id={formId} ref={crearFormRef} action={crearAction} onSubmit={onSubmit} aria-label="Crear paciente" />
      <p className="mb-3 text-sm font-medium text-zinc-900">Nuevo paciente</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="field">
          <label htmlFor="paciente-nombre" className="field-label">
            Nombre
          </label>
          <input id="paciente-nombre" name="nombre" required form={formId} autoFocus={apellido !== ""} className="input" />
        </div>
        <div className="field">
          <label htmlFor="paciente-apellido" className="field-label">
            Apellido
          </label>
          <input id="paciente-apellido" name="apellido" required form={formId} defaultValue={apellido} className="input" />
        </div>
        <div className="field">
          <label htmlFor="paciente-dni" className="field-label">
            DNI (opcional)
          </label>
          <input id="paciente-dni" name="dni" inputMode="numeric" form={formId} defaultValue={numero} className="input" />
        </div>
      </div>
      {crearState.status === "error" ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {crearState.message}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">
          Cancelar
        </button>
        <button type="submit" form={formId} disabled={crearPending} className="btn btn-primary btn-sm">
          {crearPending ? "Creando…" : "Crear y seleccionar"}
        </button>
      </div>
    </>
  );
}
