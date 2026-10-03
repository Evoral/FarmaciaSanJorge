"use client";

/**
 * Shared shell of the receta form's paciente/médico pickers: an
 * autocomplete over the entity's search Server Action, plus an inline quick
 * create (each picker brings its own form) opened from the autocomplete's
 * "Crear ..." row or the link under it. What was typed prefills the create
 * form, so a miss never means typing the name twice.
 */
import { UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";

export interface PersonaPickerProps {
  id: string;
  /** "Paciente", "Médico". */
  label: string;
  /** Lowercase entity name for the create texts: "paciente", "médico". */
  entidad: string;
  placeholder: string;
  search: (query: string) => Promise<readonly ComboboxOption[]>;
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, label: string) => void;
  disabled?: boolean;
  /** The quick-create form; `prefill` is what was typed in the search. */
  renderCrear: (args: { prefill: string; cerrar: () => void }) => ReactNode;
}

export function PersonaPicker({ id, label, entidad, placeholder, search, selectedId, selectedLabel, onSelect, disabled, renderCrear }: PersonaPickerProps) {
  // `n` remounts the create form, so a new "Crear ..." always starts from its own prefill.
  const [crear, setCrear] = useState<{ prefill: string; n: number } | null>(null);
  const abrirCrear = (prefill: string) => setCrear((actual) => ({ prefill, n: (actual?.n ?? 0) + 1 }));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Combobox
        id={id}
        label={label}
        placeholder={placeholder}
        search={search}
        value={selectedId ? { value: selectedId, label: selectedLabel } : null}
        onChange={(option) => {
          onSelect(option?.value ?? "", option?.label ?? "");
          if (option) setCrear(null);
        }}
        disabled={disabled}
        actionOption={{ label: (q) => (q ? `Crear ${entidad} “${q}”` : `Crear ${entidad} nuevo`), onSelect: abrirCrear }}
      />
      {crear ? (
        <fieldset key={crear.n} className="subpanel" disabled={disabled}>
          <legend className="sr-only">Crear {entidad}</legend>
          {renderCrear({ prefill: crear.prefill, cerrar: () => setCrear(null) })}
        </fieldset>
      ) : !selectedId && !disabled ? (
        <button type="button" className="link-button" onClick={() => abrirCrear("")}>
          <UserPlus className="size-3.5" aria-hidden />
          ¿No está? Crear {entidad} nuevo
        </button>
      ) : null}
    </div>
  );
}

/** Splits what was typed in the search for the create form: digits are a document/matrícula, anything else an apellido. */
export function separarPrefill(prefill: string): { apellido: string; numero: string } {
  const limpio = prefill.trim();
  return /^\d[\d.\s-]*$/.test(limpio) ? { apellido: "", numero: limpio.replace(/\D/g, "") } : { apellido: limpio, numero: "" };
}
