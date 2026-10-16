"use client";

/**
 * "Confirmar firma recibida" (11.2): the envío becomes ENTREGADA, so the receta must end up paid (docs/specs/pago-receta.md
 * P4) -- an unpaid one shows the same "Pagada" switch as the alta and the submit waits for it. Same
 * `shared/ui/simple-form.tsx`-wrapping shape as shared/ui/motivo-form.tsx.
 */
import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { PagoSwitch } from "@/modules/recetas/ui/pago-switch";
import type { EntregaActionState } from "./action-state";

export interface ConfirmarFirmaFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  /** The receta is already paid: the switch shows on and locked. */
  pagada: boolean;
  /** Runs after a successful confirmation (the pop-up closes itself). */
  onSuccess?: () => void;
}

export function ConfirmarFirmaForm({ action, recetaId, pagada, onSuccess }: ConfirmarFirmaFormProps) {
  const [pagarAhora, setPagarAhora] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] leading-relaxed text-zinc-600">Al confirmar el retorno del envío, la receta pasa a Entregada.</p>
      <SimpleForm
        action={action}
        submitLabel="Confirmar retorno"
        pendingLabel="Confirmando…"
        onSuccess={onSuccess}
        submitDisabled={!pagada && !pagarAhora}
        submitDisabledReason="Para entregarla, marcá la receta como pagada."
      >
        <input type="hidden" name="recetaId" value={recetaId} />
        {pagada ? (
          <PagoSwitch pago={{ pagada: true, onChange: () => {}, disabled: true }} className="" />
        ) : (
          <div className="flex flex-col gap-2">
            <div role="note" className="alert alert-warn">
              <TriangleAlert aria-hidden />
              <p>
                <strong className="font-semibold">Receta impaga.</strong> Para entregarla tiene que quedar pagada.
              </p>
            </div>
            <PagoSwitch pago={{ pagada: pagarAhora, onChange: setPagarAhora, disabled: false, name: "pagada" }} className="" />
          </div>
        )}
      </SimpleForm>
    </div>
  );
}
