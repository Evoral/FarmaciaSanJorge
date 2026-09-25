"use client";

/**
 * `/admin/usuarios/[id]` state-machine actions (M03, FASE 3 point 3.5):
 * shows exactly the transitions legal from the usuario's CURRENT estado
 * (mirrors modules/usuarios/domain/estado-usuario.ts, narrowed to what an
 * ADM may trigger -- reactivar is SUSPENDIDO-only, per task). BAJA is
 * never offered as a source state (terminal, DP-02 pending) -- the UI
 * says so explicitly instead of silently omitting a button.
 */
import { useId, useState } from "react";
import { suspenderUsuarioAction, reactivarUsuarioAction, darDeBajaUsuarioAction } from "./actions";
import { ReauthAwareForm } from "./reauth-aware-form";
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
  submitClassName,
}: {
  action: (prevState: UsuarioActionState, formData: FormData) => Promise<UsuarioActionState>;
  usuarioId: string;
  label: string;
  pendingLabel: string;
  helpText?: string;
  submitClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const motivoId = useId();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={submitClassName ?? "btn btn-secondary"}>
        {label}
      </button>
    );
  }

  return (
    <div className="card p-4">
      {helpText ? <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{helpText}</p> : null}
      <ReauthAwareForm action={action} submitLabel={label} pendingLabel={pendingLabel} submitClassName={submitClassName} onSuccess={() => setOpen(false)}>
        <input type="hidden" name="usuarioId" value={usuarioId} />
        <label htmlFor={motivoId} className="text-sm font-medium">
          Motivo
        </label>
        <textarea id={motivoId} name="motivo" required rows={2} className="mt-1 w-full input" />
      </ReauthAwareForm>
      <button type="button" onClick={() => setOpen(false)} className="mt-2 text-sm underline">
        Cancelar
      </button>
    </div>
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
          submitClassName="btn btn-danger"
        />
      ) : null}
    </div>
  );
}
