"use client";

/**
 * Supplier invoice import form (/stock/ingresar): the preview read from the
 * PDF, editable, one block per lote -- each becomes a partida on
 * confirmation (`importarFacturaCompraAction`, one transaction). What the
 * invoice does not carry (vencimiento, pureza, vale) is typed here; droga,
 * unidad and proveedor come matched when possible and are picked otherwise.
 *
 * Every value lives in React state and is sent as one JSON field, so an
 * error never loses what was typed (SimpleForm only resets on success).
 * The visible controls are named `lineas.<i>.<campo>`, matching the
 * `fields` the server's per-row errors carry, so the right one is marked.
 * Picking a droga for one lote applies it to the other lotes of the same
 * product; "Recordar" saves the invoice's text as an alias of that droga.
 */
import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { importarFacturaCompraAction } from "./actions";
import type { OpcionConMagnitud, OpcionSimple } from "./ingresar-partida-form";
import { formatearComprobante } from "../domain/importacion-factura-compra";
import type { VistaPreviaFactura } from "../domain/importacion-factura-compra";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";

const LETRAS = ["A", "B", "C", "M"] as const;

interface LineaEditable {
  codigo: string;
  descripcion: string;
  drogaTexto: string;
  unidadTexto: string;
  despacho: string | null;
  paisOrigen: string | null;
  /** The droga came matched from the PDF (no alias to remember). */
  matcheada: boolean;
  droga: ComboboxOption | null;
  unidadCompraId: string;
  cantidad: string;
  precioUnitario: string;
  lote: string;
  fechaVencimiento: string;
  potenciaDeclarada: string;
  numeroValeAdquisicion: string;
  recordar: boolean;
}

export interface ImportarFacturaFormProps {
  vistaPrevia: VistaPreviaFactura;
  drogas: OpcionConMagnitud[];
  proveedores: OpcionSimple[];
  unidades: OpcionConMagnitud[];
  onImportada: () => void;
}

