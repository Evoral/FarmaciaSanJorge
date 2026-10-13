"use client";

/**
 * Mark / unmark a receta as paid from its detail (migration 0071, docs/specs/pago-receta.md). The same "Pagada" switch
 * as the alta (./pago-switch.tsx), saved as soon as it is toggled: it flips optimistically and falls
 * back to the server's value if the action fails. `pagadaEn` / `pagadaPorId` are set by the server, the switch only
 * says which state it asks for.
 */
import { useOptimistic, useState, useTransition } from "react";
import { FormMessage } from "@/shared/ui/form-parts";
import { marcarPagoRecetaAction } from "./actions";
import { IDLE_STATE } from "./action-state";
import { PagoSwitch } from "./pago-switch";

export interface PagoRecetaFormProps {
  recetaId: string;
  /** The receta's current payment. */
  pagada: boolean;
  /** `false` for an ENTREGADA receta (domain/pago.ts#puedeDesmarcarPago): once paid, the switch is locked on. */
  puedeDesmarcar: boolean;
}

export function PagoRecetaForm({ recetaId, pagada, puedeDesmarcar }: PagoRecetaFormProps) {
  const [pagadaVisible, setPagadaVisible] = useOptimistic(pagada);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cambiar(nueva: boolean) {
    setError(null);
    startTransition(async () => {
      setPagadaVisible(nueva);
      const formData = new FormData();
      formData.set("id", recetaId);
      formData.set("pagada", String(nueva));
      // revalidatePath in the action refreshes the page within this transition, so `pagada` arrives updated.
      const state = await marcarPagoRecetaAction(IDLE_STATE, formData);
      if (state.status === "error") setError(state.message);
    });
  }

  return (
    <div className="flex flex-col gap-2" aria-busy={isPending}>
      <PagoSwitch pago={{ pagada: pagadaVisible, onChange: cambiar, disabled: isPending || (pagadaVisible && !puedeDesmarcar) }} className="" />
      {pagada && !puedeDesmarcar ? <p className="text-xs text-zinc-500">La receta ya fue entregada: no se puede marcar como impaga.</p> : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
