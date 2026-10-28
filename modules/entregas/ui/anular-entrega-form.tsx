"use client";

/**
 * "Anular entrega" on `/recetas/[id]` (openspec/specs/anular-entrega/spec.md): the mostrador picked the wrong receta when
 * registering a retiro or envío. Same `CollapsibleActionCard` + motivo shape as shared/ui/motivo-form.tsx, plus the
 * "Pagada" switch of the alta and the entrega (shown on, the user turns it off when the payment was a mistake too).
 * Deliberately NOT styled as a danger action: it only puts the receta back in /entregas and touches neither the
 * libro nor stock -- unlike anulling the receta or an asiento, which it must not be confused with.
 */
import { useState } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { CollapsibleActionCard, MotivoField } from "@/shared/ui/motivo-form";
import { PagoSwitch } from "@/modules/recetas/ui/pago-switch";
import { anularEntregaAction } from "./actions";

export interface AnularEntregaFormProps {
  recetaId: string;
  /** The receta is paid now: the switch starts on and can be turned off. */
  pagada: boolean;
}

export function AnularEntregaForm({ recetaId, pagada }: AnularEntregaFormProps) {
  const [siguePagada, setSiguePagada] = useState(pagada);

  return (
    <CollapsibleActionCard
      label="Anular entrega"
      helpText="Si se marcó como entregada por error, la receta vuelve a la lista de Entregas. No cambia nada en el libro recetario ni en el stock."
    >
      {({ close, cancelButton }) => (
        <SimpleForm
          action={anularEntregaAction}
          submitLabel="Anular entrega"
          pendingLabel="Anulando…"
          onSuccess={close}
          extraActions={cancelButton}
        >
          <input type="hidden" name="recetaId" value={recetaId} />
          <input type="hidden" name="marcarImpaga" value={pagada && !siguePagada ? "on" : ""} />
          <MotivoField />
          {pagada ? <PagoSwitch pago={{ pagada: siguePagada, onChange: setSiguePagada, disabled: false }} className="" /> : null}
        </SimpleForm>
      )}
    </CollapsibleActionCard>
  );
}
