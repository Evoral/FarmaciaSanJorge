"use client";

/**
 * One etiqueta measure typed in mm (label ancho/alto, sheet ancho/alto/margen),
 * with the live equivalent in cm under it so a user who thinks in cm can check
 * what they typed ("100" -> "= 10 cm"). The input stays uncontrolled (the form
 * keeps what was typed on an error); the preview only reads it.
 */
import { useState } from "react";
import { Decimal } from "decimal.js";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";

export interface MedidaMmFieldProps {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  disabled: boolean;
}

/** "100" -> "10 cm", "42,5" -> "4,25 cm"; `null` while the text is not a number. */
export function equivalenteEnCm(texto: string): string | null {
  const numero = interpretarNumero(texto);
  if (!numero.ok) return null;
  return `${new Decimal(numero.valor).div(10).toString().replace(".", ",")} cm`;
}

export function MedidaMmField({ id, name, label, defaultValue, disabled }: MedidaMmFieldProps) {
  const [valor, setValor] = useState(defaultValue);
  const cm = equivalenteEnCm(valor);

  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue}
        onChange={(event) => setValor(event.target.value)}
        required
        disabled={disabled}
        inputMode="decimal"
        aria-describedby={`${id}-cm`}
        className="input font-mono"
      />
      <p id={`${id}-cm`} className="field-help font-mono tabular-nums" aria-live="polite">
        {cm ? `= ${cm}` : " "}
      </p>
    </div>
  );
}
