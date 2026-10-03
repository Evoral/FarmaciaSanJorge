"use client";

/** `/libro/historico` digitalización form (FASE 9, M12 point 9.5, DT only). Paciente/médico are transcribed as printed in the physical book (free text, not a pick). */
import { crearAsientoHistoricoAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";

const TIPOS = [
  { value: "RECETARIO", label: "Recetario" },
  { value: "PSICOTROPICO", label: "Psicotrópicos" },
  { value: "ESTUPEFACIENTE", label: "Estupefacientes" },
] as const;

export function HistoricoForm() {
  return (
    <SimpleForm action={crearAsientoHistoricoAction} submitLabel="Digitalizar asiento">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="tipoLibro" className="field-label">
            Libro
          </label>
          <select id="tipoLibro" name="tipoLibro" required className="input">
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="numeroAsientoFisico" className="field-label">
            Nº de asiento (libro físico)
          </label>
          <input id="numeroAsientoFisico" name="numeroAsientoFisico" type="text" required className="input font-mono" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="fechaAsiento" className="field-label">
          Fecha del asiento
        </label>
        <DateInput id="fechaAsiento" name="fechaAsiento" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="pacienteTexto" className="field-label">
            Paciente (si figura)
          </label>
          <input id="pacienteTexto" name="pacienteTexto" type="text" className="input" />
        </div>
        <div className="field">
          <label htmlFor="medicoTexto" className="field-label">
            Médico (si figura)
          </label>
          <input id="medicoTexto" name="medicoTexto" type="text" className="input" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="formulaTexto" className="field-label">
          Fórmula
        </label>
        <textarea id="formulaTexto" name="formulaTexto" required rows={3} className="input font-mono" />
      </div>

      <div className="field">
        <label htmlFor="observaciones" className="field-label">
          Observaciones
        </label>
        <textarea id="observaciones" name="observaciones" rows={2} className="input" />
      </div>
    </SimpleForm>
  );
}
