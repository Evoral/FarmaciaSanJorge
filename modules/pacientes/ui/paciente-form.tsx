"use client";

/** Crear/editar paciente form (FASE 4 point 4.5). HEALTH-ADJACENT DATA (DP-24): rendered only when the caller already checked `can(session, "pacientes.gestionar")` -- see app/(app)/pacientes/**. The page provides the surrounding panel. */
import { crearPacienteAction, editarPacienteAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";

export interface PacienteFormProps {
  mode: "crear" | "editar";
  paciente?: {
    id: string;
    nombre: string;
    apellido: string;
    cuil: string | null;
    dni: string | null;
    telefono: string | null;
    email: string | null;
    fechaNacimiento: string | null;
    nroCredencial: string | null;
    sexo: string | null;
    aceptaRecordatoriosWhatsapp: boolean;
  };
  disabled: boolean;
}

export function PacienteForm({ mode, paciente, disabled }: PacienteFormProps) {
  const action = mode === "crear" ? crearPacienteAction : editarPacienteAction;

  return (
    <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear paciente" : "Guardar cambios"}>
      {mode === "editar" && paciente ? (
        <>
          <input type="hidden" name="id" value={paciente.id} />
          <input type="hidden" name="versionNombre" value={paciente.nombre} />
          <input type="hidden" name="versionApellido" value={paciente.apellido} />
          <input type="hidden" name="versionCuil" value={paciente.cuil ?? ""} />
          <input type="hidden" name="versionDni" value={paciente.dni ?? ""} />
          <input type="hidden" name="versionTelefono" value={paciente.telefono ?? ""} />
          <input type="hidden" name="versionEmail" value={paciente.email ?? ""} />
          <input type="hidden" name="versionFechaNacimiento" value={paciente.fechaNacimiento ?? ""} />
          <input type="hidden" name="versionNroCredencial" value={paciente.nroCredencial ?? ""} />
          <input type="hidden" name="versionSexo" value={paciente.sexo ?? ""} />
          <input type="hidden" name="versionAceptaRecordatoriosWhatsapp" value={paciente.aceptaRecordatoriosWhatsapp ? "true" : "false"} />
        </>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="nombre" className="field-label">
            Nombre
          </label>
          <input id="nombre" name="nombre" defaultValue={paciente?.nombre ?? ""} required disabled={disabled} autoComplete="off" className="input" />
        </div>
        <div className="field">
          <label htmlFor="apellido" className="field-label">
            Apellido
          </label>
          <input id="apellido" name="apellido" defaultValue={paciente?.apellido ?? ""} required disabled={disabled} autoComplete="off" className="input" />
        </div>
        <div className="field">
          <label htmlFor="dni" className="field-label">
            DNI
          </label>
          <input id="dni" name="dni" defaultValue={paciente?.dni ?? ""} placeholder="12345678" disabled={disabled} autoComplete="off" className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="cuil" className="field-label">
            CUIL <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <input id="cuil" name="cuil" defaultValue={paciente?.cuil ?? ""} placeholder="20-12345678-6" disabled={disabled} autoComplete="off" className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="telefono" className="field-label">
            Teléfono
          </label>
          <input id="telefono" name="telefono" type="tel" defaultValue={paciente?.telefono ?? ""} disabled={disabled} autoComplete="off" className="input" />
        </div>
        <div className="field">
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input id="email" name="email" type="email" defaultValue={paciente?.email ?? ""} disabled={disabled} autoComplete="off" className="input" />
        </div>
        <div className="field">
          <label htmlFor="fechaNacimiento" className="field-label">
            Fecha de nacimiento
          </label>
          <DateInput id="fechaNacimiento" name="fechaNacimiento" defaultValue={paciente?.fechaNacimiento ?? ""} disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor="sexo" className="field-label">
            Sexo
          </label>
          <input id="sexo" name="sexo" defaultValue={paciente?.sexo ?? ""} disabled={disabled} autoComplete="off" className="input" />
        </div>
        <div className="field sm:col-span-2">
          <label htmlFor="nroCredencial" className="field-label">
            Nº de credencial <span className="font-normal text-zinc-500">(obra social)</span>
          </label>
          <input id="nroCredencial" name="nroCredencial" defaultValue={paciente?.nroCredencial ?? ""} disabled={disabled} autoComplete="off" className="input font-mono" />
        </div>
      </div>

      <label htmlFor="aceptaRecordatoriosWhatsapp" className="choice-row items-start">
        <input
          id="aceptaRecordatoriosWhatsapp"
          name="aceptaRecordatoriosWhatsapp"
          type="checkbox"
          defaultChecked={paciente?.aceptaRecordatoriosWhatsapp ?? false}
          disabled={disabled}
          aria-describedby="aceptaRecordatoriosWhatsapp-ayuda"
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-zinc-900">Acepta recordatorios por WhatsApp</span>
          <span id="aceptaRecordatoriosWhatsapp-ayuda" className="text-xs text-zinc-500">
            Solo si el paciente lo aceptó. Permite avisarle cuando se acerca la fecha de una preparación que pide seguido.
          </span>
        </span>
      </label>
    </SimpleForm>
  );
}
