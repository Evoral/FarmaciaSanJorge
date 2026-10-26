/**
 * The tipo de vencimiento of one ítem, chosen where it is confirmed (openspec/specs/vencimiento-preparado/spec.md R10): starts on
 * `ESTANDAR`. Uncontrolled, so `ReauthAwareForm` keeps the choice when the server refuses the confirmation.
 */
import { etiquetaTipoVencimiento, TIPOS_VENCIMIENTO_PREPARADO, TIPO_VENCIMIENTO_DEFAULT } from "@/modules/preparaciones/domain/vencimiento";

export interface TipoVencimientoSelectProps {
  id: string;
  name: string;
  label: string;
  /** `meses_vencimiento_preparado`, shown in the `ESTANDAR` option. */
  mesesEstandar: number;
}

export function TipoVencimientoSelect({ id, name, label, mesesEstandar }: TipoVencimientoSelectProps) {
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <select id={id} name={name} defaultValue={TIPO_VENCIMIENTO_DEFAULT} className="input">
        {TIPOS_VENCIMIENTO_PREPARADO.map((tipo) => (
          <option key={tipo} value={tipo}>
            {etiquetaTipoVencimiento(tipo, mesesEstandar)}
          </option>
        ))}
      </select>
    </div>
  );
}
