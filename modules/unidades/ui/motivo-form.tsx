"use client";

/** Baja/reactivar with motivo, collapsed behind a confirm button -- mirrors modules/usuarios/ui/estado-acciones.tsx's `MotivoForm`, without the re-auth branch (see ./simple-form.tsx). */
import { useId, useState } from "react";
import { SimpleForm } from "./simple-form";
import type { UnidadActionState } from "./action-state";

export interface MotivoFormProps {
  action: (prevState: UnidadActionState, formData: FormData) => Promise<UnidadActionState>;
  id: string;
  label: string;
  pendingLabel: string;
  helpText?: string;
  submitClassName?: string;
}

export function MotivoForm({ action, id, label, pendingLabel, helpText, submitClassName }: MotivoFormProps) {
  const [open, setOpen] = useState(false);
  const motivoId = useId();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={submitClassName ?? "btn btn-secondary"}>
        {label}
      </button>
    );
  }

  return (
    <div className="card p-4">
      {helpText ? <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{helpText}</p> : null}
      <SimpleForm action={action} submitLabel={label} pendingLabel={pendingLabel} submitClassName={submitClassName} onSuccess={() => setOpen(false)}>
        <input type="hidden" name="id" value={id} />
        <label htmlFor={motivoId} className="text-sm font-medium">
          Motivo
        </label>
        <textarea id={motivoId} name="motivo" required rows={2} className="mt-1 w-full input" />
      </SimpleForm>
      <button type="button" onClick={() => setOpen(false)} className="mt-2 text-sm underline">
        Cancelar
      </button>
    </div>
  );
}
