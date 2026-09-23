"use client";

/** "Descartar preparación" form (M11, FASE 8 point 8.1) -- motivo obligatorio, no toca stock. */
import { SimpleForm } from "./simple-form";
import { descartarPreparacionAction } from "./actions";

export interface DescartarPreparacionFormProps {
  preparacionId: string;
}

export function DescartarPreparacionForm({ preparacionId }: DescartarPreparacionFormProps) {
  return (
    <SimpleForm action={descartarPreparacionAction} submitLabel="Descartar preparación" pendingLabel="Descartando…" submitClassName="rounded bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">
      <input type="hidden" name="preparacionId" value={preparacionId} />
      <div className="flex flex-col gap-1">
        <label htmlFor="motivo" className="text-sm font-medium">
          Motivo del descarte
        </label>
        <textarea id="motivo" name="motivo" required rows={2} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <p className="text-xs text-zinc-500">Descartar una preparación INICIADA no afecta el stock: todavía no se descontó nada.</p>
      </div>
    </SimpleForm>
  );
}
