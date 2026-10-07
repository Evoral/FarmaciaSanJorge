"use client";

/**
 * Labeled `desde`/`hasta` pair of `DateInput`s for GET filter forms.
 *
 * The `hasta` field stays hidden until `desde` has a value: most searches
 * are "from this day on", and an empty second field is noise. It is still
 * shown when it already carries a value (e.g. a shared URL with only
 * `hasta`), so an active filter is never invisible.
 */
import { useState } from "react";
import { DateInput } from "./date-input";

export interface DateRangeFieldProps {
  /** Base id for the group label; each input uses its field name as id. */
  id: string;
  label: string;
  desdeName: string;
  hastaName: string;
  desdeDefault?: string;
  hastaDefault?: string;
}

export function DateRangeField({ id, label, desdeName, hastaName, desdeDefault = "", hastaDefault = "" }: DateRangeFieldProps) {
  const [desde, setDesde] = useState(desdeDefault);
  const [hasta, setHasta] = useState(hastaDefault);
  // Re-sync when the server hands new defaults on a soft navigation (chip removal, "Limpiar filtros").
  const [seen, setSeen] = useState({ desdeDefault, hastaDefault });
  if (seen.desdeDefault !== desdeDefault || seen.hastaDefault !== hastaDefault) {
    setSeen({ desdeDefault, hastaDefault });
    setDesde(desdeDefault);
    setHasta(hastaDefault);
  }

  const showHasta = desde !== "" || hasta !== "";
  const labelId = `${id}-label`;

  return (
    <div className="field">
      <span id={labelId} className="field-label">
        {label}
      </span>
      <div className="range-field" role="group" aria-labelledby={labelId}>
        <label htmlFor={desdeName} className="sr-only">
          {label} desde
        </label>
        <DateInput id={desdeName} name={desdeName} defaultValue={desdeDefault} onValueChange={setDesde} />
        {showHasta ? (
          <>
            <span className="range-field-sep" aria-hidden>
              a
            </span>
            <label htmlFor={hastaName} className="sr-only">
              {label} hasta
            </label>
            <DateInput id={hastaName} name={hastaName} defaultValue={hastaDefault} onValueChange={setHasta} />
          </>
        ) : null}
      </div>
    </div>
  );
}
