"use client";

/** "Descartar preparación" form (M11, FASE 8 point 8.1) -- motivo obligatorio, no toca stock. */
import { SimpleForm } from "@/shared/ui/simple-form";
import { descartarPreparacionAction } from "./actions";

export interface DescartarPreparacionFormProps {
  preparacionId: string;
}

export function DescartarPreparacionForm({ preparacionId }: DescartarPreparacionFormProps) {
  return (
    <SimpleForm action={descartarPreparacionAction} submitLabel="Descartar preparación" pendingLabel="Descartando…" submitVariant="danger-solid">
      <input type="hidden" name="preparacionId" value={preparacionId} />
      <div className="flex flex-col gap-1">
        <label htmlFor="motivo" className="text-sm font-medium">
          Motivo del descarte
        </label>
        <textarea id="motivo" name="motivo" required rows={2} className="input" />
        <p className="text-xs text-zinc-500">Descartar una preparación INICIADA no afecta el stock: todavía no se descontó nada.</p>
      </div>
    </SimpleForm>
  );
}
