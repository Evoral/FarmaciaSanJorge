"use client";

/** "Generar nueva ficha técnica" button -- no motivo/confirmation needed, generation is always allowed (see modules/elaboracion/application/generar-ficha-tecnica.ts's INV-R05/INV-P02 doc comment: a new version is never refused). */
import { SimpleForm } from "./simple-form";
import { generarFichaTecnicaAction } from "./actions";

export interface GenerarFichaFormProps {
  itemRecetaId: string;
  recetaId: string;
  label: string;
}

export function GenerarFichaForm({ itemRecetaId, recetaId, label }: GenerarFichaFormProps) {
  return (
    <SimpleForm action={generarFichaTecnicaAction} submitLabel={label} pendingLabel="Generando…">
      <input type="hidden" name="itemRecetaId" value={itemRecetaId} />
      <input type="hidden" name="recetaId" value={recetaId} />
    </SimpleForm>
  );
}
