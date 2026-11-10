"use client";

/**
 * Alta of a pharmacy (openspec/changes/plataforma-superadmin P10): its datos, contacto and first Administrador. On an
 * error nothing typed is lost and the offending field is marked (SimpleForm); on success it opens the new pharmacy.
 */
import { useRouter } from "next/navigation";
import { SimpleForm } from "@/shared/ui/simple-form";
import { PasswordInput } from "@/shared/ui/password-input";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { RAZON_SOCIAL_MAX } from "../domain/farmacia";
import { ContactoCampos } from "./contacto-campos";
import { crearFarmaciaAction } from "./actions";

function Campo({ name, label, required, type = "text", help, maxLength }: { name: string; label: string; required?: boolean; type?: string; help?: string; maxLength?: number }) {
  return (
    <div className="field">
      <label htmlFor={`alta-${name}`} className="field-label">
        {label}
      </label>
      <input id={`alta-${name}`} name={name} type={type} required={required} maxLength={maxLength} autoComplete="off" className="input" />
      {help ? <p className="field-help">{help}</p> : null}
    </div>
  );
}

export function AltaFarmaciaForm() {
  const router = useRouter();
  return (
    <SimpleForm
      className="@container"
      action={crearFarmaciaAction}
      submitLabel="Crear farmacia"
      pendingLabel="Creando…"
      onSuccess={(state) => {
        if (state.tenantId) router.push(`/plataforma/farmacias/${state.tenantId}`);
      }}
    >
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-zinc-900">Farmacia</legend>
        <div className="grid gap-4 @lg:grid-cols-2">
          <Campo name="razonSocial" label="Razón social" required maxLength={RAZON_SOCIAL_MAX} />
          <Campo name="cuit" label="CUIT" required maxLength={20} help="11 dígitos, con o sin guiones." />
          <Campo name="nombreFantasia" label="Nombre de fantasía" maxLength={RAZON_SOCIAL_MAX} />
          <Campo name="matriculaFarmacia" label="Matrícula de la farmacia" maxLength={100} />
        </div>
        <Campo name="domicilio" label="Domicilio" maxLength={300} />
        <input type="hidden" name="zonaHoraria" value="America/Argentina/Mendoza" />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-zinc-900">Contacto</legend>
        <ContactoCampos idPrefix="alta" />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold text-zinc-900">Primer administrador</legend>
        <div className="grid gap-4 @lg:grid-cols-2">
          <Campo name="adminNombre" label="Nombre" required maxLength={100} />
          <Campo name="adminApellido" label="Apellido" required maxLength={100} />
          <Campo name="adminEmail" label="Email" type="email" required help="Con este email inicia sesión." />
          <Campo name="adminDni" label="DNI" required maxLength={12} />
        </div>
        <div className="field">
          <label htmlFor="alta-adminPasswordTemporal" className="field-label">
            Contraseña temporal
          </label>
          <PasswordInput id="alta-adminPasswordTemporal" name="adminPasswordTemporal" required minLength={AUTH_POLICY.minTemporaryPasswordLength} autoComplete="new-password" className="input" />
          <p className="field-help">
            Al menos {AUTH_POLICY.minTemporaryPasswordLength} caracteres. Dásela en persona: en su primer ingreso la cambia y configura su PIN.
          </p>
        </div>
      </fieldset>
    </SimpleForm>
  );
}
