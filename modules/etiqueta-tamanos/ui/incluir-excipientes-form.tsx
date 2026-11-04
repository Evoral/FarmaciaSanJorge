"use client";

/**
 * Where the toma's "Incluir excipientes en la etiqueta" switch starts (`/admin/configuracion/etiquetas`, migration
 * 0117). Uses `ReauthAwareForm` like the sheet's form; the page provides the surrounding panel.
 */
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { editarIncluirExcipientesAction } from "./actions";

export function IncluirExcipientesForm({ incluirExcipientes, disabled }: { incluirExcipientes: boolean; disabled: boolean }) {
  return (
    <ReauthAwareForm action={editarIncluirExcipientesAction} submitLabel="Guardar" submitDisabled={disabled}>
      <label className="toggle-switch min-h-0 items-start text-sm text-zinc-700">
        <input type="checkbox" role="switch" name="incluirExcipientes" className="mt-0.5" defaultChecked={incluirExcipientes} disabled={disabled} />
        <span>
          Incluir excipientes en la etiqueta por defecto
          <span className="mt-0.5 block text-xs text-zinc-500">
            Es como arranca el switch al imprimir las etiquetas de una receta en Preparaciones; se puede cambiar ahí antes de imprimir. Los excipientes se agregan a la
            fórmula de la etiqueta aclarando que son excipientes. No cambia las etiquetas ya generadas.
          </span>
        </span>
      </label>
    </ReauthAwareForm>
  );
}
