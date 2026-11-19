"use client";

/**
 * Form for configurable red background on preparado etiquetas (`/admin/configuracion/etiquetas`, migration 0130).
 * Mirrors `incluir-excipientes-form.tsx`: uses `ReauthAwareForm`, keeps user input on error, and responds to container
 * queries down to 375px.
 */
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { TONOS_FONDO_ROJO, type TonoFondoRojoKey } from "../domain/etiqueta-fondo";
import { FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { FORMAS_FARMACEUTICAS, type FormaFarmaceutica } from "@/modules/recetas/domain/receta";
import { editarFondoEtiquetaAction } from "./actions";

interface FondoEtiquetaFormProps {
  formasFondoRojo: readonly FormaFarmaceutica[];
  tonoFondoRojo: TonoFondoRojoKey;
  disabled: boolean;
}

export function FondoEtiquetaForm({ formasFondoRojo, tonoFondoRojo, disabled }: FondoEtiquetaFormProps) {
  return (
    <ReauthAwareForm action={editarFondoEtiquetaAction} submitLabel="Guardar fondo" submitDisabled={disabled}>
      <div className="@container flex flex-col gap-6">
        <div>
          <h3 className="text-sm font-medium text-zinc-900">Formas farmacéuticas con fondo rojo</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Las etiquetas de los preparados con estas formas se imprimirán con fondo de color rojo (por ejemplo, preparaciones de uso externo).
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2.5 @sm:grid-cols-2 @lg:grid-cols-3">
            {FORMAS_FARMACEUTICAS.map((forma) => (
              <label key={forma} className="flex items-center gap-2 text-sm text-zinc-700 select-none">
                <input
                  type="checkbox"
                  name="formasFondoRojo"
                  value={forma}
                  defaultChecked={formasFondoRojo.includes(forma)}
                  disabled={disabled}
                  className="rounded border-zinc-300 text-primary focus:ring-primary"
                />
                <span>{FORMA_FARMACEUTICA_LABELS[forma]}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-zinc-900">Tono de rojo</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Un único tono para todas las etiquetas que lleven fondo rojo. Cada opción garantiza contraste legible (≥ 4.5:1) con el texto negro.
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            {TONOS_FONDO_ROJO.map((t) => (
              <label key={t.key} className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer select-none">
                <input
                  type="radio"
                  name="tonoFondoRojo"
                  value={t.key}
                  defaultChecked={tonoFondoRojo === t.key}
                  disabled={disabled}
                  className="text-primary focus:ring-primary"
                />
                <span
                  className="inline-block size-5 shrink-0 rounded border border-zinc-300 shadow-xs"
                  style={{ backgroundColor: t.hex }}
                  aria-hidden
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </ReauthAwareForm>
  );
}
