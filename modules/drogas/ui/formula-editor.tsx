"use client";

/**
 * "Se elabora en la farmacia" (openspec/changes/lotes-elaborados EL3): the droga's fórmula inside its alta AND edit
 * form, saved with the rest of the form in the same transaction (`drogas.crear` / `drogas.editar`). Fields:
 * `formulaEnviada` (marker: the section was rendered enabled), `tieneFormula`, `cantidadReferencia` and one
 * `componente_<drogaId>` per component, in order -- the same names the command reports a rejected field by.
 * Quantities are typed in each droga's unidad base; the reference quantity in this droga's.
 */
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { numeroParaInput } from "@/shared/decimal/numero-ingresado";

export interface ComponenteOpcion {
  id: string;
  nombre: string;
  unidadBaseSimbolo: string;
  sinonimos: readonly string[];
}

export interface FormulaInicial {
  cantidadReferencia: string;
  componentes: readonly { drogaId: string; drogaNombre: string; cantidad: string; unidadBaseSimbolo: string }[];
}

export interface FormulaEditorProps {
  opciones: readonly ComponenteOpcion[];
  inicial: FormulaInicial | null;
  /** The droga being edited (never its own component); none on alta. */
  drogaId?: string;
  /** Drogas whose fórmula uses this one: it can not have its own (one level, INV-EL5). */
  esComponenteDe: readonly string[];
  disabled: boolean;
}

interface Fila {
  drogaId: string;
  nombre: string;
  simbolo: string;
  cantidad: string;
}

export function FormulaEditor({ opciones, inicial, drogaId, esComponenteDe, disabled }: FormulaEditorProps) {
  const [tiene, setTiene] = useState(inicial !== null);
  const [referencia, setReferencia] = useState(inicial ? numeroParaInput(inicial.cantidadReferencia) : "");
  const [filas, setFilas] = useState<Fila[]>(() =>
    (inicial?.componentes ?? []).map((c) => ({ drogaId: c.drogaId, nombre: c.drogaNombre, simbolo: c.unidadBaseSimbolo, cantidad: numeroParaInput(c.cantidad) })),
  );
  const [buscando, setBuscando] = useState<ComboboxOption | null>(null);

  const disponibles = useMemo(
    () => opciones.filter((o) => o.id !== drogaId && !filas.some((f) => f.drogaId === o.id)),
    [opciones, drogaId, filas],
  );
  const buscar = useMemo(
    () => filtrarOpciones(disponibles.map((o) => ({ value: o.id, label: o.nombre, description: o.unidadBaseSimbolo, sinonimos: o.sinonimos }))),
    [disponibles],
  );
  const bloqueada = esComponenteDe.length > 0 && inicial === null;

  function agregar(opcion: ComboboxOption | null) {
    setBuscando(null);
    const elegida = opcion ? opciones.find((o) => o.id === opcion.value) : undefined;
    if (!elegida) return;
    setFilas((actuales) => [...actuales, { drogaId: elegida.id, nombre: elegida.nombre, simbolo: elegida.unidadBaseSimbolo, cantidad: "" }]);
  }

  return (
    <fieldset className="field" disabled={disabled}>
      <input type="hidden" name="formulaEnviada" value="1" disabled={disabled} />
      <legend className="sr-only">Fórmula</legend>
      <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-zinc-900">
        <input type="checkbox" name="tieneFormula" checked={tiene} disabled={disabled || bloqueada} onChange={(e) => setTiene(e.target.checked)} />
        Se elabora en la farmacia (tiene fórmula)
      </label>
      <p className="field-help">
        {bloqueada
          ? `No puede tener fórmula: es componente de ${esComponenteDe.join(", ")}.`
          : "Sus materias primas por cada cantidad de referencia. Sirve para elaborar lotes y, si la droga no tiene costo de proveedor, para cotizarla."}
      </p>

      {tiene ? (
        <div className="mt-2 flex flex-col gap-3 rounded-md border border-zinc-200 p-3">
          <div className="field sm:max-w-[50%]">
            <label htmlFor="cantidadReferencia" className="field-label">
              Cantidad de referencia <span className="font-normal text-zinc-400">(en la unidad base)</span>
            </label>
            <input
              id="cantidadReferencia"
              name="cantidadReferencia"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              required
              inputMode="decimal"
              autoComplete="off"
              className="input font-mono"
            />
          </div>

          <div className="flex flex-col gap-2" role="group" aria-label="Componentes" data-field="componentes">
            {filas.length === 0 ? <p className="text-xs text-zinc-500">Todavía no hay componentes.</p> : null}
            {filas.map((fila) => {
              const id = `componente_${fila.drogaId}`;
              return (
                <div key={fila.drogaId} className="flex items-center gap-2">
                  <label htmlFor={id} className="min-w-0 flex-1 truncate text-[0.8125rem] text-zinc-800">
                    {fila.nombre}
                  </label>
                  <input
                    id={id}
                    name={id}
                    value={fila.cantidad}
                    onChange={(e) => setFilas((actuales) => actuales.map((f) => (f.drogaId === fila.drogaId ? { ...f, cantidad: e.target.value } : f)))}
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    className="input w-32 font-mono"
                  />
                  <span className="w-8 text-xs text-zinc-500">{fila.simbolo}</span>
                  <button
                    type="button"
                    onClick={() => setFilas((actuales) => actuales.filter((f) => f.drogaId !== fila.drogaId))}
                    aria-label={`Quitar ${fila.nombre}`}
                    className="btn btn-ghost btn-sm btn-icon"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>

          <Combobox
            id="formula-agregar-componente"
            label="Agregar componente"
            placeholder="Buscar droga o excipiente"
            search={buscar}
            value={buscando}
            onChange={agregar}
            disabled={disabled}
            size="sm"
            helperText={
              <span className="inline-flex items-center gap-1">
                <Plus className="size-3" aria-hidden />
                Cada componente se indica en su propia unidad base.
              </span>
            }
          />
        </div>
      ) : null}
    </fieldset>
  );
}
