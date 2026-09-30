"use client";

/**
 * `/stock/ingresar` form (FASE 5 point 5.1, FAR/DT). "Unidad de compra"
 * only lists the vigente units of the chosen droga's magnitude (its unidad
 * base included): the server converts the quantity with `fsj.convertir`,
 * which cannot cross magnitudes. Disabled until a droga is chosen.
 */
import { useState } from "react";
import { ingresarPartidaAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";

export interface OpcionSimple {
  id: string;
  label: string;
}

/** A droga or a unit, with the `tipo_magnitud` that pairs them. */
export interface OpcionConMagnitud extends OpcionSimple {
  tipoMagnitud: string;
}

export interface IngresarPartidaFormProps {
  drogas: OpcionConMagnitud[];
  proveedores: OpcionSimple[];
  /** Vigente units only. */
  unidades: OpcionConMagnitud[];
}

export function IngresarPartidaForm({ drogas, proveedores, unidades }: IngresarPartidaFormProps) {
  const [drogaId, setDrogaId] = useState("");
  const magnitud = drogas.find((droga) => droga.id === drogaId)?.tipoMagnitud ?? null;
  const unidadesDeLaDroga = magnitud === null ? [] : unidades.filter((unidad) => unidad.tipoMagnitud === magnitud);

  return (
    <SimpleForm action={ingresarPartidaAction} submitLabel="Ingresar partida" className="max-w-lg" onSuccess={() => setDrogaId("")}>
      <div className="flex flex-col gap-1">
        <label htmlFor="drogaId" className="text-sm font-medium">
          Droga
        </label>
        <select id="drogaId" name="drogaId" required value={drogaId} onChange={(event) => setDrogaId(event.target.value)} className="input">
          <option value="">Seleccioná una droga</option>
          {drogas.map((droga) => (
            <option key={droga.id} value={droga.id}>
              {droga.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="proveedorId" className="text-sm font-medium">
          Proveedor
        </label>
        <select id="proveedorId" name="proveedorId" required className="input">
          <option value="">Seleccioná un proveedor</option>
          {proveedores.map((proveedor) => (
            <option key={proveedor.id} value={proveedor.id}>
              {proveedor.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="lote" className="text-sm font-medium">
          Lote
        </label>
        <input id="lote" name="lote" required className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="fechaVencimiento" className="text-sm font-medium">
          Fecha de vencimiento
        </label>
        <DateInput
          id="fechaVencimiento"
          name="fechaVencimiento"
          required
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="cantidadCompra" className="text-sm font-medium">
            Cantidad comprada
          </label>
          <input
            id="cantidadCompra"
            name="cantidadCompra"
            type="text"
            inputMode="decimal"
            required
            className="input"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="unidadCompraId" className="text-sm font-medium">
            Unidad de compra
          </label>
          {/* Remounted when the magnitude changes, so a unit of the previous droga's magnitude never stays selected. */}
          <select
            key={magnitud ?? "sin-droga"}
            id="unidadCompraId"
            name="unidadCompraId"
            required
            disabled={magnitud === null}
            className="input"
          >
            <option value="">{magnitud === null ? "Elegí primero la droga" : "Unidad"}</option>
            {unidadesDeLaDroga.map((unidad) => (
              <option key={unidad.id} value={unidad.id}>
                {unidad.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        {magnitud === null
          ? "Elegí la droga para ver las unidades de compra disponibles."
          : "La cantidad se convierte automáticamente a la unidad base de la droga."}
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="costoUnitario" className="text-sm font-medium">
          Costo unitario (por unidad base de la droga)
        </label>
        <input
          id="costoUnitario"
          name="costoUnitario"
          type="text"
          inputMode="decimal"
          required
          className="input"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="numeroValeAdquisicion" className="text-sm font-medium">
          Número de vale de adquisición (drogas controladas, si el contralor está activo)
        </label>
        <input
          id="numeroValeAdquisicion"
          name="numeroValeAdquisicion"
          className="input"
        />
      </div>
    </SimpleForm>
  );
}
