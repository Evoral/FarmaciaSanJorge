"use client";

/** `/admin/farmacia` edit form (FASE 3 point 3.10a). Only the 4 editable fields -- see modules/farmacia/application/editar-datos-tenant.ts for why the other 4 tenant fields are never even parsed as input. */
import { editarDatosTenantAction } from "./actions";
import { ReauthAwareForm } from "./reauth-aware-form";

export interface EditarDatosTenantFormProps {
  tenant: {
    razonSocial: string;
    nombreFantasia: string | null;
    domicilio: string | null;
    matriculaFarmacia: string | null;
  };
  disabled: boolean;
}

export function EditarDatosTenantForm({ tenant, disabled }: EditarDatosTenantFormProps) {
  return (
    <ReauthAwareForm action={editarDatosTenantAction} submitLabel="Guardar cambios" pendingLabel="Guardando…" className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="tenant-razon-social" className="text-sm font-medium">
          Razón social
        </label>
        <input
          id="tenant-razon-social"
          name="razonSocial"
          defaultValue={tenant.razonSocial}
          required
          disabled={disabled}
          className="rounded border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="tenant-nombre-fantasia" className="text-sm font-medium">
          Nombre de fantasía (opcional)
        </label>
        <input
          id="tenant-nombre-fantasia"
          name="nombreFantasia"
          defaultValue={tenant.nombreFantasia ?? ""}
          disabled={disabled}
          className="rounded border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="tenant-domicilio" className="text-sm font-medium">
          Domicilio (opcional)
        </label>
        <input
          id="tenant-domicilio"
          name="domicilio"
          defaultValue={tenant.domicilio ?? ""}
          disabled={disabled}
          className="rounded border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="tenant-matricula-farmacia" className="text-sm font-medium">
          Matrícula de la farmacia (opcional)
        </label>
        <input
          id="tenant-matricula-farmacia"
          name="matriculaFarmacia"
          defaultValue={tenant.matriculaFarmacia ?? ""}
          disabled={disabled}
          className="rounded border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
    </ReauthAwareForm>
  );
}
