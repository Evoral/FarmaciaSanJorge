"use client";

/**
 * Editable preview of a supplier price list import (openspec/specs/costos-proveedor/spec.md R18-R20), modelled on the
 * supplier invoice import form (modules/stock/ui/importar-factura-form.tsx): what was read from the file, row by
 * row, to review and correct before ONE confirmation that is all or nothing (`importarListaPreciosAction`).
 *
 * Every value lives in React state and the kept rows are sent as ONE JSON field (`listaJson`), so an error never
 * loses what was edited (`SimpleForm` -> `shared/ui/use-form-submit.ts` only resets on success). The rows are
 * evaluated with the SAME pure rules the server used to build the preview (`evaluarFilasLista`): picking another
 * droga, changing a unit, correcting a price or omitting a row re-evaluates its state, its variation and the
 * duplicates of the whole list at once.
 *
 * A list has about a thousand rows, so the table is paginated on the client (PAGE_SIZE rows per page) and filtered
 * by state from the summary chips. Only the rows that will really be applied (state "Asociada") are sent, with only
 * the fields the command needs, so the payload stays far below the Server Actions body limit (checked anyway).
 *
 * Errors: the server refuses the WHOLE confirmation when any row is invalid and points at `filas.<i>.<campo>` (`i`
 * = position among the SENT rows). The marks are React-owned here (`aria-invalid`, a red row, the offending fields
 * named) and not the DOM-level `shared/ui/field-errors.ts`: with pagination most rows have no DOM at all, so the
 * form jumps to the page of the first refused row. A mark disappears when that row is edited.
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, Plus, TriangleAlert } from "lucide-react";
import type { DrogaCreada } from "@/modules/drogas/ui/action-state";
import type { UnidadOpcion } from "@/modules/drogas/ui/droga-form";
import { NuevaDrogaDialog } from "@/modules/drogas/ui/nueva-droga-dialog";
import { normalizarTexto } from "@/modules/drogas/domain/normalizar";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { RecordarSinonimoSwitch } from "@/shared/ui/recordar-sinonimo-switch";
import { SimpleForm } from "@/shared/ui/simple-form";
import { ToneBadge, type BadgeTone } from "@/shared/ui/status-badge";
import { toast } from "@/shared/ui/toast";
import { formatFechaIso } from "@/shared/format/fecha";
import { formatearCostoUnitario } from "@/shared/format/monto";
import { fieldLabel } from "@/shared/labels/field-labels";
import { MAX_CONFIRMACION_BYTES } from "../domain/archivo-lista";
import {
  ESTADOS_FILA_LISTA,
  ESTADO_FILA_LISTA_LABELS,
  evaluarFilasLista,
  resumirEstados,
  unidadPrecioInicial,
  type ContextoEvaluacionLista,
  type EstadoFilaLista,
  type UnidadParaLista,
  type VistaPreviaLista,
} from "../domain/importacion-lista";
import { etiquetaPrecio } from "../domain/presentacion";
import type { CostoProveedorActionState } from "./action-state";
import { importarListaPreciosAction } from "./actions";
import type { DrogaOpcionCosto, UnidadOpcionCosto } from "./costo-form";
import { numeroParaInput } from "@/shared/decimal/numero-ingresado";

const PAGE_SIZE = 50;

const numberFormat = new Intl.NumberFormat("es-AR");

const TONO_ESTADO: Readonly<Record<EstadoFilaLista, BadgeTone>> = {
  ASOCIADA: "success",
  SIN_ASOCIAR: "warn",
  DUPLICADA: "danger",
  PRECIO_INVALIDO: "danger",
  MAS_ANTIGUA: "warn",
  SIN_CAMBIOS: "neutral",
  OMITIDA_PRESENTACION: "neutral",
  OMITIDA: "neutral",
};

/** What each state means, as the tooltip of its badge and chip. */
const AYUDA_ESTADO: Readonly<Record<EstadoFilaLista, string>> = {
  ASOCIADA: "Se va a cargar como costo del proveedor (nuevo o como nueva versión del vigente).",
  SIN_ASOCIAR: "No coincide con ninguna droga: elegí una o dejala afuera.",
  DUPLICADA: "La misma droga está en más de una fila: dejá solo una.",
  PRECIO_INVALIDO: "Falta el precio o no es válido: corregilo o omití la fila.",
  MAS_ANTIGUA: "El proveedor ya tiene un precio más nuevo que esta lista: no lo reemplaza.",
  SIN_CAMBIOS: "Mismo precio, unidad y fecha que el costo vigente: no se carga nada.",
  OMITIDA_PRESENTACION: "La descripción termina en una presentación (envase): solo se importan las filas base, por kg / L / u.",
  OMITIDA: "La dejaste afuera.",
};

