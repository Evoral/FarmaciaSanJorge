"use client";

/** DT's "Actualizar plazos" button on `/archivo` (FASE 12 point 12.2). Shares `moverPlazoCumplidoTenant` with the daily job -- see `application/actualizar-plazos.ts`. */
import { actualizarPlazosAction } from "./actions";
import { SimpleForm } from "./simple-form";

export function ActualizarPlazosButton() {
  return (
    <SimpleForm
      action={actualizarPlazosAction}
      submitLabel="Actualizar plazos"
      pendingLabel="Actualizando…"
      submitClassName="btn btn-secondary"
      className="inline"
    >
      {null}
    </SimpleForm>
  );
}
