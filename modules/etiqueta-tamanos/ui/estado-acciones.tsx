"use client";

/**
 * Baja / reactivación of a tamaño de etiqueta (`/admin/configuracion/etiquetas/[id]`).
 * Both need a motivo (kept in the audit trail) and recent re-authentication, so
 * this composes the shared card + motivo field with `ReauthAwareForm` -- the same
 * shape as modules/usuarios/ui/estado-acciones.tsx.
 */
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { CollapsibleActionCard, MotivoField } from "@/shared/ui/motivo-form";
import { darDeBajaEtiquetaTamanoAction, reactivarEtiquetaTamanoAction } from "./actions";

export interface EstadoAccionesProps {
  id: string;
  activo: boolean;
}

export function EtiquetaTamanoEstadoAcciones({ id, activo }: EstadoAccionesProps) {
  const label = activo ? "Dar de baja" : "Reactivar";
  const variant = activo ? "danger" : undefined;

  return (
    <CollapsibleActionCard
      label={label}
      variant={variant}
      helpText={activo ? "El tamaño deja de ofrecerse al imprimir etiquetas. Se puede reactivar más adelante." : "El tamaño vuelve a ofrecerse al imprimir etiquetas."}
    >
      {({ close, cancelButton }) => (
        <ReauthAwareForm
          action={activo ? darDeBajaEtiquetaTamanoAction : reactivarEtiquetaTamanoAction}
          submitLabel={label}
          pendingLabel={activo ? "Dando de baja…" : "Reactivando…"}
          submitVariant={variant}
          onSuccess={close}
          extraActions={cancelButton}
        >
          <input type="hidden" name="id" value={id} />
          <MotivoField />
        </ReauthAwareForm>
      )}
    </CollapsibleActionCard>
  );
}
