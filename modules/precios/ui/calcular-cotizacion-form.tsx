"use client";

/** `/recetas/[id]/items/[itemId]/cotizacion`'s "calcular" button (FASE 7 point 7.4). */
import { calcularCotizacionAction } from "./actions";
import { SimpleForm } from "./simple-form";

export interface CalcularCotizacionFormProps {
  itemRecetaId: string;
  recetaId: string;
  label: string;
}

export function CalcularCotizacionForm({ itemRecetaId, recetaId, label }: CalcularCotizacionFormProps) {
  return (
    <SimpleForm action={calcularCotizacionAction} submitLabel={label} pendingLabel="Calculando…">
      <input type="hidden" name="itemRecetaId" value={itemRecetaId} />
      <input type="hidden" name="recetaId" value={recetaId} />
    </SimpleForm>
  );
}
