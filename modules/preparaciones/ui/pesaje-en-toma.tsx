"use client";

/**
 * The pesada en la ficha (openspec/specs/pesada-real/spec.md "Pesada en la ficha", migration 0090): on a Pendiente ítem of the
 * toma workspace (/preparaciones/recetas/[recetaId]) the lab fills in its ficha técnica WHILE weighing, línea by
 * línea, instead of at the end in a dialog:
 *   - the lot of every línea: a selector with the droga's eligible partidas in consumption order (abiertas first,
 *     then FEFO), the oldest preselected (`lotesPorDefecto`); with partidas of different purity each option shows it.
 *     When the chosen lot does not cover the línea, "Agregar otro lote" adds another: the chosen lots are drained in
 *     consumption order whatever the order they were picked in (the server's `repartirPesadaReal`). "A pesar" is the
 *     PHYSICAL weight over the chosen lots (purity-corrected, rounded to the balance; the active is the "Teórica"
 *     next to it); split over several lots, each lot's row shows its own share;
 *   - "Cantidad real pesada": what the balance showed (prefilled with the expected weight rounded to the balance,
 *     following the lots until typed; deviation and tolerance under it), or an enrase manual línea's quantity;
 *   - the INV-S18 motivo, only when asked;
 *   - the excipiente used (migration 0092, openspec/specs/excipiente-preparacion/spec.md): a buscador of the drogas of clase
 *     EXCIPIENTE (type to filter, never free text) and its quantity in the droga's unidad base; once one is chosen
 *     its quantity is required to confirm. Reserved oldest lot first with the drogas;
 *   - below it, with the same mechanics (migration 0110, openspec/specs/insumos-preparacion/spec.md): the "Material"
 *     (a buscador of the drogas of clase MATERIAL; for a CAPSULA ítem its quantity is pre-filled with the number of
 *     cápsulas, ignored until a material is chosen) and any number of insumos adicionales ("Agregar insumo", drogas
 *     of clase EXCIPIENTE or MATERIAL), each with its quantity in the droga's unidad base; the whole list is saved
 *     as it changes (`guardarInsumosBorradorAction`).
 * Each línea is saved as soon as it changes (a lot) or its field is left (`guardarBorradorPesadaAction`), so nothing
 * typed is lost. "Marcar como preparada" (`MarcarPreparadaDialog`, in the ítem's footer) only confirms: it lists what
 * was loaded, asks the DT co-firma when a pesada is outside the tolerance and re-authentication, and sends the same
 * fields as before to `reservarStockAction`, which re-validates everything under its locks.
 *
 * `PesajeProvider` holds the state shared by the table (card body) and the dialog (card footer); the plan and the
 * tolerance come from ./confirmar-form.tsx's pure helpers, so both flows compute the same.
 */
import { createContext, useActionState, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, FlaskConical, Info, Plus, TriangleAlert, X } from "lucide-react";
import { Decimal } from "@/shared/decimal";
import { convertirCantidad } from "@/shared/decimal/convertir-unidad";
import { formatNumero, formatStockEntero } from "@/shared/format/cantidad";
import { formatFechaIso } from "@/shared/format/fecha";
import { AYUDA_NUMERO, numeroParaInput } from "@/shared/decimal/numero-ingresado";
import { ToneBadge } from "@/shared/ui/status-badge";
import { CoFirmaDt } from "@/shared/ui/co-firma-dt";
import { toast } from "@/shared/ui/toast";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { ordenarParaConsumo } from "@/modules/stock/domain/reparto";
import { estadoVencimientoPartida } from "@/modules/stock/domain/vencimiento-partida";
import type { DatosConfirmacion, LineaPantalla } from "../application/datos-confirmacion";
import type { LineaDeFichaToma } from "../application/get-toma-receta";
import { precisionDeLinea, sugerenciaPesadaReal } from "../domain/pesada-real";
import { AvisoBajoLaBalanza } from "./aviso-bajo-la-balanza";
import { cantidadRealDesdeServidor, cantidadRealParaServidor, cantidadValida, lotesPorDefecto, pesadaDeLinea, planDeLinea, type PesadaDeLinea, type PlanDeLinea } from "./confirmar-form";
import { CantidadFicha, LotesVencidos, Vacio, conExceso } from "./lineas-ficha-tabla";
import type { TipoInsumo } from "../domain/insumo";
import { guardarBorradorPesadaAction, guardarExcipienteBorradorAction, guardarInsumosBorradorAction, reservarStockAction } from "./actions";
import { IDLE_STATE } from "./action-state";

type EstadoGuardado = "guardando" | "guardado" | "error";

type DatosInsumos = NonNullable<DatosConfirmacion["insumos"]>;

/** One row of the material / insumos adicionales (migration 0110); `clave` is the client's stable key. */
interface FilaInsumo {
  clave: string;
  tipo: TipoInsumo;
  drogaId: string | null;
  cantidad: string;
}

interface PesajeContexto {
  datos: DatosConfirmacion;
  elegidas: Record<string, string[]>;
  reales: Record<string, string>;
  manuales: Record<string, string>;
  motivos: Record<string, string>;
  planes: PlanDeLinea[];
  pesadas: (PesadaDeLinea | null)[];
  guardados: Record<string, { estado: EstadoGuardado; mensaje?: string }>;
  /** Replaces a línea's lots (in order) and saves it. */
  setLotes: (lineaId: string, ids: string[]) => void;
  setReal: (lineaId: string, valor: string) => void;
  setManual: (lineaId: string, valor: string) => void;
  setMotivo: (lineaId: string, valor: string) => void;
  /** Saves the línea's draft (a field was left); `CLAVE_EXCIPIENTE` saves the excipiente's. */
  guardar: (lineaId: string) => void;
  excipiente: {
    opciones: NonNullable<DatosConfirmacion["excipiente"]>["opciones"];
    drogaId: string | null;
    cantidad: string;
    /** Chooses (or clears) the excipiente and saves it. */
    setDroga: (drogaId: string | null) => void;
    setCantidad: (valor: string) => void;
  } | null;
  /** The material (always the first row) and the insumos adicionales (migration 0110). */
  insumos: {
    opciones: DatosInsumos["opciones"];
    /** The ítem's number of cápsulas (CAPSULA forma), the Material's pre-fill; `null` otherwise. */
    capsulas: string | null;
    filas: FilaInsumo[];
    /** Chooses (or clears) a row's droga and saves the list. */
    setDroga: (clave: string, drogaId: string | null) => void;
    setCantidad: (clave: string, valor: string) => void;
    /** Adds an empty insumo adicional row (saved once its droga is chosen). */
    agregar: () => void;
    /** Removes an insumo adicional row and saves the list. */
    quitar: (clave: string) => void;
  } | null;
}

/** The excipiente's key in the save versions/states (never a línea id: those are uuids). */
const CLAVE_EXCIPIENTE = "excipiente";
/** The insumos list's key in the save versions/states, and the Material row's own key. */
const CLAVE_INSUMOS = "insumos";
const CLAVE_MATERIAL = "material";

