"use client";

/**
 * "Cancelar toma" in the toma workspace (`preparaciones.cancelarToma`, domain/toma.ts): two steps -- the first button
 * only asks for confirmation; "Sí, cancelar toma" reverts the toma and goes back to /preparaciones, where the receta is
 * in Pendientes again. An error (e.g. an ítem's confirmation already started) shows inline.
 *
 * The confirmation floats under the button (it lives in the page header's actions row): rendered in the flow it
 * re-laid out the whole row and pushed "Volver a pendientes" around. Escape or "No" close it.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SimpleForm } from "@/shared/ui/simple-form";
import { cancelarTomaAction } from "./actions";

export function CancelarTomaForm({ recetaId }: { recetaId: string }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="relative">
      <button type="button" onClick={() => setConfirmando((v) => !v)} aria-expanded={confirmando} className="btn btn-secondary">
        Cancelar toma
      </button>
      {confirmando ? (
        <div
          role="group"
          aria-label="Confirmar la cancelación de la toma"
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmando(false);
          }}
          className="card absolute right-0 top-full z-20 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 p-4 text-sm shadow-lg"
        >
          <p>La receta vuelve a Pendientes y cualquier usuario del laboratorio la puede tomar. ¿Cancelar la toma?</p>
          <SimpleForm
            action={cancelarTomaAction}
            accion="preparaciones.iniciar"
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
      ) : null}
    </div>
  );
}
