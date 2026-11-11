"use client";

/**
 * Planilla de relevamiento de existencia inicial (openspec/changes/planilla-existencia-inicial R5, R13-R16).
 * Renders the draft planilla rows, keyboard navigation (agregarYEnfocar + data-fila),
 * save-on-blur with field error marking, native <dialog> confirmation for Pasar a stock under conOperador,
 * what already passed (read-only in delivery 2), and Faltan cargar.
 */
import {
  useState,
  useRef,
  useTransition,
  useMemo,
  useActionState,
  useEffect,
} from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  Loader2,
  FileSpreadsheet,
  Download,
} from "lucide-react";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { NumeroInput } from "@/shared/ui/numero-input";
import { DateInput } from "@/shared/ui/date-input";
import { ToneBadge } from "@/shared/ui/status-badge";
import { toast } from "@/shared/ui/toast";
import { interpretarNumero, numeroParaInput } from "@/shared/decimal/numero-ingresado";
import { Decimal } from "@/shared/decimal";
import { agregarYEnfocar, filaDeLista } from "@/shared/ui/enfocar-al-agregar";
import { markInvalidFields } from "@/shared/ui/field-errors";
import { useOperador } from "@/shared/ui/operador";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { CAMPO_OPERADOR_PIN } from "@/shared/auth/operador-campos";
import { formatFechaIso } from "@/shared/format/fecha";
import { dec } from "@/shared/decimal";
import {
  guardarFilaRelevamientoAction,
  quitarFilaRelevamientoAction,
  pasarAStockAction,
  corregirCantidadInicialAction,
  corregirDatosPartidaInicialAction,
  corregirCostoPartidaAction,
  importarPlanillaExcelAction,
  type PasarAStockState,
} from "./actions";
import { IDLE_IMPORTAR_PLANILLA_EXCEL_STATE } from "./action-state";
import { SimpleForm } from "@/shared/ui/simple-form";
import { CoFirmaDt } from "@/shared/ui/co-firma-dt";
import { claveGrupo } from "../domain/existencia-inicial";
import type {
  ImportarPlanillaExcelResultado,
  CeldaNoReconocida,
} from "../application/importar-planilla-excel";
import type {
  FilaPlanillaConEstado,
  PartidaExistenciaInicialView,
  DrogaFaltanCargarRaw,
} from "../application/get-planilla-relevamiento";

export interface OpcionConMagnitud {
  id: string;
  label: string;
  tipoMagnitud: string;
  clase?: string;
  sinonimos?: readonly string[];
  simbolo?: string;
  factorABase?: string;
}

export interface OpcionSimple {
  id: string;
  label: string;
}

export interface PlanillaExistenciaInicialProps {
  filas: FilaPlanillaConEstado[];
  partidas: PartidaExistenciaInicialView[];
  faltanCargar: DrogaFaltanCargarRaw[];
  drogas: OpcionConMagnitud[];
  proveedores: OpcionSimple[];
  unidades: OpcionConMagnitud[];
  puedeEditar: boolean;
  puedePasarAStock: boolean;
  puedeCorregirPartida?: boolean;
  puedeCorregirCosto?: boolean;
  dts?: readonly { id: string; label: string }[];
  operadorEsDt?: boolean;
  jornadaActual: string;
  abierto: boolean;
}

const DIALOG_CLASS =
  "card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-2xl p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900";

const GRID_COLS_CLASS =
  "@3xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1.8fr)_minmax(0,1.2fr)_40px]";

