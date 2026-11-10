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
} from "react";
import {
  Plus,
  Trash2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  Loader2,
} from "lucide-react";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { NumeroInput } from "@/shared/ui/numero-input";
import { DateInput } from "@/shared/ui/date-input";
import { ToneBadge } from "@/shared/ui/status-badge";
import { toast } from "@/shared/ui/toast";
import { numeroParaInput } from "@/shared/decimal/numero-ingresado";
import { agregarYEnfocar, filaDeLista } from "@/shared/ui/enfocar-al-agregar";
import { markInvalidFields } from "@/shared/ui/field-errors";
import { useOperador } from "@/shared/ui/operador";
import { CAMPO_OPERADOR_PIN } from "@/shared/auth/operador-campos";
import { formatFechaIso } from "@/shared/format/fecha";
import { dec } from "@/shared/decimal";
import {
  guardarFilaRelevamientoAction,
  quitarFilaRelevamientoAction,
  pasarAStockAction,
  type PasarAStockState,
} from "./actions";
import { claveGrupo } from "../domain/existencia-inicial";
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
  jornadaActual,
  abierto,
}: PlanillaExistenciaInicialProps) {
  const [prevInitialFilas, setPrevInitialFilas] = useState(initialFilas);
  const [filas, setFilas] = useState<FilaPlanillaConEstado[]>(initialFilas);
  const filasRef = useRef<FilaPlanillaConEstado[]>(initialFilas);
  filasRef.current = filas;

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
              <div className="flex items-center gap-2">
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
              <div className="min-w-0 truncate">Costo</div>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {partidas.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                    <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                      <div className="flex items-center gap-1.5">
                        <span>{p.drogaNombre}</span>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
          Costo unitario
        </label>
        <NumeroInput
          name="costoUnitario"
          value={fila.costoUnitario ? numeroParaInput(fila.costoUnitario) : ""}
          placeholder="$"
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