function formatearMonto(valor: number): string {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ImportarFacturaForm({ vistaPrevia, drogas, proveedores, unidades, onImportada }: ImportarFacturaFormProps) {
  const { comprobante } = vistaPrevia;
  const [proveedor, setProveedor] = useState<ComboboxOption | null>(
    vistaPrevia.proveedor ? { value: vistaPrevia.proveedor.id, label: vistaPrevia.proveedor.razonSocial } : null,
  );
  const [letra, setLetra] = useState<string>(comprobante.letra ?? "");
  const [puntoVenta, setPuntoVenta] = useState(comprobante.puntoVenta);
  const [numero, setNumero] = useState(comprobante.numero);
  const [fechaEmision, setFechaEmision] = useState(comprobante.fechaEmision);
  const [lineas, setLineas] = useState<LineaEditable[]>(() =>
    vistaPrevia.lineas.map((l) => ({
      codigo: l.codigo,
      descripcion: l.descripcion,
      drogaTexto: l.drogaTexto,
      unidadTexto: l.unidadTexto,
      despacho: l.despacho,
      paisOrigen: l.paisOrigen,
      matcheada: l.drogaId !== null,
      droga: l.drogaId ? { value: l.drogaId, label: l.drogaNombre ?? l.drogaTexto } : null,
      unidadCompraId: l.unidadCompraId ?? "",
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      lote: l.lote,
      fechaVencimiento: l.fechaVencimiento ?? "",
      potenciaDeclarada: "",
      numeroValeAdquisicion: "",
      recordar: true,
    })),
  );

  const buscarDrogas = useMemo(() => filtrarOpciones(drogas.map((d) => ({ value: d.id, label: d.label }))), [drogas]);
  const buscarProveedores = useMemo(() => filtrarOpciones(proveedores.map((p) => ({ value: p.id, label: p.label }))), [proveedores]);
  const magnitudDe = (drogaId: string | undefined) => drogas.find((d) => d.id === drogaId)?.tipoMagnitud ?? null;

  function actualizar(indice: number, cambios: Partial<LineaEditable>) {
    setLineas((actuales) => actuales.map((l, i) => (i === indice ? { ...l, ...cambios } : l)));
  }

  /** A droga belongs to the product, not the lote: applied to every lote of the same code. */
  function elegirDroga(indice: number, droga: ComboboxOption | null) {
    const codigo = lineas[indice]!.codigo;
    const magnitud = magnitudDe(droga?.value);
    setLineas((actuales) =>
      actuales.map((l) => {
        if (l.codigo !== codigo) return l;
        const unidadValida = unidades.some((u) => u.id === l.unidadCompraId && u.tipoMagnitud === magnitud);
        return { ...l, droga, matcheada: false, unidadCompraId: unidadValida ? l.unidadCompraId : "" };
      }),
    );
  }

  const incompletas = lineas.filter((l) => !l.droga || !l.unidadCompraId).length;
  const faltaEncabezado = !proveedor || !letra;
  const totalLineas = lineas.reduce((suma, l) => suma + (Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), 0);
  const subtotalFactura = comprobante.subtotal === null ? null : Number(comprobante.subtotal);
  const difiereDelSubtotal = subtotalFactura !== null && Math.abs(totalLineas - subtotalFactura) > 0.05;

  function payload() {
    const equivalencias = new Map<string, string>();
    for (const l of lineas) {
      if (!l.matcheada && l.recordar && l.droga) equivalencias.set(l.drogaTexto, l.droga.value);
    }
    return {
      proveedorId: proveedor?.value ?? "",
      letra,
      puntoVenta,
      numero,
      fechaEmision,
      cae: comprobante.cae,
      subtotal: comprobante.subtotal,
      iva: comprobante.iva,
      total: comprobante.total,
      lineas: lineas.map((l) => ({
        drogaId: l.droga?.value ?? "",
        lote: l.lote,
        fechaVencimiento: l.fechaVencimiento,
        cantidadCompra: l.cantidad,
        unidadCompraId: l.unidadCompraId,
        precioUnitario: l.precioUnitario,
        potenciaDeclarada: l.potenciaDeclarada.trim() || undefined,
        numeroValeAdquisicion: l.numeroValeAdquisicion.trim() || undefined,
        despachoImportacion: l.despacho,
        paisOrigen: l.paisOrigen,
      })),
      equivalencias: [...equivalencias].map(([aliasTexto, drogaId]) => ({ aliasTexto, drogaId })),
    };
  }

  return (
    <SimpleForm
      action={importarFacturaCompraAction}
      submitLabel={lineas.length === 1 ? "Ingresar 1 partida" : `Ingresar ${lineas.length} partidas`}
      pendingLabel="Ingresando…"
      submitDisabled={incompletas > 0 || faltaEncabezado}
      onSuccess={onImportada}
    >
      <input type="hidden" name="facturaJson" value={JSON.stringify(payload())} />

      {vistaPrevia.advertencias.length > 0 ? (
        <div role="note" className="alert alert-warn">
          <TriangleAlert aria-hidden />
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {vistaPrevia.advertencias.map((a, i) => (
              <li key={i}>{a.mensaje}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-sm font-semibold text-zinc-900">
          Comprobante {formatearComprobante(letra || null, puntoVenta, numero)}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Combobox id="proveedorId-buscar" label="Proveedor" placeholder="Buscar proveedor" name="proveedorId" search={buscarProveedores} value={proveedor} onChange={setProveedor} />
          <div className="field">
            <label htmlFor="fechaEmision" className="field-label">
              Fecha de la factura
            </label>
            <DateInput id="fechaEmision" name="fechaEmision" value={fechaEmision} onValueChange={setFechaEmision} required />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="field">
            <label htmlFor="letra" className="field-label">
              Letra
            </label>
            <select id="letra" name="letra" required value={letra} onChange={(e) => setLetra(e.target.value)} className="input">
              <option value="">Elegí la letra</option>
              {LETRAS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="puntoVenta" className="field-label">
              Punto de venta
            </label>
            <input id="puntoVenta" name="puntoVenta" required inputMode="numeric" value={puntoVenta} onChange={(e) => setPuntoVenta(e.target.value)} className="input font-mono" />
          </div>
          <div className="field">
            <label htmlFor="numero" className="field-label">
              Número
            </label>
            <input id="numero" name="numero" required inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} className="input font-mono" />
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500">Subtotal (neto)</dt>
            <dd className="font-mono">{comprobante.subtotal === null ? "—" : formatearMonto(Number(comprobante.subtotal))}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">IVA</dt>
            <dd className="font-mono">{comprobante.iva === null ? "—" : formatearMonto(Number(comprobante.iva))}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Total</dt>
            <dd className="font-mono">{comprobante.total === null ? "—" : formatearMonto(Number(comprobante.total))}</dd>
          </div>
        </dl>
        {difiereDelSubtotal ? (
          <p className="field-help">
            Cantidad × precio de los lotes suma {formatearMonto(totalLineas)}, distinto del subtotal de la factura. Revisá cantidades y precios.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-zinc-100 pt-5">
        <legend className="sr-only">Lotes</legend>
        <p className="text-sm font-semibold text-zinc-900" aria-hidden>
          Lotes ({lineas.length})
        </p>
        {lineas.map((l, i) => {
          const magnitud = magnitudDe(l.droga?.value);
          const unidadesDeLaDroga = magnitud === null ? [] : unidades.filter((u) => u.tipoMagnitud === magnitud);
          const primeraDelProducto = lineas.findIndex((otra) => otra.codigo === l.codigo) === i;
          return (
            <div key={i} className="flex flex-col gap-4 rounded border border-zinc-200 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-zinc-900">
                  <span className="font-mono text-zinc-500">{l.codigo}</span> {l.descripcion}
                </p>
                <p className="text-[0.8125rem] text-zinc-500">
                  {[l.despacho ? `Despacho ${l.despacho}` : null, l.paisOrigen ? `Origen ${l.paisOrigen}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Combobox
                    id={`lineas.${i}.drogaId-buscar`}
                    label="Droga"
                    placeholder="Buscar droga"
                    name={`lineas.${i}.drogaId`}
                    search={buscarDrogas}
                    value={l.droga}
                    onChange={(droga) => elegirDroga(i, droga)}
                  />
                  {!l.matcheada && l.droga && primeraDelProducto ? (
                    <label className="flex items-center gap-2 text-[0.8125rem] text-zinc-600">
                      <input type="checkbox" checked={l.recordar} onChange={(e) => actualizar(i, { recordar: e.target.checked })} />
                      Recordar «{l.drogaTexto}» como esta droga
                    </label>
                  ) : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="field">
                    <label htmlFor={`lineas.${i}.lote`} className="field-label">
                      Lote
                    </label>
                    <input id={`lineas.${i}.lote`} name={`lineas.${i}.lote`} required value={l.lote} onChange={(e) => actualizar(i, { lote: e.target.value })} className="input font-mono" />
                  </div>
                  <div className="field">
                    <label htmlFor={`lineas.${i}.fechaVencimiento`} className="field-label">
                      Vencimiento
                    </label>
                    <DateInput
                      id={`lineas.${i}.fechaVencimiento`}
                      name={`lineas.${i}.fechaVencimiento`}
                      value={l.fechaVencimiento}
                      onValueChange={(fechaVencimiento) => actualizar(i, { fechaVencimiento })}
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-5">
                <div className="field">
                  <label htmlFor={`lineas.${i}.cantidadCompra`} className="field-label">
                    Cantidad
                  </label>
                  <input
                    id={`lineas.${i}.cantidadCompra`}
                    name={`lineas.${i}.cantidadCompra`}
                    required
                    inputMode="decimal"
                    value={l.cantidad}
                    onChange={(e) => actualizar(i, { cantidad: e.target.value })}
                    className="input font-mono"
                  />
                </div>
                <div className="field">
                  <label htmlFor={`lineas.${i}.unidadCompraId`} className="field-label">
                    Unidad
                  </label>
                  <select
                    id={`lineas.${i}.unidadCompraId`}
                    name={`lineas.${i}.unidadCompraId`}
                    required
                    disabled={magnitud === null}
                    value={l.unidadCompraId}
                    onChange={(e) => actualizar(i, { unidadCompraId: e.target.value })}
                    className="input"
                  >
                    <option value="">{magnitud === null ? "Elegí la droga" : `Unidad (${l.unidadTexto})`}</option>
                    {unidadesDeLaDroga.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`lineas.${i}.precioUnitario`} className="field-label">
                    Precio unitario
                  </label>
                  <input
                    id={`lineas.${i}.precioUnitario`}
                    name={`lineas.${i}.precioUnitario`}
                    required
                    inputMode="decimal"
                    value={l.precioUnitario}
                    onChange={(e) => actualizar(i, { precioUnitario: e.target.value })}
                    aria-describedby="precioUnitario-ayuda"
                    className="input font-mono"
                  />
                </div>
                <div className="field">
                  <label htmlFor={`lineas.${i}.potenciaDeclarada`} className="field-label">
                    Pureza (%)<span className="font-normal text-zinc-500"> (opc.)</span>
                  </label>
                  <input
                    id={`lineas.${i}.potenciaDeclarada`}
                    name={`lineas.${i}.potenciaDeclarada`}
                    inputMode="decimal"
                    value={l.potenciaDeclarada}
                    onChange={(e) => actualizar(i, { potenciaDeclarada: e.target.value })}
                    className="input font-mono"
                  />
                </div>
                <div className="field">
                  <label htmlFor={`lineas.${i}.numeroValeAdquisicion`} className="field-label">
                    Vale<span className="font-normal text-zinc-500"> (controladas)</span>
                  </label>
                  <input
                    id={`lineas.${i}.numeroValeAdquisicion`}
                    name={`lineas.${i}.numeroValeAdquisicion`}
                    value={l.numeroValeAdquisicion}
                    onChange={(e) => actualizar(i, { numeroValeAdquisicion: e.target.value })}
                    className="input font-mono"
                  />
                </div>
              </div>
            </div>
          );
        })}
        <p id="precioUnitario-ayuda" className="field-help">
          Precio por unidad de compra, sin IVA, como figura en la factura: se convierte solo a costo por unidad base. Pureza vacía = 100 %.
        </p>
        {incompletas > 0 || faltaEncabezado ? (
          <p className="field-help">
            {faltaEncabezado ? "Elegí el proveedor y la letra del comprobante. " : ""}
            {incompletas > 0 ? `Falta elegir droga o unidad en ${incompletas === 1 ? "1 lote" : `${incompletas} lotes`}.` : ""}
          </p>
        ) : null}
      </fieldset>
    </SimpleForm>
  );
}
