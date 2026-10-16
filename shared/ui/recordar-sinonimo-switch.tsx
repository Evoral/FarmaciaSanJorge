/**
 * The "recordar equivalencia" switch of every import that matches text to a droga (lista de precios, factura,
 * receta): on confirm, the imported text is saved as a synonym ("Otros nombres") of the droga the user picked, so
 * the next imports match it on their own (docs/specs/sinonimos-droga.md). The copy spells that out, because
 * "recordar como esta droga" alone does not say what is stored nor that it applies beyond this import.
 */
export function RecordarSinonimoSwitch({
  texto,
  drogaNombre,
  checked,
  onChange,
  disabled = false,
  className = "",
}: {
  /** The text as written on the imported document. */
  texto: string;
  /** The picked droga's name; without one the switch reads "la droga elegida". */
  drogaNombre?: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`toggle-switch min-h-0 items-start text-[0.8125rem] text-zinc-700 ${className}`}>
      <input type="checkbox" role="switch" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Guardar «{texto}» como otro nombre de {drogaNombre ? <strong className="font-medium">{drogaNombre}</strong> : "la droga elegida"}
        <span className="mt-0.5 block text-xs text-zinc-500">
          Las próximas listas, facturas y recetas que digan «{texto}» se van a asociar solas a esta droga. Apagalo si la
          asociación es solo por esta vez.
        </span>
      </span>
    </label>
  );
}