export interface ImportarListaFormProps {
  vista: VistaPreviaLista;
  drogas: readonly DrogaOpcionCosto[];
  unidades: readonly UnidadOpcionCosto[];
  /** After a successful confirmation (the form already raised the toast). */
  onImportada: () => void;
  /** Units for the alta de insumo of a "sin asociar" row; `null` when the session can not create drogas (no button). */
  unidadesAltaDroga: UnidadOpcion[] | null;
  /** For that alta: the contralor digital is activo (a controlled droga asks for its saldo de apertura). */
  contralorActivo?: boolean;
}

interface FilaEditable {
  droga: ComboboxOption | null;
  /** As typed (plain decimal or es-AR): the evaluation parses it. */
  precio: string;
  unidadPrecioId: string;
  omitida: boolean;
  recordar: boolean;
}

/** "+12,3 %" / "-4,0 %". */
function etiquetaVariacion(pct: string): string {
  return `${pct.startsWith("-") ? "" : "+"}${pct.replace(".", ",")} %`;
}

/** Fields the server refused, by row (index in `vista.filas`). */
type ErroresPorFila = ReadonlyMap<number, ReadonlySet<string>>;

export function ImportarListaForm({ vista, drogas: drogasDelCatalogo, unidades, onImportada, unidadesAltaDroga, contralorActivo }: ImportarListaFormProps) {
  const router = useRouter();

  /** Drogas created from a row's alta: usable at once, before the page's refresh brings them in the catalog. */
  const [drogasCreadas, setDrogasCreadas] = useState<DrogaOpcionCosto[]>([]);
  const drogas = useMemo(
    () => [...drogasDelCatalogo, ...drogasCreadas.filter((creada) => !drogasDelCatalogo.some((d) => d.id === creada.id))],
    [drogasDelCatalogo, drogasCreadas],
  );
  /** The row whose "Nuevo insumo" dialog is open. */
  const [altaFila, setAltaFila] = useState<number | null>(null);

  const unidadesLista = useMemo<UnidadParaLista[]>(
    () => unidades.map((u) => ({ id: u.id, codigo: u.codigo, simbolo: u.simbolo, tipoMagnitud: u.tipoMagnitud, factorABase: u.factorABase, vigente: u.vigente })),
    [unidades],
  );
  const contexto = useMemo<ContextoEvaluacionLista>(
    () => ({
      fechaLista: vista.fechaLista,
      drogas: new Map(drogas.map((d) => [d.id, { id: d.id, nombre: d.nombre, tipoMagnitud: d.tipoMagnitud, unidadBaseId: d.unidadBaseId }])),
      unidades: new Map(unidadesLista.map((u) => [u.id, u])),
      vigentePorDroga: new Map(vista.vigentes.map((v) => [v.drogaId, v])),
    }),
    [drogas, unidadesLista, vista.fechaLista, vista.vigentes],
  );
  const buscarDrogas = useMemo(() => filtrarOpciones(drogas.map((d) => ({ value: d.id, label: d.nombre, sinonimos: d.sinonimos }))), [drogas]);
  const indicePorNumeroFila = useMemo(() => new Map(vista.filas.map((fila, i) => [fila.numeroFila, i])), [vista.filas]);

  const [filas, setFilas] = useState<FilaEditable[]>(() =>
    vista.filas.map((fila) => ({
      // Matched through a remembered synonym: the field shows the list's text, the canonical name as a hint (openspec/specs/sinonimos-droga/spec.md).
      droga: fila.drogaId ? { value: fila.drogaId, label: fila.drogaNombre ?? fila.descripcion, sinonimo: fila.via === "ALIAS" && fila.drogaNombre ? fila.descripcion : null } : null,
      precio: numeroParaInput(fila.precio),
      unidadPrecioId: fila.unidadPrecioId ?? "",
      omitida: false,
      recordar: true,
    })),
  );
  const [filtro, setFiltro] = useState<EstadoFilaLista | null>(null);
  const [pagina, setPagina] = useState(1);
  /** The row edited last stays listed even if its new state no longer matches the filter (it would vanish under the user's hands). */
  const [fijada, setFijada] = useState<number | null>(null);
  const [erroresServidor, setErroresServidor] = useState<ErroresPorFila>(new Map());
  const [mensajeServidor, setMensajeServidor] = useState<string | null>(null);

  const evaluaciones = useMemo(
    () =>
      evaluarFilasLista(
        contexto,
        filas.map((fila, i) => ({
          drogaId: fila.droga?.value ?? null,
          precio: fila.precio,
          unidadPrecioId: fila.unidadPrecioId || null,
          omitida: fila.omitida,
          presentacion: vista.filas[i]!.presentacion,
        })),
      ),
    [contexto, filas, vista.filas],
  );
  const resumen = useMemo(() => resumirEstados(evaluaciones), [evaluaciones]);

  // "Recordar equivalencia" only makes sense when the user (not the match) chose the droga for that text, and the text
  // is not already its name (e.g. a droga just created from the row with the list's text: it matches by name).
  const recordable = (i: number): boolean => {
    const fila = filas[i]!;
    const original = vista.filas[i]!;
    return (
      fila.droga !== null &&
      !fila.omitida &&
      original.presentacion === null &&
      fila.droga.value !== original.drogaId &&
      normalizarTexto(fila.droga.label) !== normalizarTexto(original.descripcion)
    );
  };

  /** The rows that will be applied, in list order, and the JSON the confirmation sends. */
  const { listaJson, aplicables, bytes } = useMemo(() => {
    const indices = evaluaciones.flatMap((evaluacion, i) => (evaluacion.estado === "ASOCIADA" ? [i] : []));
    const json = JSON.stringify({
      proveedorId: vista.proveedor.id,
      fechaLista: vista.fechaLista,
      nombreArchivo: vista.nombreArchivo,
      hashSha256: vista.hashSha256,
      formato: vista.formato,
      filasLeidas: vista.filasLeidas,
      filas: indices.map((i) => {
        const fila = filas[i]!;
        const original = vista.filas[i]!;
        return {
          drogaId: fila.droga!.value,
          precioInformado: evaluaciones[i]!.precioCanonico,
          unidadPrecioId: fila.unidadPrecioId,
          descripcionProveedor: original.descripcion,
          vigenteEsperadoId: contexto.vigentePorDroga.get(fila.droga!.value)?.id ?? null,
          ...(fila.recordar && fila.droga!.value !== original.drogaId ? { recordarEquivalencia: true } : {}),
          numeroFila: original.numeroFila,
        };
      }),
    });
    return { listaJson: json, aplicables: indices.length, bytes: new TextEncoder().encode(json).length };
  }, [evaluaciones, filas, vista, contexto]);

  const bloqueos = [
    resumen.DUPLICADA > 0 ? `Hay ${resumen.DUPLICADA === 1 ? "1 fila duplicada" : `${resumen.DUPLICADA} filas duplicadas`}: dejá una sola por droga (omití las otras).` : null,
    resumen.PRECIO_INVALIDO > 0 ? `Hay ${resumen.PRECIO_INVALIDO === 1 ? "1 fila con precio inválido" : `${resumen.PRECIO_INVALIDO} filas con precio inválido`}: corregilas u omitilas.` : null,
    aplicables === 0 ? "No hay ningún costo para actualizar." : null,
    bytes > MAX_CONFIRMACION_BYTES ? "Son demasiadas filas para confirmar juntas: omití las que no necesites." : null,
  ].filter((b): b is string => b !== null);

  // Visible rows: by the chip's filter (plus the row being edited), in list order, one page.
  const visibles = useMemo(
    () => evaluaciones.flatMap((evaluacion, i) => (filtro === null || evaluacion.estado === filtro || i === fijada ? [i] : [])),
    [evaluaciones, filtro, fijada],
  );
  const totalPaginas = Math.max(1, Math.ceil(visibles.length / PAGE_SIZE));
  const paginaActual = Math.min(pagina, totalPaginas);
  const desde = (paginaActual - 1) * PAGE_SIZE;
  const deLaPagina = visibles.slice(desde, desde + PAGE_SIZE);

  function filtrar(estado: EstadoFilaLista | null) {
    setFiltro(estado);
    setFijada(null);
    setPagina(1);
  }

  function irAPagina(destino: number) {
    setPagina(destino);
    setFijada(null);
  }

  function editar(indice: number, cambios: Partial<FilaEditable>) {
    setFilas((actuales) => actuales.map((fila, i) => (i === indice ? { ...fila, ...cambios } : fila)));
    setFijada(indice);
    // A mark goes away as soon as that row is edited.
    setErroresServidor((actuales) => {
      if (!actuales.has(indice)) return actuales;
      const siguientes = new Map(actuales);
      siguientes.delete(indice);
      return siguientes;
    });
  }

  /** `conocida`: the droga's data when it is not in `drogas` yet (just created in this render). */
  function elegirDroga(indice: number, droga: ComboboxOption | null, conocida?: DrogaOpcionCosto) {
    const nueva = droga ? (conocida ?? drogas.find((d) => d.id === droga.value)) : undefined;
    const unidadActual = unidades.find((u) => u.id === filas[indice]!.unidadPrecioId);
    // Keep the unit when it still fits the new droga's magnitud; otherwise start at the magnitud's default (R6).
    const sigueValida = nueva !== undefined && unidadActual !== undefined && unidadActual.vigente && unidadActual.tipoMagnitud === nueva.tipoMagnitud;
    editar(indice, {
      droga,
      omitida: droga ? false : filas[indice]!.omitida,
      unidadPrecioId: sigueValida ? filas[indice]!.unidadPrecioId : nueva ? (unidadPrecioInicial(nueva.tipoMagnitud, unidadesLista) ?? "") : "",
    });
  }

  /** The row's alta created a droga: it joins the picker and is chosen for that row (its synonym switch then applies as usual). */
  function drogaCreada(indice: number, creada: DrogaCreada) {
    const tipoMagnitud = unidades.find((u) => u.id === creada.unidadBaseId)?.tipoMagnitud ?? "";
    const opcion: DrogaOpcionCosto = { id: creada.id, nombre: creada.nombre, unidadBaseId: creada.unidadBaseId, tipoMagnitud, sinonimos: [] };
    setDrogasCreadas((actuales) => [...actuales, opcion]);
    elegirDroga(indice, { value: creada.id, label: creada.nombre }, opcion);
    setAltaFila(null);
  }

  /** Enter in a row's field must not confirm the whole import: the form's own button is the only way. */
  function sinEnviarConEnter(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key === "Enter" && (evento.target as HTMLElement).tagName === "INPUT") evento.preventDefault();
  }

  /** Saves, marks the refused rows and raises the confirmation (the Toaster lives in the route's layout and survives the redirect). */
  async function confirmar(estadoPrevio: CostoProveedorActionState, formData: FormData): Promise<CostoProveedorActionState> {
    setMensajeServidor(null);
    const estado = await importarListaPreciosAction(estadoPrevio, formData);
    if (estado.status === "success") {
      if (estado.message) toast(estado.message);
      return estado;
    }
    if (estado.status === "error") {
      setMensajeServidor(estado.message);
      // `filas.<j>.<campo>`: j = position among the sent rows, named here by the row number each one carries.
      const enviadas = (JSON.parse(String(formData.get("listaJson") ?? "{}")) as { filas?: { numeroFila?: number }[] }).filas ?? [];
      const marcas = new Map<number, Set<string>>();
      for (const campo of estado.fields ?? []) {
        const coincidencia = /^filas\.(\d+)\.(.+)$/.exec(campo);
        if (!coincidencia) continue;
        const numeroFila = enviadas[Number(coincidencia[1])]?.numeroFila;
        const indice = numeroFila === undefined ? undefined : indicePorNumeroFila.get(numeroFila);
        if (indice === undefined) continue;
        marcas.set(indice, new Set([...(marcas.get(indice) ?? []), coincidencia[2]!]));
      }
      setErroresServidor(marcas);
      const primera = Math.min(...marcas.keys());
      if (Number.isFinite(primera)) {
        setFiltro(null);
        setFijada(null);
        setPagina(Math.floor(primera / PAGE_SIZE) + 1);
      }
    }
    return estado;
  }

  const omitidasPresentacion = resumen.OMITIDA_PRESENTACION;

  const filaEnAlta = altaFila === null ? null : vista.filas[altaFila]!;

  return (
    <>
      <SimpleForm
        action={confirmar}
        submitLabel={aplicables === 1 ? "Actualizar 1 costo" : `Actualizar ${numberFormat.format(aplicables)} costos`}
        pendingLabel="Importando…"
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
        onSuccess={onImportada}
      >
        <input type="hidden" name="listaJson" value={listaJson} />

        {mensajeServidor ? (
          <div role="alert" className="alert alert-danger">
            <CircleAlert aria-hidden />
            <p>{mensajeServidor} No se guardó nada: corregí las filas marcadas y confirmá de nuevo.</p>
          </div>
        ) : null}

        <p className="text-sm text-zinc-600">
          Se leyeron <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(vista.filasLeidas)}</span> filas de la hoja «{vista.hoja}»
          {omitidasPresentacion > 0 ? `; ${numberFormat.format(omitidasPresentacion)} son presentaciones y se omiten` : ""}. Los precios son sin IVA, por kg / L / u. No se guarda nada
          hasta que confirmes.
        </p>

        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
          <ChipEstado etiqueta="Todas" cantidad={vista.filas.length} activo={filtro === null} onClick={() => filtrar(null)} />
          {ESTADOS_FILA_LISTA.filter((estado) => resumen[estado] > 0).map((estado) => (
            <ChipEstado
              key={estado}
              etiqueta={ESTADO_FILA_LISTA_LABELS[estado]}
              cantidad={resumen[estado]}
              ayuda={AYUDA_ESTADO[estado]}
              activo={filtro === estado}
              onClick={() => filtrar(filtro === estado ? null : estado)}
            />
          ))}
        </div>

        {vista.filas.length === 0 ? (
          <p role="note" className="alert alert-warn">
            <TriangleAlert aria-hidden />
            <span>La hoja «{vista.hoja}» no tiene productos para importar. Probá con otra hoja del archivo.</span>
          </p>
        ) : (
          <div onKeyDownCapture={sinEnviarConEnter}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2 text-right">
                      Fila
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Estado
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Descripción del proveedor
                    </th>
                    <th scope="col" className="min-w-64 px-3 py-2">
                      Droga
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Unidad
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Precio (sin IVA)
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Vigente → nuevo
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deLaPagina.map((i) => {
                    const original = vista.filas[i]!;
                    const fila = filas[i]!;
                    const evaluacion = evaluaciones[i]!;
                    const marcas = erroresServidor.get(i);
                    const esPresentacion = original.presentacion !== null;
                    const drogaElegida = fila.droga ? drogas.find((d) => d.id === fila.droga!.value) : undefined;
                    const unidadesDeLaDroga = drogaElegida ? unidades.filter((u) => u.vigente && u.tipoMagnitud === drogaElegida.tipoMagnitud) : [];
                    const simboloUnidad = unidades.find((u) => u.id === fila.unidadPrecioId)?.simbolo;
                    const vigente = fila.droga ? (contexto.vigentePorDroga.get(fila.droga.value) ?? null) : null;
                    const atenuada = evaluacion.estado === "OMITIDA" || evaluacion.estado === "OMITIDA_PRESENTACION";
                    return (
                      <tr key={original.numeroFila} className={marcas ? "bg-red-50 dark:bg-red-950" : atenuada ? "text-zinc-500" : undefined}>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-zinc-500">{original.numeroFila}</td>
                        <td className="px-3 py-2.5">
                          <ToneBadge tone={TONO_ESTADO[evaluacion.estado]} title={AYUDA_ESTADO[evaluacion.estado]}>
                            {ESTADO_FILA_LISTA_LABELS[evaluacion.estado]}
                          </ToneBadge>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={atenuada ? "line-through" : "font-medium text-zinc-900"}>{original.descripcion}</span>
                          {esPresentacion ? <span className="block text-xs text-zinc-500">Presentación: {original.presentacion}</span> : null}
                          {evaluacion.mensaje && !esPresentacion ? <span className="block text-xs text-zinc-600">{evaluacion.mensaje}</span> : null}
                          {marcas ? (
                            <span role="alert" className="block text-xs font-medium text-red-700 dark:text-red-300">
                              Revisá: {[...marcas].map((campo) => fieldLabel(campo)).join(", ")}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          {esPresentacion ? (
                            <span className="text-zinc-400">—</span>
                          ) : (
                            <>
                              <Combobox
                                id={`fila-${original.numeroFila}-droga`}
                                label={`Droga de la fila ${original.numeroFila}`}
                                hideLabel
                                size="sm"
                                placeholder="Buscar droga"
                                search={buscarDrogas}
                                value={fila.droga}
                                onChange={(droga) => elegirDroga(i, droga)}
                                disabled={fila.omitida}
                              />
                              {unidadesAltaDroga && evaluacion.estado === "SIN_ASOCIAR" ? (
                                <button type="button" className="btn btn-secondary btn-sm mt-1.5" aria-haspopup="dialog" onClick={() => setAltaFila(i)}>
                                  <Plus className="size-3.5" aria-hidden />
                                  Nuevo insumo
                                </button>
                              ) : null}
                              {recordable(i) ? (
                                <RecordarSinonimoSwitch
                                  className="mt-1.5"
                                  texto={original.descripcion}
                                  drogaNombre={fila.droga?.label}
                                  checked={fila.recordar}
                                  onChange={(recordar) => editar(i, { recordar })}
                                />
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {esPresentacion ? null : (
                            <select
                              aria-label={`Unidad del precio de la fila ${original.numeroFila}`}
                              className="input input-sm"
                              aria-invalid={marcas?.has("unidadPrecioId") ? true : undefined}
                              disabled={!drogaElegida || fila.omitida}
                              value={fila.unidadPrecioId}
                              onChange={(e) => editar(i, { unidadPrecioId: e.target.value })}
                            >
                              <option value="">{drogaElegida ? "Elegí" : "—"}</option>
                              {unidadesDeLaDroga.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.simbolo}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {esPresentacion ? null : (
                            <input
                              aria-label={`Precio de la fila ${original.numeroFila}`}
                              className="input input-sm w-28 font-mono"
                              inputMode="decimal"
                              autoComplete="off"
                              aria-invalid={marcas?.has("precioInformado") || evaluacion.estado === "PRECIO_INVALIDO" ? true : undefined}
                              disabled={fila.omitida}
                              value={fila.precio}
                              onChange={(e) => editar(i, { precio: e.target.value })}
                            />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[0.8125rem]">
                          {esPresentacion || !fila.droga ? (
                            <span className="text-zinc-400">—</span>
                          ) : (
                            <>
                              <span className="block text-zinc-500">
                                {vigente ? `${etiquetaPrecio(vigente.precioInformado, vigente.unidadPrecioSimbolo)} · ${formatFechaIso(vigente.fechaPrecio)}` : "Sin costo vigente"}
                              </span>
                              <span className="block font-mono tabular-nums text-zinc-900">
                                {evaluacion.precioCanonico && simboloUnidad ? `→ $ ${formatearCostoUnitario(evaluacion.precioCanonico)} / ${simboloUnidad}` : "→ —"}
                              </span>
                              {evaluacion.variacionPct ? (
                                <ToneBadge tone={evaluacion.variacionAlta ? "warn" : "neutral"} title={evaluacion.variacionAlta ? "Variación mayor al 50 %: revisá el precio." : "Variación respecto del costo vigente."}>
                                  {etiquetaVariacion(evaluacion.variacionPct)}
                                </ToneBadge>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {esPresentacion ? null : (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => editar(i, { omitida: !fila.omitida })}>
                              {fila.omitida ? "Incluir" : "Omitir"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {visibles.length === 0 ? <p className="px-1 py-4 text-sm text-zinc-500">Ninguna fila tiene ese estado.</p> : null}

            {visibles.length > 0 ? (
              <div className="pagination">
                <p>
                  <span className="font-medium text-zinc-900 tabular-nums">
                    {numberFormat.format(desde + 1)}-{numberFormat.format(Math.min(visibles.length, desde + PAGE_SIZE))}
                  </span>{" "}
                  de <span className="tabular-nums">{numberFormat.format(visibles.length)}</span>
                </p>
                {totalPaginas > 1 ? (
                  <nav aria-label="Paginación de la lista" className="flex items-center gap-1">
                    <button type="button" className="page-link" aria-label="Página anterior" disabled={paginaActual <= 1} onClick={() => irAPagina(paginaActual - 1)}>
                      <ChevronLeft className="size-4" aria-hidden />
                    </button>
                    <span className="px-2 tabular-nums">
                      {paginaActual} / {totalPaginas}
                    </span>
                    <button type="button" className="page-link" aria-label="Página siguiente" disabled={paginaActual >= totalPaginas} onClick={() => irAPagina(paginaActual + 1)}>
                      <ChevronRight className="size-4" aria-hidden />
                    </button>
                  </nav>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {bloqueos.length > 0 ? (
          <ul className="field-help flex list-disc flex-col gap-0.5 pl-4">
            {bloqueos.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="field-help">
            Se actualizan {numberFormat.format(aplicables)} {aplicables === 1 ? "costo" : "costos"}; las filas sin asociar, omitidas, más antiguas o sin cambios no se tocan. Las drogas que no
            están en la lista conservan su costo vigente.
          </p>
        )}
      </SimpleForm>
      {/* Outside the import's own <form>: the alta is a form of its own. */}
      {unidadesAltaDroga ? (
        <NuevaDrogaDialog
          abierta={filaEnAlta !== null}
          nombreInicial={filaEnAlta?.descripcion ?? ""}
          subtitulo={filaEnAlta ? `Fila ${filaEnAlta.numeroFila} de la lista: al crearlo queda asociado a esa fila.` : undefined}
          unidades={unidadesAltaDroga}
          contralorActivo={contralorActivo}
          onCreada={(creada) => {
            if (altaFila !== null) drogaCreada(altaFila, creada);
          }}
          onCerrar={() => setAltaFila(null)}
        />
      ) : null}
    </>
  );
}

function ChipEstado({ etiqueta, cantidad, ayuda, activo, onClick }: { etiqueta: string; cantidad: number; ayuda?: string; activo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="chip cursor-pointer pr-2 aria-pressed:border-zinc-500 aria-pressed:bg-zinc-200"
      aria-pressed={activo}
      title={ayuda}
      onClick={onClick}
    >
      {etiqueta} <strong className="tabular-nums">{numberFormat.format(cantidad)}</strong>
    </button>
  );
}
