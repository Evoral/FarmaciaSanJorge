"use client";

/** Crear/editar paciente form (FASE 4 point 4.5). HEALTH-ADJACENT DATA (DP-24): rendered only when the caller already checked `can(session, "pacientes.gestionar")` -- see app/(app)/catalogos/pacientes/**. */
import { crearPacienteAction, editarPacienteAction } from "./actions";
import { SimpleForm } from "./simple-form";

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
  };
  disabled: boolean;
}

export function PacienteForm({ mode, paciente, disabled }: PacienteFormProps) {
  const action = mode === "crear" ? crearPacienteAction : editarPacienteAction;

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear paciente" : "Guardar cambios"} className="flex max-w-md flex-col gap-3">
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
          </>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre
          </label>
          <input id="nombre" name="nombre" defaultValue={paciente?.nombre ?? ""} required disabled={disabled} autoComplete="off" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="apellido" className="text-sm font-medium">
            Apellido
          </label>
          <input id="apellido" name="apellido" defaultValue={paciente?.apellido ?? ""} required disabled={disabled} autoComplete="off" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="dni" className="text-sm font-medium">
            DNI
          </label>
          <input id="dni" name="dni" defaultValue={paciente?.dni ?? ""} disabled={disabled} placeholder="12345678" autoComplete="off" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="cuil" className="text-sm font-medium">
            CUIL (opcional)
          </label>
          <input id="cuil" name="cuil" defaultValue={paciente?.cuil ?? ""} disabled={disabled} placeholder="20-12345678-6" autoComplete="off" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="telefono" className="text-sm font-medium">
            Teléfono
          </label>
          <input id="telefono" name="telefono" defaultValue={paciente?.telefono ?? ""} disabled={disabled} autoComplete="off" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input id="email" name="email" type="email" defaultValue={paciente?.email ?? ""} disabled={disabled} autoComplete="off" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="fechaNacimiento" className="text-sm font-medium">
            Fecha de nacimiento
          </label>
          <input id="fechaNacimiento" name="fechaNacimiento" type="date" defaultValue={paciente?.fechaNacimiento ?? ""} disabled={disabled} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="nroCredencial" className="text-sm font-medium">
            Nº de credencial (obra social)
          </label>
          <input id="nroCredencial" name="nroCredencial" defaultValue={paciente?.nroCredencial ?? ""} disabled={disabled} autoComplete="off" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="sexo" className="text-sm font-medium">
            Sexo
          </label>
          <input id="sexo" name="sexo" defaultValue={paciente?.sexo ?? ""} disabled={disabled} autoComplete="off" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
      </SimpleForm>
    </div>
  );
}
