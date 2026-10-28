"use client";

/**
 * Crear/editar tamaño de etiqueta (`/admin/configuracion/etiquetas`). Nombre
 * plus the label's ancho x alto in mm (decimal comma or dot, one decimal). Uses
 * `ReauthAwareForm` (keeps what was typed on an error). The page provides
 * the surrounding panel.
 */
import { useRouter } from "next/navigation";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { areaUtilMm } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { NOMBRE_MAX_LENGTH, TAMANO_MM_MAX, TAMANO_MM_MIN, formatearMedidas } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { crearEtiquetaTamanoAction, editarEtiquetaTamanoAction } from "./actions";
import { MedidaMmField } from "./medida-mm-field";

export interface EtiquetaTamanoFormProps {
  mode: "crear" | "editar";
  tamano?: { id: string; nombre: string; anchoMm: number; altoMm: number };
  /** The sheet the size has to fit (spec R5): its printable area is the largest size, shown in the help text. */
  hoja?: HojaEtiqueta;
  disabled: boolean;
  /** Where to go after a successful create (the list, which closes the "Nuevo tamaño" panel). */
  volverA?: string;
}

/** `100` -> "100", `42.5` -> "42,5": what an es-AR user types. */
function medidaParaInput(valor: number | undefined): string {
  if (valor === undefined) return "";
  return String(valor).replace(".", ",");
}

export function EtiquetaTamanoForm({ mode, tamano, hoja, disabled, volverA }: EtiquetaTamanoFormProps) {
  const router = useRouter();
  const maximo = hoja ? areaUtilMm(hoja) : null;
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
        <input id="nombre" name="nombre" defaultValue={tamano?.nombre ?? ""} required disabled={disabled} maxLength={NOMBRE_MAX_LENGTH} placeholder="Ej.: Rollo 100 × 42" className="input" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MedidaMmField id="anchoMm" name="anchoMm" label="Ancho (mm)" defaultValue={medidaParaInput(tamano?.anchoMm)} disabled={disabled} />
        <MedidaMmField id="altoMm" name="altoMm" label="Alto (mm)" defaultValue={medidaParaInput(tamano?.altoMm)} disabled={disabled} />
      </div>
      <p className="field-help -mt-1">
        Entre {TAMANO_MM_MIN} y {TAMANO_MM_MAX} mm, con un decimal como máximo. El ancho es el lado largo (la etiqueta se imprime en apaisado).
        {maximo ? ` Tiene que entrar al menos una vez en la hoja de impresión: como máximo ${formatearMedidas(maximo)}.` : null}
      </p>
    </ReauthAwareForm>
  );
}
