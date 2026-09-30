"use client";

/**
 * Motivo-gated actions (baja, reactivar, anulación): a trigger button that
 * expands into a card with a required "Motivo" textarea, the submit button
 * and "Cancelar" in one actions row.
 *
 * `CollapsibleActionCard` and `MotivoField` are the visual pieces (also used
 * by forms with more fields, e.g. the DT cese form); the form
 * component is up to the caller. `MotivoForm` wires them to `SimpleForm`;
 * actions that need recent re-auth compose the same pieces with
 * `modules/auth/ui/reauth-aware-form.tsx` instead (see
 * `modules/usuarios/ui/estado-acciones.tsx`,
 * `app/(app)/admin/accesos/directores-tecnicos/cese-form.tsx`).
 */
import { useId, useState, type ReactNode } from "react";
import { SimpleForm } from "./simple-form";
import { buttonClassName, type ButtonVariant, type FormActionState } from "./form-parts";

export function MotivoField({ name = "motivo", label = "Motivo" }: { name?: string; label?: string }) {
  const motivoId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={motivoId} className="text-sm font-medium">
        {label}
      </label>
      <textarea id={motivoId} name={name} required rows={2} className="input" />
    </div>
  );
}

export interface CollapsibleActionCardProps {
  label: string;
  helpText?: string;
  /** Trigger button variant. Defaults to `"secondary"`. */
  variant?: ButtonVariant;
  /** Width constraints for the expanded card only (e.g. `w-64`). */
  className?: string;
  /** Renders the form. `close` collapses the card; `cancelButton` goes in the form's `extraActions`. */
  children: (controls: { close: () => void; cancelButton: ReactNode }) => ReactNode;
}

export function CollapsibleActionCard({ label, helpText, variant, className, children }: CollapsibleActionCardProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClassName(variant ?? "secondary")}>
        {label}
      </button>
    );
  }

  const cancelButton = (
    <button type="button" onClick={close} className={buttonClassName("secondary")}>
      Cancelar
    </button>
  );

  return (
    <div className={className ? `card p-4 ${className}` : "card p-4"}>
      {helpText ? <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{helpText}</p> : null}
      {children({ close, cancelButton })}
    </div>
  );
}

export interface MotivoFormProps<S extends FormActionState> {
  action: (prevState: S, formData: FormData) => Promise<S>;
  /** Sent as the hidden `id` field. */
  id: string;
  label: string;
  pendingLabel: string;
  helpText?: string;
  variant?: ButtonVariant;
}

export function MotivoForm<S extends FormActionState>({ action, id, label, pendingLabel, helpText, variant }: MotivoFormProps<S>) {
  return (
    <CollapsibleActionCard label={label} helpText={helpText} variant={variant}>
      {({ close, cancelButton }) => (
        <SimpleForm action={action} submitLabel={label} pendingLabel={pendingLabel} submitVariant={variant} onSuccess={close} extraActions={cancelButton}>
          <input type="hidden" name="id" value={id} />
          <MotivoField />
        </SimpleForm>
      )}
    </CollapsibleActionCard>
  );
}
