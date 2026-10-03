"use client";

/**
 * Médico search-or-quick-create for the receta form -- same shape as
 * paciente-picker.tsx (matrícula instead of DNI, no DP-24 restriction for
 * médicos). Autocomplete over `buscarMedicosParaRecetaAction`; quick create
 * through `crearMedicoRapidoAction`, which auto-selects the result.
 */
import { useActionState, useCallback, useEffect, useId, useRef } from "react";
import { errorFieldsOf } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { DetachedForm } from "@/shared/ui/detached-form";
import { buscarMedicosParaRecetaAction, crearMedicoRapidoAction } from "./actions";
import { JURISDICCIONES_MATRICULA, JURISDICCION_MATRICULA_LABELS } from "@/modules/medicos/domain/medico";
import { IDLE_BUSCAR_PERSONA_STATE, IDLE_CREAR_PERSONA_STATE } from "./action-state";
import { PersonaPicker, separarPrefill } from "./persona-picker";

export interface MedicoPickerProps {
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
}

export function MedicoPicker({ selectedId, selectedLabel, onSelect, disabled }: MedicoPickerProps) {
  const search = useCallback(async (q: string) => {
    const formData = new FormData();
    formData.set("q", q);
    const result = await buscarMedicosParaRecetaAction(IDLE_BUSCAR_PERSONA_STATE, formData);
    if (result.status === "error") throw new Error(result.message);
    return result.items.map((m) => ({ value: m.id, label: `${m.apellido}, ${m.nombre}` }));
  }, []);

  return (
    <PersonaPicker
      id="medico-q"
      label="Médico"
      entidad="médico"
      placeholder="Apellido o matrícula"
      search={search}
      selectedId={selectedId}
      selectedLabel={selectedLabel}
      onSelect={onSelect}
      disabled={disabled}
      renderCrear={({ prefill, cerrar }) => (
        <CrearMedico
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

function CrearMedico({ prefill, onCreado, onCancel }: { prefill: string; onCreado: (id: string, label: string) => void; onCancel: () => void }) {
  const [crearState, crearAction, crearPending] = useActionState(crearMedicoRapidoAction, IDLE_CREAR_PERSONA_STATE);
  // Not reset on success: a successful quick create selects the new médico and this form closes.
  const { onSubmit } = useFormSubmit(crearAction);
  const crearFormRef = useRef<HTMLFormElement>(null);
  useFieldErrors(crearFormRef, errorFieldsOf(crearState));
  // The receta form wraps this picker: the sub-form is a DetachedForm (a <form> cannot contain another <form>).
  const formId = useId();
  const { apellido, numero } = separarPrefill(prefill);

  useEffect(() => {
    if (crearState.status === "success") onCreado(crearState.persona.id, `${crearState.persona.apellido}, ${crearState.persona.nombre}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crearState]);

  return (
    <>
      <DetachedForm id={formId} ref={crearFormRef} action={crearAction} onSubmit={onSubmit} aria-label="Crear médico" />
      <p className="mb-3 text-sm font-medium text-zinc-900">Nuevo médico</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="medico-nombre" className="field-label">
            Nombre
          </label>
          <input id="medico-nombre" name="nombre" required form={formId} autoFocus={apellido !== ""} className="input" />
        </div>
        <div className="field">
          <label htmlFor="medico-apellido" className="field-label">
            Apellido
          </label>
          <input id="medico-apellido" name="apellido" required form={formId} defaultValue={apellido} className="input" />
        </div>
        <div className="field">
          <label htmlFor="medico-matricula" className="field-label">
            Matrícula
          </label>
          <input id="medico-matricula" name="matricula" required form={formId} defaultValue={numero} className="input" />
        </div>
        <div className="field">
          <label htmlFor="medico-matricula-jurisdiccion" className="field-label">
            Jurisdicción
          </label>
          <select id="medico-matricula-jurisdiccion" name="matriculaJurisdiccion" defaultValue="PROVINCIAL" required form={formId} className="input">
            {JURISDICCIONES_MATRICULA.map((j) => (
              <option key={j} value={j}>
                {JURISDICCION_MATRICULA_LABELS[j]}
              </option>
            ))}
          </select>
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
