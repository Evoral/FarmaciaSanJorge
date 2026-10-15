"use client";

/**
 * Manual entry of one costo de proveedor (docs/specs/costos-proveedor.md R24): add a
 * price or change the vigente one of a (droga, proveedor) pair. It goes through the SAME
 * command as the list import (`registrarCostosProveedor`), so every rule (R3-R12, R23)
 * is enforced there; this form only helps the user get it right:
 *
 *   - proveedor and droga are AUTOCOMPLETES over the catalogs the page already loaded;
 *   - the unidad de precio offers the units of the droga's magnitud and starts at the
 *     default of that magnitud (R6: kg / L / u);
 *   - once both are chosen, the VIGENTE costo of the pair is looked up and shown, and its id
 *     travels as `vigenteEsperadoId` (R23): if someone else changes it meanwhile the save
 *     is refused instead of overwriting;
 *   - what the price means per unidad base is previewed with the same arithmetic the
 *     command uses (`calcularCostoUnidadBase`).
 *
 * The controls are named `proveedorId` and `filas.0.<campo>`, the names the command's
 * errors point at, so a refused field is marked and NOTHING typed is lost
 * (`SimpleForm` -> `shared/ui/use-form-submit.ts`). Prices are net of IVA, in pesos (R7).
 */
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info } from "lucide-react";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { DateInput } from "@/shared/ui/date-input";
import { SimpleForm } from "@/shared/ui/simple-form";
import { toast } from "@/shared/ui/toast";
import { dec } from "@/shared/decimal";
import { formatFechaIso } from "@/shared/format/fecha";
import { formatearCostoUnitario } from "@/shared/format/monto";
import { calcularCostoUnidadBase, unidadPrecioPorDefecto } from "../domain/costo-proveedor";
import type { TipoMagnitudCosto } from "../domain/costo-proveedor";
import { antiguedadDias, etiquetaAntiguedad, etiquetaPrecio } from "../domain/presentacion";
import type { CostoProveedorActionState, CostoVigenteResumen } from "./action-state";
import { obtenerCostoVigenteDelParAction, registrarCostoManualAction } from "./actions";

export interface DrogaOpcionCosto {
  id: string;
  nombre: string;
  unidadBaseId: string;
  tipoMagnitud: string;
  /** Vigente synonyms: the picker finds the droga by them too (docs/specs/sinonimos-droga.md). */
  sinonimos: readonly string[];
}

export interface UnidadOpcionCosto {
  id: string;
  codigo: string;
  simbolo: string;
  tipoMagnitud: string;
  factorABase: string;
  /** `false` = dada de baja: never offered, but still names a droga's unidad base. */
  vigente: boolean;
}

export interface CostoFormProps {
  drogas: readonly DrogaOpcionCosto[];
  proveedores: readonly { id: string; razonSocial: string }[];
  unidades: readonly UnidadOpcionCosto[];
  /** `YYYY-MM-DD`: the pharmacy's today (default and maximum of the price's date). */
  jornadaActual: string;
  /** Opened with a pair already chosen ("Editar", or "Cambiar el precio" from the historial): the pair is fixed and `vigente` (if any) prefills price and unit. Both `null` = a blank form. */
  inicial: { droga: { id: string; nombre: string } | null; proveedor: { id: string; razonSocial: string } | null; vigente: CostoVigenteResumen | null };
}

/** Saves, and raises the confirmation when the action resolves (the Toaster lives in the route's layout and survives the redirect). */
async function registrarConAviso(estadoPrevio: CostoProveedorActionState, formData: FormData): Promise<CostoProveedorActionState> {
  const estado = await registrarCostoManualAction(estadoPrevio, formData);
  if (estado.status === "success" && estado.message) toast(estado.message);
  return estado;
}

type EstadoVigente = { tipo: "sin-par" } | { tipo: "cargando" } | { tipo: "listo"; costo: CostoVigenteResumen | null } | { tipo: "error"; mensaje: string };

/** The unit a droga's price starts in: the default of its magnitud (R6) when it is a vigente unit of that magnitud. */
function unidadInicial(droga: DrogaOpcionCosto | null, unidades: readonly UnidadOpcionCosto[]): string {
  if (!droga) return "";
  const codigo = unidadPrecioPorDefecto(droga.tipoMagnitud as TipoMagnitudCosto);
  return unidades.find((u) => u.vigente && u.tipoMagnitud === droga.tipoMagnitud && u.codigo === codigo)?.id ?? "";
}