/** The draft's rows still listed (the Material first, always present), the Material pre-filled with the cápsulas. */
function filasInsumoIniciales(insumos: DatosInsumos | undefined): FilaInsumo[] {
  if (!insumos) return [];
  const listada = (drogaId: string | null, tipo: TipoInsumo) =>
    drogaId && insumos.opciones.some((o) => o.id === drogaId && (tipo === "ADICIONAL" || o.clase === "MATERIAL")) ? drogaId : null;
  const material = insumos.borrador.find((b) => b.tipo === "MATERIAL");
  const adicionales = insumos.borrador.filter((b) => b.tipo === "ADICIONAL" && listada(b.drogaId, "ADICIONAL"));
  return [
    {
      clave: CLAVE_MATERIAL,
      tipo: "MATERIAL",
      drogaId: listada(material?.drogaId ?? null, "MATERIAL"),
      cantidad: material?.cantidad ? numeroParaInput(material.cantidad) : (insumos.capsulas ?? ""),
    },
    ...adicionales.map((b, i) => ({ clave: `adicional-${i}`, tipo: "ADICIONAL" as const, drogaId: b.drogaId, cantidad: numeroParaInput(b.cantidad) })),
  ];
}

/** The drogas used by the other rows and the excipiente, as a stable key ("id,id"): a row's buscador never offers them. */
function drogasUsadasPorOtras(filas: readonly FilaInsumo[], clave: string, excipienteId: string | null): string {
  return [excipienteId, ...filas.filter((f) => f.clave !== clave).map((f) => f.drogaId)]
    .filter((id): id is string => Boolean(id))
    .sort()
    .join(",");
}

const Contexto = createContext<PesajeContexto | null>(null);

function usePesaje(): PesajeContexto {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error("PesajeProvider missing");
  return contexto;
}

/** The draft's lots still eligible, else the default ones (`lotesPorDefecto`: the automatic plan's, else the oldest). */
function lotesIniciales(linea: LineaPantalla, jornada: string): string[] {
  const guardadas = (linea.reserva?.partidaIds ?? []).filter((id) => linea.partidasElegibles.some((p) => p.id === id));
  return guardadas.length > 0 ? guardadas : lotesPorDefecto({ ...linea, reserva: null }, jornada);
}

export function PesajeProvider({ datos, children }: { datos: DatosConfirmacion; children: ReactNode }) {
  const [elegidas, setElegidas] = useState<Record<string, string[]>>(() => Object.fromEntries(datos.lineas.map((l) => [l.id, lotesIniciales(l, datos.jornadaActual)])));
  const [reales, setReales] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      datos.lineas.flatMap((l) =>
        l.reserva?.cantidadReal ? [[l.id, cantidadRealDesdeServidor(l.reserva.cantidadReal, l.unidad)]] : [],
      ),
    ),
  );
  const [manuales, setManuales] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.cantidadManual ? [[l.id, numeroParaInput(l.reserva.cantidadManual)]] : []))),
  );
  const [motivos, setMotivos] = useState<Record<string, string>>(() =>
    Object.fromEntries(datos.lineas.flatMap((l) => (l.reserva?.motivoAperturaAdicional ? [[l.id, l.reserva.motivoAperturaAdicional]] : []))),
  );
  const opcionesExcipiente = datos.excipiente?.opciones ?? [];
  const [excipienteId, setExcipienteId] = useState<string | null>(() => {
    const guardado = datos.excipiente?.borrador?.drogaId ?? null;
    return guardado && opcionesExcipiente.some((o) => o.id === guardado) ? guardado : null;
  });
  const [excipienteCantidad, setExcipienteCantidad] = useState(() => numeroParaInput(datos.excipiente?.borrador?.cantidad));
  const [filasInsumo, setFilasInsumo] = useState<FilaInsumo[]>(() => filasInsumoIniciales(datos.insumos));
  // New adicional rows' keys: never reused while the page lives.
  const siguienteAdicional = useRef(filasInsumo.length);
  // Bumped to save a línea: its hidden form submits after the render that carries the new values.
  const [versiones, setVersiones] = useState<Record<string, number>>({});
  const [guardados, setGuardados] = useState<Record<string, { estado: EstadoGuardado; mensaje?: string }>>({});

  const guardar = useCallback((lineaId: string) => setVersiones((prev) => ({ ...prev, [lineaId]: (prev[lineaId] ?? 0) + 1 })), []);
  const onEstado = useCallback((lineaId: string, estado: EstadoGuardado, mensaje?: string) => setGuardados((prev) => ({ ...prev, [lineaId]: { estado, mensaje } })), []);

  const planes = datos.lineas.map((linea) => planDeLinea(linea, manuales[linea.id], elegidas[linea.id] ?? [], datos.jornadaActual));
  const pesadas = datos.lineas.map((linea, i) => pesadaDeLinea(linea, planes[i]!, reales[linea.id], datos));

  const contexto: PesajeContexto = {
    datos,
    elegidas,
    reales,
    manuales,
    motivos,
    planes,
    pesadas,
    guardados,
    setLotes: (lineaId, ids) => {
      setElegidas((prev) => ({ ...prev, [lineaId]: ids }));
      guardar(lineaId);
    },
    setReal: (lineaId, valor) => setReales((prev) => ({ ...prev, [lineaId]: valor })),
    setManual: (lineaId, valor) => setManuales((prev) => ({ ...prev, [lineaId]: valor })),
    setMotivo: (lineaId, valor) => setMotivos((prev) => ({ ...prev, [lineaId]: valor })),
    guardar,
    excipiente: datos.excipiente
      ? {
          opciones: opcionesExcipiente,
          drogaId: excipienteId,
          cantidad: excipienteCantidad,
          setDroga: (drogaId) => {
            setExcipienteId(drogaId);
            guardar(CLAVE_EXCIPIENTE);
          },
          setCantidad: setExcipienteCantidad,
        }
      : null,
    insumos: datos.insumos
      ? {
          opciones: datos.insumos.opciones,
          capsulas: datos.insumos.capsulas,
          filas: filasInsumo,
          setDroga: (clave, drogaId) => {
            setFilasInsumo((prev) => prev.map((f) => (f.clave === clave ? { ...f, drogaId } : f)));
            guardar(CLAVE_INSUMOS);
          },
          setCantidad: (clave, valor) => setFilasInsumo((prev) => prev.map((f) => (f.clave === clave ? { ...f, cantidad: valor } : f))),
          agregar: () => {
            const clave = `adicional-${siguienteAdicional.current++}`;
            setFilasInsumo((prev) => [...prev, { clave, tipo: "ADICIONAL", drogaId: null, cantidad: "" }]);
          },
          quitar: (clave) => {
            setFilasInsumo((prev) => prev.filter((f) => f.clave !== clave || f.tipo === "MATERIAL"));
            guardar(CLAVE_INSUMOS);
          },
        }
      : null,
  };

  return (
    <Contexto.Provider value={contexto}>
      {children}
      {datos.lineas.map((linea) => (
        <BorradorLinea
          key={linea.id}
          lineaId={linea.id}
          partidaIds={elegidas[linea.id] ?? []}
          cantidadReal={linea.esEnraseManual ? "" : cantidadRealParaServidor(reales[linea.id], linea.unidad)}
          cantidadManual={linea.esEnraseManual ? (manuales[linea.id] ?? "") : ""}
          motivo={motivos[linea.id] ?? ""}
          version={versiones[linea.id] ?? 0}
          onEstado={onEstado}
        />
      ))}
      {datos.excipiente ? (
        <BorradorExcipiente
          fichaTecnicaId={datos.fichaTecnicaId}
          drogaId={excipienteId}
          cantidad={excipienteCantidad}
          version={versiones[CLAVE_EXCIPIENTE] ?? 0}
          onEstado={onEstado}
        />
      ) : null}
      {datos.insumos ? <BorradorInsumos fichaTecnicaId={datos.fichaTecnicaId} filas={filasInsumo} version={versiones[CLAVE_INSUMOS] ?? 0} onEstado={onEstado} /> : null}
    </Contexto.Provider>
  );
}

