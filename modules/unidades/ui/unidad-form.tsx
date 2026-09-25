"use client";

/**
 * Crear/editar unidad de medida form (FASE 4 point 4.1). DP-39 RESUELTA:
 * this catalog is GLOBAL -- a create/edit here affects EVERY tenant, so a
 * warning banner is always shown (task's binding decision: "Show that
 * clearly in the UI before confirming").
 */
import { crearUnidadAction, editarUnidadAction } from "./actions";
import { SimpleForm } from "./simple-form";
import { TIPOS_MAGNITUD, TIPO_MAGNITUD_LABELS } from "@/modules/unidades/domain/unidad";

const GLOBAL_WARNING = "Esta acción afecta a TODAS las farmacias del sistema: las unidades de medida son un catálogo global compartido.";

export interface UnidadFormProps {
  mode: "crear" | "editar";
  unidad?: {
    id: string;
    codigo: string;
    nombre: string;
    simbolo: string;
    tipoMagnitud: string;
    factorABase: string;
    usada: boolean;
    /** m1 (review finding): TRUE cross-tenant count (fsj.contar_drogas_por_unidad, migration 0028) -- not just the `usada` boolean. */
    drogasQueLaUsan?: number;
  };
  disabled: boolean;
}

export function UnidadForm({ mode, unidad, disabled }: UnidadFormProps) {
  const action = mode === "crear" ? crearUnidadAction : editarUnidadAction;
  const classificacionDisabled = disabled || (mode === "editar" && (unidad?.usada ?? false));

  return (
    <div className="card p-4">
      <p role="note" className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {GLOBAL_WARNING}
      </p>

      <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear unidad" : "Guardar cambios"} className="flex max-w-md flex-col gap-3">
        {mode === "editar" && unidad ? (
          <>
            <input type="hidden" name="id" value={unidad.id} />
            <input type="hidden" name="versionCodigo" value={unidad.codigo} />
            <input type="hidden" name="versionNombre" value={unidad.nombre} />
            <input type="hidden" name="versionSimbolo" value={unidad.simbolo} />
            <input type="hidden" name="versionTipoMagnitud" value={unidad.tipoMagnitud} />
            <input type="hidden" name="versionFactorABase" value={unidad.factorABase} />
          </>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="codigo" className="text-sm font-medium">
            Código
          </label>
          <input id="codigo" name="codigo" defaultValue={unidad?.codigo ?? ""} required disabled={disabled} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre
          </label>
          <input id="nombre" name="nombre" defaultValue={unidad?.nombre ?? ""} required disabled={disabled} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="simbolo" className="text-sm font-medium">
            Símbolo
          </label>
          <input id="simbolo" name="simbolo" defaultValue={unidad?.simbolo ?? ""} required disabled={disabled} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="tipoMagnitud" className="text-sm font-medium">
            Magnitud
          </label>
          <select
            id="tipoMagnitud"
            name="tipoMagnitud"
            defaultValue={unidad?.tipoMagnitud ?? TIPOS_MAGNITUD[0]}
            disabled={classificacionDisabled}
            className="input"
          >
            {TIPOS_MAGNITUD.map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_MAGNITUD_LABELS[tipo]}
              </option>
            ))}
          </select>
          {classificacionDisabled && mode === "editar" ? (
            <p className="text-xs text-zinc-500">
              Ya fue usada por{" "}
              {unidad && unidad.drogasQueLaUsan !== undefined
                ? `${unidad.drogasQueLaUsan} droga${unidad.drogasQueLaUsan === 1 ? "" : "s"} (en todas las farmacias)`
                : "alguna droga"}
              : la magnitud y el factor no se pueden modificar (INV-M04).
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="factorABase" className="text-sm font-medium">
            Factor respecto de la unidad base
          </label>
          <input
            id="factorABase"
            name="factorABase"
            defaultValue={unidad?.factorABase ?? ""}
            required
            disabled={classificacionDisabled}
            inputMode="decimal"
            className="input"
          />
        </div>

        {mode === "crear" ? (
          <div className="flex items-center gap-2">
            <input id="esBase" name="esBase" type="checkbox" disabled={disabled} className="rounded border-zinc-300" />
            <label htmlFor="esBase" className="text-sm font-medium">
              Es la unidad base de su magnitud (factor 1)
            </label>
          </div>
        ) : null}
      </SimpleForm>
    </div>
  );
}
