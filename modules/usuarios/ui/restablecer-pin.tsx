"use client";

/**
 * `/admin/accesos/usuarios/[id]` "Restablecer PIN" action
 * (openspec/specs/contrasena-temporal/spec.md). Two steps like Suspender / Dar de baja
 * (`CollapsibleActionCard` + confirm), without a motivo. On success the card
 * collapses, a toast confirms it and `ReauthAwareForm`'s `router.refresh()`
 * turns the panel's state into "Sin configurar".
 */
import { restablecerPinAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { CollapsibleActionCard } from "@/shared/ui/motivo-form";
import { toast } from "@/shared/ui/toast";

export function RestablecerPin({ usuarioId }: { usuarioId: string }) {
  return (
    <CollapsibleActionCard
      label="Restablecer PIN"
      helpText="Borra el PIN actual. La próxima vez que ingrese, la persona tendrá que configurar uno nuevo. No cierra sus sesiones ni cambia su contraseña."
    >
      {({ close, cancelButton }) => (
        <ReauthAwareForm
          action={restablecerPinAction}
          submitLabel="Restablecer PIN"
          pendingLabel="Restableciendo…"
          onSuccess={(state) => {
            toast(state.message ?? "PIN restablecido.");
            close();
          }}
          extraActions={cancelButton}
        >
          <input type="hidden" name="usuarioId" value={usuarioId} />
        </ReauthAwareForm>
      )}
    </CollapsibleActionCard>
  );
}
