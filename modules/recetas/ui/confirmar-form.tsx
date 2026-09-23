"use client";

/** One-click confirm action (recepción física, 6.4) -- no motivo needed, unlike modules/recetas/ui/motivo-form.tsx (anulación). */
import { SimpleForm } from "./simple-form";
import type { RecetaActionState } from "./action-state";

export interface ConfirmarFormProps {
  action: (prevState: RecetaActionState, formData: FormData) => Promise<RecetaActionState>;
  id: string;
  label: string;
  pendingLabel: string;
  helpText?: string;
  submitClassName?: string;
}

export function ConfirmarForm({ action, id, label, pendingLabel, helpText, submitClassName }: ConfirmarFormProps) {
  return (
    <div>
      {helpText ? <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{helpText}</p> : null}
      <SimpleForm action={action} submitLabel={label} pendingLabel={pendingLabel} submitClassName={submitClassName}>
        <input type="hidden" name="id" value={id} />
      </SimpleForm>
    </div>
  );
}
