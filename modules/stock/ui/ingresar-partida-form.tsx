"use client";

/**
 * `/stock/ingresar` form (FASE 5 point 5.1, FAR/DT). Droga and proveedor
 * are autocompletes over the options the page already loaded (no extra
 * request); their hidden inputs submit `drogaId` / `proveedorId` as before.
 * "Unidad de compra" only lists the vigente units of the chosen droga's
 * magnitude (its unidad base included): the server converts the quantity
 * with `fsj.convertir`, which cannot cross magnitudes. Disabled until a
 * droga is chosen. "Pureza (%)" (migration 0058) is optional: empty = 100 %.
 */
import { useMemo, useState } from "react";
import { ingresarPartidaAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";

export interface OpcionSimple {
  id: string;
  label: string;
}

/** A droga or a unit, with the `tipo_magnitud` that pairs them. */
export interface OpcionConMagnitud extends OpcionSimple {
  tipoMagnitud: string;
  /** Drogas only (migration 0063): DROGA | EXCIPIENTE | MATERIAL. */
  clase?: string;
}

export interface IngresarPartidaFormProps {
  drogas: OpcionConMagnitud[];
  proveedores: OpcionSimple[];
  /** Vigente units only. */
  unidades: OpcionConMagnitud[];
}

export function IngresarPartidaForm({ drogas, proveedores, unidades }: IngresarPartidaFormProps) {
  const [droga, setDroga] = useState<ComboboxOption | null>(null);
  const [proveedor, setProveedor] = useState<ComboboxOption | null>(null);
  const magnitud = drogas.find((d) => d.id === droga?.value)?.tipoMagnitud ?? null;
  // Migration 0064: an insumo may have no expiry; a droga (or none chosen yet) requires it.
  const esInsumo = (drogas.find((d) => d.id === droga?.value)?.clase ?? "DROGA") !== "DROGA";
  const unidadesDeLaDroga = magnitud === null ? [] : unidades.filter((unidad) => unidad.tipoMagnitud === magnitud);

  const buscarDrogas = useMemo(() => filtrarOpciones(drogas.map((d) => ({ value: d.id, label: d.label }))), [drogas]);
  const buscarProveedores = useMemo(() => filtrarOpciones(proveedores.map((p) => ({ value: p.id, label: p.label }))), [proveedores]);

  return (
    <SimpleForm
      action={ingresarPartidaAction}
      submitLabel="Ingresar partida"
      onSuccess={() => {
        // The form resets itself; the two autocompletes are controlled, so they are cleared here.
        setDroga(null);
        setProveedor(null);
      }}
    >
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-sm font-semibold text-zinc-900">Qué se compró</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Combobox id="drogaId-buscar" label="Droga" placeholder="Buscar droga" name="drogaId" search={buscarDrogas} value={droga} onChange={setDroga} />
          <Combobox id="proveedorId-buscar" label="Proveedor" placeholder="Buscar proveedor" name="proveedorId" search={buscarProveedores} value={proveedor} onChange={setProveedor} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="lote" className="field-label">
              Lote
            </label>
            <input id="lote" name="lote" required className="input font-mono" />
          </div>
          <div className="field">
            <label htmlFor="fechaVencimiento" className="field-label">
              Fecha de vencimiento{esInsumo ? <span className="font-normal text-zinc-500"> (opcional: vacía = no vence)</span> : null}
            </label>
            <DateInput id="fechaVencimiento" name="fechaVencimiento" required={!esInsumo} />
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-zinc-100 pt-5">
        <legend className="sr-only">Cantidad y costo</legend>
        <p className="text-sm font-semibold text-zinc-900" aria-hidden>
          Cantidad y costo
        </p>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="field">
            <label htmlFor="cantidadCompra" className="field-label">
              Cantidad comprada
            </label>
            <input id="cantidadCompra" name="cantidadCompra" type="text" inputMode="decimal" required className="input font-mono" />
          </div>
          <div className="field">
            <label htmlFor="unidadCompraId" className="field-label">
              Unidad de compra
            </label>
            {/* Remounted when the magnitude changes, so a unit of the previous droga's magnitude never stays selected. */}
            <select key={magnitud ?? "sin-droga"} id="unidadCompraId" name="unidadCompraId" required disabled={magnitud === null} className="input">
              <option value="">{magnitud === null ? "Elegí primero la droga" : "Unidad"}</option>
              {unidadesDeLaDroga.map((unidad) => (
                <option key={unidad.id} value={unidad.id}>
                  {unidad.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="costoUnitario" className="field-label">
              Costo unitario
            </label>
            <input id="costoUnitario" name="costoUnitario" type="text" inputMode="decimal" required aria-describedby="costoUnitario-ayuda" className="input font-mono" />
            <p id="costoUnitario-ayuda" className="field-help">
              Por unidad base de la droga.
            </p>
          </div>
        </div>
        <p className="field-help -mt-1">
          {magnitud === null ? "Elegí la droga para ver las unidades de compra disponibles." : "La cantidad se convierte automáticamente a la unidad base de la droga."}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-zinc-100 pt-5">
        <legend className="sr-only">Pureza</legend>
        <div className="field sm:max-w-sm">
          <label htmlFor="potenciaDeclarada" className="field-label">
            Pureza (%)<span className="font-normal text-zinc-500"> (opcional)</span>
          </label>
          <input
            id="potenciaDeclarada"
            name="potenciaDeclarada"
            type="text"
            inputMode="decimal"
            aria-describedby="potenciaDeclarada-ayuda"
            className="input font-mono"
          />
          <p id="potenciaDeclarada-ayuda" className="field-help">
            La declarada en el certificado del lote. Si la dejás vacía, se toma como 100 %.
          </p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-zinc-100 pt-5">
        <legend className="sr-only">Contralor</legend>
        <div className="field sm:max-w-sm">
          <label htmlFor="numeroValeAdquisicion" className="field-label">
            Número de vale de adquisición
          </label>
          <input id="numeroValeAdquisicion" name="numeroValeAdquisicion" aria-describedby="numeroValeAdquisicion-ayuda" className="input font-mono" />
          <p id="numeroValeAdquisicion-ayuda" className="field-help">
            Solo para drogas controladas, si el contralor está activo.
          </p>
        </div>
      </fieldset>
    </SimpleForm>
  );
}
