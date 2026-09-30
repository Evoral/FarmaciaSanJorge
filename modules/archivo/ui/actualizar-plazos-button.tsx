"use client";

/**
 * DT's "Actualizar plazos" button on `/archivo` (FASE 12 point 12.2). Shares `moverPlazoCumplidoTenant` with the daily job -- see `application/actualizar-plazos.ts`.
 * `inline` layout: it sits in the page header next to "Conformar lote", so the result message floats below the button instead of shifting the header.
 */
import { SimpleForm } from "@/shared/ui/simple-form";
import { actualizarPlazosAction } from "./actions";

export function ActualizarPlazosButton() {
  return <SimpleForm action={actualizarPlazosAction} submitLabel="Actualizar plazos" pendingLabel="Actualizando…" submitVariant="secondary" layout="inline" />;
}
