"use client";

/**
 * "Otros nombres" of a droga (docs/specs/sinonimos-droga.md): its vigente
 * synonyms, each removable, plus a one-field form to add another. Both go
 * through `SimpleForm`, so a rejected name stays typed and its field is
 * marked (e.g. «Vaselina» ya es el nombre de otra droga). The page renders
 * the surrounding panel and decides `editable` (permiso + droga vigente).
 */
import { useId } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { agregarSinonimoAction, quitarSinonimoAction } from "./actions";
import { SINONIMO_MAX_LARGO } from "../domain/sinonimo";

export interface SinonimosDrogaProps {
  drogaId: string;
  drogaNombre: string;
  sinonimos: readonly { id: string; texto: string }[];
  editable: boolean;
}

export function SinonimosDroga({ drogaId, drogaNombre, sinonimos, editable }: SinonimosDrogaProps) {
  const inputId = useId();

  return (
    <div className="flex flex-col gap-4">
      {sinonimos.length === 0 ? (
        <p className="text-[0.8125rem] text-zinc-500">Sin otros nombres.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100" aria-label={`Otros nombres de ${drogaNombre}`}>
          {sinonimos.map((sinonimo) => (
            <li key={sinonimo.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-[0.8125rem] text-zinc-800">{sinonimo.texto}</span>
              {editable ? (
                <SimpleForm action={quitarSinonimoAction} submitLabel="Quitar" pendingLabel="Quitando…" submitVariant="secondary" submitSize="sm" layout="inline">
                  <input type="hidden" name="id" value={sinonimo.id} />
                </SimpleForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <SimpleForm action={agregarSinonimoAction} submitLabel="Agregar nombre" pendingLabel="Agregando…" submitVariant="secondary">
          <input type="hidden" name="drogaId" value={drogaId} />
          <div className="field">
            <label htmlFor={inputId} className="field-label">
              Otro nombre
            </label>
            <input id={inputId} name="sinonimo" required maxLength={SINONIMO_MAX_LARGO} autoComplete="off" className="input" aria-describedby={`${inputId}-ayuda`} />
            <p id={`${inputId}-ayuda`} className="field-help">
              Por ejemplo, como figura en recetas o facturas. Buscando ese nombre se encuentra esta droga, pero recetas, libros y etiquetas usan siempre «{drogaNombre}».
            </p>
          </div>
        </SimpleForm>
      ) : null}
    </div>
  );
}
