"use client";

/** `/admin/parametros` per-parameter edit form (FASE 3 point 3.10b). */
import { editarParametroAction } from "./actions";
import { ReauthAwareForm } from "./reauth-aware-form";

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
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-base font-medium">{label}</h3>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{descripcion}</p>

      <ReauthAwareForm action={editarParametroAction} submitLabel="Guardar" pendingLabel="Guardando…" className="flex max-w-xs flex-col gap-2">
        <input type="hidden" name="clave" value={clave} />
        <label htmlFor={inputId} className="text-sm font-medium">
          Valor actual
        </label>
        <input
          id={inputId}
          name="valor"
          defaultValue={valor}
          required
          disabled={disabled}
          className="rounded border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </ReauthAwareForm>
    </div>
  );
}