export function PlanillaExistenciaInicial({
  filas: initialFilas,
  partidas,
  faltanCargar,
  drogas,
  proveedores,
  unidades,
  puedeEditar,
  puedePasarAStock,
  puedeCorregirPartida = false,
  puedeCorregirCosto = false,
  dts = [],
  operadorEsDt = false,
  jornadaActual,
  abierto,
}: PlanillaExistenciaInicialProps) {
  const [prevInitialFilas, setPrevInitialFilas] = useState(initialFilas);
  const [filas, setFilas] = useState<FilaPlanillaConEstado[]>(initialFilas);
  const filasRef = useRef<FilaPlanillaConEstado[]>(initialFilas);
  filasRef.current = filas;

  const [partidaACorregir, setPartidaACorregir] = useState<PartidaExistenciaInicialView | null>(null);
  const dialogCorreccionRef = useRef<HTMLDialogElement>(null);

  function abrirCorreccion(p: PartidaExistenciaInicialView) {
    setPartidaACorregir(p);
    dialogCorreccionRef.current?.showModal();
  }

  function cerrarCorreccion() {
    dialogCorreccionRef.current?.close();
    setPartidaACorregir(null);
  }

  // Track ids created locally and not yet saved successfully
  const locallyCreatedUnsavedRef = useRef<Set<string>>(new Set());

  // Track ids of rows with unsaved edits and their revision number
  const dirtyRowIdsRef = useRef<Set<string>>(new Set());
  const editVersionRef = useRef<Map<string, number>>(new Map());

  // Per-row save serialization queue
  const saveQueuesRef = useRef<Map<string, Promise<unknown>>>(new Map());

  // Per-row error message for fieldless save errors or remove errors
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [apertura, setApertura] = useState(0);
  const [resultadoPasar, setResultadoPasar] = useState<PasarAStockState | null>(null);
  const [isPendingPasar, startTransitionPasar] = useTransition();
  const operador = useOperador();

  const importDialogRef = useRef<HTMLDialogElement>(null);
  const [aperturaImport, setAperturaImport] = useState(0);
  const [ultimoResultadoImport, setUltimoResultadoImport] = useState<ImportarPlanillaExcelResultado | null>(null);

  // Merge server refresh with local state
  if (initialFilas !== prevInitialFilas) {
    setPrevInitialFilas(initialFilas);
    const localMap = new Map(filas.map((f) => [f.id, f]));
    const serverMap = new Map(initialFilas.map((s) => [s.id, s]));

    const merged: FilaPlanillaConEstado[] = initialFilas.map((serverRow) => {
      const localRow = localMap.get(serverRow.id);
      if (localRow && dirtyRowIdsRef.current.has(serverRow.id)) {
        // Dirty row: keeps its local field values, takes server's estado and display names
        return {
          ...serverRow,
          drogaId: localRow.drogaId,
          lote: localRow.lote,
          fechaVencimiento: localRow.fechaVencimiento,
          cantidad: localRow.cantidad,
          unidadMedidaId: localRow.unidadMedidaId,
          potenciaDeclarada: localRow.potenciaDeclarada,
          costoUnitario: localRow.costoUnitario,
          proveedorId: localRow.proveedorId,
          textoDroga: localRow.textoDroga,
          drogaNombre:
            localRow.drogaId === serverRow.drogaId
              ? serverRow.drogaNombre
              : (localRow.drogaNombre ?? serverRow.drogaNombre),
          drogaClase:
            localRow.drogaId === serverRow.drogaId
              ? serverRow.drogaClase
              : (localRow.drogaClase ?? serverRow.drogaClase),
          proveedorRazonSocial:
            localRow.proveedorId === serverRow.proveedorId
              ? serverRow.proveedorRazonSocial
              : (localRow.proveedorRazonSocial ?? serverRow.proveedorRazonSocial),
          unidadSimbolo:
            localRow.unidadMedidaId === serverRow.unidadMedidaId
              ? serverRow.unidadSimbolo
              : (localRow.unidadSimbolo ?? serverRow.unidadSimbolo),
        };
      }
      // Clean row: takes server row
      return serverRow;
    });

    // Only locally created and not yet saved rows survive when absent from the server list
    for (const localRow of filas) {
      if (!serverMap.has(localRow.id) && locallyCreatedUnsavedRef.current.has(localRow.id)) {
        merged.push(localRow);
      }
    }

    setFilas(merged);
    filasRef.current = merged;
  }

  const buscarDrogas = useMemo(
    () =>
      filtrarOpciones(
        drogas.map((d) => ({
          value: d.id,
          label: d.label,
          sinonimos: d.sinonimos,
        })),
      ),
    [drogas],
  );

  const buscarProveedores = useMemo(
    () =>
      filtrarOpciones(
        proveedores.map((p) => ({
          value: p.id,
          label: p.label,
        })),
      ),
    [proveedores],
  );

  function handleAgregarFila() {
    if (!puedeEditar || !abierto) return;
    const newId = crypto.randomUUID();
    locallyCreatedUnsavedRef.current.add(newId);
    dirtyRowIdsRef.current.add(newId);
    editVersionRef.current.set(newId, 1);

    const nuevaFila: FilaPlanillaConEstado = {
      id: newId,
      drogaId: null,
      drogaNombre: null,
      drogaClase: null,
      lote: null,
      fechaVencimiento: null,
      cantidad: null,
      cantidadBase: null,
      unidadMedidaId: null,
      unidadSimbolo: null,
      unidadBaseSimbolo: null,
      potenciaDeclarada: null,
      costoUnitario: null,
      proveedorId: null,
      proveedorRazonSocial: null,
      textoDroga: null,
      creadoPorNombre: "",
      creadoPorApellido: "",
      creadoEn: new Date(),
      actualizadoEn: new Date(),
      estado: {
        tipo: "incompleta",
        campoFaltante: "droga",
        motivo: "Falta la droga",
      },
    };
    setFilas((prev) => {
      const next = [...prev, nuevaFila];
      filasRef.current = next;
      return next;
    });
  }

  async function handleQuitarFila(id: string) {
    if (!puedeEditar || !abierto) return;

    const index = filasRef.current.findIndex((f) => f.id === id);
    if (index === -1) return;
    const filaAEliminar = filasRef.current[index]!;

    const wasLocallyCreatedUnsaved = locallyCreatedUnsavedRef.current.has(id);
    locallyCreatedUnsavedRef.current.delete(id);
    dirtyRowIdsRef.current.delete(id);

    setFilas((prev) => {
      const next = prev.filter((f) => f.id !== id);
      filasRef.current = next;
      return next;
    });

    try {
      const res = await quitarFilaRelevamientoAction({ id });
      if (res.status === "error") {
        if (wasLocallyCreatedUnsaved) {
          locallyCreatedUnsavedRef.current.add(id);
        }
        setFilas((prev) => {
          const next = [...prev];
          const insertAt = Math.min(index, next.length);
          next.splice(insertAt, 0, filaAEliminar);
          filasRef.current = next;
          return next;
        });
        setRowErrors((prev) => new Map(prev).set(id, res.message));
        toast(res.message, "error");
      }
    } catch (err) {
      if (wasLocallyCreatedUnsaved) {
        locallyCreatedUnsavedRef.current.add(id);
      }
      setFilas((prev) => {
        const next = [...prev];
        const insertAt = Math.min(index, next.length);
        next.splice(insertAt, 0, filaAEliminar);
        filasRef.current = next;
        return next;
      });
      const msg = err instanceof Error ? err.message : "No se pudo quitar la fila.";
      setRowErrors((prev) => new Map(prev).set(id, msg));
      toast(msg, "error");
    }
  }

  function updateFila(id: string, patch: Partial<FilaPlanillaConEstado>) {
    dirtyRowIdsRef.current.add(id);
    const nextVer = (editVersionRef.current.get(id) ?? 0) + 1;
    editVersionRef.current.set(id, nextVer);

    setRowErrors((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

    setFilas((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, ...patch } : f));
      filasRef.current = next;
      return next;
    });
  }

  function guardarFila(id: string, formEl: HTMLFormElement | null) {
    if (!puedeEditar || !abierto) return;

    const prevPromise = saveQueuesRef.current.get(id) ?? Promise.resolve();
    const nextPromise = prevPromise
      .catch(() => {})
      .then(async () => {
        const fila = filasRef.current.find((f) => f.id === id);
        if (!fila) return;

        const versionAtStart = editVersionRef.current.get(id) ?? 0;

        const res = await guardarFilaRelevamientoAction({
          id: fila.id,
          drogaId: fila.drogaId || null,
          lote: fila.lote ? fila.lote.trim() : null,
          fechaVencimiento: fila.fechaVencimiento || null,
          cantidad: fila.cantidad || null,
          unidadMedidaId: fila.unidadMedidaId || null,
          potenciaDeclarada: fila.potenciaDeclarada || null,
          costoUnitario: fila.costoUnitario || null,
          proveedorId: fila.proveedorId || null,
          textoDroga: fila.textoDroga || null,
        });

        if (res.status === "success") {
          locallyCreatedUnsavedRef.current.delete(id);
          if (editVersionRef.current.get(id) === versionAtStart) {
            dirtyRowIdsRef.current.delete(id);
          }
          setRowErrors((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
        } else if (res.status === "error") {
          setRowErrors((prev) => new Map(prev).set(id, res.message));
          if (res.fields && res.fields.length > 0 && formEl) {
            markInvalidFields(formEl, res.fields);
          }
        }
      });

    saveQueuesRef.current.set(id, nextPromise);
  }

  const filasValidas = useMemo(
    () => filas.filter((f) => f.estado.tipo === "lista" || f.estado.tipo === "se_suma"),
    [filas],
  );

  // Grouping for Pasar a stock confirmation preview
  const gruposPreview = useMemo(() => {
    const map = new Map<
      string,
      {
        clave: string;
        drogaNombre: string;
        lote: string;
        proveedorRazonSocial: string | null;
        fechaVencimiento: string | null;
        unidadBaseSimbolo: string;
        cantidadTotalBase: string;
        sinCosto: boolean;
        esVencida: boolean;
        filas: FilaPlanillaConEstado[];
      }
    >();

    for (const f of filasValidas) {
      if (!f.drogaId || !f.lote) continue;
      const clave = claveGrupo(f.drogaId, f.lote, f.proveedorId);
      let g = map.get(clave);
      if (!g) {
        const esVencida = Boolean(
          f.fechaVencimiento && f.fechaVencimiento.trim() < jornadaActual,
        );
        g = {
          clave,
          drogaNombre: f.drogaNombre ?? "Droga",
          lote: f.lote.trim(),
          proveedorRazonSocial: f.proveedorRazonSocial,
          fechaVencimiento: f.fechaVencimiento,
          unidadBaseSimbolo: f.unidadBaseSimbolo ?? f.unidadSimbolo ?? "",
          cantidadTotalBase: "0",
          sinCosto: !f.costoUnitario || f.costoUnitario.trim() === "",
          esVencida,
          filas: [],
        };
        map.set(clave, g);
      }
      g.filas.push(f);
      try {
        const cantToAdd = f.cantidadBase ?? f.cantidad;
        if (cantToAdd) {
          g.cantidadTotalBase = dec(g.cantidadTotalBase).plus(dec(cantToAdd)).toString();
        }
      } catch {
        // ignore format errors in summation preview
      }
      if (f.costoUnitario && f.costoUnitario.trim() !== "") {
        g.sinCosto = false;
      }
    }
    return Array.from(map.values());
  }, [filasValidas, jornadaActual]);

  function handleConfirmarPasarAStock() {
    startTransitionPasar(async () => {
      await Promise.allSettled([...saveQueuesRef.current.values()]);
      const datos = new FormData();
      let pedirOperador = operador.requierePin("stock.partida.ingresar");
      let errorOperador: string | undefined;
      let resultado: PasarAStockState;

      for (;;) {
        if (pedirOperador) {
          const campos = await operador.pedir(errorOperador);
          if (!campos) return;
          for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
        }
        resultado = await pasarAStockAction({ status: "idle" }, datos);
        if (resultado.status === "operador-required") {
          pedirOperador = true;
          errorOperador = undefined;
        } else if (
          resultado.status === "error" &&
          "fields" in resultado &&
          (resultado as { fields?: string[] }).fields?.includes(CAMPO_OPERADOR_PIN)
        ) {
          pedirOperador = true;
          errorOperador = resultado.message;
        } else {
          break;
        }
      }
      setResultadoPasar(resultado);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Planilla section (only when abierto) */}
      {abierto ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Planilla de relevamiento ({filas.length})
              </h2>
              <p className="text-xs text-zinc-500">
                Borrador compartido: los cambios se guardan automáticamente al salir de cada campo.
              </p>
            </div>
            {puedeEditar ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    agregarYEnfocar(handleAgregarFila, () =>
                      filaDeLista("relevamiento-fila"),
                    )
                  }
                  className="btn btn-secondary btn-sm"
                >
                  <Plus className="size-4" aria-hidden />
                  <span>Agregar fila</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAperturaImport((n) => n + 1);
                    importDialogRef.current?.showModal();
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  <FileSpreadsheet className="size-4" aria-hidden />
                  <span>Importar desde Excel</span>
                </button>
                <a
                  href="/api/stock/existencia-inicial/plantilla/xlsx"
                  download="plantilla-existencia-inicial.xlsx"
                  className="btn btn-ghost btn-sm"
                >
                  <Download className="size-4" aria-hidden />
                  <span>Descargar plantilla</span>
                </a>
                <button
                  type="button"
                  onClick={() => dialogRef.current?.showModal()}
                  disabled={filasValidas.length === 0 || !puedePasarAStock}
                  className="btn btn-primary btn-sm"
                >
                  <ArrowRight className="size-4" aria-hidden />
                  <span>Pasar a stock ({filasValidas.length})</span>
                </button>
              </div>
            ) : null}
          </div>

          {ultimoResultadoImport && ultimoResultadoImport.noReconocidos.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50/80 p-4 text-xs dark:border-amber-900/60 dark:bg-amber-950/30">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    Última importación: {ultimoResultadoImport.filasImportadas} fila{ultimoResultadoImport.filasImportadas === 1 ? "" : "s"} importada{ultimoResultadoImport.filasImportadas === 1 ? "" : "s"}, {ultimoResultadoImport.noReconocidos.length} celda{ultimoResultadoImport.noReconocidos.length === 1 ? "" : "s"} no reconocida{ultimoResultadoImport.noReconocidos.length === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setUltimoResultadoImport(null)}
                  aria-label="Descartar aviso"
                  className="btn btn-ghost btn-xs text-amber-800 dark:text-amber-300"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Las siguientes celdas no se reconocieron y quedaron en blanco o con el texto leído para completar en la planilla:
              </p>
              <div className="max-h-48 overflow-y-auto divide-y divide-amber-200/60 dark:divide-amber-900/40">
                {ultimoResultadoImport.noReconocidos.map((item, idx) => (
                  <div key={idx} className="flex flex-wrap items-center justify-between gap-2 py-1">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      Fila {item.fila} · {item.columna}:
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-xs" title={item.valor}>
                      «{item.valor || "(vacío)"}»
                    </span>
                    <span className="text-amber-700 dark:text-amber-400">
                      {item.motivo}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="@container w-full">
            {/* Desktop grid header (visible above @3xl, fits 768px container) */}
            <div
              className={`hidden @3xl:grid ${GRID_COLS_CLASS} items-center gap-2 pb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200 dark:border-zinc-800`}
            >
              <div className="min-w-0 truncate">Droga / Insumo</div>
              <div className="min-w-0 truncate">Lote</div>
              <div className="min-w-0 truncate">Vencimiento</div>
              <div className="min-w-0 truncate">Cantidad</div>
              <div className="min-w-0 truncate">Unidad</div>
              <div className="min-w-0 truncate">Pureza (%)</div>
              <div className="min-w-0 truncate" title="Precio de una unidad de la fila (ej. $ por kg)">Costo por unidad</div>
              <div className="min-w-0 truncate">Proveedor</div>
              <div className="min-w-0 truncate">Estado</div>
              <div></div>
            </div>

            {filas.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
                <p className="text-sm text-zinc-500">
                  La planilla está vacía. Agregá filas con el botón &ldquo;Agregar fila&rdquo;.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 @3xl:gap-0 divide-y divide-zinc-200 dark:divide-zinc-800">
                {filas.map((fila) => (
                  <FilaPlanillaItem
                    key={fila.id}
                    fila={fila}
                    saveError={rowErrors.get(fila.id)}
                    drogas={drogas}
                    unidades={unidades}
                    buscarDrogas={buscarDrogas}
                    buscarProveedores={buscarProveedores}
                    puedeEditar={puedeEditar}
                    onUpdateFila={(patch) => updateFila(fila.id, patch)}
                    onGuardarFila={(id, formEl) => guardarFila(id, formEl)}
                    onQuitarFila={() => handleQuitarFila(fila.id)}
                    onAgregarFilaEnter={() =>
                      agregarYEnfocar(handleAgregarFila, () =>
                        filaDeLista("relevamiento-fila"),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* Pasar a stock native dialog */}
      <dialog
        ref={dialogRef}
        className={DIALOG_CLASS}
        onClose={() => {
          setApertura((n) => n + 1);
          setResultadoPasar(null);
        }}
      >
        <div key={apertura} className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {resultadoPasar ? "Resultado de pasar a stock" : "Pasar filas a stock"}
              </h3>
              <p className="text-xs text-zinc-500">
                {resultadoPasar
                  ? resultadoPasar.status === "success"
                    ? resultadoPasar.message
                    : "Ocurrió un error al procesar el pase a stock."
                  : `${filasValidas.length} fila${filasValidas.length === 1 ? "" : "s"} lista${filasValidas.length === 1 ? "" : "s"} se agruparán en ${gruposPreview.length} partida${gruposPreview.length === 1 ? "" : "s"}.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Cerrar diálogo"
              className="btn btn-ghost btn-sm"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {resultadoPasar ? (
            <div className="flex flex-col gap-4">
              {resultadoPasar.status === "success" ? (
                <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                  {resultadoPasar.resultados.map((r, i) => (
                    <div
                      key={r.grupoClave || i}
                      className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-800/40"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {r.drogaNombre} · Lote {r.lote}
                        </span>
                        {r.ok ? (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">
                            Partida creada / actualizada
                          </span>
                        ) : (
                          <span className="text-xs text-red-600 dark:text-red-400">
                            {r.error}
                          </span>
                        )}
                      </div>
                      {r.ok ? (
                        <ToneBadge tone="success">Pasada</ToneBadge>
                      ) : (
                        <ToneBadge tone="danger">Error</ToneBadge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  <p className="font-medium">{(resultadoPasar as { message?: string }).message ?? "Error"}</p>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  className="btn btn-secondary btn-sm"
                >
                  Cerrar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                {gruposPreview.map((g) => (
                  <div
                    key={g.clave}
                    className="flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-800/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {g.drogaNombre}
                      </span>
                      <span className="text-xs text-zinc-500 font-mono">
                        Lote: {g.lote}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <span>Total: {g.cantidadTotalBase} {g.unidadBaseSimbolo}</span>
                      <span>·</span>
                      <span>{g.proveedorRazonSocial ?? "Sin proveedor"}</span>
                      {g.fechaVencimiento ? (
                        <>
                          <span>·</span>
                          <span>Vto: {formatFechaIso(g.fechaVencimiento)}</span>
                        </>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {g.sinCosto ? (
                        <span className="inline-flex items-center text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                          Sin costo (tomará costo vigente de proveedor o $0)
                        </span>
                      ) : null}
                      {g.esVencida ? (
                        <span className="inline-flex items-center text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
                          Vencida (quedará vencida con saldo)
                        </span>
                      ) : null}
                      {g.filas.length > 1 ? (
                        <span className="inline-flex items-center text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                          Suma {g.filas.length} filas
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  className="btn btn-ghost btn-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmarPasarAStock}
                  disabled={isPendingPasar || gruposPreview.length === 0}
                  className="btn btn-primary btn-sm"
                >
                  {isPendingPasar ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      <span>Pasando a stock...</span>
                    </>
                  ) : (
                    <span>Confirmar y pasar a stock</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </dialog>

      {/* Importar desde Excel native dialog (R21) */}
      <dialog
        ref={importDialogRef}
        className={DIALOG_CLASS}
        onClose={() => setAperturaImport((n) => n + 1)}
      >
        <div key={aperturaImport} className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Importar planilla desde Excel
              </h3>
              <p className="text-xs text-zinc-500">
                Cargá un archivo .xlsx con el relevamiento físico. Se agregará como filas a la planilla.
              </p>
            </div>
            <button
              type="button"
              onClick={() => importDialogRef.current?.close()}
              aria-label="Cerrar diálogo"
              className="btn btn-ghost btn-sm"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <ImportarExcelDialogForm
            onImportado={(resultado) => {
              setUltimoResultadoImport(resultado);
            }}
            onCerrar={() => importDialogRef.current?.close()}
          />
        </div>
      </dialog>

      {/* Partidas ya pasadas a stock (R5) */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Partidas pasadas a stock ({partidas.length})
          </h2>
          <p className="text-xs text-zinc-500">
            Partidas creadas o sumadas durante el relevamiento inicial.
          </p>
        </div>

        {partidas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Todavía no se pasó ninguna partida a stock.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-2.5">Droga</th>
                  <th className="px-4 py-2.5">Lote</th>
                  <th className="px-4 py-2.5">Proveedor</th>
                  <th className="px-4 py-2.5">Vencimiento</th>
                  <th className="px-4 py-2.5 text-right">Inicial</th>
                  <th className="px-4 py-2.5 text-right">Disponible</th>
                  <th className="px-4 py-2.5 text-center">Estado</th>
                  {abierto && (puedeCorregirPartida || puedeCorregirCosto) ? (
                    <th className="px-4 py-2.5 text-right">Acciones</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {partidas.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                    <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{p.drogaNombre}</span>
                        {p.anulada ? (
                          <ToneBadge tone="neutral">Anulada</ToneBadge>
                        ) : null}
                        {p.sinCosto ? (
                          <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                            Sin costo
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-zinc-700 dark:text-zinc-300">
                      {p.lote}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                      {p.proveedorRazonSocial ?? "Sin proveedor"}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                      {p.fechaVencimiento ? formatFechaIso(p.fechaVencimiento) : "No vence"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-900 dark:text-zinc-100">
                      {p.cantidadInicial} {p.unidadSimbolo}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-900 dark:text-zinc-100">
                      {p.cantidadDisponible} {p.unidadSimbolo}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <ToneBadge tone={p.usada ? "warn" : "success"}>
                        {p.usada ? "En uso" : "Sin uso"}
                      </ToneBadge>
                    </td>
                    {abierto && (puedeCorregirPartida || puedeCorregirCosto) ? (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => abrirCorreccion(p)}
                          className="btn btn-secondary btn-sm"
                        >
                          Corregir
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Dialog corrección de partida de existencia inicial (R17, R18) */}
      <dialog
        ref={dialogCorreccionRef}
        onClose={cerrarCorreccion}
        className={DIALOG_CLASS}
        aria-labelledby="dialog-corregir-partida-titulo"
      >
        {partidaACorregir ? (
          <DialogCorregirPartidaContent
            partida={partidaACorregir}
            drogas={drogas}
            proveedores={proveedores}
            unidades={unidades}
            dts={dts}
            operadorEsDt={operadorEsDt}
            puedeCorregirCosto={puedeCorregirCosto}
            puedeCorregirPartida={puedeCorregirPartida}
            onClose={cerrarCorreccion}
          />
        ) : null}
      </dialog>

      {/* Faltan cargar (R16) */}
      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-800/20">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Faltan cargar ({faltanCargar.length})
          </h2>
          <span className="text-xs text-zinc-500">Informativo: no bloquea el relevamiento</span>
        </div>
        <p className="text-xs text-zinc-500">
          Drogas activas sin partida de existencia inicial y sin filas en la planilla.
        </p>
        {faltanCargar.length === 0 ? (
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Todas las drogas activas tienen existencia inicial o están en la planilla.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {faltanCargar.map((d) => (
              <span
                key={d.id}
                className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                <span>{d.nombre}</span>
                <span className="text-[10px] text-zinc-400 font-mono">({d.unidad_base_simbolo})</span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface ImportarExcelDialogFormProps {
  onImportado: (resultado: ImportarPlanillaExcelResultado) => void;
  onCerrar: () => void;
}

function ImportarExcelDialogForm({ onImportado, onCerrar }: ImportarExcelDialogFormProps) {
  const [state, formAction, isPending] = useActionState(
    importarPlanillaExcelAction,
    IDLE_IMPORTAR_PLANILLA_EXCEL_STATE,
  );
  const { onSubmit } = useFormSubmit(formAction, { estado: state });
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onImportado(state.resultado);
    }
  }, [state, router, onImportado]);

  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              {state.message}
            </h4>
          </div>
          <p className="text-xs text-emerald-800 dark:text-emerald-300">
            Las filas ya se encuentran agregadas a la planilla y están visibles para todos los usuarios.
          </p>
        </div>

        {state.resultado.noReconocidos.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/30">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <h5 className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                Valores no reconocidos ({state.resultado.noReconocidos.length})
              </h5>
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Quedaron en blanco o con el texto leído para completar manualmente en la planilla:
            </p>
            <div className="max-h-56 overflow-y-auto divide-y divide-amber-200/60 text-xs dark:divide-amber-900/40">
              {state.resultado.noReconocidos.map((item: CeldaNoReconocida, idx: number) => (
                <div key={idx} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Fila {item.fila} ({item.columna}):
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-xs" title={item.valor}>
                    «{item.valor || "(vacío)"}»
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    {item.motivo}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onCerrar}
            className="btn btn-primary btn-sm"
          >
            Ver en la planilla
          </button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Plantilla modelo
          </span>
          <span>Podés descargar el archivo Excel con las columnas requeridas y ejemplos.</span>
        </div>
        <a
          href="/api/stock/existencia-inicial/plantilla/xlsx"
          download="plantilla-existencia-inicial.xlsx"
          className="btn btn-secondary btn-sm shrink-0"
        >
          <Download className="size-4" aria-hidden />
          <span>Descargar</span>
        </a>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="archivo-importar-excel"
          className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400"
        >
          Archivo Excel (.xlsx) *
        </label>
        <input
          id="archivo-importar-excel"
          type="file"
          name="archivo"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          disabled={isPending}
          className="block w-full text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-800 hover:file:bg-zinc-200 dark:text-zinc-400 dark:file:bg-zinc-800 dark:file:text-zinc-200 dark:hover:file:bg-zinc-700"
        />
        <p className="text-xs text-zinc-500">
          Columnas mínimas requeridas: <strong>Droga</strong> y <strong>Cantidad</strong>. Máximo 1000 filas.
        </p>
      </div>

      {state.status === "error" ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-medium">{state.message}</p>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={onCerrar}
          disabled={isPending}
          className="btn btn-secondary btn-sm"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="btn btn-primary btn-sm"
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              <span>Importando…</span>
            </>
          ) : (
            <>
              <FileSpreadsheet className="size-4" aria-hidden />
              <span>Importar planilla</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}

interface FilaPlanillaItemProps {
  fila: FilaPlanillaConEstado;
  saveError?: string;
  drogas: OpcionConMagnitud[];
  unidades: OpcionConMagnitud[];
  buscarDrogas: (q: string) => Promise<readonly ComboboxOption[]>;
  buscarProveedores: (q: string) => Promise<readonly ComboboxOption[]>;
  puedeEditar: boolean;
  onUpdateFila: (patch: Partial<FilaPlanillaConEstado>) => void;
  onGuardarFila: (id: string, formEl: HTMLFormElement | null) => void;
  onQuitarFila: () => void;
  onAgregarFilaEnter: () => void;
}

function FilaPlanillaItem({
  fila,
  saveError,
  drogas,
  unidades,
  buscarDrogas,
  buscarProveedores,
  puedeEditar,
  onUpdateFila,
  onGuardarFila,
  onQuitarFila,
  onAgregarFilaEnter,
}: FilaPlanillaItemProps) {
  const formRef = useRef<HTMLFormElement>(null);

  const drogaActual = useMemo(() => {
    if (!fila.drogaId) return null;
    return {
      value: fila.drogaId,
      label: fila.drogaNombre ?? "",
    };
  }, [fila.drogaId, fila.drogaNombre]);

  const proveedorActual = useMemo(() => {
    if (!fila.proveedorId) return null;
    return {
      value: fila.proveedorId,
      label: fila.proveedorRazonSocial ?? "",
    };
  }, [fila.proveedorId, fila.proveedorRazonSocial]);

  const drogaElegida = useMemo(
    () => (fila.drogaId ? drogas.find((d) => d.id === fila.drogaId) : undefined),
    [fila.drogaId, drogas],
  );

  const unidadesFiltradas = useMemo(() => {
    if (!drogaElegida) return unidades;
    return unidades.filter((u) => u.tipoMagnitud === drogaElegida.tipoMagnitud);
  }, [drogaElegida, unidades]);

  const buscarUnidades = useMemo(
    () =>
      filtrarOpciones(
        unidadesFiltradas.map((u) => ({
          value: u.id,
          label: u.label,
        })),
      ),
    [unidadesFiltradas],
  );

  const unidadActual = useMemo(() => {
    if (!fila.unidadMedidaId) return null;
    const u = unidades.find((opt) => opt.id === fila.unidadMedidaId);
    return {
      value: fila.unidadMedidaId,
      label: u ? u.label : (fila.unidadSimbolo ?? ""),
    };
  }, [fila.unidadMedidaId, fila.unidadSimbolo, unidades]);

  function triggerBlurSave() {
    onGuardarFila(fila.id, formRef.current);
  }

  function handleKeyDown(e: React.KeyboardEvent, isLastField = false) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isLastField) {
        onAgregarFilaEnter();
      }
    }
  }

  return (
    <form
      ref={formRef}
      data-fila="relevamiento-fila"
      onSubmit={(e) => e.preventDefault()}
      className={`rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 flex flex-col gap-3 @3xl:rounded-none @3xl:border-0 @3xl:border-b @3xl:bg-transparent @3xl:p-0 @3xl:py-2.5 @3xl:shadow-none @3xl:grid ${GRID_COLS_CLASS} @3xl:items-center @3xl:gap-2`}
    >
      {/* 1. Droga */}
      <div className="flex flex-col gap-1 @3xl:contents">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 @3xl:hidden">
          Droga o insumo
        </label>
        <div className="min-w-0" onKeyDown={(e) => handleKeyDown(e, false)}>
          <Combobox
            id={`droga-${fila.id}`}
            label="Droga o insumo"
            hideLabel
            placeholder="Elegir droga"
            name="drogaId"
            size="sm"
            disabled={!puedeEditar}
            search={buscarDrogas}
            value={drogaActual}
            onChange={(opcion) => {
              const d = opcion ? drogas.find((item) => item.id === opcion.value) : undefined;
              let nuevaUnidadId = fila.unidadMedidaId;
              let nuevaUnidadSimbolo = fila.unidadSimbolo;
              if (d && !nuevaUnidadId) {
                const primera = unidades.find((u) => u.tipoMagnitud === d.tipoMagnitud);
                if (primera) {
                  nuevaUnidadId = primera.id;
                  nuevaUnidadSimbolo = primera.simbolo ?? null;
                }
              }
              onUpdateFila({
                drogaId: opcion?.value ?? null,
                drogaNombre: opcion?.label ?? null,
                drogaClase: d?.clase ?? null,
                unidadMedidaId: nuevaUnidadId,
                unidadSimbolo: nuevaUnidadSimbolo,
              });
              onGuardarFila(fila.id, formRef.current);
            }}
          />
        </div>
      </div>

      {/* 2. Lote */}
      <div className="flex flex-col gap-1 @3xl:contents">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 @3xl:hidden">
          Lote
        </label>
        <input
          name="lote"
          value={fila.lote ?? ""}
          placeholder="Lote"
          disabled={!puedeEditar}
          onChange={(e) => onUpdateFila({ lote: e.target.value })}
          onBlur={triggerBlurSave}
          onKeyDown={(e) => handleKeyDown(e, false)}
          className="input input-sm font-mono min-w-0 truncate"
        />
      </div>

      {/* 3. Vencimiento */}
      <div className="flex flex-col gap-1 @3xl:contents">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 @3xl:hidden">
          Vencimiento
        </label>
        <div className="min-w-0" onBlur={triggerBlurSave} onKeyDown={(e) => handleKeyDown(e, false)}>
          <DateInput
            name="fechaVencimiento"
            value={fila.fechaVencimiento ?? ""}
            disabled={!puedeEditar}
            onValueChange={(val) => {
              onUpdateFila({ fechaVencimiento: val || null });
              onGuardarFila(fila.id, formRef.current);
            }}
          />
        </div>
      </div>

      {/* 4. Cantidad */}
      <div className="flex flex-col gap-1 @3xl:contents">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 @3xl:hidden">
          Cantidad contada
        </label>
        <NumeroInput
          name="cantidad"
          value={fila.cantidad ?? ""}
          placeholder="Cant."
          disabled={!puedeEditar}
          onValueChange={(val) => onUpdateFila({ cantidad: val || null })}
          onBlur={triggerBlurSave}
          onKeyDown={(e) => handleKeyDown(e, false)}
          className="input input-sm font-mono text-right min-w-0 truncate"
        />
      </div>

      {/* 5. Unidad */}
      <div className="flex flex-col gap-1 @3xl:contents">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 @3xl:hidden">
          Unidad
        </label>
        <div className="min-w-0" onKeyDown={(e) => handleKeyDown(e, false)}>
          <Combobox
            id={`unidad-${fila.id}`}
            label="Unidad"
            hideLabel
            placeholder="Unidad"
            name="unidadMedidaId"
            size="sm"
            disabled={!puedeEditar}
            search={buscarUnidades}
            value={unidadActual}
            onChange={(opcion) => {
              const u = opcion ? unidades.find((item) => item.id === opcion.value) : undefined;
              onUpdateFila({
                unidadMedidaId: opcion?.value ?? null,
                unidadSimbolo: u?.simbolo ?? null,
              });
              onGuardarFila(fila.id, formRef.current);
            }}
          />
        </div>
      </div>

      {/* 6. Pureza */}
      <div className="flex flex-col gap-1 @3xl:contents">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 @3xl:hidden">
          Pureza (%)
        </label>
        <NumeroInput
          name="potenciaDeclarada"
          value={fila.potenciaDeclarada ?? ""}
          placeholder="%"
          disabled={!puedeEditar}
          onValueChange={(val) => onUpdateFila({ potenciaDeclarada: val || null })}
          onBlur={triggerBlurSave}
          onKeyDown={(e) => handleKeyDown(e, false)}
          className="input input-sm font-mono text-right min-w-0 truncate"
        />
      </div>

      {/* 7. Costo */}
      <div className="flex flex-col gap-1 @3xl:contents">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 @3xl:hidden">
          Costo por {fila.unidadSimbolo || "unidad"}
        </label>
        <NumeroInput
          name="costoUnitario"
          value={fila.costoUnitario ? numeroParaInput(fila.costoUnitario) : ""}
          placeholder={fila.unidadSimbolo ? `$ / ${fila.unidadSimbolo}` : "$"}
          aria-label={`Costo por ${fila.unidadSimbolo || "unidad"}`}
          disabled={!puedeEditar}
          onValueChange={(val) => onUpdateFila({ costoUnitario: val || null })}
          onBlur={triggerBlurSave}
          onKeyDown={(e) => handleKeyDown(e, false)}
          className="input input-sm font-mono text-right min-w-0 truncate"
        />
      </div>

      {/* 8. Proveedor (last input: Enter adds a row) */}
      <div className="flex flex-col gap-1 @3xl:contents">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 @3xl:hidden">
          Proveedor (opcional)
        </label>
        <div className="min-w-0" onKeyDown={(e) => handleKeyDown(e, true)}>
          <Combobox
            id={`proveedor-${fila.id}`}
            label="Proveedor"
            hideLabel
            placeholder="Sin proveedor"
            name="proveedorId"
            size="sm"
            disabled={!puedeEditar}
            search={buscarProveedores}
            value={proveedorActual}
            onChange={(opcion) => {
              onUpdateFila({
                proveedorId: opcion?.value ?? null,
                proveedorRazonSocial: opcion?.label ?? null,
              });
              onGuardarFila(fila.id, formRef.current);
            }}
          />
        </div>
      </div>

      {/* 9. Estado */}
      <div className="flex items-center gap-1.5 min-w-0 pt-2 @3xl:pt-0 overflow-hidden">
        <EstadoFilaBadge estado={fila.estado} />
      </div>

      {/* 10. Quitar fila */}
      <div className="flex items-center justify-end @3xl:justify-center w-10">
        {puedeEditar ? (
          <button
            type="button"
            onClick={onQuitarFila}
            aria-label="Quitar fila"
            title="Quitar fila"
            className="btn btn-ghost btn-sm text-zinc-400 hover:text-red-600 p-1"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* Save error with no fields */}
      {saveError ? (
        <div className="col-span-full pt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {saveError}
        </div>
      ) : null}
    </form>
  );
}

function EstadoFilaBadge({ estado }: { estado: FilaPlanillaConEstado["estado"] }) {
  if (estado.tipo === "lista") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
        title="Lista para pasar a stock"
      >
        <CheckCircle2 className="size-3" aria-hidden />
        <span>Lista</span>
      </span>
    );
  }

  if (estado.tipo === "incompleta") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-700 bg-zinc-100 border border-zinc-200 rounded px-1.5 py-0.5 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 truncate"
        title={estado.motivo}
      >
        <Info className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {estado.campoFaltante ? `Falta ${estado.campoFaltante}` : "Incompleta"}
        </span>
      </span>
    );
  }

  if (estado.tipo === "se_suma") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
        title={estado.motivo ?? "Se suma"}
      >
        <Plus className="size-3" aria-hidden />
        <span>Se suma</span>
      </span>
    );
  }

  if (estado.tipo === "en_conflicto") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800 truncate"
        title={estado.motivo ?? estado.diferencia}
      >
        <AlertTriangle className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{estado.diferencia ?? "Conflicto"}</span>
      </span>
    );
  }

  return null;
}

function parseDecimalSeguro(texto: string): Decimal | null {
  const interpretado = interpretarNumero(texto);
  if (!interpretado.ok) return null;
  try {
    const d = new Decimal(interpretado.valor);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function DialogCorregirPartidaContent({
  partida,
  drogas,
  proveedores,
  unidades,
  dts,
  operadorEsDt,
  puedeCorregirCosto,
  puedeCorregirPartida,
  onClose,
}: {
  partida: PartidaExistenciaInicialView;
  drogas: OpcionConMagnitud[];
  proveedores: OpcionSimple[];
  unidades: OpcionConMagnitud[];
  dts: readonly { id: string; label: string }[];
  operadorEsDt?: boolean;
  puedeCorregirCosto: boolean;
  puedeCorregirPartida: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"cantidad" | "datos" | "costo">("cantidad");
  const [cantidadInput, setCantidadInput] = useState(partida.cantidadInicial);
  const [unidadSeleccionadaId, setUnidadSeleccionadaId] = useState(partida.unidadBaseId);
  const [proveedorSeleccionadoId, setProveedorSeleccionadoId] = useState(partida.proveedorId);

  // Droga details
  const droga = drogas.find((d) => d.id === partida.drogaId);
  const unidadesCompatibles = useMemo(() => {
    if (!droga?.tipoMagnitud) return unidades;
    const compatibles = unidades.filter((u) => u.tipoMagnitud === droga.tipoMagnitud);
    return compatibles.length > 0 ? compatibles : unidades;
  }, [unidades, droga]);

  // Co-firma needed when controlled droga is lowered
  const esControlada = Boolean(partida.tipoControl && partida.tipoControl !== "NINGUNO");
  const esBaja = useMemo(() => {
    const parsed = parseDecimalSeguro(cantidadInput);
    const cantidadInicialNum = parseDecimalSeguro(partida.cantidadInicial);
    if (!parsed || !cantidadInicialNum) return false;

    const unidadElegida = unidades.find((u) => u.id === unidadSeleccionadaId);
    const unidadBase = unidades.find((u) => u.id === partida.unidadBaseId);
    const factorElegida = unidadElegida?.factorABase
      ? parseDecimalSeguro(unidadElegida.factorABase)
      : unidadSeleccionadaId === partida.unidadBaseId
        ? dec(1)
        : null;
    const factorBase = unidadBase?.factorABase
      ? parseDecimalSeguro(unidadBase.factorABase)
      : dec(1);

    if (factorElegida && factorBase && !factorBase.isZero()) {
      const cantidadEnBase = parsed.times(factorElegida).dividedBy(factorBase);
      return cantidadEnBase.lessThan(cantidadInicialNum);
    }
    return parsed.lessThan(cantidadInicialNum);
  }, [cantidadInput, partida.cantidadInicial, partida.unidadBaseId, unidadSeleccionadaId, unidades]);
  const requiereCoFirma = esControlada && esBaja;

  const fechaVencimientoIso = partida.fechaVencimiento
    ? partida.fechaVencimiento.slice(0, 10)
    : "";

  return (
    <div className="flex flex-col max-h-[85vh] overflow-hidden">
      {/* Dialog header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h2 id="dialog-corregir-partida-titulo" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Corregir partida de existencia inicial
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{partida.drogaNombre}</span>
            <span>·</span>
            <span className="font-mono">Lote: {partida.lote}</span>
            {partida.anulada ? (
              <ToneBadge tone="neutral">Anulada</ToneBadge>
            ) : null}
            <ToneBadge tone={partida.usada ? "warn" : "success"}>
              {partida.usada ? "En uso" : "Sin uso"}
            </ToneBadge>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar diálogo"
          className="btn btn-ghost btn-sm btn-icon"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 px-6 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        {puedeCorregirPartida ? (
          <button
            type="button"
            onClick={() => setTab("cantidad")}
            className={`border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              tab === "cantidad"
                ? "border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
            }`}
          >
            Cantidad inicial
          </button>
        ) : null}

        {!partida.usada && puedeCorregirPartida ? (
          <button
            type="button"
            onClick={() => setTab("datos")}
            className={`border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              tab === "datos"
                ? "border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
            }`}
          >
            Datos (lote, vencimiento, proveedor)
          </button>
        ) : null}

        {puedeCorregirCosto ? (
          <button
            type="button"
            onClick={() => setTab("costo")}
            className={`border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              tab === "costo"
                ? "border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
            }`}
          >
            Costo unitario
          </button>
        ) : null}
      </div>

      {/* Dialog content */}
      <div className="overflow-y-auto p-6">
        {tab === "cantidad" && puedeCorregirPartida ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-zinc-500">
              Ingresá la <strong>cantidad inicial correcta</strong> de la partida. La diferencia con la cantidad actual ({partida.cantidadInicial} {partida.unidadSimbolo}) se registrará como una corrección inicial (suma o resta). Se admite 0 para anular la partida.
            </p>
            <SimpleForm
              action={corregirCantidadInicialAction}
              accion="stock.partida.ingresar"
              submitLabel="Guardar cantidad"
              onSuccess={() => {
                toast("Cantidad inicial corregida.");
                onClose();
              }}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="partidaId" value={partida.id} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="field">
                  <label htmlFor="correccion-cantidad" className="field-label">
                    Cantidad inicial correcta
                  </label>
                  <NumeroInput
                    id="correccion-cantidad"
                    name="cantidad"
                    value={cantidadInput}
                    onValueChange={(val) => setCantidadInput(val)}
                    required
                    className="input font-mono"
                  />
                </div>
                <div className="field">
                  <label htmlFor="correccion-unidadId" className="field-label">
                    Unidad
                  </label>
                  <select
                    id="correccion-unidadId"
                    name="unidadId"
                    value={unidadSeleccionadaId}
                    onChange={(e) => setUnidadSeleccionadaId(e.target.value)}
                    className="input"
                  >
                    {unidadesCompatibles.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label htmlFor="correccion-observacion" className="field-label">
                  Observación (opcional)
                </label>
                <textarea
                  id="correccion-observacion"
                  name="observacion"
                  rows={2}
                  placeholder="Motivo de la corrección..."
                  className="input"
                />
              </div>

              {requiereCoFirma ? (
                <div className="pt-2">
                  <CoFirmaDt dts={dts} operadorEsDt={operadorEsDt} />
                </div>
              ) : null}
            </SimpleForm>
          </div>
        ) : null}

        {tab === "datos" && !partida.usada && puedeCorregirPartida ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-zinc-500">
              Esta partida aún no ha sido utilizada. Podés corregir su lote, fecha de vencimiento y proveedor.
            </p>
            <SimpleForm
              action={corregirDatosPartidaInicialAction}
              accion="stock.partida.ingresar"
              submitLabel="Guardar datos"
              onSuccess={() => {
                toast("Datos de la partida corregidos.");
                onClose();
              }}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="partidaId" value={partida.id} />
              <div className="field">
                <label htmlFor="correccion-lote" className="field-label">
                  Lote
                </label>
                <input
                  type="text"
                  id="correccion-lote"
                  name="lote"
                  defaultValue={partida.lote}
                  required
                  className="input font-mono"
                />
              </div>

              <div className="field">
                <label htmlFor="correccion-vencimiento" className="field-label">
                  Fecha de vencimiento {partida.drogaClase === "DROGA" ? "(obligatoria)" : "(opcional)"}
                </label>
                <DateInput
                  id="correccion-vencimiento"
                  name="fechaVencimiento"
                  defaultValue={fechaVencimientoIso}
                  required={partida.drogaClase === "DROGA"}
                />
              </div>

              <div className="field">
                <label htmlFor="correccion-proveedorId" className="field-label">
                  Proveedor (opcional)
                </label>
                <select
                  id="correccion-proveedorId"
                  name="proveedorId"
                  value={proveedorSeleccionadoId ?? ""}
                  onChange={(e) => setProveedorSeleccionadoId(e.target.value || null)}
                  className="input"
                >
                  <option value="">Sin proveedor</option>
                  {proveedores.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.label}
                    </option>
                  ))}
                </select>
              </div>
            </SimpleForm>
          </div>
        ) : null}

        {tab === "costo" && puedeCorregirCosto ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-zinc-500">
              Corregir el costo unitario por unidad base. Actual: <span className="font-mono font-medium">${partida.costoUnitario}</span>
            </p>
            <SimpleForm
              action={corregirCostoPartidaAction}
              accion="stock.partida.costo.corregir"
              submitLabel="Guardar costo"
              onSuccess={() => {
                toast("Costo corregido.");
                onClose();
              }}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="id" value={partida.id} />
              <div className="field">
                <label htmlFor="correccion-costoUnitarioNuevo" className="field-label">
                  Costo unitario nuevo
                </label>
                <NumeroInput
                  id="correccion-costoUnitarioNuevo"
                  name="costoUnitarioNuevo"
                  defaultValue={partida.costoUnitario}
                  required
                  className="input font-mono"
                />
              </div>
              <div className="field">
                <label htmlFor="correccion-motivo-costo" className="field-label">
                  Motivo de la corrección
                </label>
                <textarea
                  id="correccion-motivo-costo"
                  name="motivo"
                  required
                  rows={2}
                  placeholder="Motivo de la corrección de costo..."
                  className="input"
                />
              </div>
            </SimpleForm>
          </div>
        ) : null}
      </div>
    </div>
  );
}

