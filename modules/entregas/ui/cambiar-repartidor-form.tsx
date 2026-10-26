"use client";

/**
 * "Cambiar repartidor" / "Asignar repartidor" (openspec/specs/envios-repartidores/spec.md E5/E7): the repartidor autocomplete
 * over the ACTIVE repartidores plus its submit, for an envío waiting for its firma. Same `shared/ui/simple-form.tsx`
 * wrapping shape as `confirmar-firma-form.tsx`: an error keeps the picked repartidor (`useFormSubmit`) and marks the
 * field (the Combobox handles `FIELD_ERROR_EVENT`). Choosing the repartidor the envío already has is not submittable.
 */
import { useState } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { buscarRepartidoresParaCombobox } from "@/modules/repartidores/ui/repartidor-search";
import type { EntregaActionState } from "./action-state";

/** Active repartidores only: an inactive one is never offered for an assignment (E3). */
const buscarRepartidoresActivos = buscarRepartidoresParaCombobox(true);

export interface CambiarRepartidorFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  /** The repartidor the envío has now (null for an envío registered before migration 0093). */
  repartidorActualId: string | null;
  /** `true` when the envío has no repartidor yet: the wording is "Asignar" instead of "Cambiar". */
  asignacion: boolean;
  /** Runs after a successful change. */
  onSuccess?: () => void;
  /** Closes the form without saving. */
  onCancel: () => void;
}

export function CambiarRepartidorForm({ action, recetaId, repartidorActualId, asignacion, onSuccess, onCancel }: CambiarRepartidorFormProps) {
  const [repartidor, setRepartidor] = useState<ComboboxOption | null>(null);
  const sinCambio = repartidor !== null && repartidor.value === repartidorActualId;

  return (
    <SimpleForm
      action={action}
      submitLabel={asignacion ? "Asignar repartidor" : "Guardar repartidor"}
      pendingLabel="Guardando…"
      submitVariant="secondary"
      onSuccess={onSuccess}
      submitDisabled={repartidor === null || sinCambio}
      submitDisabledReason={sinCambio ? "El envío ya tiene asignado a ese repartidor." : "Elija el repartidor que lleva el envío."}
      extraActions={
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
      }
    >
      <input type="hidden" name="recetaId" value={recetaId} />
      <Combobox
        label="Repartidor"
        placeholder="Buscar repartidor por nombre o teléfono"
        name="repartidorId"
        search={buscarRepartidoresActivos}
        value={repartidor}
        onChange={setRepartidor}
      />
    </SimpleForm>
  );
}
