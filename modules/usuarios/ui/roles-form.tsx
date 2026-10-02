"use client";

/**
 * `/admin/accesos/usuarios/[id]` "Roles" tab (M03, FASE 3 point 3.4). Submits the FULL desired role set; requires
 * re-authentication (handled by ReauthAwareForm). The options are the tenant's roles (DP-03: per-tenant data, loaded
 * by the page via `listRolesAsignables`, SISTEMA never included); `cambiarRoles` re-validates every code server-side.
 */
import { cambiarRolesAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";

export interface RolesFormProps {
  usuarioId: string;
  rolesActuales: string[];
  opciones: readonly { codigo: string; nombre: string }[];
  disabled: boolean;
}

export function RolesForm({ usuarioId, rolesActuales, opciones, disabled }: RolesFormProps) {
  return (
    <ReauthAwareForm action={cambiarRolesAction} submitLabel="Guardar roles" pendingLabel="Guardando…">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <div className="flex flex-col gap-2">
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="text-sm font-medium">Roles (al menos uno)</legend>
          {opciones.map((rol) => (
            <label key={rol.codigo} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="roles" value={rol.codigo} defaultChecked={rolesActuales.includes(rol.codigo)} className="h-4 w-4" />
              {rol.nombre}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-zinc-500">
          Para quitarle el acceso a alguien, suspendé o dá de baja la cuenta -- no lo hagas quitando todos los roles.
        </p>
      </div>
    </ReauthAwareForm>
  );
}
