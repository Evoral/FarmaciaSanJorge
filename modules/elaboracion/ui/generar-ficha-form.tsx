"use client";

/** "Generar nueva ficha técnica" button -- no motivo/confirmation needed; only refused once the item has a CONFIRMADA preparación (see modules/elaboracion/application/generar-ficha-tecnica.ts's INV-R05/INV-P02 doc comment). */
import { SimpleForm } from "@/shared/ui/simple-form";
import { generarFichaTecnicaAction } from "./actions";

export interface GenerarFichaFormProps {
  itemRecetaId: string;
  recetaId: string;
  label: string;
}

export function GenerarFichaForm({ itemRecetaId, recetaId, label }: GenerarFichaFormProps) {
  return (
    <SimpleForm
      action={generarFichaTecnicaAction}
      submitLabel={label}
      pendingLabel="Generando…"
      successMessage={(state) => state.message ?? `Ficha versión ${state.version} generada.`}
    >
      <input type="hidden" name="itemRecetaId" value={itemRecetaId} />
      <input type="hidden" name="recetaId" value={recetaId} />
    </SimpleForm>
  );
}
