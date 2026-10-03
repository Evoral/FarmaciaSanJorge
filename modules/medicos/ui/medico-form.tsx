"use client";

/** Crear/editar médico form (FASE 4 point 4.4). The page provides the surrounding panel. */
import { crearMedicoAction, editarMedicoAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { JURISDICCIONES_MATRICULA, JURISDICCION_MATRICULA_LABELS } from "../domain/medico";
import type { JurisdiccionMatricula } from "../domain/medico";

export interface MedicoFormProps {
  mode: "crear" | "editar";
  medico?: {
    id: string;
    nombre: string;
    apellido: string;
    matricula: string;
    matriculaJurisdiccion: JurisdiccionMatricula;
    especialidad: string | null;
    telefono: string | null;
    direccionRegistrada: string | null;
  };
  disabled: boolean;
}

export function MedicoForm({ mode, medico, disabled }: MedicoFormProps) {
  const action = mode === "crear" ? crearMedicoAction : editarMedicoAction;

  return (
    <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear médico" : "Guardar cambios"}>
      {mode === "editar" && medico ? (
        <>
          <input type="hidden" name="id" value={medico.id} />
          <input type="hidden" name="versionNombre" value={medico.nombre} />
          <input type="hidden" name="versionApellido" value={medico.apellido} />
          <input type="hidden" name="versionMatricula" value={medico.matricula} />
          <input type="hidden" name="versionMatriculaJurisdiccion" value={medico.matriculaJurisdiccion} />
          <input type="hidden" name="versionEspecialidad" value={medico.especialidad ?? ""} />
          <input type="hidden" name="versionTelefono" value={medico.telefono ?? ""} />
          <input type="hidden" name="versionDireccionRegistrada" value={medico.direccionRegistrada ?? ""} />
        </>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="nombre" className="field-label">
            Nombre
          </label>
          <input id="nombre" name="nombre" defaultValue={medico?.nombre ?? ""} required disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="apellido" className="field-label">
            Apellido
          </label>
          <input id="apellido" name="apellido" defaultValue={medico?.apellido ?? ""} required disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="matricula" className="field-label">
            Matrícula
          </label>
          <input id="matricula" name="matricula" defaultValue={medico?.matricula ?? ""} required disabled={disabled} className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="matriculaJurisdiccion" className="field-label">
            Jurisdicción de la matrícula
          </label>
          <select id="matriculaJurisdiccion" name="matriculaJurisdiccion" defaultValue={medico?.matriculaJurisdiccion ?? "PROVINCIAL"} required disabled={disabled} className="input">
            {JURISDICCIONES_MATRICULA.map((j) => (
              <option key={j} value={j}>
                {JURISDICCION_MATRICULA_LABELS[j]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="especialidad" className="field-label">
            Especialidad
          </label>
          <input id="especialidad" name="especialidad" defaultValue={medico?.especialidad ?? ""} disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="telefono" className="field-label">
            Teléfono
          </label>
          <input id="telefono" name="telefono" type="tel" defaultValue={medico?.telefono ?? ""} disabled={disabled} className="input" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="direccionRegistrada" className="field-label">
          Dirección registrada
        </label>
        <input id="direccionRegistrada" name="direccionRegistrada" defaultValue={medico?.direccionRegistrada ?? ""} disabled={disabled} className="input" />
      </div>
    </SimpleForm>
  );
}
