"use client";

/**
 * "Tomar receta" on a /preparaciones "Pendientes" row (`preparaciones.tomarReceta`, domain/toma.ts): records who took the
 * receta and opens its toma workspace. An error (e.g. someone else took it a moment earlier) shows inline.
 */
import { useRouter } from "next/navigation";
import { SimpleForm } from "@/shared/ui/simple-form";
import { hrefToma } from "../domain/toma";
import { tomarRecetaAction } from "./actions";

export function TomarRecetaForm({ recetaId }: { recetaId: string }) {
  const router = useRouter();
  return (
    <SimpleForm
      action={tomarRecetaAction}
      submitLabel="Tomar receta"
      pendingLabel="Tomando…"
      submitSize="sm"
      layout="inline"
      onSuccess={() => router.push(hrefToma(recetaId))}
    >
      <input type="hidden" name="recetaId" value={recetaId} />
    </SimpleForm>
  );
}
