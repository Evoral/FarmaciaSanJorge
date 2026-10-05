"use client";

/**
 * "Tomar receta" on a /preparaciones "Pendientes" row (`preparaciones.tomarReceta`, domain/toma.ts): records who took the
 * receta and opens its toma workspace (the action redirects there). An error (e.g. someone else took it a moment earlier)
 * shows inline.
 */
import { SimpleForm } from "@/shared/ui/simple-form";
import { tomarRecetaAction } from "./actions";

export function TomarRecetaForm({ recetaId }: { recetaId: string }) {
  return (
    <SimpleForm
      action={tomarRecetaAction}
      submitLabel="Tomar receta"
      pendingLabel="Tomando…"
      submitSize="sm"
      layout="inline"
    >
      <input type="hidden" name="recetaId" value={recetaId} />
    </SimpleForm>
  );
}
