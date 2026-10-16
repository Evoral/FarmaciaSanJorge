"use client";

/**
 * `/admin/configuracion/pin` (docs/specs/cuentas-de-sector.md): one switch
 * per configurable acción, grouped by module like the role editor
 * (modules/usuarios/ui/rol-form.tsx). On = in a cuenta de sector, that
 * acción asks for the PIN of the empleado performing it and is registered
 * under their name; off = it is registered under the cuenta de sector.
 *
 * Switch state is CONTROLLED (a `Set`), so neither React 19's form
 * auto-reset nor a failed submit loses it. The form submits the complete
 * set of switches that are on.
 */
import { useMemo, useState } from "react";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { etiquetaGrupoPermiso, grupoDePermiso } from "@/modules/usuarios/domain/roles";
import type { AccionConPin } from "../domain/acciones-con-pin";
import { configurarAccionesConPinAction } from "./actions";

export interface AccionesConPinFormProps {
  acciones: readonly AccionConPin[];
  /** Read-only rendering (no `config.editar`). */
  disabled?: boolean;
}

export function AccionesConPinForm({ acciones, disabled = false }: AccionesConPinFormProps) {
  const [conPin, setConPin] = useState<Set<string>>(() => new Set(acciones.filter((accion) => accion.pidePin).map((accion) => accion.codigo)));

  const grupos = useMemo(() => {
    const porGrupo = new Map<string, AccionConPin[]>();
    for (const accion of acciones) {
      const grupo = grupoDePermiso(accion.codigo);
      porGrupo.set(grupo, [...(porGrupo.get(grupo) ?? []), accion]);
    }
    return [...porGrupo.entries()].map(([grupo, items]) => ({ grupo, etiqueta: etiquetaGrupoPermiso(grupo), items }));
  }, [acciones]);

  function cambiar(codigo: string, activo: boolean) {
    setConPin((previo) => {
      const siguiente = new Set(previo);
      if (activo) siguiente.add(codigo);
      else siguiente.delete(codigo);
      return siguiente;
    });
  }

  const campos = (
    <div className="grid gap-3 lg:grid-cols-2">
      {grupos.map((grupo) => (
        <div key={grupo.grupo} className="group-card">
          <div className="group-card-header justify-between">
            <h3 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-zinc-900">
              {grupo.etiqueta}
              <span className="font-mono text-xs font-normal tabular-nums text-zinc-500" title="Acciones que piden PIN">
                {grupo.items.filter((accion) => conPin.has(accion.codigo)).length}/{grupo.items.length}
              </span>
            </h3>
          </div>
          <ul className="flex flex-col divide-y divide-zinc-100">
            {grupo.items.map((accion) => (
              <li key={accion.codigo} className="px-3 py-1">
                <label className="toggle-switch w-full justify-between text-[0.8125rem] text-zinc-900">
                  <span className="min-w-0">{accion.descripcion}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    name="acciones"
                    value={accion.codigo}
                    checked={conPin.has(accion.codigo)}
                    disabled={disabled}
                    onChange={(event) => cambiar(accion.codigo, event.target.checked)}
                    aria-label={`${accion.descripcion}: pide PIN`}
                  />
                </label>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );

  if (disabled) return campos;

  return (
    <ReauthAwareForm action={configurarAccionesConPinAction} submitLabel="Guardar cambios" pendingLabel="Guardando…">
      {campos}
    </ReauthAwareForm>
  );
}
