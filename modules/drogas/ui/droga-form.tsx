"use client";

/**
 * Crear/editar droga form (FASE 4 point 4.2, DP-12). The page provides the
 * surrounding panel. "Clase" (migration 0063): on alta it follows the name's
 * suggestion (domain/sugerir-clase.ts) until the user picks one by hand;
 * on edición it is never changed for the user.
 */
import { useState } from "react";
import { crearDrogaAction, editarDrogaAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { CLASES_DROGA, CLASE_DROGA_LABELS, TIPOS_CONTROL, TIPO_CONTROL_LABELS, type ClaseDroga } from "@/modules/drogas/domain/droga";
import { sugerirClase, type SugerenciaClase } from "@/modules/drogas/domain/sugerir-clase";

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
    clase: string;
    stockMinimo: string;
    tienePartidas: boolean;
  };
  disabled: boolean;
}

export function DrogaForm({ mode, unidades, droga, disabled }: DrogaFormProps) {
  const action = mode === "crear" ? crearDrogaAction : editarDrogaAction;
  const clasificacionDisabled = disabled || (mode === "editar" && (droga?.tienePartidas ?? false));
  const [clase, setClase] = useState<ClaseDroga>((droga?.clase as ClaseDroga | undefined) ?? "DROGA");
  const [sugerencia, setSugerencia] = useState<SugerenciaClase | null>(null);
  const [claseElegida, setClaseElegida] = useState(mode === "editar");

  function onNombre(nombre: string) {
    if (claseElegida) return;
    const nueva = sugerirClase(nombre);
    setSugerencia(nueva);
    setClase(nueva?.clase ?? "DROGA");
  }

  return (
    <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear droga" : "Guardar cambios"}>
      {mode === "editar" && droga ? (
        <>
          <input type="hidden" name="id" value={droga.id} />
          <input type="hidden" name="versionNombre" value={droga.nombre} />
          <input type="hidden" name="versionUnidadBaseId" value={droga.unidadBaseId} />
          <input type="hidden" name="versionEsControlada" value={String(droga.esControlada)} />
          <input type="hidden" name="versionTipoControl" value={droga.tipoControl} />
          <input type="hidden" name="versionClase" value={droga.clase} />
          <input type="hidden" name="versionStockMinimo" value={droga.stockMinimo} />
        </>
      ) : null}

      <div className="field">
        <label htmlFor="nombre" className="field-label">
          Nombre
        </label>
        <input id="nombre" name="nombre" defaultValue={droga?.nombre ?? ""} required disabled={disabled} onChange={(e) => onNombre(e.target.value)} className="input" />
      </div>

      <div className="field sm:max-w-[50%]">
        <label htmlFor="clase" className="field-label">
          Clase
        </label>
        <select
          id="clase"
          name="clase"
          value={clase}
          disabled={disabled}
          onChange={(e) => {
            setClase(e.target.value as ClaseDroga);
            setClaseElegida(true);
          }}
          aria-describedby="clase-ayuda"
          className="input"
        >
          {CLASES_DROGA.map((c) => (
            <option key={c} value={c}>
              {CLASE_DROGA_LABELS[c]}
            </option>
          ))}
        </select>
        <p id="clase-ayuda" className="field-help">
          {!claseElegida && sugerencia ? `Sugerido por «${sugerencia.motivo}» en el nombre. ` : ""}
          Excipientes y materiales llevan stock y costo, pero no van al libro recetario ni pueden ser controlados.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="unidadBaseId" className="field-label">
            Unidad base
          </label>
          <select id="unidadBaseId" name="unidadBaseId" defaultValue={droga?.unidadBaseId ?? ""} required disabled={clasificacionDisabled} className="input">
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

        <div className="field">
          <label htmlFor="tipoControl" className="field-label">
            Tipo de control
          </label>
          <select id="tipoControl" name="tipoControl" defaultValue={droga?.tipoControl ?? "NINGUNO"} disabled={clasificacionDisabled} className="input">
            {TIPOS_CONTROL.map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_CONTROL_LABELS[tipo]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="field-help -mt-1">
        Unidad en la que se utiliza la droga en el laboratorio. El stock y el libro contralor se registran en esta unidad; las compras se convierten automáticamente,
        independientemente de la unidad indicada en la factura.
      </p>
      {clasificacionDisabled && mode === "editar" ? (
        <p className="field-help -mt-1">Esta droga ya tiene partidas: la unidad base y el tipo de control no se pueden modificar.</p>
      ) : null}

      <div className="field sm:max-w-[50%]">
        <label htmlFor="stockMinimo" className="field-label">
          Stock mínimo
        </label>
        <input id="stockMinimo" name="stockMinimo" defaultValue={droga?.stockMinimo ?? "0"} required disabled={disabled} inputMode="decimal" className="input font-mono" />
      </div>
    </SimpleForm>
  );
}
