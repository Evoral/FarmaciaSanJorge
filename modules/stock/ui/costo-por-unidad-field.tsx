"use client";

/**
 * The "costo unitario nuevo" of a costo correction, typed per a unit of the
 * user's choice (the price of a kg, as on the invoice) instead of per the
 * droga's unidad base. Submits `costoUnitarioNuevo` + `unidadId`;
 * `corregirCostoPartida` converts with `fsj.convertir`. The line under the
 * inputs previews the stored value per unidad base with the catalog's
 * factors, so a price typed in the wrong unit is visible before saving.
 */
import { useId, useState } from "react";
import { NumeroInput } from "@/shared/ui/numero-input";
import { interpretarNumero, numeroParaInput } from "@/shared/decimal/numero-ingresado";
import { dec } from "@/shared/decimal";
import { formatearCostoUnitario } from "@/shared/format/monto";

export interface UnidadCosto {
  id: string;
  simbolo: string;
  /** Factor to the magnitude's base unit (fsj.unidad_medida.factor_a_base). */
  factorABase: string;
}

export interface CostoPorUnidadFieldProps {
  /** Units of the droga's magnitude, vigentes. Must include the unidad base. */
  unidades: readonly UnidadCosto[];
  unidadBaseId: string;
  /** Current costo per unidad base, shown as the starting value. */
  costoActual: string;
}

export function CostoPorUnidadField({ unidades, unidadBaseId, costoActual }: CostoPorUnidadFieldProps) {
  const id = useId();
  const [costo, setCosto] = useState(numeroParaInput(costoActual));
  const [unidadId, setUnidadId] = useState(unidadBaseId);

  const base = unidades.find((u) => u.id === unidadBaseId);
  const elegida = unidades.find((u) => u.id === unidadId);
  const simboloBase = base?.simbolo ?? "";

  let previa: string | null = null;
  const numero = interpretarNumero(costo);
  if (numero.ok && elegida && base && unidadId !== unidadBaseId) {
    const factor = dec(elegida.factorABase).dividedBy(dec(base.factorABase));
    if (!factor.isZero()) previa = formatearCostoUnitario(dec(numero.valor).dividedBy(factor).toDecimalPlaces(6).toString());
  }

  return (
    <div className="field">
      <label htmlFor={`${id}-costo`} className="field-label">
        Costo unitario nuevo
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <NumeroInput
          id={`${id}-costo`}
          name="costoUnitarioNuevo"
          value={costo}
          onValueChange={setCosto}
          required
          aria-describedby={`${id}-ayuda`}
          className="input font-mono min-w-0"
        />
        <select
          name="unidadId"
          aria-label="Unidad del costo"
          value={unidadId}
          onChange={(e) => setUnidadId(e.target.value)}
          className="input"
        >
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              $ / {u.simbolo}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-ayuda`} className="field-help">
        Actual: <span className="font-mono">$ {formatearCostoUnitario(costoActual)} / {simboloBase}</span>
        {previa !== null ? (
          <>
            {" "}
            · Se guarda: <span className="font-mono font-medium">$ {previa} / {simboloBase}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
