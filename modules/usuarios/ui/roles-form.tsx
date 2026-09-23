"use client";

/** `/admin/usuarios/[id]` "Roles" tab (M03, FASE 3 point 3.4). Submits the FULL desired role set; requires re-authentication (handled by ReauthAwareForm). */
import { cambiarRolesAction } from "./actions";
import { ReauthAwareForm } from "./reauth-aware-form";
import { ROLES_ASIGNABLES, ROL_LABELS } from "../domain/roles";

export interface RolesFormProps {
  usuarioId: string;
  rolesActuales: string[];
  disabled: boolean;
}

export function RolesForm({ usuarioId, rolesActuales, disabled }: RolesFormProps) {
  return (
    <ReauthAwareForm action={cambiarRolesAction} submitLabel="Guardar roles" pendingLabel="Guardando…">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-sm font-medium">Roles (al menos uno)</legend>
        {ROLES_ASIGNABLES.map((codigo) => (
          <label key={codigo} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="roles" value={codigo} defaultChecked={rolesActuales.includes(codigo)} className="h-4 w-4" />
            {ROL_LABELS[codigo]}
          </label>
        ))}
      </fieldset>
      <p className="mt-2 text-xs text-zinc-500">
        Para quitarle el acceso a alguien, suspendé o dá de baja la cuenta -- no lo hagas quitando todos los roles.
      </p>
    </ReauthAwareForm>
  );
}