/**
 * The insumos list's hidden save form (migration 0110): same mechanics as `BorradorExcipiente`, the whole list each
 * time -- the Material when it has a droga or a quantity (the cápsulas' count), the adicionales with a droga.
 */
function BorradorInsumos({
  fichaTecnicaId,
  filas,
  version,
  onEstado,
}: {
  fichaTecnicaId: string;
  filas: readonly FilaInsumo[];
  version: number;
  onEstado: (clave: string, estado: EstadoGuardado, mensaje?: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(guardarInsumosBorradorAction, IDLE_STATE);
  const { onSubmit } = useFormSubmit(formAction, { estado: state, accion: "preparaciones.confirmar" });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (version > 0) formRef.current?.requestSubmit();
  }, [version]);

  useEffect(() => {
    if (isPending) onEstado(CLAVE_INSUMOS, "guardando");
    else if (state.status === "success") onEstado(CLAVE_INSUMOS, "guardado");
    else if (state.status === "error") onEstado(CLAVE_INSUMOS, "error", state.message);
  }, [isPending, state, onEstado]);

  const aGuardar = filas.filter((f) => f.drogaId || (f.tipo === "MATERIAL" && f.cantidad.trim()));
  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} hidden>
      <input type="hidden" name="fichaTecnicaId" value={fichaTecnicaId} />
      {aGuardar.map((f) => (
        <CamposInsumo key={f.clave} fila={f} />
      ))}
    </form>
  );
}

/** One insumo row as the forms send it: parallel fields, in order (`insumosDe` in ./actions.ts). */
function CamposInsumo({ fila }: { fila: FilaInsumo }) {
  return (
    <>
      <input type="hidden" name="insumoTipo" value={fila.tipo} />
      <input type="hidden" name="insumoDrogaId" value={fila.drogaId ?? ""} />
      <input type="hidden" name="insumoCantidad" value={fila.cantidad} />
    </>
  );
}

/** The excipiente's hidden save form (migration 0092): same mechanics as `BorradorLinea`. */
function BorradorExcipiente({
  fichaTecnicaId,
  drogaId,
  cantidad,
  version,
  onEstado,
}: {
  fichaTecnicaId: string;
  drogaId: string | null;
  cantidad: string;
  version: number;
  onEstado: (clave: string, estado: EstadoGuardado, mensaje?: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(guardarExcipienteBorradorAction, IDLE_STATE);
  const { onSubmit } = useFormSubmit(formAction, { estado: state, accion: "preparaciones.confirmar" });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (version > 0) formRef.current?.requestSubmit();
  }, [version]);

  useEffect(() => {
    if (isPending) onEstado(CLAVE_EXCIPIENTE, "guardando");
    else if (state.status === "success") onEstado(CLAVE_EXCIPIENTE, "guardado");
    else if (state.status === "error") onEstado(CLAVE_EXCIPIENTE, "error", state.message);
  }, [isPending, state, onEstado]);

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} hidden>
      <input type="hidden" name="fichaTecnicaId" value={fichaTecnicaId} />
      <input type="hidden" name="excipienteDrogaId" value={drogaId ?? ""} />
      <input type="hidden" name="excipienteCantidad" value={drogaId ? cantidad : ""} />
    </form>
  );
}

/** One línea's hidden save form: submitted whenever `version` changes (operator prompt on a cuenta de sector, like the excipiente). */
function BorradorLinea({
  lineaId,
  partidaIds,
  cantidadReal,
  cantidadManual,
  motivo,
  version,
  onEstado,
}: {
  lineaId: string;
  partidaIds: readonly string[];
  cantidadReal: string;
  cantidadManual: string;
  motivo: string;
  version: number;
  onEstado: (lineaId: string, estado: EstadoGuardado, mensaje?: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(guardarBorradorPesadaAction, IDLE_STATE);
  const { onSubmit } = useFormSubmit(formAction, { estado: state, accion: "preparaciones.confirmar" });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (version > 0) formRef.current?.requestSubmit();
  }, [version]);

  useEffect(() => {
    if (isPending) onEstado(lineaId, "guardando");
    else if (state.status === "success") onEstado(lineaId, "guardado");
    else if (state.status === "error") onEstado(lineaId, "error", state.message);
  }, [isPending, state, lineaId, onEstado]);

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} hidden>
      <input type="hidden" name="lineaPesajeId" value={lineaId} />
      {partidaIds.map((id) => (
        <input key={id} type="hidden" name="partidaIds" value={id} />
      ))}
      <input type="hidden" name="cantidadReal" value={cantidadReal} />
      <input type="hidden" name="cantidadManual" value={cantidadManual} />
      <input type="hidden" name="motivoAperturaAdicional" value={motivo} />
    </form>
  );
}

/** The ficha's líneas with their lots and "Cantidad real pesada". `lineasFicha`: the saved ficha's display data (teórica, exceso, vencidas), matched by `orden`. */
export function PesajeTabla({ lineasFicha }: { lineasFicha: readonly LineaDeFichaToma[] }) {
  const { datos } = usePesaje();
  const exceso = conExceso(lineasFicha);
  const columnas = exceso ? 5 : 4;
  return (
    // overflow-visible: the excipiente Combobox popover must float over the card,
    // not open a scroll box inside the table (hard to drive on a tablet).
    <div className="table-wrap overflow-visible">
      <table className="data-table">
        <caption className="sr-only">Líneas de pesaje</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2">
              Droga
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Teórica
            </th>
            {exceso ? (
              <th scope="col" className="px-3 py-2 text-right">
                Exceso %
              </th>
            ) : null}
            <th scope="col" className="px-3 py-2 text-right">
              A pesar
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Cantidad real pesada
            </th>
          </tr>
        </thead>
        <tbody>
          {datos.lineas.map((linea, indice) => (
            <FilasLinea key={linea.id} linea={linea} indice={indice} ficha={lineasFicha.find((l) => l.orden === linea.orden)} exceso={exceso} columnas={columnas} />
          ))}
          <FilaExcipiente columnas={columnas} />
          <FilasInsumos columnas={columnas} />
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-zinc-500">{AYUDA_NUMERO}</p>
    </div>
  );
}

