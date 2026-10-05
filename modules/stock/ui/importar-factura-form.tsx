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
 *
 * Insumos (migration 0063): a product missing from the catalog can be
 * created right here ("Crear «…»", with the clase suggested from its name,
 * modules/drogas/domain/sugerir-clase.ts), and any lote can be marked "No
 * ingresar al stock" -- it is simply not sent; the invoice is still
 * recorded whole.
 *
 * Manual mode (`manual`, no PDF): the same form starts empty -- the invoice
 * header is typed once and lotes are added with "Agregar lote" (and removed
 * with "Quitar"); everything is saved as one comprobante, exactly as an
 * imported invoice. Prices are per unidad de compra in both modes.
 */
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { crearProductoDesdeFacturaAction, importarFacturaCompraAction } from "./actions";
import { formatearComprobante } from "../domain/importacion-factura-compra";
import type { VistaPreviaFactura } from "../domain/importacion-factura-compra";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { ToneBadge } from "@/shared/ui/status-badge";
import { CLASES_DROGA, CLASE_DROGA_LABELS, type ClaseDroga } from "@/modules/drogas/domain/droga";
import { sugerirClase } from "@/modules/drogas/domain/sugerir-clase";

const LETRAS = ["A", "B", "C", "M"] as const;

export interface OpcionSimple {
  id: string;
  label: string;
}

/** A droga or a unit, with the `tipo_magnitud` that pairs them. */
export interface OpcionConMagnitud extends OpcionSimple {
  tipoMagnitud: string;
  /** Drogas only (migration 0063): DROGA | EXCIPIENTE | MATERIAL. */
  clase?: string;
  /** Units only: "kg", "mL"... */
  simbolo?: string;
}

/** The starting point of a manual invoice: empty header, no lote (the form starts with one blank lote). */
export const VISTA_PREVIA_MANUAL: VistaPreviaFactura = {
  comprobante: { emisorCuit: null, letra: null, puntoVenta: "", numero: "", fechaEmision: "", cae: null, subtotal: null, iva: null, total: null },
  proveedor: null,
  lineas: [],
  advertencias: [],
};

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
  /** "No ingresar al stock": the lote is not sent. */
  omitir: boolean;
}

let siguienteLoteManual = 0;

/** A blank lote of a manual invoice. Its own `codigo`, so picking its droga never touches another lote; nothing to remember as an alias. */
function loteManual(): LineaEditable {
  siguienteLoteManual += 1;
  return {
    codigo: `manual-${siguienteLoteManual}`,
    descripcion: "",
    drogaTexto: "",
    unidadTexto: "",
    despacho: null,
    paisOrigen: null,
    matcheada: true,
    droga: null,
    unidadCompraId: "",
    cantidad: "",
    precioUnitario: "",
    lote: "",
    fechaVencimiento: "",
    potenciaDeclarada: "",
    numeroValeAdquisicion: "",
    recordar: false,
    omitir: false,
  };
}

/** The inline "Crear «…»" panel of one lote. */
interface AltaProducto {
  indice: number;
  nombre: string;
  clase: ClaseDroga;
  unidadBaseId: string;
  error: string | null;
}

export interface ImportarFacturaFormProps {
  vistaPrevia: VistaPreviaFactura;
  drogas: OpcionConMagnitud[];
  proveedores: OpcionSimple[];
  unidades: OpcionConMagnitud[];
  /** `drogas.crear`: offer "Crear «…»" for products missing from the catalog. */
  puedeCrearProducto: boolean;
  /** Typed by hand (no PDF): see the module doc comment. */
  manual?: boolean;
  onImportada: () => void;
}

