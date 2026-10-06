"use client";

/**
 * Crear/editar tamaño de etiqueta (`/admin/configuracion/etiquetas`). Nombre
 * plus ancho x alto in mm (decimal comma or dot, one decimal). Both commands
 * require recent re-authentication, hence `ReauthAwareForm`. The page provides
 * the surrounding panel.
 */
import { useRouter } from "next/navigation";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { TAMANO_MM_MAX, TAMANO_MM_MIN } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { crearEtiquetaTamanoAction, editarEtiquetaTamanoAction } from "./actions";

export interface EtiquetaTamanoFormProps {
  mode: "crear" | "editar";
  tamano?: { id: string; nombre: string; anchoMm: number; altoMm: number };
  disabled: boolean;
  /** Where to go after a successful create (the list, which closes the "Nuevo tamaño" panel). */
  volverA?: string;
}

/** `100` -> "100", `42.5` -> "42,5": what an es-AR user types. */
function medidaParaInput(valor: number | undefined): string {
  if (valor === undefined) return "";
  return String(valor).replace(".", ",");
}

export function EtiquetaTamanoForm({ mode, tamano, disabled, volverA }: EtiquetaTamanoFormProps) {
  const router = useRouter();
  const action = mode === "crear" ? crearEtiquetaTamanoAction : editarEtiquetaTamanoAction;

  return (
    <ReauthAwareForm
      action={action}
      submitLabel={mode === "crear" ? "Crear tamaño" : "Guardar cambios"}
      submitDisabled={disabled}
      onSuccess={() => {
        if (mode === "crear" && volverA) router.push(volverA);
      }}
    >
      {mode === "editar" && tamano ? <input type="hidden" name="id" value={tamano.id} /> : null}

      <div className="field">
        <label htmlFor="nombre" className="field-label">
          Nombre
        </label>
        <input id="nombre" name="nombre" defaultValue={tamano?.nombre ?? ""} required disabled={disabled} maxLength={80} placeholder="Ej.: Rollo 100 × 42" className="input" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="anchoMm" className="field-label">
            Ancho (mm)
          </label>
          <input id="anchoMm" name="anchoMm" defaultValue={medidaParaInput(tamano?.anchoMm)} required disabled={disabled} inputMode="decimal" className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="altoMm" className="field-label">
            Alto (mm)
          </label>
          <input id="altoMm" name="altoMm" defaultValue={medidaParaInput(tamano?.altoMm)} required disabled={disabled} inputMode="decimal" className="input font-mono" />
        </div>
      </div>
      <p className="field-help -mt-1">
        Entre {TAMANO_MM_MIN} y {TAMANO_MM_MAX} mm, con un decimal como máximo. El ancho es el lado largo (la etiqueta se imprime en apaisado).
      </p>
    </ReauthAwareForm>
  );
}
