"use client";

/** `/admin/configuracion/farmacia` edit form (FASE 3 point 3.10a). Only the editable fields -- see modules/farmacia/application/editar-datos-tenant.ts for why the other tenant fields are never even parsed as input. The CUIT field is rendered only while `cuitEditable` (openspec/specs/cuit-farmacia/spec.md). The page provides the surrounding panel. */
import { editarDatosTenantAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";

export interface EditarDatosTenantFormProps {
  tenant: {
    razonSocial: string;
    nombreFantasia: string | null;
    domicilio: string | null;
    matriculaFarmacia: string | null;
    telefonoFijo: string | null;
    telefonoCelular: string | null;
    cuit: string;
    cuitEditable: boolean;
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
        {tenant.cuitEditable ? (
          <div className="field sm:col-span-2">
            <label htmlFor="tenant-cuit" className="field-label">
              CUIT <span className="font-normal text-zinc-500">(editable hasta firmar el primer cierre diario)</span>
            </label>
            <input id="tenant-cuit" name="cuit" defaultValue={tenant.cuit} required maxLength={20} disabled={disabled} className="input font-mono" />
          </div>
        ) : null}
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
        <div className="field">
          <label htmlFor="tenant-telefono-fijo" className="field-label">
            Teléfono fijo <span className="font-normal text-zinc-500">(opcional, sale en la etiqueta)</span>
          </label>
          <input id="tenant-telefono-fijo" name="telefonoFijo" type="tel" maxLength={40} defaultValue={tenant.telefonoFijo ?? ""} placeholder="(0263) 4428850" disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="tenant-telefono-celular" className="field-label">
            Celular / WhatsApp <span className="font-normal text-zinc-500">(opcional, sale en la etiqueta)</span>
          </label>
          <input id="tenant-telefono-celular" name="telefonoCelular" type="tel" maxLength={40} defaultValue={tenant.telefonoCelular ?? ""} placeholder="(0263) 154949843" disabled={disabled} className="input" />
        </div>
      </div>
    </ReauthAwareForm>
  );
}
