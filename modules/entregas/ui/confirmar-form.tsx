"use client";

/** One-click confirm action (marcar lista para retirar / confirmar firma recibida) -- same `shared/ui/simple-form.tsx`-wrapping shape as shared/ui/motivo-form.tsx. */
import { SimpleForm } from "@/shared/ui/simple-form";
import type { EntregaActionState } from "./action-state";

export interface ConfirmarFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  label: string;
  pendingLabel: string;
  helpText?: string;
}

export function ConfirmarForm({ action, recetaId, label, pendingLabel, helpText }: ConfirmarFormProps) {
  return (
    <div className="flex flex-col gap-3">
      {helpText ? <p className="text-[0.8125rem] leading-relaxed text-zinc-600">{helpText}</p> : null}
      <SimpleForm action={action} submitLabel={label} pendingLabel={pendingLabel}>
        <input type="hidden" name="recetaId" value={recetaId} />
      </SimpleForm>
    </div>
  );
}
