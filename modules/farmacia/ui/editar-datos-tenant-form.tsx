"use client";

/** `/admin/configuracion/farmacia` edit form (FASE 3 point 3.10a). Only the 4 editable fields -- see modules/farmacia/application/editar-datos-tenant.ts for why the other 4 tenant fields are never even parsed as input. The page provides the surrounding panel. */
import { editarDatosTenantAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";

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
    <ReauthAwareForm action={editarDatosTenantAction} submitLabel="Guardar cambios" pendingLabel="Guardando…">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="tenant-razon-social" className="field-label">
            Razón social
          </label>
          <input id="tenant-razon-social" name="razonSocial" defaultValue={tenant.razonSocial} required disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="tenant-nombre-fantasia" className="field-label">
            Nombre de fantasía <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <input id="tenant-nombre-fantasia" name="nombreFantasia" defaultValue={tenant.nombreFantasia ?? ""} disabled={disabled} className="input" />
        </div>
        <div className="field sm:col-span-2">
          <label htmlFor="tenant-domicilio" className="field-label">
            Domicilio <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <input id="tenant-domicilio" name="domicilio" defaultValue={tenant.domicilio ?? ""} disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="tenant-matricula-farmacia" className="field-label">
            Matrícula de la farmacia <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <input id="tenant-matricula-farmacia" name="matriculaFarmacia" defaultValue={tenant.matriculaFarmacia ?? ""} disabled={disabled} className="input font-mono" />
        </div>
      </div>
    </ReauthAwareForm>
  );
}
