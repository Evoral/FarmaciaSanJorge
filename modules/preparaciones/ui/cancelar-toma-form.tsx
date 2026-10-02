"use client";

/**
 * "Cancelar toma" in the toma workspace (`preparaciones.cancelarToma`, domain/toma.ts): two steps -- the first button
 * only asks for confirmation; "Sí, cancelar toma" reverts the toma and goes back to /preparaciones, where the receta is
 * in Pendientes again. An error (e.g. an ítem's confirmation already started) shows inline.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SimpleForm } from "@/shared/ui/simple-form";
import { cancelarTomaAction } from "./actions";

export function CancelarTomaForm({ recetaId }: { recetaId: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);

  if (!confirmando) {
    return (
      <button type="button" onClick={() => setConfirmando(true)} className="btn btn-secondary">
        Cancelar toma
      </button>
    );
  }

  return (
    <div role="group" aria-label="Confirmar la cancelación de la toma" className="flex flex-col gap-2 text-sm">
      <p>La receta vuelve a Pendientes y cualquier usuario del laboratorio la puede tomar. ¿Cancelar la toma?</p>
      <SimpleForm
        action={cancelarTomaAction}
        submitLabel="Sí, cancelar toma"
        pendingLabel="Cancelando…"
        submitVariant="danger"
        extraActions={
          <button type="button" onClick={() => setConfirmando(false)} className="btn btn-secondary">
            No
          </button>
        }
        onSuccess={() => router.push("/preparaciones")}
      >
        <input type="hidden" name="recetaId" value={recetaId} />
      </SimpleForm>
    </div>
  );
}
