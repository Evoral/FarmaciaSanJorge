"use client";

/** `/admin/configuracion/parametros` per-parameter edit form (FASE 3 point 3.10b), one panel per parameter. */
import { editarParametroAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";

export interface ParametroFormProps {
  clave: string;
  label: string;
  descripcion: string;
  valor: string;
  disabled: boolean;
}

export function ParametroForm({ clave, label, descripcion, valor, disabled }: ParametroFormProps) {
  const inputId = `parametro-valor-${clave}`;

  return (
    <section className="panel" aria-labelledby={`${inputId}-titulo`}>
      <div className="panel-header">
        <h3 id={`${inputId}-titulo`} className="text-[0.9375rem] font-semibold">
          {label}
        </h3>
        <p className="mt-0.5 text-[0.8125rem] text-zinc-500">{descripcion}</p>
      </div>
      <div className="panel-body">
        <ReauthAwareForm action={editarParametroAction} submitLabel="Guardar" pendingLabel="Guardando…" className="max-w-xs">
          <input type="hidden" name="clave" value={clave} />
          <div className="field">
            <label htmlFor={inputId} className="field-label">
              Valor actual
            </label>
            <input id={inputId} name="valor" defaultValue={valor} required disabled={disabled} className="input font-mono" />
          </div>
        </ReauthAwareForm>
      </div>
    </section>
  );
}
