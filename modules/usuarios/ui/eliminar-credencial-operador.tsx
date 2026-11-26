"use client";

/**
 * `/admin/accesos/usuarios/[id]` "Eliminar huella" action (openspec/changes/metodos-verificacion-operador). The
 * Administrador can only REMOVE a usuario's code for a verification method (e.g. a lost reader), never enrol it nor see
 * it. Two steps like "Restablecer PIN" (`CollapsibleActionCard` + confirm, so the form is unmounted when collapsed and
 * never keeps a stale result), without a motivo. On success the card collapses, a toast confirms it and
 * `ReauthAwareForm`'s `router.refresh()` turns the panel's state into "Sin huella".
 */
import { eliminarCredencialOperadorAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { CollapsibleActionCard } from "@/shared/ui/motivo-form";
import { toast } from "@/shared/ui/toast";

export function EliminarCredencialOperador({ usuarioId, metodo, etiqueta }: { usuarioId: string; metodo: string; etiqueta: string }) {
  const nombre = etiqueta.toLowerCase();
  return (
    <CollapsibleActionCard
      label={`Eliminar ${nombre}`}
      helpText={`Borra la ${nombre} enrolada: la persona deja de poder identificarse con ella hasta que enrole otra desde Mi cuenta. No cambia su PIN ni cierra sus sesiones.`}
    >
      {({ close, cancelButton }) => (
        <ReauthAwareForm
          action={eliminarCredencialOperadorAction}
          submitLabel={`Eliminar ${nombre}`}
          pendingLabel="Eliminando…"
          onSuccess={(state) => {
            toast(state.message ?? `${etiqueta} eliminada.`);
            close();
          }}
          extraActions={cancelButton}
        >
          <input type="hidden" name="usuarioId" value={usuarioId} />
          <input type="hidden" name="metodo" value={metodo} />
        </ReauthAwareForm>
      )}
    </CollapsibleActionCard>
  );
}