function FilasLinea({
  linea,
  indice,
  ficha,
  exceso,
  columnas,
}: {
  linea: LineaPantalla;
  indice: number;
  ficha: LineaDeFichaToma | undefined;
  exceso: boolean;
  columnas: number;
}) {
  const { datos, elegidas, planes, pesadas, motivos, setLotes, setMotivo, guardar } = usePesaje();
  const plan = planes[indice]!;
  const pesada = pesadas[indice] ?? null;
  const lotes = elegidas[linea.id] ?? [];
  const partidas = ordenarParaConsumo(linea.partidasElegibles, datos.jornadaActual);
  const conPureza = !linea.esEnraseManual && partidas.some((p) => p.potenciaDeclarada !== null);
  const sinStock = plan !== null && plan !== "elegir" && !plan.ok;
  const libres = partidas.filter((p) => !lotes.includes(p.id));
  const precision = precisionDeLinea(linea.unidad, datos.pesada.precisionBalanza);
  const planOk = plan !== null && plan !== "elegir" && plan.ok ? plan : null;
  const partes = planOk ? planOk.partes : [];
  // "A pesar": the physical weight over the chosen lots, rounded to the balance (exact below one division, P13); the ficha's active only while no lot covers the línea.
  const aPesar = planOk ? sugerenciaPesadaReal(convertirCantidad(new Decimal(planOk.totalFisico), linea.unidadStock, linea.unidad), precision).toFixed() : linea.cantidadAPesar;
  // What to weigh from each lot: only when the línea is split over several, otherwise it is "A pesar" itself.
  const mostrarPartes = !linea.esEnraseManual && partes.length > 1;
  const vencidas = (ficha?.partidas ?? []).filter((p) => p.vencida);
  const motivoId = `motivoApertura_${linea.id}`;
  // Every row of the línea but its last drops the row border: one visual group.
  const ultimaFilaMotivo = plan !== null && plan !== "elegir" && plan.ok && plan.requiereMotivo;

  return (
    <>
      <tr className="border-b-0">
        <td className="px-3 py-2 font-medium text-zinc-900">{linea.drogaNombre}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
          {ficha?.cantidadTeorica ? (
            <CantidadFicha valor={ficha.cantidadTeorica} simbolo={ficha.unidadSimbolo} />
          ) : (
            <Vacio />
          )}
        </td>
        {exceso ? <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{ficha?.excesoAplicado}</td> : null}
        <td className="px-3 py-2 text-right font-mono font-semibold text-zinc-900 tabular-nums">
          {linea.esEnraseManual ? (
            <span className="inline-block max-w-[12rem] font-sans font-normal text-zinc-500">Enrase manual</span>
          ) : aPesar ? (
            <span className="whitespace-nowrap">
              <CantidadFicha valor={aPesar} simbolo={linea.unidadSimbolo} classNameSimbolo="font-normal text-zinc-500" />
            </span>
          ) : (
            <Vacio />
          )}
        </td>
        <td className="px-3 py-2 text-right align-top">
          <CantidadReal linea={linea} pesada={pesada} />
        </td>
      </tr>

      {partidas.length === 0 ? (
        <tr className={vencidas.length > 0 || sinStock ? "border-b-0" : undefined}>
          <td colSpan={columnas} className="px-3 pb-3 pt-0 text-xs text-zinc-500">
            Sin partidas disponibles para esta droga.
          </td>
        </tr>
      ) : (
        lotes.map((partidaId, k) => {
          const opciones = partidas.filter((p) => p.id === partidaId || !lotes.includes(p.id));
          const parte = partes.find((p) => p.partidaId === partidaId);
          const ultimaFila = k === lotes.length - 1 && !(sinStock || libres.length > 0) && vencidas.length === 0 && !ultimaFilaMotivo;
          return (
            <tr key={partidaId} className={ultimaFila ? undefined : "border-b-0"}>
              <td colSpan={columnas - 2} className={`pl-6 pr-3 ${ultimaFila ? "pb-3 pt-0.5" : "py-0.5"}`}>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <label htmlFor={`partidas_${linea.id}_${k}`} className="shrink-0">
                    {k === 0 ? "Lote" : "y"}
                  </label>
                  <select
                    id={`partidas_${linea.id}_${k}`}
                    value={partidaId}
                    onChange={(event) => setLotes(linea.id, lotes.map((id, i) => (i === k ? event.target.value : id)))}
                    className="input h-8 min-w-0 max-w-full py-0 font-mono text-xs"
                  >
                    {opciones.map((p) => (
                      <option key={p.id} value={p.id}>
                        {etiquetaLote(p, conPureza, datos)}
                      </option>
                    ))}
                  </select>
                  {k > 0 ? (
                    <button type="button" onClick={() => setLotes(linea.id, lotes.filter((_, i) => i !== k))} aria-label="Quitar este lote" className="btn btn-ghost btn-sm">
                      <X className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </td>
              <td className={`whitespace-nowrap px-3 text-right font-mono font-medium text-zinc-900 tabular-nums ${ultimaFila ? "pb-3 pt-0.5" : "py-0.5"}`}>
                {mostrarPartes && parte ? (
                  <CantidadDeLote cantidad={sugerenciaPesadaReal(convertirCantidad(new Decimal(parte.cantidad), linea.unidadStock, linea.unidad), precision).toFixed()} simbolo={linea.unidadSimbolo} />
                ) : null}
              </td>
              <td className={ultimaFila ? "pb-3" : undefined} />
            </tr>
          );
        })
      )}

      {partidas.length > 0 && (sinStock || libres.length > 0) ? (
        <tr className={vencidas.length > 0 || ultimaFilaMotivo ? "border-b-0" : undefined}>
          <td colSpan={columnas} className="pb-3 pl-6 pr-3 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {sinStock ? (
                <span className="flex items-center gap-1 text-red-700 dark:text-red-300">
                  <CircleAlert className="size-3.5" aria-hidden />
                  Stock insuficiente en {lotes.length === 1 ? "el lote elegido" : "los lotes elegidos"}: faltan{" "}
                  <span className="font-mono">
                    {formatNumero(plan.faltante)} {linea.unidadSimbolo}
                  </span>
                  .
                </span>
              ) : lotes.length > 1 ? (
                <span className="text-zinc-500">Se termina primero el lote abierto o el que vence antes, y el resto sale del otro.</span>
              ) : null}
              {libres.length > 0 ? (
                <button type="button" onClick={() => setLotes(linea.id, [...lotes, libres[0]!.id])} className="btn btn-ghost btn-sm">
                  <Plus className="size-3.5" aria-hidden />
                  Agregar otro lote
                </button>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}

      {ultimaFilaMotivo ? (
        <tr className={vencidas.length > 0 ? "border-b-0" : undefined}>
          <td colSpan={columnas} className="pb-3 pl-6 pr-3 pt-0.5">
            <div className="field max-w-md">
              <label htmlFor={motivoId} className="field-label">
                Motivo de apertura adicional
              </label>
              <input
                id={motivoId}
                value={motivos[linea.id] ?? ""}
                onChange={(event) => setMotivo(linea.id, event.target.value)}
                onBlur={() => guardar(linea.id)}
                className="input"
              />
              <p className="field-help">Se abre una partida nueva aunque la que ya está abierta alcanza: indicá por qué.</p>
            </div>
          </td>
        </tr>
      ) : null}

      {pesada?.bajoLaBalanza ? (
        <tr className={vencidas.length > 0 ? "border-b-0" : undefined}>
          <td colSpan={columnas} className="pb-3 pl-6 pr-3 pt-0.5">
            <AvisoBajoLaBalanza
              linea={linea}
              elegidas={lotes}
              onUsar={(partidaId) => setLotes(linea.id, [partidaId])}
              puedeElaborar={datos.puedeElaborarLote === true}
              // The dialog's form refreshes the page on success, which lists the new lot for this línea.
              onDilucionCreada={(partidaId) => setLotes(linea.id, [partidaId])}
            />
          </td>
        </tr>
      ) : null}

      {vencidas.length > 0 ? (
        <tr>
          <td colSpan={columnas} className="pb-3 pl-6 pr-3 pt-0.5">
            <LotesVencidos vencidas={vencidas} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The excipiente used: a buscador of the catalog's excipientes (filters as typed; only a listed one can be chosen)
 * and its quantity in the droga's unidad base, in the "Cantidad real pesada" column. Saved when chosen / left.
 */
function FilaExcipiente({ columnas }: { columnas: number }) {
  const { excipiente } = usePesaje();
  if (!excipiente) return null;

  return (
    <tr className="border-t border-zinc-200">
      <td className="px-3 py-1.5 align-top font-medium text-zinc-900">Excipiente</td>
      <td colSpan={columnas - 2} className="px-3 py-1.5 align-top">
        <BuscadorExcipiente />
      </td>
      <td className="px-3 py-1.5 text-right align-top">
        <CantidadExcipiente />
      </td>
    </tr>
  );
}

/**
 * The excipiente's buscador: only drogas of clase EXCIPIENTE (`listExcipientesParaToma`). Shared by the ficha and
 * "Marcar como preparada"; in the dialog its list floats over the dialog's edge instead of being clipped by it.
 */
function BuscadorExcipiente({ flotante = false }: { flotante?: boolean }) {
  const { excipiente } = usePesaje();
  const opciones = excipiente?.opciones;
  // The app's standard local search (accents, case, synonyms, a capped list), as every droga buscador.
  const buscar = useMemo(() => filtrarOpciones((opciones ?? []).map((o) => ({ value: o.id, label: o.nombre, sinonimos: o.sinonimos }))), [opciones]);
  if (!excipiente) return null;
  const elegido = excipiente.opciones.find((o) => o.id === excipiente.drogaId) ?? null;
  const valor: ComboboxOption | null = elegido ? { value: elegido.id, label: elegido.nombre } : null;

  return excipiente.opciones.length === 0 ? (
    <p className="text-xs text-zinc-500">No hay excipientes en el catálogo de drogas.</p>
  ) : (
    <Combobox
      label="Excipiente utilizado"
      hideLabel
      size="sm"
      placeholder="Buscá el excipiente (opcional)"
      floating={flotante}
      value={valor}
      onChange={(opcion) => excipiente.setDroga(opcion ? opcion.value : null)}
      search={buscar}
    />
  );
}

/** The chosen excipiente's quantity (unidad base), saved when left or on Enter; nothing until one is chosen. */
function CantidadExcipiente() {
  const { excipiente, guardar, guardados } = usePesaje();
  const id = useId();
  if (!excipiente) return null;
  const elegido = excipiente.opciones.find((o) => o.id === excipiente.drogaId) ?? null;
  if (!elegido) return null;
  const guardado = guardados[CLAVE_EXCIPIENTE];
  const faltaCantidad = cantidadValida(excipiente.cantidad) === null;

  return (
    <div className="ml-auto flex max-w-[11rem] flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={excipiente.cantidad}
          onChange={(event) => excipiente.setCantidad(event.target.value)}
          onBlur={() => guardar(CLAVE_EXCIPIENTE)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              guardar(CLAVE_EXCIPIENTE);
            }
          }}
          aria-label={`Cantidad de ${elegido.nombre} (${elegido.unidadSimbolo})`}
          aria-invalid={faltaCantidad || guardado?.estado === "error" ? true : undefined}
          aria-describedby={`${id}-ayuda`}
          title={AYUDA_NUMERO}
          className="input h-8 w-24 py-0 text-right font-mono"
        />
        <span className="w-6 text-xs text-zinc-500">{elegido.unidadSimbolo}</span>
      </div>
      <p id={`${id}-ayuda`} className="text-right text-xs text-zinc-500" aria-live="polite">
        {faltaCantidad ? <span className="block text-amber-700 dark:text-amber-300">Ingresá la cantidad.</span> : null}
        {guardado?.estado === "error" ? <span className="block text-red-700 dark:text-red-300">{guardado.mensaje}</span> : guardado?.estado === "guardando" ? <span className="block">Guardando…</span> : guardado?.estado === "guardado" ? <span className="block">Guardado</span> : null}
      </p>
    </div>
  );
}

/**
 * The Material row and the insumos adicionales (migration 0110), under the excipiente and like it: a buscador and the
 * quantity in the droga's unidad base, in the "Cantidad real pesada" column; then "Agregar insumo" and the list's
 * save state. Saved when a droga is chosen / a row removed / a quantity left.
 */
function FilasInsumos({ columnas }: { columnas: number }) {
  const { insumos } = usePesaje();
  if (!insumos) return null;

  return (
    <>
      {insumos.filas.map((fila) => (
        <tr key={fila.clave} className="border-b-0">
          <td className="px-3 py-1.5 align-top font-medium text-zinc-900">{fila.tipo === "MATERIAL" ? "Material" : "Insumo"}</td>
          <td colSpan={columnas - 2} className="px-3 py-1.5 align-top">
            <BuscadorInsumo fila={fila} />
          </td>
          <td className="px-3 py-1.5 text-right align-top">
            <CantidadInsumo fila={fila} />
          </td>
        </tr>
      ))}
      <tr>
        <td colSpan={columnas} className="px-3 py-1">
          <AgregarInsumo />
        </td>
      </tr>
    </>
  );
}

/** "Agregar insumo" (only when the catalog has excipientes or materiales) and the insumos list's save state. */
function AgregarInsumo() {
  const { insumos, guardados } = usePesaje();
  if (!insumos) return null;
  const guardado = guardados[CLAVE_INSUMOS];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {insumos.opciones.length > 0 ? (
        <button type="button" onClick={insumos.agregar} className="btn btn-ghost btn-sm">
          <Plus className="size-3.5" aria-hidden />
          Agregar insumo
        </button>
      ) : null}
      <span className="text-zinc-500" aria-live="polite">
        {guardado?.estado === "error" ? <span className="text-red-700 dark:text-red-300">{guardado.mensaje}</span> : guardado?.estado === "guardando" ? "Guardando…" : guardado?.estado === "guardado" ? "Guardado" : null}
      </span>
    </div>
  );
}

/**
 * A row's buscador: the Material lists only drogas of clase MATERIAL, an adicional those of clase EXCIPIENTE or
 * MATERIAL, never one already used by another row or the excipiente. An adicional row can be removed (while not
 * reserved: once reserved the ficha is no longer editable).
 */
function BuscadorInsumo({ fila, flotante = false }: { fila: FilaInsumo; flotante?: boolean }) {
  const { insumos, excipiente } = usePesaje();
  const todas = insumos?.opciones;
  const usadas = drogasUsadasPorOtras(insumos?.filas ?? [], fila.clave, excipiente?.drogaId ?? null);
  // The Material: only clase MATERIAL; an adicional: EXCIPIENTE or MATERIAL. Stable while nothing else changes.
  const opciones = useMemo(() => {
    const excluidas = new Set(usadas.split(","));
    return (todas ?? []).filter((o) => (fila.tipo === "ADICIONAL" || o.clase === "MATERIAL") && !excluidas.has(o.id));
  }, [todas, fila.tipo, usadas]);
  const buscar = useMemo(() => filtrarOpciones(opciones.map((o) => ({ value: o.id, label: o.nombre, sinonimos: o.sinonimos }))), [opciones]);
  if (!insumos) return null;
  const elegido = insumos.opciones.find((o) => o.id === fila.drogaId) ?? null;
  const valor: ComboboxOption | null = elegido ? { value: elegido.id, label: elegido.nombre } : null;
  const esMaterial = fila.tipo === "MATERIAL";
  const sinOpciones = esMaterial ? !insumos.opciones.some((o) => o.clase === "MATERIAL") : insumos.opciones.length === 0;

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {sinOpciones ? (
          <p className="text-xs text-zinc-500">{esMaterial ? "No hay materiales en el catálogo de drogas." : "No hay excipientes ni materiales en el catálogo de drogas."}</p>
        ) : (
          <Combobox
            label={esMaterial ? "Material utilizado" : "Insumo adicional"}
            hideLabel
            size="sm"
            placeholder={esMaterial ? (insumos.capsulas ? "Buscá el tipo de cápsula (opcional)" : "Buscá el material (opcional)") : "Buscá el excipiente o material"}
            floating={flotante}
            value={valor}
            onChange={(opcion) => insumos.setDroga(fila.clave, opcion ? opcion.value : null)}
            search={buscar}
          />
        )}
      </div>
      {esMaterial ? null : (
        <button type="button" onClick={() => insumos.quitar(fila.clave)} aria-label="Quitar este insumo" className="btn btn-ghost btn-sm">
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * A row's quantity (the chosen droga's unidad base, its symbol from the droga), saved when left or on Enter; nothing
 * until a droga is chosen -- except the Material of a CAPSULA ítem, pre-filled with the cápsulas and ignored until a
 * material is chosen.
 */
function CantidadInsumo({ fila }: { fila: FilaInsumo }) {
  const { insumos, guardar } = usePesaje();
  const id = useId();
  if (!insumos) return null;
  const elegido = insumos.opciones.find((o) => o.id === fila.drogaId) ?? null;
  if (!elegido && !(fila.tipo === "MATERIAL" && insumos.capsulas)) return null;
  const faltaCantidad = elegido !== null && cantidadValida(fila.cantidad) === null;
  const etiqueta = elegido ? `${elegido.nombre} (${elegido.unidadSimbolo})` : "las cápsulas";

  return (
    <div className="ml-auto flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={fila.cantidad}
          onChange={(event) => insumos.setCantidad(fila.clave, event.target.value)}
          onBlur={() => guardar(CLAVE_INSUMOS)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              guardar(CLAVE_INSUMOS);
            }
          }}
          aria-label={`Cantidad de ${etiqueta}`}
          aria-invalid={faltaCantidad ? true : undefined}
          aria-describedby={`${id}-ayuda`}
          title={AYUDA_NUMERO}
          className="input h-8 w-24 py-0 text-right font-mono"
        />
        <span className="w-6 text-xs text-zinc-500">{elegido?.unidadSimbolo}</span>
      </div>
      <p id={`${id}-ayuda`} className="text-right text-xs text-zinc-500" aria-live="polite">
        {faltaCantidad ? <span className="block text-amber-700 dark:text-amber-300">Ingresá la cantidad.</span> : null}
        {elegido ? null : <span className="block whitespace-nowrap">Elegí la cápsula para descontarla.</span>}
      </p>
    </div>
  );
}

/** "251138 · 5 kg disp." plus the purity (when the droga's lots declare one) and "abierta" / the date of a lot por vencer. */
function etiquetaLote(p: LineaPantalla["partidasElegibles"][number], conPureza: boolean, datos: DatosConfirmacion): string {
  const partes = [p.lote, `${formatStockEntero(p.cantidadDisponible, p.unidadSimbolo)} disp.`];
  if (conPureza) partes.push(`Pureza ${p.potenciaDeclarada ? formatNumero(p.potenciaDeclarada) : "100"} %`);
  if (p.fechaApertura) partes.push("abierta");
  if (p.fechaVencimiento && estadoVencimientoPartida(p.fechaVencimiento, datos.jornadaActual, datos.diasAlertaVencimiento) === "POR_VENCER") {
    partes.push(`vence ${formatFechaIso(p.fechaVencimiento)}`);
  }
  return partes.join(" · ");
}

function CantidadDeLote({ cantidad, simbolo }: { cantidad: string; simbolo: string }) {
  return <CantidadFicha valor={cantidad} simbolo={simbolo} classNameSimbolo="font-normal text-zinc-500" />;
}

/** The línea's "Cantidad real pesada" field: the balance's reading (non-manual) or the enrase manual quantity. Saved when left. */
function CantidadReal({ linea, pesada }: { linea: LineaPantalla; pesada: PesadaDeLinea | null }) {
  const { reales, manuales, setReal, setManual, guardar, guardados, datos } = usePesaje();
  const id = useId();
  const campo = linea.esEnraseManual ? `cantidadManual_${linea.id}` : `cantidadReal_${linea.id}`;
  if (!linea.esEnraseManual && !pesada) return <Vacio />;

  const valor = linea.esEnraseManual ? (manuales[linea.id] ?? "") : (reales[linea.id] ?? pesada!.sugerida);
  const evaluacion = pesada?.evaluacion ?? null;
  const guardado = guardados[linea.id];
  const esMasa = !linea.esEnraseManual && linea.unidad.tipoMagnitud === "MASA";
  const simboloDisplay = esMasa ? "mg" : linea.unidadSimbolo;
  return (
    <div className="ml-auto flex max-w-[11rem] flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          name={campo}
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(event) => (linea.esEnraseManual ? setManual(linea.id, event.target.value) : setReal(linea.id, event.target.value))}
          onBlur={() => guardar(linea.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              guardar(linea.id);
            }
          }}
          aria-label={`Cantidad real pesada de ${linea.drogaNombre} (${simboloDisplay})`}
          title={AYUDA_NUMERO}
          aria-invalid={evaluacion?.fueraDeTolerancia || guardado?.estado === "error" ? true : undefined}
          aria-describedby={`${id}-ayuda`}
          className="input h-8 w-24 py-0 text-right font-mono"
        />
        <span className="w-6 text-xs text-zinc-500">{simboloDisplay}</span>
      </div>
      <p id={`${id}-ayuda`} className="text-right text-xs text-zinc-500" aria-live="polite">
        {linea.esEnraseManual ? null : (
          <span className={evaluacion?.fueraDeTolerancia ? "text-amber-700 dark:text-amber-300" : undefined}>
            {evaluacion ? `Desvío ${evaluacion.desvioPorcentaje.greaterThan(0) ? "+" : ""}${formatNumero(evaluacion.desvioPorcentaje.toString())} % (±${formatNumero(datos.pesada.toleranciaPorcentaje)} %)` : null}
          </span>
        )}
        {guardado?.estado === "error" ? <span className="block text-red-700 dark:text-red-300">{guardado.mensaje}</span> : guardado?.estado === "guardando" ? <span className="block">Guardando…</span> : guardado?.estado === "guardado" ? <span className="block">Guardado</span> : null}
      </p>
    </div>
  );
}

/**
 * "Marcar como preparada": confirms what the ficha holds -- one row per línea with its lot(s) and real weighing --,
 * adds the DT co-firma when a pesada is outside the tolerance, and reserves the stock (`reservarStockAction`, behind
 * re-authentication). Native `<dialog>` like ./continuar-preparacion-dialog.tsx; a click on the backdrop does not close it.
 */
export function MarcarPreparadaDialog({ itemNombre }: { itemNombre: string }) {
  const { datos, elegidas, reales, manuales, motivos, planes, pesadas, excipiente, insumos } = usePesaje();
  const excipienteElegido = excipiente?.opciones.find((o) => o.id === excipiente.drogaId) ?? null;
  const faltaExcipiente = excipienteElegido !== null && cantidadValida(excipiente?.cantidad) === null;
  // Material and insumos adicionales (migration 0110): a chosen one needs its quantity; a quantity alone is ignored.
  const filasInsumo = insumos?.filas ?? [];
  const insumoSinCantidad = (f: FilaInsumo) => f.drogaId !== null && cantidadValida(f.cantidad) === null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tituloId = useId();

  const lineasSinStock = planes.filter((plan) => plan !== null && plan !== "elegir" && !plan.ok).length;
  const faltaManual = datos.lineas.some((l) => l.esEnraseManual && !manuales[l.id]?.trim());
  const sinLote = datos.lineas.some((l, i) => planes[i] === "elegir" || (l.partidasElegibles.length === 0 && !l.esEnraseManual));
  const requiereCoFirma = pesadas.some((p) => p?.evaluacion?.fueraDeTolerancia);
  const bloqueada = lineasSinStock > 0 || faltaManual || sinLote || faltaExcipiente || filasInsumo.some(insumoSinCantidad);
  const loteDe = useMemo(() => new Map(datos.lineas.flatMap((l) => l.partidasElegibles.map((p) => [p.id, p.lote] as const))), [datos.lineas]);
  // No excipiente added in the ficha when the dialog opened: one more chance to add it here (same buscador, same draft).
  const [agregarExcipiente, setAgregarExcipiente] = useState(false);
  // The insumo rows with a droga when the dialog opened: listed read-only; the rest (and the ones added here) editable.
  const [insumosFijos, setInsumosFijos] = useState<ReadonlySet<string>>(() => new Set());
  const faltaMaterialFijo = filasInsumo.some((f) => f.tipo === "MATERIAL" && insumosFijos.has(f.clave) && insumoSinCantidad(f));
  const faltaInsumoFijo = filasInsumo.some((f) => f.tipo === "ADICIONAL" && insumosFijos.has(f.clave) && insumoSinCantidad(f));

  function abrir() {
    setAgregarExcipiente(excipiente !== null && excipienteElegido === null && excipiente.opciones.length > 0);
    setInsumosFijos(new Set(filasInsumo.filter((f) => f.drogaId).map((f) => f.clave)));
    dialogRef.current?.showModal();
  }

  function cerrar() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button type="button" onClick={abrir} aria-haspopup="dialog" className="btn btn-primary">
        <FlaskConical className="size-4" aria-hidden />
        Marcar como preparada
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={tituloId}
        className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-2xl p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={tituloId} className="text-lg font-semibold">
                Marcar como preparada
              </h2>
              <p className="truncate text-sm text-zinc-500">{itemNombre}</p>
            </div>
            <button type="button" onClick={cerrar} aria-label="Cerrar" className="btn btn-ghost btn-sm">
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <div role="note" className="alert alert-info">
            <Info aria-hidden />
            <p>Se reserva el stock de estos lotes. Se descuenta y se escribe en el libro recetario recién al imprimir las etiquetas de la receta.</p>
          </div>
          {datos.jornadaCerrada ? (
            <div role="alert" className="alert alert-danger">
              <CircleAlert aria-hidden />
              <p>La jornada de hoy ya fue firmada por el Director Técnico: podés reservar el stock, pero la etiqueta recién se podrá imprimir en la próxima jornada.</p>
            </div>
          ) : null}
          {/* An excipiente being added here shows its own "Ingresá la cantidad." next to the field. */}
          {lineasSinStock > 0 || faltaManual || sinLote || (faltaExcipiente && !agregarExcipiente) || faltaMaterialFijo || faltaInsumoFijo ? (
            <div role="alert" className="alert alert-danger">
              <CircleAlert aria-hidden />
              <p>
                {lineasSinStock > 0 ? "Hay líneas sin stock suficiente en los lotes elegidos. " : null}
                {sinLote ? "Hay líneas sin lote. " : null}
                {faltaManual ? "Falta la cantidad real de una línea de enrase manual. " : null}
                {faltaExcipiente && !agregarExcipiente ? "Falta la cantidad del excipiente. " : null}
                {faltaMaterialFijo ? "Falta la cantidad del material. " : null}
                {faltaInsumoFijo ? "Falta la cantidad de un insumo. " : null}
                Completalo en la ficha técnica.
              </p>
            </div>
          ) : null}

          <ul className="flex flex-col divide-y divide-zinc-100 text-sm">
            {datos.lineas.map((linea, i) => {
              const pesada = pesadas[i];
              const real = linea.esEnraseManual ? manuales[linea.id] : (reales[linea.id] ?? pesada?.sugerida);
              const esMasa = !linea.esEnraseManual && linea.unidad.tipoMagnitud === "MASA";
              const simboloDisplay = esMasa ? "mg" : linea.unidadSimbolo;
              return (
                <li key={linea.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                  <span className="min-w-0">
                    <span className="font-medium text-zinc-900">{linea.drogaNombre}</span>{" "}
                    <span className="text-xs text-zinc-500">
                      Lote{(elegidas[linea.id]?.length ?? 0) > 1 ? "s" : ""} <span className="font-mono">{(elegidas[linea.id] ?? []).map((id) => loteDe.get(id) ?? "—").join(" → ") || "—"}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {pesada?.evaluacion?.fueraDeTolerancia ? <ToneBadge tone="warn">Fuera de tolerancia</ToneBadge> : null}
                    <span className="font-mono font-semibold tabular-nums text-zinc-900">
                      {real?.trim() ? `${cantidadValida(real) ? formatNumero(cantidadValida(real)!) : real} ${simboloDisplay}` : "—"}
                    </span>
                  </span>
                </li>
              );
            })}
            {agregarExcipiente ? (
              <li className="flex flex-col gap-2 py-2">
                <span className="text-xs text-zinc-500">No agregaste el excipiente en la ficha. Si usaste uno, buscalo acá con su cantidad.</span>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <BuscadorExcipiente flotante />
                  </div>
                  <CantidadExcipiente />
                </div>
              </li>
            ) : excipienteElegido ? (
              <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span className="min-w-0">
                  <span className="text-xs text-zinc-500">Excipiente</span> <span className="font-medium text-zinc-900">{excipienteElegido.nombre}</span>{" "}
                  <span className="text-xs text-zinc-500">(lote más viejo, automático)</span>
                </span>
                <span className="font-mono font-semibold tabular-nums text-zinc-900">
                  {cantidadValida(excipiente?.cantidad) ? `${formatNumero(cantidadValida(excipiente?.cantidad)!)} ${excipienteElegido.unidadSimbolo}` : "—"}
                </span>
              </li>
            ) : null}
            {filasInsumo.map((fila) =>
              insumosFijos.has(fila.clave) ? <InsumoFijo key={fila.clave} fila={fila} /> : <InsumoEnDialogo key={fila.clave} fila={fila} />,
            )}
            {insumos && insumos.opciones.length > 0 ? (
              <li className="py-2">
                <AgregarInsumo />
              </li>
            ) : null}
          </ul>

          {requiereCoFirma ? (
            <div role="note" className="alert alert-warn">
              <TriangleAlert aria-hidden />
              <p>Hay pesadas fuera de la tolerancia: volvé a pesar o pedí la co-firma del Director Técnico.</p>
            </div>
          ) : null}

          <ReauthAwareForm
            action={reservarStockAction}
            accion="preparaciones.confirmar"
            submitLabel="Marcar como preparada"
            pendingLabel="Reservando…"
            submitDisabled={bloqueada}
            className="flex flex-col gap-4"
            extraActions={
              <button type="button" onClick={cerrar} className="btn btn-secondary">
                Cancelar
              </button>
            }
            onSuccess={(state) => {
              if (state.message) toast(state.message);
              cerrar();
            }}
          >
            <input type="hidden" name="fichaTecnicaId" value={datos.fichaTecnicaId} />
            {datos.lineas.map((linea, i) => {
              const plan = planes[i];
              return (
                <div key={linea.id} hidden>
                  <input type="hidden" name="lineaIds" value={linea.id} />
                  {(elegidas[linea.id] ?? []).map((id) => (
                    <input key={id} type="hidden" name={`partidas_${linea.id}`} value={id} />
                  ))}
                  {linea.esEnraseManual ? (
                    <input type="hidden" name={`cantidadManual_${linea.id}`} value={manuales[linea.id] ?? ""} />
                  ) : pesadas[i] ? (
                    <input type="hidden" name={`cantidadReal_${linea.id}`} value={cantidadRealParaServidor(reales[linea.id] ?? pesadas[i]!.sugerida, linea.unidad)} />
                  ) : null}
                  {plan !== null && plan !== "elegir" && plan.ok && plan.requiereMotivo ? (
                    <input type="hidden" name={`motivoApertura_${linea.id}`} value={motivos[linea.id] ?? ""} />
                  ) : null}
                </div>
              );
            })}
            {excipienteElegido ? (
              <div hidden>
                <input type="hidden" name="excipienteDrogaId" value={excipienteElegido.id} />
                <input type="hidden" name="excipienteCantidad" value={excipiente?.cantidad ?? ""} />
              </div>
            ) : null}
            {filasInsumo
              .filter((f) => f.drogaId)
              .map((f) => (
                <div key={f.clave} hidden>
                  <CamposInsumo fila={f} />
                </div>
              ))}
            {requiereCoFirma ? <CoFirmaDt dts={datos.dts} titulo="Co-firma del Director Técnico (pesada fuera de tolerancia)" /> : null}
          </ReauthAwareForm>
        </div>
      </dialog>
    </>
  );
}

/** An insumo already added in the ficha when "Marcar como preparada" opened: listed read-only, like the excipiente. */
function InsumoFijo({ fila }: { fila: FilaInsumo }) {
  const { insumos } = usePesaje();
  const elegido = insumos?.opciones.find((o) => o.id === fila.drogaId) ?? null;
  if (!elegido) return null;
  const cantidad = cantidadValida(fila.cantidad);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <span className="min-w-0">
        <span className="text-xs text-zinc-500">{fila.tipo === "MATERIAL" ? "Material" : "Insumo"}</span> <span className="font-medium text-zinc-900">{elegido.nombre}</span>{" "}
        <span className="text-xs text-zinc-500">(lote más viejo, automático)</span>
      </span>
      <span className="font-mono font-semibold tabular-nums text-zinc-900">{cantidad ? `${formatNumero(cantidad.toString())} ${elegido.unidadSimbolo}` : "—"}</span>
    </li>
  );
}

/**
 * The second chance in "Marcar como preparada" (migration 0110, like E9): a Material not chosen in the ficha, or an
 * insumo adicional added here, with the same buscador and quantity -- the same draft as the ficha's rows.
 */
function InsumoEnDialogo({ fila }: { fila: FilaInsumo }) {
  const { insumos } = usePesaje();
  if (!insumos) return null;
  const esMaterial = fila.tipo === "MATERIAL";
  if (esMaterial && !insumos.opciones.some((o) => o.clase === "MATERIAL")) return null;
  return (
    <li className="flex flex-col gap-2 py-2">
      {esMaterial ? (
        <span className="text-xs text-zinc-500">
          {insumos.capsulas
            ? "No elegiste el tipo de cápsula en la ficha. Elegilo acá para descontarlo del stock."
            : "No agregaste el material en la ficha. Si usaste uno, buscalo acá con su cantidad."}
        </span>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <BuscadorInsumo fila={fila} flotante />
        </div>
        <CantidadInsumo fila={fila} />
      </div>
    </li>
  );
}
