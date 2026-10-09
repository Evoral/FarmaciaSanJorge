"use client";

/**
 * The entrega action the receta's current estado allows (11.1/11.2), shared by the `/entregas` pop-up
 * (`@modal/(.)[recetaId]`) and the full `/entregas/[recetaId]` page. Plain data only: the page has already read it.
 * Inside the pop-up a successful action closes it (`useRouteDialogClose`).
 */
import { Lock } from "lucide-react";
import { ESTADO_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { useRouteDialogClose } from "@/shared/ui/route-dialog";
import { ToneBadge } from "@/shared/ui/status-badge";
import { puedeConfirmarFirmaRecibida, puedeRegistrarEntrega } from "../domain/entrega";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";
import { confirmarFirmaRecibidaAction, registrarEntregaAction } from "./actions";
import { ConfirmarForm } from "./confirmar-form";
import { RegistrarEntregaForm } from "./registrar-entrega-form";

export interface EntregaAccionesProps {
  recetaId: string;
  estado: EstadoReceta;
  /** Migration 0071: the receta is already paid. */
  pagada: boolean;
  itemsExcluidos: number;
  /** `entregas.registrar` */
  puedeRegistrar: boolean;
  /** `entregas.firma.confirmar` */
  puedeConfirmarFirma: boolean;
}

export function EntregaAcciones({ recetaId, estado, pagada, itemsExcluidos, puedeRegistrar, puedeConfirmarFirma }: EntregaAccionesProps) {
  const cerrar = useRouteDialogClose();

  const excluidos =
    itemsExcluidos > 0 ? (
      <ToneBadge tone="warn">
        {itemsExcluidos} {itemsExcluidos === 1 ? "ítem excluido, no se entrega" : "ítems excluidos, no se entregan"}
      </ToneBadge>
    ) : null;

  if (puedeRegistrar && puedeRegistrarEntrega(estado)) {
    return (
      <div className="flex flex-col gap-3">
        {excluidos}
        <RegistrarEntregaForm action={registrarEntregaAction} recetaId={recetaId} pagada={pagada} onSuccess={cerrar} />
      </div>
    );
  }

  if (puedeConfirmarFirma && puedeConfirmarFirmaRecibida(estado)) {
    return (
      <ConfirmarForm
        action={confirmarFirmaRecibidaAction}
        recetaId={recetaId}
        label="Confirmar firma recibida"
        pendingLabel="Confirmando…"
        helpText="El repartidor trajo la constancia firmada: la receta pasa a Entregada."
        onSuccess={cerrar}
      />
    );
  }

  return (
    <p className="flex items-start gap-2 text-sm text-zinc-500">
      <Lock className="mt-0.5 size-4 flex-none" aria-hidden />
      Sin acciones de entrega en estado {ESTADO_RECETA_LABELS[estado]}.
    </p>
  );
}
