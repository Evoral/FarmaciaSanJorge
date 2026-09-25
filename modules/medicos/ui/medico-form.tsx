"use client";

/** Crear/editar médico form (FASE 4 point 4.4). */
import { crearMedicoAction, editarMedicoAction } from "./actions";
import { SimpleForm } from "./simple-form";

export interface MedicoFormProps {
  mode: "crear" | "editar";
  medico?: {
    id: string;
    nombre: string;
    apellido: string;
    matricula: string;
    especialidad: string | null;
    telefono: string | null;
    direccionRegistrada: string | null;
  };
  disabled: boolean;
}

export function MedicoForm({ mode, medico, disabled }: MedicoFormProps) {
  const action = mode === "crear" ? crearMedicoAction : editarMedicoAction;

  return (
    <div className="card p-4">
      <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear médico" : "Guardar cambios"} className="flex max-w-md flex-col gap-3">
        {mode === "editar" && medico ? (
          <>
            <input type="hidden" name="id" value={medico.id} />
            <input type="hidden" name="versionNombre" value={medico.nombre} />
            <input type="hidden" name="versionApellido" value={medico.apellido} />
            <input type="hidden" name="versionMatricula" value={medico.matricula} />
            <input type="hidden" name="versionEspecialidad" value={medico.especialidad ?? ""} />
            <input type="hidden" name="versionTelefono" value={medico.telefono ?? ""} />
            <input type="hidden" name="versionDireccionRegistrada" value={medico.direccionRegistrada ?? ""} />
          </>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre
          </label>
          <input id="nombre" name="nombre" defaultValue={medico?.nombre ?? ""} required disabled={disabled} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="apellido" className="text-sm font-medium">
            Apellido
          </label>
          <input id="apellido" name="apellido" defaultValue={medico?.apellido ?? ""} required disabled={disabled} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="matricula" className="text-sm font-medium">
            Matrícula
          </label>
          <input id="matricula" name="matricula" defaultValue={medico?.matricula ?? ""} required disabled={disabled} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="especialidad" className="text-sm font-medium">
            Especialidad
          </label>
          <input id="especialidad" name="especialidad" defaultValue={medico?.especialidad ?? ""} disabled={disabled} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="telefono" className="text-sm font-medium">
            Teléfono
          </label>
          <input id="telefono" name="telefono" defaultValue={medico?.telefono ?? ""} disabled={disabled} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="direccionRegistrada" className="text-sm font-medium">
            Dirección registrada
          </label>
          <input id="direccionRegistrada" name="direccionRegistrada" defaultValue={medico?.direccionRegistrada ?? ""} disabled={disabled} className="input" />
        </div>
      </SimpleForm>
    </div>
  );
}
