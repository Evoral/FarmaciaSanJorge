"use client";

/** One-click confirm action (marcar lista para retirar / confirmar firma recibida) -- own copy per module, see modules/recetas/ui/confirmar-form.tsx. */
import { SimpleForm } from "./simple-form";
import type { EntregaActionState } from "./action-state";

export interface ConfirmarFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  label: string;
  pendingLabel: string;
  helpText?: string;
  submitClassName?: string;
}

export function ConfirmarForm({ action, recetaId, label, pendingLabel, helpText, submitClassName }: ConfirmarFormProps) {
  return (
    <div>
      {helpText ? <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{helpText}</p> : null}
      <SimpleForm action={action} submitLabel={label} pendingLabel={pendingLabel} submitClassName={submitClassName}>
        <input type="hidden" name="recetaId" value={recetaId} />
      </SimpleForm>
    </div>
  );
}
