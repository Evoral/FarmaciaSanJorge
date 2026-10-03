"use client";

/**
 * Crear/editar unidad de medida form (FASE 4 point 4.1). DP-39 RESUELTA:
 * this catalog is GLOBAL -- a create/edit here affects EVERY tenant, so a
 * warning banner is always shown (task's binding decision: "Show that
 * clearly in the UI before confirming"). The page provides the surrounding panel.
 */
import { Globe } from "lucide-react";
import { crearUnidadAction, editarUnidadAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
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
    <div className="flex flex-col gap-4">
      <div role="note" className="alert alert-warn">
        <Globe aria-hidden />
        <p>{GLOBAL_WARNING}</p>
      </div>

      <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear unidad" : "Guardar cambios"}>
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

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          <div className="field">
            <label htmlFor="codigo" className="field-label">
              Código
            </label>
            <input id="codigo" name="codigo" defaultValue={unidad?.codigo ?? ""} required disabled={disabled} className="input font-mono" />
          </div>
          <div className="field">
            <label htmlFor="nombre" className="field-label">
              Nombre
            </label>
            <input id="nombre" name="nombre" defaultValue={unidad?.nombre ?? ""} required disabled={disabled} className="input" />
          </div>
          <div className="field">
            <label htmlFor="simbolo" className="field-label">
              Símbolo
            </label>
            <input id="simbolo" name="simbolo" defaultValue={unidad?.simbolo ?? ""} required disabled={disabled} className="input font-mono" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="tipoMagnitud" className="field-label">
              Magnitud
            </label>
            <select id="tipoMagnitud" name="tipoMagnitud" defaultValue={unidad?.tipoMagnitud ?? TIPOS_MAGNITUD[0]} disabled={classificacionDisabled} className="input">
              {TIPOS_MAGNITUD.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {TIPO_MAGNITUD_LABELS[tipo]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="factorABase" className="field-label">
              Factor respecto de la unidad base
            </label>
            <input id="factorABase" name="factorABase" defaultValue={unidad?.factorABase ?? ""} required disabled={classificacionDisabled} inputMode="decimal" className="input font-mono" />
          </div>
        </div>
        {classificacionDisabled && mode === "editar" ? (
          <p className="field-help -mt-1">
            Ya fue usada por{" "}
            {unidad && unidad.drogasQueLaUsan !== undefined ? `${unidad.drogasQueLaUsan} droga${unidad.drogasQueLaUsan === 1 ? "" : "s"} (en todas las farmacias)` : "alguna droga"}: la magnitud y el factor
            no se pueden modificar.
          </p>
        ) : null}

        {mode === "crear" ? (
          <label htmlFor="esBase" className="flex items-center gap-2 text-sm text-zinc-800">
            <input id="esBase" name="esBase" type="checkbox" disabled={disabled} />
            Es la unidad base de su magnitud (factor 1)
          </label>
        ) : null}
      </SimpleForm>
    </div>
  );
}
