"use client";

/**
 * Existencia inicial (openspec/specs/existencia-inicial/spec.md R3/R5): one physical
 * envase counted at the relevamiento inicial per submit. Same data as a lote
 * of the manual alta, read from the envase, with the proveedor optional and no
 * vale. Text inputs are uncontrolled: SimpleForm keeps them on an error and
 * clears them on success, ready for the next envase; the pickers are state and
 * are cleared in `onSuccess` (the proveedor stays: an envase run usually comes
 * from the same one). The costo is prefilled with the droga's vigente costo de
 * proveedor when there is one, and stays editable.
 */
import { useMemo, useRef, useState } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { numeroParaInput } from "@/shared/decimal/numero-ingresado";
import { costoSugeridoExistenciaInicialAction, ingresarExistenciaInicialAction } from "./actions";
import type { OpcionConMagnitud, OpcionSimple } from "./importar-factura-form";

export interface ExistenciaInicialFormProps {
  drogas: OpcionConMagnitud[];
  proveedores: OpcionSimple[];
  unidades: OpcionConMagnitud[];
}

export function ExistenciaInicialForm({ drogas, proveedores, unidades }: ExistenciaInicialFormProps) {
  const [droga, setDroga] = useState<ComboboxOption | null>(null);
  const [proveedor, setProveedor] = useState<ComboboxOption | null>(null);
  const [unidadId, setUnidadId] = useState("");
  const [costo, setCosto] = useState("");
  const consulta = useRef(0);

  const buscarDrogas = useMemo(() => filtrarOpciones(drogas.map((d) => ({ value: d.id, label: d.label, sinonimos: d.sinonimos }))), [drogas]);
  const buscarProveedores = useMemo(() => filtrarOpciones(proveedores.map((p) => ({ value: p.id, label: p.label }))), [proveedores]);
  const drogaElegida = droga ? drogas.find((d) => d.id === droga.value) : undefined;
  const unidadesDeLaDroga = drogaElegida ? unidades.filter((u) => u.tipoMagnitud === drogaElegida.tipoMagnitud) : [];

  async function sugerirCosto(drogaId: string | undefined, proveedorId: string | undefined) {
    const turno = ++consulta.current;
    if (!drogaId) return;
    const sugerido = await costoSugeridoExistenciaInicialAction(drogaId, proveedorId);
    // Only the latest pick prefills, and never over a costo already typed.
    if (turno === consulta.current && sugerido !== null) setCosto((actual) => (actual.trim() === "" ? numeroParaInput(sugerido) : actual));
  }

  return (
    <SimpleForm
      action={ingresarExistenciaInicialAction}
      accion="stock.partida.ingresar"
      submitLabel="Cargar envase"
      onSuccess={() => {
        setDroga(null);
        setUnidadId("");
        setCosto("");
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Combobox
          id="drogaId-buscar"
          label="Droga o insumo"
          placeholder="Buscar droga"
          name="drogaId"
          search={buscarDrogas}
          value={droga}
          onChange={(opcion) => {
            setDroga(opcion);
            const nueva = opcion ? drogas.find((d) => d.id === opcion.value) : undefined;
            const primera = nueva ? unidades.find((u) => u.tipoMagnitud === nueva.tipoMagnitud) : undefined;
            setUnidadId(primera?.id ?? "");
            setCosto("");
            void sugerirCosto(opcion?.value, proveedor?.value);
          }}
        />
        <Combobox
          id="proveedorId-buscar"
          label="Proveedor (opcional)"
          placeholder="Sin proveedor"
          name="proveedorId"
          search={buscarProveedores}
          value={proveedor}
          onChange={(opcion) => {
            setProveedor(opcion);
            void sugerirCosto(droga?.value, opcion?.value);
          }}
          helperText="Si figura en el envase. Sin proveedor, la partida no aparece en la trayectoria de ningún proveedor."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="field">
          <label htmlFor="lote" className="field-label">
            Lote
          </label>
          <input id="lote" name="lote" required autoComplete="off" className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="fechaVencimiento" className="field-label">
            Vencimiento
          </label>
          <DateInput id="fechaVencimiento" name="fechaVencimiento" required={drogaElegida?.clase === "DROGA"} />
        </div>
        <div className="field">
          <label htmlFor="potenciaDeclarada" className="field-label">
            Pureza <span className="font-normal text-zinc-400">(%, opcional)</span>
          </label>
          <input id="potenciaDeclarada" name="potenciaDeclarada" inputMode="decimal" className="input font-mono" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="field">
          <label htmlFor="cantidadCompra" className="field-label">
            Cantidad contada
          </label>
          <input id="cantidadCompra" name="cantidadCompra" required inputMode="decimal" className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="unidadCompraId" className="field-label">
            Unidad
          </label>
          <select id="unidadCompraId" name="unidadCompraId" value={unidadId} onChange={(e) => setUnidadId(e.target.value)} required disabled={!drogaElegida} className="input">
            <option value="" disabled>
              {drogaElegida ? "Elegí una unidad" : "Elegí primero la droga"}
            </option>
            {unidadesDeLaDroga.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="costoUnitario" className="field-label">
            Costo por unidad base
          </label>
          <input
            id="costoUnitario"
            name="costoUnitario"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
            required
            inputMode="decimal"
            className="input font-mono"
          />
        </div>
      </div>
    </SimpleForm>
  );
}