function formatearMonto(valor: number): string {
  return valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ImportarFacturaForm({ vistaPrevia, drogas: drogasIniciales, proveedores, unidades, puedeCrearProducto, manual = false, onImportada }: ImportarFacturaFormProps) {
  // Products created from this form join the local catalog right away.
  const [drogas, setDrogas] = useState(drogasIniciales);
  const [alta, setAlta] = useState<AltaProducto | null>(null);
  const [creando, startCreando] = useTransition();
  const { comprobante } = vistaPrevia;
  const [proveedor, setProveedor] = useState<ComboboxOption | null>(
    vistaPrevia.proveedor ? { value: vistaPrevia.proveedor.id, label: vistaPrevia.proveedor.razonSocial } : null,
  );
  const [letra, setLetra] = useState<string>(comprobante.letra ?? "");
  const [puntoVenta, setPuntoVenta] = useState(comprobante.puntoVenta);
  const [numero, setNumero] = useState(comprobante.numero);
  const [fechaEmision, setFechaEmision] = useState(comprobante.fechaEmision);
  const [lineas, setLineas] = useState<LineaEditable[]>(() =>
    manual ? [loteManual()] : vistaPrevia.lineas.map((l) => ({
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
      omitir: false,
    })),
  );

  const buscarDrogas = useMemo(() => filtrarOpciones(drogas.map((d) => ({ value: d.id, label: d.label }))), [drogas]);
  const buscarProveedores = useMemo(() => filtrarOpciones(proveedores.map((p) => ({ value: p.id, label: p.label }))), [proveedores]);
  const magnitudDe = (drogaId: string | undefined) => drogas.find((d) => d.id === drogaId)?.tipoMagnitud ?? null;

  function quitarLote(indice: number) {
    setLineas((actuales) => actuales.filter((_, i) => i !== indice));
    setAlta((actual) => (actual === null || actual.indice === indice ? null : actual.indice > indice ? { ...actual, indice: actual.indice - 1 } : actual));
  }

  /** Manual mode, after saving: a blank invoice again (the success message stays visible). */
  function reiniciar() {
    setProveedor(null);
    setLetra("");
    setPuntoVenta("");
    setNumero("");
    setFechaEmision("");
    setLineas([loteManual()]);
    setAlta(null);
  }

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

  function abrirAlta(indice: number, texto: string) {
    const nombre = texto.trim() || lineas[indice]!.drogaTexto;
    setAlta({ indice, nombre, clase: sugerirClase(nombre)?.clase ?? "DROGA", unidadBaseId: "", error: null });
  }

  function crearProducto() {
    if (!alta) return;
    const { indice, nombre, clase, unidadBaseId } = alta;
    const unidad = unidades.find((u) => u.id === unidadBaseId);
    if (!nombre.trim() || !unidad) {
      setAlta({ ...alta, error: "Completá el nombre y la unidad base." });
      return;
    }
    startCreando(async () => {
      const resultado = await crearProductoDesdeFacturaAction({ nombre: nombre.trim(), unidadBaseId, clase });
      if (resultado.status === "error") {
        setAlta((actual) => (actual ? { ...actual, error: resultado.message } : actual));
        return;
      }
      setDrogas((actuales) => [...actuales, { id: resultado.id, label: nombre.trim(), tipoMagnitud: unidad.tipoMagnitud, clase }]);
      setAlta(null);
      elegirDroga(indice, { value: resultado.id, label: nombre.trim() });
    });
  }

  const activas = lineas.filter((l) => !l.omitir);
  const incompletas = activas.filter((l) => !l.droga || !l.unidadCompraId).length;
  // The date picker submits through a hidden input, which the browser never validates: checked here.
  const sinVencimiento = activas.filter((l) => l.droga && !l.fechaVencimiento && (drogas.find((d) => d.id === l.droga?.value)?.clase ?? "DROGA") === "DROGA").length;
  const faltaEncabezado = !proveedor || !letra;
  /** Why "Ingresar" is disabled -- shown floating over the button. */
  const bloqueos = [
    !proveedor ? "Elegí el proveedor." : null,
    !letra ? "Elegí la letra del comprobante." : null,
    incompletas > 0 ? `Falta elegir droga o unidad en ${incompletas === 1 ? "1 lote" : `${incompletas} lotes`}.` : null,
    sinVencimiento > 0 ? `Falta el vencimiento en ${sinVencimiento === 1 ? "1 lote" : `${sinVencimiento} lotes`} de droga (solo excipientes y materiales pueden no vencer).` : null,
    activas.length === 0 ? "Todos los lotes están marcados para no ingresar." : null,
    alta !== null ? "Terminá o cancelá el alta del producto nuevo." : null,
  ].filter((b): b is string => b !== null);
  const totalLineas = lineas.reduce((suma, l) => suma + (Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0), 0);
  const subtotalFactura = comprobante.subtotal === null ? null : Number(comprobante.subtotal);
  const difiereDelSubtotal = subtotalFactura !== null && Math.abs(totalLineas - subtotalFactura) > 0.05;

  function payload() {
    const equivalencias = new Map<string, string>();
    for (const l of activas) {
      if (!l.matcheada && l.recordar && l.droga) equivalencias.set(l.drogaTexto, l.droga.value);
    }
    return {
      origen: manual ? "manual" : "pdf",
      proveedorId: proveedor?.value ?? "",
      letra,
      puntoVenta,
      numero,
      fechaEmision,
      cae: comprobante.cae,
      subtotal: comprobante.subtotal,
      iva: comprobante.iva,
      total: comprobante.total,
      lineas: activas.map((l) => ({
        drogaId: l.droga?.value ?? "",
        lote: l.lote,
        fechaVencimiento: l.fechaVencimiento || undefined,
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
      submitLabel={activas.length === 1 ? "Ingresar 1 partida" : `Ingresar ${activas.length} partidas`}
      pendingLabel="Ingresando…"
      submitDisabled={bloqueos.length > 0}
      submitDisabledReason={
        <ul className="flex flex-col gap-1">
          {bloqueos.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      }
      onSuccess={() => {
        if (manual) reiniciar();
        onImportada();
      }}
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
          {manual && !puntoVenta && !numero ? "Datos de la factura" : `Comprobante ${formatearComprobante(letra || null, puntoVenta, numero)}`}
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
        {/* A manual invoice has no totals read from a PDF. */}
        {manual ? null : (
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
        )}
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
          const clase = drogas.find((d) => d.id === l.droga?.value)?.clase as ClaseDroga | undefined;
          const sugerencia = l.droga ? null : sugerirClase(l.drogaTexto);
          return (
            <div key={manual ? l.codigo : i} className={`flex flex-col gap-4 rounded border p-4 ${l.omitir ? "border-dashed border-zinc-200 bg-zinc-50" : "border-zinc-200"}`}>
              {manual ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-900">Lote {i + 1}</p>
                  {lineas.length > 1 ? (
                    <button type="button" onClick={() => quitarLote(i)} className="btn btn-ghost btn-sm">
                      <Trash2 className="size-4" aria-hidden />
                      Quitar
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className={`text-sm font-medium ${l.omitir ? "text-zinc-500 line-through" : "text-zinc-900"}`}>
                    <span className="font-mono text-zinc-500">{l.codigo}</span> {l.descripcion}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[0.8125rem] text-zinc-500">
                      {[l.despacho ? `Despacho ${l.despacho}` : null, l.paisOrigen ? `Origen ${l.paisOrigen}` : null].filter(Boolean).join(" · ")}
                    </p>
                    <label className="flex items-center gap-2 text-[0.8125rem] text-zinc-600">
                      <input
                        type="checkbox"
                        checked={l.omitir}
                        onChange={(e) => {
                          actualizar(i, { omitir: e.target.checked });
                          if (e.target.checked && alta?.indice === i) setAlta(null);
                        }}
                      />
                      No ingresar al stock
                    </label>
                  </div>
                </div>
              )}
              {l.omitir ? null : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      {sugerencia && alta?.indice !== i ? (
                        <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-zinc-600">
                          {puedeCrearProducto ? (
                            <button type="button" onClick={() => abrirAlta(i, l.drogaTexto)} className="btn btn-secondary btn-sm">
                              <Plus className="size-4" aria-hidden />
                              Crear «{l.drogaTexto}»
                            </button>
                          ) : null}
                          <span>
                            Parece un {CLASE_DROGA_LABELS[sugerencia.clase].toLowerCase()} («{sugerencia.motivo}»).
                          </span>
                        </div>
                      ) : null}
                      <Combobox
                        id={`lineas.${i}.drogaId-buscar`}
                        label="Droga"
                        placeholder="Buscar droga"
                        name={`lineas.${i}.drogaId`}
                        search={buscarDrogas}
                        value={l.droga}
                        onChange={(droga) => elegirDroga(i, droga)}
                        actionOption={puedeCrearProducto ? { label: (q) => `Crear «${q || l.drogaTexto}»`, onSelect: (q) => abrirAlta(i, q) } : undefined}
                      />
                      {clase && clase !== "DROGA" ? (
                        <p className="text-[0.8125rem] text-zinc-600">
                          <ToneBadge tone="neutral">{CLASE_DROGA_LABELS[clase]}</ToneBadge> Lleva stock y costo; no va al libro recetario.
                        </p>
                      ) : null}
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
                          Vencimiento{clase && clase !== "DROGA" ? <span className="font-normal text-zinc-500"> (opc.: no vence)</span> : null}
                        </label>
                        <DateInput
                          id={`lineas.${i}.fechaVencimiento`}
                          name={`lineas.${i}.fechaVencimiento`}
                          value={l.fechaVencimiento}
                          onValueChange={(fechaVencimiento) => actualizar(i, { fechaVencimiento })}
                          required={!clase || clase === "DROGA"}
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
                        <option value="">{magnitud === null ? "Elegí la droga" : l.unidadTexto ? `Unidad (${l.unidadTexto})` : "Unidad"}</option>
                        {unidadesDeLaDroga.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`lineas.${i}.precioUnitario`} className="field-label">
                        Precio por {unidades.find((u) => u.id === l.unidadCompraId)?.simbolo ?? "unidad"}
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
                  {/* Always computed from the form's own cantidad x precio (never the PDF's importe): a scale error shows here at once. */}
                  <p className="text-sm text-zinc-600">
                    Importe del lote:{" "}
                    <span className="font-mono font-semibold text-zinc-900">
                      {Number.isFinite(Number(l.cantidad) * Number(l.precioUnitario)) ? `$ ${formatearMonto(Number(l.cantidad) * Number(l.precioUnitario))}` : "—"}
                    </span>
                  </p>
                </>
              )}
              {alta?.indice === i ? (
                <div role="group" aria-label="Crear producto" className="flex flex-col gap-3 rounded border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-sm font-semibold text-zinc-900">Nuevo producto del catálogo</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="field">
                      <label htmlFor={`alta-${i}-nombre`} className="field-label">
                        Nombre
                      </label>
                      <input id={`alta-${i}-nombre`} value={alta.nombre} onChange={(e) => setAlta({ ...alta, nombre: e.target.value, error: null })} className="input" />
                    </div>
                    <div className="field">
                      <label htmlFor={`alta-${i}-clase`} className="field-label">
                        Clase
                      </label>
                      <select id={`alta-${i}-clase`} value={alta.clase} onChange={(e) => setAlta({ ...alta, clase: e.target.value as ClaseDroga, error: null })} className="input">
                        {CLASES_DROGA.map((c) => (
                          <option key={c} value={c}>
                            {CLASE_DROGA_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`alta-${i}-unidad`} className="field-label">
                        Unidad base
                      </label>
                      <select id={`alta-${i}-unidad`} value={alta.unidadBaseId} onChange={(e) => setAlta({ ...alta, unidadBaseId: e.target.value, error: null })} className="input">
                        <option value="">Elegí la unidad</option>
                        {unidades.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="field-help">
                    {sugerirClase(alta.nombre) ? `Clase sugerida por «${sugerirClase(alta.nombre)!.motivo}» en el nombre. ` : ""}
                    La unidad base es la que usa el laboratorio; las compras se convierten solas. Se crea sin control (tipo Ninguno).
                  </p>
                  {alta.error ? (
                    <p role="alert" className="text-sm text-red-600">
                      {alta.error}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={crearProducto} disabled={creando} className="btn btn-secondary btn-sm">
                      {creando ? "Creando…" : "Crear y usar"}
                    </button>
                    <button type="button" onClick={() => setAlta(null)} disabled={creando} className="btn btn-ghost btn-sm">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {manual ? (
          <button type="button" className="add-row-button" onClick={() => setLineas((actuales) => [...actuales, loteManual()])}>
            <Plus className="size-4" aria-hidden />
            Agregar lote
          </button>
        ) : null}
        <p id="precioUnitario-ayuda" className="field-help">
          Precio por unidad de compra, sin IVA, como figura en la factura (ej.: $ 50.000 el kg: elegí kg e ingresá 50000); se convierte solo a costo por unidad base. Pureza
          vacía = 100 %.
        </p>
        {incompletas > 0 || faltaEncabezado || activas.length === 0 ? (
          <p className="field-help">
            {faltaEncabezado ? "Elegí el proveedor y la letra del comprobante. " : ""}
            {incompletas > 0 ? `Falta elegir droga o unidad en ${incompletas === 1 ? "1 lote" : `${incompletas} lotes`}. ` : ""}
            {activas.length === 0 ? "Todos los lotes están marcados para no ingresar." : ""}
          </p>
        ) : null}
      </fieldset>
    </SimpleForm>
  );
}
