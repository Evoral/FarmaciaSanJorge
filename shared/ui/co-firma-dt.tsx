/**
 * The "co-firma en el mismo acto" block: the Director Técnico who authorizes picks themselves and types THEIR OWN
 * password inside the same form (the action verifies it server-side before writing anything). Used by the stock
 * ajuste and the libro anulación/rectificativo forms. Submits `dtUsuarioId` and `dtPassword`. Presentational only.
 */
import { ShieldCheck } from "lucide-react";

export interface CoFirmaDtOpcion {
  id: string;
  label: string;
}

export interface CoFirmaDtProps {
  dts: readonly CoFirmaDtOpcion[];
  /** Suffix for the field ids when two forms share a page. */
  idSuffix?: string;
  /** The operator is themselves a vigente DT (they still type their own password). */
  operadorEsDt?: boolean;
}

export function CoFirmaDt({ dts, idSuffix = "", operadorEsDt = false }: CoFirmaDtProps) {
  const dtId = `dtUsuarioId${idSuffix}`;
  const passwordId = `dtPassword${idSuffix}`;
  return (
    <fieldset className="subpanel">
      <legend className="sr-only">Co-firma del Director Técnico</legend>
      <div className="mb-3 flex items-start gap-3">
        <span className="tone-tile" data-tone="success" aria-hidden>
          <ShieldCheck />
        </span>
        <div>
          <p className="text-sm font-medium text-zinc-900">Co-firma del Director Técnico</p>
          <p className="text-xs text-zinc-500">
            {operadorEsDt ? "Sos DT vigente: aun así, ingresá tu propia contraseña para autorizar." : "El DT que autoriza ingresa su contraseña en este mismo paso."}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor={dtId} className="field-label">
            Director Técnico
          </label>
          {/* A single vigente DT is the only possible answer: preselect them. */}
          <select id={dtId} name="dtUsuarioId" required defaultValue={dts.length === 1 ? dts[0]!.id : ""} className="input">
            <option value="">Seleccioná el DT que autoriza</option>
            {dts.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={passwordId} className="field-label">
            Contraseña del Director Técnico
          </label>
          <input id={passwordId} name="dtPassword" type="password" autoComplete="off" required className="input" />
        </div>
      </div>
    </fieldset>
  );
}
