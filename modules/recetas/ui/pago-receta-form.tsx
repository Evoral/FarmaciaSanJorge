"use client";

/**
 * Mark / unmark a receta as paid from its detail (migration 0071, docs/specs/pago-receta.md). One button that flips
 * the current value; `pagadaEn` / `pagadaPorId` are set by the server, the form only says which state it asks for.
 * Same `shared/ui/simple-form.tsx`-wrapping shape as modules/entregas/ui/confirmar-form.tsx.
 */
import { SimpleForm } from "@/shared/ui/simple-form";
import { marcarPagoRecetaAction } from "./actions";

export interface PagoRecetaFormProps {
  recetaId: string;
  /** The receta's current payment. */
  pagada: boolean;
}

export function PagoRecetaForm({ recetaId, pagada }: PagoRecetaFormProps) {
  return (
    <SimpleForm
      action={marcarPagoRecetaAction}
      submitLabel={pagada ? "Marcar como impaga" : "Marcar como pagada"}
      pendingLabel="Guardando…"
      submitVariant={pagada ? "secondary" : "primary"}
    >
      <input type="hidden" name="id" value={recetaId} />
      <input type="hidden" name="pagada" value={pagada ? "false" : "true"} />
    </SimpleForm>
  );
}
