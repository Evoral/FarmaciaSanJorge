"use client";

/**
 * `/libro/numeracion` form (migration 0097). Rendered only for a libro whose numbering is not fixed yet and a session
 * holding `libro.anulacion.autorizar` (the DT). Previews where the asientos already registered will land; the DT's
 * own re-auth is handled by `ReauthAwareForm`.
 */
import { useState } from "react";
import { configurarNumeracionLibroAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { parseNumeroInicial, rangoRenumerado } from "../domain/numeracion";

export interface ConfigurarNumeracionFormProps {
  libroId: string;
  numeroInicial: string;
  cantidadAsientos: number;
  primerNumero: string | null;
  ultimoNumero: string | null;
}

export function ConfigurarNumeracionForm({ libroId, numeroInicial, cantidadAsientos, primerNumero, ultimoNumero }: ConfigurarNumeracionFormProps) {
  const [valor, setValor] = useState(numeroInicial);
  const nuevo = parseNumeroInicial(valor);
  const rango = nuevo !== null && primerNumero !== null && ultimoNumero !== null ? rangoRenumerado({ actual: numeroInicial, nuevo, primero: primerNumero, ultimo: ultimoNumero }) : null;
  const inputId = `numeroInicial-${libroId}`;

  return (
    <ReauthAwareForm action={configurarNumeracionLibroAction} submitLabel="Guardar numeración" pendingLabel="Guardando…" submitVariant="primary">
      <input type="hidden" name="libroId" value={libroId} />
      <div className="field">
        <label htmlFor={inputId} className="field-label">
          Número del primer asiento
        </label>
        <input
          id={inputId}
          name="numeroInicial"
          inputMode="numeric"
          required
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          aria-describedby={`${inputId}-ayuda`}
          className="input max-w-[12rem] font-mono tabular-nums"
        />
        <p id={`${inputId}-ayuda`} className="field-help">
          1 para empezar el libro de cero. Para continuar el libro físico, el número siguiente a su último asiento.
          {rango && nuevo !== BigInt(numeroInicial)
            ? cantidadAsientos === 1
              ? ` El asiento ya registrado pasará a ser el Nº ${rango.desde}.`
              : ` Los ${cantidadAsientos} asientos ya registrados pasarán a ser del Nº ${rango.desde} al Nº ${rango.hasta}.`
            : null}
          {rango && nuevo !== BigInt(numeroInicial) ? " Las etiquetas ya impresas conservan el número anterior; si las reimprimís, salen con el nuevo." : null}
        </p>
      </div>
    </ReauthAwareForm>
  );
}
