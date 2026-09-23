"use client";

/** Crear/editar droga form (FASE 4 point 4.2, DP-12). */
import { crearDrogaAction, editarDrogaAction } from "./actions";
import { SimpleForm } from "./simple-form";
import { TIPOS_CONTROL, TIPO_CONTROL_LABELS } from "@/modules/drogas/domain/droga";

export interface UnidadOpcion {
  id: string;
  nombre: string;
  simbolo: string;
}

export interface DrogaFormProps {
  mode: "crear" | "editar";
  unidades: UnidadOpcion[];
  droga?: {
    id: string;
    nombre: string;
    unidadBaseId: string;
    esControlada: boolean;
    tipoControl: string;
    stockMinimo: string;
    tienePartidas: boolean;
  };
  disabled: boolean;
}

export function DrogaForm({ mode, unidades, droga, disabled }: DrogaFormProps) {
  const action = mode === "crear" ? crearDrogaAction : editarDrogaAction;
  const clasificacionDisabled = disabled || (mode === "editar" && (droga?.tienePartidas ?? false));

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear droga" : "Guardar cambios"} className="flex max-w-md flex-col gap-3">
        {mode === "editar" && droga ? (
          <>
            <input type="hidden" name="id" value={droga.id} />
            <input type="hidden" name="versionNombre" value={droga.nombre} />
            <input type="hidden" name="versionUnidadBaseId" value={droga.unidadBaseId} />
            <input type="hidden" name="versionEsControlada" value={String(droga.esControlada)} />
            <input type="hidden" name="versionTipoControl" value={droga.tipoControl} />
            <input type="hidden" name="versionStockMinimo" value={droga.stockMinimo} />
          </>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="nombre" className="text-sm font-medium">
            Nombre
          </label>
          <input id="nombre" name="nombre" defaultValue={droga?.nombre ?? ""} required disabled={disabled} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="unidadBaseId" className="text-sm font-medium">
            Unidad base
          </label>
          <select
            id="unidadBaseId"
            name="unidadBaseId"
            defaultValue={droga?.unidadBaseId ?? ""}
            required
            disabled={clasificacionDisabled}
            className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="" disabled>
              Elegí una unidad
            </option>
            {unidades.map((unidad) => (
              <option key={unidad.id} value={unidad.id}>
                {unidad.nombre} ({unidad.simbolo})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <input id="esControlada" name="esControlada" type="checkbox" defaultChecked={droga?.esControlada ?? false} disabled={clasificacionDisabled} className="rounded border-zinc-300" />
          <label htmlFor="esControlada" className="text-sm font-medium">
            Es controlada (psicotrópico o estupefaciente)
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="tipoControl" className="text-sm font-medium">
            Tipo de control
          </label>
          <select
            id="tipoControl"
            name="tipoControl"
            defaultValue={droga?.tipoControl ?? "NINGUNO"}
            disabled={clasificacionDisabled}
            className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {TIPOS_CONTROL.map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_CONTROL_LABELS[tipo]}
              </option>
            ))}
          </select>
          {clasificacionDisabled && mode === "editar" ? (
            <p className="text-xs text-zinc-500">Esta droga ya tiene partidas: la unidad base, si es controlada y el tipo de control no se pueden modificar (DP-12).</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="stockMinimo" className="text-sm font-medium">
            Stock mínimo
          </label>
          <input id="stockMinimo" name="stockMinimo" defaultValue={droga?.stockMinimo ?? "0"} required disabled={disabled} inputMode="decimal" className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
      </SimpleForm>
    </div>
  );
}
