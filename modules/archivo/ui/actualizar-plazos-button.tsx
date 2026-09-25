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
      submitClassName="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
      className="inline"
    >
      {null}
    </SimpleForm>
  );
}
