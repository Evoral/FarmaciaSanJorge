"use client";

/**
 * The entrega action the receta's current estado allows (11.1/11.2), shared by the entrega pop-up
 * (`app/(app)/@modal/(.)entregas/[recetaId]`) and the full `/entregas/[recetaId]` page. Plain data only: the page has already read it.
 * Inside the pop-up a successful action closes it (`useRouteDialogClose`).
 */
import { useState } from "react";
import { Lock } from "lucide-react";
import { ESTADO_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { useRouteDialogClose } from "@/shared/ui/route-dialog";
import { ToneBadge } from "@/shared/ui/status-badge";
import { puedeConfirmarFirmaRecibida, puedeRegistrarEntrega } from "../domain/entrega";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";
import type { EntregaActionState } from "./action-state";
import { confirmarFirmaRecibidaAction, registrarEntregaAction } from "./actions";
import { ConfirmarFirmaForm } from "./confirmar-firma-form";
import { RegistrarEntregaForm } from "./registrar-entrega-form";

export interface EntregaAccionesProps {
  recetaId: string;
  estado: EstadoReceta;
  /** Migration 0071: the receta is already paid. */
  pagada: boolean;
  itemsExcluidos: number;
  /** `entregas.registrar` */
  puedeRegistrar: boolean;
  /** `entregas.registrar` (single /entregas permiso, migration 0085) */
  puedeConfirmarFirma: boolean;
}

export function EntregaAcciones({ recetaId, estado, pagada, itemsExcluidos, puedeRegistrar, puedeConfirmarFirma }: EntregaAccionesProps) {
  const cerrar = useRouteDialogClose();
  // The action revalidates the receta, so the pop-up's props flip to ENVIADA_PEND_FIRMA (and unmount the registration
  // form before its `onSuccess` runs) while it is still open: without this it would swap straight into the "confirmar
  // firma" form. An envío is registered to be confirmed LATER (the repartidor takes time), so the pop-up just closes.
  const [envioRegistrado, setEnvioRegistrado] = useState(false);

  async function registrar(prevState: EntregaActionState, formData: FormData): Promise<EntregaActionState> {
    const result = await registrarEntregaAction(prevState, formData);
    if (result.status === "success" && cerrar && formData.get("modalidad") === "ENVIO") {
      setEnvioRegistrado(true);
      cerrar();
    }
    return result;
  }

  const excluidos =
    itemsExcluidos > 0 ? (
      <ToneBadge tone="warn">
        {itemsExcluidos} {itemsExcluidos === 1 ? "ítem excluido, no se entrega" : "ítems excluidos, no se entregan"}
      </ToneBadge>
    ) : null;

  if (envioRegistrado) {
    return <p className="text-sm text-zinc-500">Envío registrado: queda pendiente de confirmar su retorno.</p>;
  }

  if (puedeRegistrar && puedeRegistrarEntrega(estado)) {
    return (
      <div className="flex flex-col gap-3">
        {excluidos}
        <RegistrarEntregaForm action={registrar} recetaId={recetaId} pagada={pagada} onSuccess={cerrar} />
      </div>
    );
  }

  if (puedeConfirmarFirma && puedeConfirmarFirmaRecibida(estado)) {
    return (
      <ConfirmarFirmaForm action={confirmarFirmaRecibidaAction} recetaId={recetaId} pagada={pagada} onSuccess={cerrar} />
    );
  }

  return (
    <p className="flex items-start gap-2 text-sm text-zinc-500">
      <Lock className="mt-0.5 size-4 flex-none" aria-hidden />
      Sin acciones de entrega en estado {ESTADO_RECETA_LABELS[estado]}.
    </p>
  );
}