/** `costoUnitario` of what is typed, or `null` while the price is not a valid positive decimal. Never throws. */
function costoPorUnidadBase(precio: string, unidadPrecio: UnidadOpcionCosto | undefined, unidadBase: UnidadOpcionCosto | undefined): string | null {
  const limpio = precio.trim().replace(/^(\d+),(\d+)$/, "$1.$2");
  if (!unidadPrecio || !unidadBase || !/^\d+(\.\d+)?$/.test(limpio) || !dec(limpio).greaterThan(0)) return null;
  try {
    const costo = calcularCostoUnidadBase(limpio, unidadPrecio, unidadBase);
    return dec(costo).greaterThan(0) ? costo : null;
  } catch {
    return null;
  }
}

export function CostoForm({ drogas, proveedores, unidades, jornadaActual, inicial }: CostoFormProps) {
  const router = useRouter();
  const buscarDrogas = useMemo(() => filtrarOpciones(drogas.map((d) => ({ value: d.id, label: d.nombre, sinonimos: d.sinonimos }))), [drogas]);
  const buscarProveedores = useMemo(() => filtrarOpciones(proveedores.map((p) => ({ value: p.id, label: p.razonSocial }))), [proveedores]);

  // A pair that arrives chosen is fixed: this is "the costo of THIS droga and proveedor", not a blank entry.
  const parFijo = inicial.droga !== null && inicial.proveedor !== null;
  const [droga, setDroga] = useState<ComboboxOption | null>(inicial.droga ? { value: inicial.droga.id, label: inicial.droga.nombre } : null);
  const [proveedor, setProveedor] = useState<ComboboxOption | null>(inicial.proveedor ? { value: inicial.proveedor.id, label: inicial.proveedor.razonSocial } : null);
  const [unidadId, setUnidadId] = useState(inicial.vigente?.unidadPrecioId ?? unidadInicial(drogas.find((d) => d.id === inicial.droga?.id) ?? null, unidades));
  const [precio, setPrecio] = useState(inicial.vigente?.precioInformado ?? "");
  const [fecha, setFecha] = useState(jornadaActual);
  const [motivo, setMotivo] = useState("");
  const [vigente, setVigente] = useState<EstadoVigente>(parFijo ? { tipo: "listo", costo: inicial.vigente } : { tipo: "sin-par" });
  // Only the answer to the LAST pair asked about counts: a slow answer for a pair the user already left is ignored.
  const consulta = useRef(0);

  const drogaElegida = drogas.find((d) => d.id === droga?.value) ?? null;
  const unidadesDeLaDroga = drogaElegida ? unidades.filter((u) => u.vigente && u.tipoMagnitud === drogaElegida.tipoMagnitud) : [];
  const unidadPrecio = unidades.find((u) => u.id === unidadId);
  const unidadBase = drogaElegida ? unidades.find((u) => u.id === drogaElegida.unidadBaseId) : undefined;
  const costoUnitario = costoPorUnidadBase(precio, unidadPrecio, unidadBase);

  async function consultarVigente(drogaId: string | undefined, proveedorId: string | undefined) {
    const numero = ++consulta.current;
    if (!drogaId || !proveedorId) {
      setVigente({ tipo: "sin-par" });
      return;
    }
    setVigente({ tipo: "cargando" });
    const respuesta = await obtenerCostoVigenteDelParAction(drogaId, proveedorId);
    if (numero !== consulta.current) return;
    setVigente(respuesta.status === "ok" ? { tipo: "listo", costo: respuesta.costo } : { tipo: "error", mensaje: respuesta.message });
  }

  function elegirDroga(opcion: ComboboxOption | null) {
    setDroga(opcion);
    const nueva = drogas.find((d) => d.id === opcion?.value) ?? null;
    // Keep the unit when it still fits the new droga's magnitud; otherwise start at the magnitud's default (R6).
    const sigueValida = nueva !== null && unidades.some((u) => u.id === unidadId && u.vigente && u.tipoMagnitud === nueva.tipoMagnitud);
    if (!sigueValida) setUnidadId(unidadInicial(nueva, unidades));
    void consultarVigente(opcion?.value, proveedor?.value);
  }

  function elegirProveedor(opcion: ComboboxOption | null) {
    setProveedor(opcion);
    void consultarVigente(droga?.value, opcion?.value);
  }

  const costoVigente = vigente.tipo === "listo" ? vigente.costo : null;
  const bloqueos = [
    !proveedor ? "Elegí el proveedor." : null,
    !droga ? "Elegí la droga." : null,
    vigente.tipo === "cargando" ? "Esperá a que se consulte el costo vigente." : null,
    vigente.tipo === "error" ? "No se pudo consultar el costo vigente: elegí de nuevo la droga o el proveedor." : null,
  ].filter((b): b is string => b !== null);
  const fechaAnterior = costoVigente !== null && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && fecha < costoVigente.fechaPrecio;

  return (
    <SimpleForm
      action={registrarConAviso}
      submitLabel={costoVigente ? "Guardar nuevo precio" : "Agregar costo"}
      pendingLabel="Guardando…"
      submitDisabled={bloqueos.length > 0}
      submitDisabledReason={
        <ul className="flex flex-col gap-1">
          {bloqueos.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      }
      extraActions={
        <button type="button" className="btn btn-secondary" onClick={() => router.push("/costos-proveedor")}>
          Cancelar
        </button>
      }
      onSuccess={() => router.push("/costos-proveedor")}
    >
      {/* What the user saw as vigente for the pair ("" = none): the command refuses the save if it changed (R23). */}
      <input type="hidden" name="filas.0.vigenteEsperadoId" value={costoVigente?.id ?? ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Combobox
          id="costo-proveedor"
          label="Proveedor"
          placeholder="Buscar proveedor"
          name="proveedorId"
          search={buscarProveedores}
          value={proveedor}
          onChange={elegirProveedor}
          disabled={parFijo}
        />
        <Combobox
          id="costo-droga"
          label="Droga"
          placeholder="Buscar droga"
          name="filas.0.drogaId"
          search={buscarDrogas}
          value={droga}
          onChange={elegirDroga}
          disabled={parFijo}
          helperText={unidadBase ? `Se mide en ${unidadBase.simbolo}.` : undefined}
        />
      </div>

      <div role="status" aria-live="polite" className="text-sm">
        {vigente.tipo === "cargando" ? <p className="text-zinc-500">Consultando el costo vigente…</p> : null}
        {vigente.tipo === "error" ? (
          <p className="flex items-center gap-1.5 text-red-700">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            {vigente.mensaje}
          </p>
        ) : null}
        {costoVigente ? (
          <p className="flex items-start gap-1.5 text-zinc-600">
            <Info className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />
            <span>
              Costo vigente: <span className="font-mono font-semibold text-zinc-900">{etiquetaPrecio(costoVigente.precioInformado, costoVigente.unidadPrecioSimbolo)}</span> al{" "}
              {formatFechaIso(costoVigente.fechaPrecio)} ({etiquetaAntiguedad(antiguedadDias(costoVigente.fechaPrecio, jornadaActual))}),{" "}
              {costoVigente.listaNombreArchivo ? `de la lista ${costoVigente.listaNombreArchivo}` : "carga manual"}. Al guardar, queda como valor anterior en el historial.
            </span>
          </p>
        ) : null}
        {vigente.tipo === "listo" && !costoVigente ? <p className="text-zinc-500">Todavía no hay un costo cargado para esta droga y este proveedor.</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="field">
          <label htmlFor="costo-precio" className="field-label">
            Precio informado
          </label>
          <input
            id="costo-precio"
            name="filas.0.precioInformado"
            required
            inputMode="decimal"
            autoComplete="off"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            aria-describedby="costo-precio-ayuda"
            className="input font-mono"
          />
        </div>
        <div className="field">
          <label htmlFor="costo-unidad" className="field-label">
            Unidad del precio
          </label>
          <select
            id="costo-unidad"
            name="filas.0.unidadPrecioId"
            required
            disabled={drogaElegida === null}
            value={unidadId}
            onChange={(e) => setUnidadId(e.target.value)}
            className="input"
          >
            <option value="">{drogaElegida === null ? "Elegí la droga" : "Elegí la unidad"}</option>
            {unidadesDeLaDroga.map((u) => (
              <option key={u.id} value={u.id}>
                {u.simbolo}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="costo-fecha" className="field-label">
            Fecha del precio
          </label>
          <DateInput id="costo-fecha" name="filas.0.fechaPrecio" value={fecha} onValueChange={setFecha} max={jornadaActual} required />
        </div>
      </div>
      <p id="costo-precio-ayuda" className="field-help -mt-2">
        Precio sin IVA, en pesos, por la unidad elegida, como figura en la lista del proveedor (ej.: $ 40.898 el kg: elegí kg e ingresá 40898).
        {costoUnitario && unidadBase ? (
          <>
            {" "}
            Equivale a <span className="font-mono font-semibold text-zinc-900">$ {formatearCostoUnitario(costoUnitario)}</span> por {unidadBase.simbolo}.
          </>
        ) : null}
      </p>
      {fechaAnterior && costoVigente ? (
        <p role="note" className="alert alert-warn">
          <CircleAlert aria-hidden />
          <span>La fecha es anterior a la del costo vigente ({formatFechaIso(costoVigente.fechaPrecio)}): un precio más antiguo no lo reemplaza y no se va a poder guardar.</span>
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="costo-motivo" className="field-label">
          Motivo <span className="font-normal text-zinc-500">(opcional)</span>
        </label>
        <input id="costo-motivo" name="filas.0.motivo" autoComplete="off" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="input" />
        <p className="field-help">Queda en el historial junto al precio: por ejemplo, «lista de octubre» o «corrección de un error de carga».</p>
      </div>
    </SimpleForm>
  );
}
