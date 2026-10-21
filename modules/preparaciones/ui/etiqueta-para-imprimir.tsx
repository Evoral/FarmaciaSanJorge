"use client";

/**
 * "Imprimir etiqueta" for a CONFIRMADA preparación, in ONE step: when its etiqueta was not generated yet (a preparación
 * confirmed from `/preparaciones/[id]`, which writes the asiento but no etiqueta), the button generates it
 * (`generarEtiquetaAction` -- no stock, no libro, just the etiqueta row) and then opens the size and position dialog by itself, like
 * the toma workspace's "Imprimir etiquetas" (./reserva-acciones.tsx). Once generated it is the print dialog's own button.
 *
 * Rendered at the SAME place for both states, so its "just generated" flag survives the refresh in between and the
 * dialog opens right after.
 */
import { useState } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import type { HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { generarEtiquetaAction } from "./actions";
import { ImprimirEtiquetaDialog } from "./imprimir-etiqueta-dialog";

export interface EtiquetaParaImprimirProps {
  preparacionId: string;
  /** The preparación already has its etiqueta. */
  generada: boolean;
  /** The etiqueta was already printed at least once. */
  impresa?: boolean;
  /** `etiquetas.generar`. */
  puedeGenerar: boolean;
  /** `etiquetas.imprimir`: without it the button only generates the etiqueta. */
  puedeImprimir: boolean;
  /** The active sizes that fit the sheet. */
  tamanos: readonly EtiquetaTamano[];
  hoja: HojaEtiqueta;
  /** `"secondary"` + `small` in table rows, `"primary"` on the preparación screen. */
  variant?: "primary" | "secondary";
  small?: boolean;
}

export function EtiquetaParaImprimir({ preparacionId, generada, impresa = false, puedeGenerar, puedeImprimir, tamanos, hoja, variant = "secondary", small = true }: EtiquetaParaImprimirProps) {
  const [recienGenerada, setRecienGenerada] = useState(false);

  if (generada) {
    return puedeImprimir ? <ImprimirEtiquetaDialog preparacionId={preparacionId} tamanos={tamanos} hoja={hoja} variant={variant} small={small} abrirAlMontar={recienGenerada} reimprimir={impresa} /> : null;
  }
  if (!puedeGenerar) return null;

  return (
    <SimpleForm
      action={generarEtiquetaAction}
      accion="etiquetas.generar"
      submitLabel={puedeImprimir ? "Imprimir etiqueta" : "Generar etiqueta"}
      pendingLabel="Generando…"
      submitVariant={variant}
      submitSize={small ? "sm" : undefined}
      layout="inline"
      // The print dialog that opens next is the feedback: no "Etiqueta generada." toast.
      successMessage={() => undefined}
      onSuccess={() => setRecienGenerada(true)}
    >
      <input type="hidden" name="preparacionId" value={preparacionId} />
    </SimpleForm>
  );
}
