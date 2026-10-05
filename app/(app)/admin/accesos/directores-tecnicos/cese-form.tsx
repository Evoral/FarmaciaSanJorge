"use client";

/**
 * Inline "reveal on click" cese form for a row on `/admin/accesos/directores-tecnicos`
 * (M04, FASE 3 point 3.9) -- same `CollapsibleActionCard` as the motivo
 * forms (shared/ui/motivo-form.tsx), but with the two fields a cese needs
 * (`vigenteHasta` + `motivoCese`) instead of just a motivo. Cese is
 * DEFINITIVE (INV-DT-003): once submitted there is no undo, which the
 * confirm-shaped copy below says explicitly.
 */
import { useId } from "react";
import { cesarDesignacionAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { DateInput } from "@/shared/ui/date-input";
import { CollapsibleActionCard, MotivoField } from "@/shared/ui/motivo-form";

export interface CeseFormProps {
  designacionId: string;
}

export function CeseForm({ designacionId }: CeseFormProps) {
  const vigenteHastaId = useId();

  return (
    <CollapsibleActionCard
      label="Registrar cese"
      helpText="Definitivo: una vez registrado, el cese no se puede modificar ni deshacer."
      variant="danger"
      className="w-64 text-left"
    >
      {({ close, cancelButton }) => (
        <ReauthAwareForm
          action={cesarDesignacionAction}
          submitLabel="Registrar cese"
          pendingLabel="Registrando…"
          submitVariant="danger"
          onSuccess={close}
          extraActions={cancelButton}
        >
          <input type="hidden" name="designacionId" value={designacionId} />
          <div className="flex flex-col gap-1">
            <label htmlFor={vigenteHastaId} className="text-sm font-medium">
              Vigente hasta
            </label>
            <DateInput id={vigenteHastaId} name="vigenteHasta" required />
          </div>
          <MotivoField name="motivoCese" label="Motivo del cese" />
        </ReauthAwareForm>
      )}
    </CollapsibleActionCard>
  );
}
