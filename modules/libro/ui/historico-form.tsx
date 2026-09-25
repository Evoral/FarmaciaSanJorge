"use client";

/** `/libro/historico` digitalización form (FASE 9, M12 point 9.5, DT only). */
import { crearAsientoHistoricoAction } from "./actions";
import { SimpleForm } from "./simple-form";

const TIPOS = [
  { value: "RECETARIO", label: "Recetario" },
  { value: "PSICOTROPICO", label: "Psicotrópicos" },
  { value: "ESTUPEFACIENTE", label: "Estupefacientes" },
] as const;

export function HistoricoForm() {
  return (
    <SimpleForm action={crearAsientoHistoricoAction} submitLabel="Digitalizar asiento" className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="tipoLibro" className="text-sm font-medium">
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

      <div className="flex flex-col gap-1">
        <label htmlFor="numeroAsientoFisico" className="text-sm font-medium">
          Número de asiento (libro físico)
        </label>
        <input id="numeroAsientoFisico" name="numeroAsientoFisico" type="text" required className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="fechaAsiento" className="text-sm font-medium">
          Fecha del asiento
        </label>
        <input id="fechaAsiento" name="fechaAsiento" type="date" required className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pacienteTexto" className="text-sm font-medium">
          Paciente (si figura)
        </label>
        <input id="pacienteTexto" name="pacienteTexto" type="text" className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="medicoTexto" className="text-sm font-medium">
          Médico (si figura)
        </label>
        <input id="medicoTexto" name="medicoTexto" type="text" className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="formulaTexto" className="text-sm font-medium">
          Fórmula
        </label>
        <textarea id="formulaTexto" name="formulaTexto" required rows={2} className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="observaciones" className="text-sm font-medium">
          Observaciones
        </label>
        <textarea id="observaciones" name="observaciones" rows={2} className="input" />
      </div>
    </SimpleForm>
  );
}
