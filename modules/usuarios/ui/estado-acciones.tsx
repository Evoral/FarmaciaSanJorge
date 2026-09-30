"use client";

/**
 * `/admin/accesos/usuarios/[id]` state-machine actions (M03, FASE 3 point 3.5):
 * shows exactly the transitions legal from the usuario's CURRENT estado
 * (mirrors modules/usuarios/domain/estado-usuario.ts, narrowed to what an
 * ADM may trigger -- reactivar is SUSPENDIDO-only, per task). BAJA is
 * never offered as a source state (terminal, DP-02 pending) -- the UI
 * says so explicitly instead of silently omitting a button.
 */
import { suspenderUsuarioAction, reactivarUsuarioAction, darDeBajaUsuarioAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import type { ButtonVariant } from "@/shared/ui/form-parts";
import { CollapsibleActionCard, MotivoField } from "@/shared/ui/motivo-form";
import type { UsuarioActionState } from "./action-state";

export interface EstadoAccionesProps {
  usuarioId: string;
  estado: "PENDIENTE_ACTIVACION" | "ACTIVO" | "SUSPENDIDO" | "BAJA";
  puedeSuspender: boolean;
  puedeReactivar: boolean;
  puedeDarDeBaja: boolean;
}

function MotivoForm({
  action,
  usuarioId,
  label,
  pendingLabel,
  helpText,
  variant,
}: {
  action: (prevState: UsuarioActionState, formData: FormData) => Promise<UsuarioActionState>;
  usuarioId: string;
  label: string;
  pendingLabel: string;
  helpText?: string;
  variant?: ButtonVariant;
}) {
  return (
    <CollapsibleActionCard label={label} helpText={helpText} variant={variant}>
      {({ close, cancelButton }) => (
        <ReauthAwareForm action={action} submitLabel={label} pendingLabel={pendingLabel} submitVariant={variant} onSuccess={close} extraActions={cancelButton}>
          <input type="hidden" name="usuarioId" value={usuarioId} />
          <MotivoField />
        </ReauthAwareForm>
      )}
    </CollapsibleActionCard>
  );
}

export function EstadoAcciones({ usuarioId, estado, puedeSuspender, puedeReactivar, puedeDarDeBaja }: EstadoAccionesProps) {
  if (estado === "BAJA") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Este usuario está dado de baja. La baja es definitiva: no se ofrece reactivación.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {estado === "ACTIVO" && puedeSuspender ? (
        <MotivoForm
          action={suspenderUsuarioAction}
          usuarioId={usuarioId}
          label="Suspender"
          pendingLabel="Suspendiendo…"
          helpText="Se cierran todas las sesiones activas y se revoca cualquier credencial pendiente."
        />
      ) : null}

      {estado === "SUSPENDIDO" && puedeReactivar ? (
        <MotivoForm action={reactivarUsuarioAction} usuarioId={usuarioId} label="Reactivar" pendingLabel="Reactivando…" />
      ) : null}

      {puedeDarDeBaja ? (
        <MotivoForm
          action={darDeBajaUsuarioAction}
          usuarioId={usuarioId}
          label="Dar de baja"
          pendingLabel="Dando de baja…"
          helpText="Definitivo: no se puede reactivar después. Se cierran todas las sesiones y credenciales pendientes."
          variant="danger"
        />
      ) : null}
    </div>
  );
}
