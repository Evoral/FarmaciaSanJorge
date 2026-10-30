"use client";

/**
 * DT's "Actualizar plazos" button on `/archivo` (FASE 12 point 12.2). Shares `moverPlazoCumplidoTenant` with the daily job -- see `application/actualizar-plazos.ts`.
 * Dispatches transient confirmation via toast so it doesn't float awkward text under the header buttons.
 */
import { SimpleForm } from "@/shared/ui/simple-form";
import { toast } from "@/shared/ui/toast";
import { actualizarPlazosAction } from "./actions";

export function ActualizarPlazosButton() {
  return (
    <SimpleForm
      action={actualizarPlazosAction}
      submitLabel="Actualizar plazos"
      pendingLabel="Actualizando…"
      submitVariant="secondary"
      layout="inline"
      successMessage={() => undefined}
      onSuccess={(state) => {
        if (state.message) toast(state.message);
      }}
    />
  );
}
