"use client";

/**
 * Edit the sheet the etiquetas are printed on (`/admin/configuracion/etiquetas`):
 * ancho x alto and margen in mm (decimal comma or dot, one decimal). Requires recent
 * re-authentication, hence `ReauthAwareForm` (it keeps what was typed on an error and
 * marks the offending field). The page provides the surrounding panel.
 */
import { useRouter } from "next/navigation";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { HOJA_MM_MAX, HOJA_MM_MIN, MARGEN_MM_MAX, MARGEN_MM_MIN } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { TAMANO_MM_MIN } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { editarEtiquetaHojaAction } from "./actions";

export interface EtiquetaHojaFormProps {
  hoja: HojaEtiqueta;
  disabled: boolean;
  /** Where to go after a successful save (the list, which closes the edit panel). */
  volverA?: string;
}

/** `210` -> "210", `4.5` -> "4,5": what an es-AR user types. */
function medidaParaInput(valor: number): string {
  return String(valor).replace(".", ",");
}

export function EtiquetaHojaForm({ hoja, disabled, volverA }: EtiquetaHojaFormProps) {
  const router = useRouter();

  return (
    <ReauthAwareForm
      action={editarEtiquetaHojaAction}
      submitLabel="Guardar hoja"
      submitDisabled={disabled}
      onSuccess={() => {
        if (volverA) router.push(volverA);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="field">
          <label htmlFor="hoja-anchoMm" className="field-label">
            Ancho (mm)
          </label>
          <input id="hoja-anchoMm" name="anchoMm" defaultValue={medidaParaInput(hoja.anchoMm)} required disabled={disabled} inputMode="decimal" className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="hoja-altoMm" className="field-label">
            Alto (mm)
          </label>
          <input id="hoja-altoMm" name="altoMm" defaultValue={medidaParaInput(hoja.altoMm)} required disabled={disabled} inputMode="decimal" className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="hoja-margenMm" className="field-label">
            Margen (mm)
          </label>
          <input id="hoja-margenMm" name="margenMm" defaultValue={medidaParaInput(hoja.margenMm)} required disabled={disabled} inputMode="decimal" className="input font-mono" />
        </div>
      </div>
      <p className="field-help -mt-1">
        Hoja entre {HOJA_MM_MIN} y {HOJA_MM_MAX} mm, margen entre {MARGEN_MM_MIN} y {MARGEN_MM_MAX} mm, con un decimal como máximo. Para una hoja apaisada, el ancho es el lado largo. El área útil (la hoja menos los dos márgenes) debe dejar al menos {TAMANO_MM_MIN} mm de cada lado.
      </p>
    </ReauthAwareForm>
  );
}
