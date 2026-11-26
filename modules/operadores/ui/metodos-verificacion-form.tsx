"use client";

/**
 * `/admin/configuracion/pin` (openspec/specs/cuentas-de-sector/spec.md): one switch per OPTIONAL verification method.
 * The PIN is always on and has no switch. On = an empleado can identify themselves with that method in a cuenta de
 * sector; off = the dialog does not offer it and the server rejects it. Credentials already enrolled are kept while a
 * method is off.
 *
 * Switch state is CONTROLLED (a `Set`), so neither React 19's form auto-reset nor a failed submit loses it. The form
 * submits the complete set of switches that are on.
 */
import { useState } from "react";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import type { MetodoConfigurable } from "../domain/metodos-verificacion";
import { configurarMetodosVerificacionAction } from "./actions";
import { METODOS_EN_DIALOGO } from "./metodos-en-dialogo";

export interface MetodosVerificacionFormProps {
  metodos: readonly MetodoConfigurable[];
  /** Read-only rendering (no `config.editar`). */
  disabled?: boolean;
}

export function MetodosVerificacionForm({ metodos, disabled = false }: MetodosVerificacionFormProps) {
  const [activos, setActivos] = useState<Set<string>>(() => new Set(metodos.filter((metodo) => metodo.habilitado).map((metodo) => metodo.metodo)));

  function cambiar(metodo: string, activo: boolean) {
    setActivos((previo) => {
      const siguiente = new Set(previo);
      if (activo) siguiente.add(metodo);
      else siguiente.delete(metodo);
      return siguiente;
    });
  }

  const campos = (
    <ul className="group-card flex flex-col divide-y divide-zinc-100">
      {metodos.map((metodo) => (
        <li key={metodo.metodo} className="px-3 py-1">
          <label className="toggle-switch w-full justify-between text-[0.8125rem] text-zinc-900">
            <span className="min-w-0">{metodo.etiqueta}</span>
            <input
              type="checkbox"
              role="switch"
              name="metodos"
              value={metodo.metodo}
              checked={activos.has(metodo.metodo)}
              disabled={disabled}
              onChange={(event) => cambiar(metodo.metodo, event.target.checked)}
              aria-label={metodo.etiqueta}
            />
          </label>
          {METODOS_EN_DIALOGO[metodo.metodo].notaDeConfiguracion ? (
            <p className="pb-2 text-[0.8125rem] leading-relaxed text-zinc-600">{METODOS_EN_DIALOGO[metodo.metodo].notaDeConfiguracion}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );

  if (disabled) return campos;

  return (
    <ReauthAwareForm action={configurarMetodosVerificacionAction} submitLabel="Guardar cambios" pendingLabel="Guardando…">
      {campos}
    </ReauthAwareForm>
  );
}
