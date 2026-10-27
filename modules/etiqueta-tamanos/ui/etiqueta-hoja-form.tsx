"use client";

/**
 * Edit the sheet the etiquetas are printed on (`/admin/configuracion/etiquetas`):
 * ancho x alto and margen in mm (decimal comma or dot, one decimal). Uses
 * `ReauthAwareForm` (it keeps what was typed on an error and marks the offending field). The page provides the surrounding panel.
 */
import { useRouter } from "next/navigation";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { HOJA_MM_MAX, HOJA_MM_MIN, MARGEN_MM_MAX, MARGEN_MM_MIN } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { TAMANO_MM_MIN } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { editarEtiquetaHojaAction } from "./actions";
import { MedidaMmField } from "./medida-mm-field";

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
        <MedidaMmField id="hoja-anchoMm" name="anchoMm" label="Ancho (mm)" defaultValue={medidaParaInput(hoja.anchoMm)} disabled={disabled} />
        <MedidaMmField id="hoja-altoMm" name="altoMm" label="Alto (mm)" defaultValue={medidaParaInput(hoja.altoMm)} disabled={disabled} />
        <MedidaMmField id="hoja-margenMm" name="margenMm" label="Margen (mm)" defaultValue={medidaParaInput(hoja.margenMm)} disabled={disabled} />
      </div>
      <p className="field-help -mt-1">
        Hoja entre {HOJA_MM_MIN} y {HOJA_MM_MAX} mm, margen entre {MARGEN_MM_MIN} y {MARGEN_MM_MAX} mm, con un decimal como máximo. Para una hoja apaisada, el ancho es el lado largo. El área útil (la hoja menos los dos márgenes) debe dejar al menos {TAMANO_MM_MIN} mm de cada lado.
      </p>
    </ReauthAwareForm>
  );
}
