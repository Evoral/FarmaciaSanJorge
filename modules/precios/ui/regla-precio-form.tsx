"use client";

/**
 * `/admin/configuracion/precios`'s "nueva versión" form (ADM/DT,
 * `precios.reglas.editar`): precio mínimo + a dynamic list of margin tramos
 * by cost (docs/specs/reglas-precio.md). The last row is always "sin tope"
 * (submitted as an empty `tramoCostoHasta`); rows are added before it.
 * Starts from the vigente rules; the page remounts it (React `key`) after a
 * new version is saved. Validation lives server-side (the use case runs the
 * pure `validarReglasPrecio`); its message is shown by `SimpleForm`.
 */
import { useState } from "react";
import { guardarReglaPrecioAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";

export interface ReglaPrecioFormProps {
  vigente: { precioMinimo: string; tramos: { costoHasta: string | null; margen: string }[] } | null;
}

interface FilaTramo {
  key: number;
  costoHasta: string;
  margen: string;
}

export function ReglaPrecioForm({ vigente }: ReglaPrecioFormProps) {
  const [precioMinimo, setPrecioMinimo] = useState(vigente?.precioMinimo ?? "0");
  const [filas, setFilas] = useState<FilaTramo[]>(() =>
    vigente && vigente.tramos.length > 0
      ? vigente.tramos.map((t, i) => ({ key: i, costoHasta: t.costoHasta ?? "", margen: t.margen }))
      : [{ key: 0, costoHasta: "", margen: "" }],
  );

  const actualizar = (key: number, cambios: Partial<Omit<FilaTramo, "key">>) => setFilas((actuales) => actuales.map((f) => (f.key === key ? { ...f, ...cambios } : f)));
  const quitar = (key: number) => setFilas((actuales) => (actuales.length > 1 ? actuales.filter((f) => f.key !== key) : actuales));
  /** Inserts a row just before the open-ended last one. */
  const agregar = () =>
    setFilas((actuales) => {
      const key = Math.max(...actuales.map((f) => f.key)) + 1;
      return [...actuales.slice(0, -1), { key, costoHasta: "", margen: "" }, actuales[actuales.length - 1]!];
    });

  return (
    <div className="card p-4">
      <h2 className="mb-1 text-base font-semibold">{vigente === null ? "Configurar reglas de precio" : "Nueva versión de las reglas de precio"}</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Cada preparación se cotiza sola: su costo de insumos cae en un tramo y se le suma el margen de ese tramo sobre <strong>todo</strong> el costo (no es escalonado). Si el resultado
        queda por debajo del precio mínimo, se cobra el precio mínimo. Un costo igual al tope de un tramo pertenece a ese tramo. Guardar acá NO modifica la regla actual: cierra la
        vigente y crea una versión nueva -- las cotizaciones ya calculadas mantienen la regla con la que se calcularon.
      </p>
      <SimpleForm action={guardarReglaPrecioAction} submitLabel="Guardar nueva versión" className="max-w-2xl">
        <div className="flex max-w-xs flex-col gap-1">
          <label htmlFor="precioMinimo" className="text-sm font-medium">
            Precio mínimo ($)
          </label>
          <input
            id="precioMinimo"
            name="precioMinimo"
            type="text"
            inputMode="decimal"
            required
            placeholder="Ej: 20000"
            className="input"
            value={precioMinimo}
            onChange={(e) => setPrecioMinimo(e.target.value)}
          />
          <p className="text-xs text-zinc-500">0 = sin precio mínimo.</p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Tramos de margen por costo de la preparación</legend>
          {filas.map((fila, i) => {
            const esUltima = i === filas.length - 1;
            const desde = i === 0 ? null : filas[i - 1]!.costoHasta.trim();
            const rango = i === 0 ? "Desde $0" : `Más de $${desde || "…"}`;
            return (
              <div key={fila.key} className="flex flex-wrap items-end gap-2">
                <span className="w-32 pb-2 text-sm text-zinc-600 dark:text-zinc-400">{rango}</span>
                {esUltima ? (
                  <>
                    <input type="hidden" name="tramoCostoHasta" value="" />
                    <span className="w-40 pb-2 text-sm text-zinc-600 dark:text-zinc-400">sin tope</span>
                  </>
                ) : (
                  <div className="flex w-40 flex-col gap-1">
                    <label htmlFor={`tramoCostoHasta-${fila.key}`} className="text-xs font-medium">
                      Hasta ($, inclusive)
                    </label>
                    <input
                      id={`tramoCostoHasta-${fila.key}`}
                      name="tramoCostoHasta"
                      type="text"
                      inputMode="decimal"
                      required
                      placeholder="Ej: 100000"
                      className="input"
                      value={fila.costoHasta}
                      onChange={(e) => actualizar(fila.key, { costoHasta: e.target.value })}
                    />
                  </div>
                )}
                <div className="flex w-32 flex-col gap-1">
                  <label htmlFor={`tramoMargen-${fila.key}`} className="text-xs font-medium">
                    Margen (%)
                  </label>
                  <input
                    id={`tramoMargen-${fila.key}`}
                    name="tramoMargen"
                    type="text"
                    inputMode="decimal"
                    required
                    placeholder="Ej: 100"
                    className="input"
                    value={fila.margen}
                    onChange={(e) => actualizar(fila.key, { margen: e.target.value })}
                  />
                </div>
                {filas.length > 1 ? (
                  <button type="button" className="btn btn-secondary btn-sm mb-1" onClick={() => quitar(fila.key)} aria-label={`Quitar tramo ${i + 1}`}>
                    Quitar
                  </button>
                ) : null}
              </div>
            );
          })}
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={agregar}>
              Agregar tramo
            </button>
          </div>
        </fieldset>
      </SimpleForm>
    </div>
  );
}
