"use client";

/** `/stock/ingresar` form (FASE 5 point 5.1, FAR/DT). */
import { ingresarPartidaAction } from "./actions";
import { SimpleForm } from "./simple-form";

export interface OpcionSimple {
  id: string;
  label: string;
}

export interface IngresarPartidaFormProps {
  drogas: OpcionSimple[];
  proveedores: OpcionSimple[];
  unidades: OpcionSimple[];
}

export function IngresarPartidaForm({ drogas, proveedores, unidades }: IngresarPartidaFormProps) {
  return (
    <SimpleForm action={ingresarPartidaAction} submitLabel="Ingresar partida" className="flex max-w-lg flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="drogaId" className="text-sm font-medium">
          Droga
        </label>
        <select id="drogaId" name="drogaId" required className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
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
        <select id="proveedorId" name="proveedorId" required className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
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
        <input id="lote" name="lote" required className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="fechaVencimiento" className="text-sm font-medium">
          Fecha de vencimiento
        </label>
        <input
          id="fechaVencimiento"
          name="fechaVencimiento"
          type="date"
          required
          className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="unidadCompraId" className="text-sm font-medium">
            Unidad de compra
          </label>
          <select id="unidadCompraId" name="unidadCompraId" required className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Unidad</option>
            {unidades.map((unidad) => (
              <option key={unidad.id} value={unidad.id}>
                {unidad.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-zinc-500">La cantidad se convierte automáticamente a la unidad base de la droga.</p>

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
          className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="numeroValeAdquisicion" className="text-sm font-medium">
          Número de vale de adquisición (drogas controladas, si el contralor está activo)
        </label>
        <input
          id="numeroValeAdquisicion"
          name="numeroValeAdquisicion"
          className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
    </SimpleForm>
  );
}
