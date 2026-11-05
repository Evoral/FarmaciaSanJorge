/**
 * The /preparaciones list: its tabs (Pendientes, then one per preparación
 * estado), its filters as they travel in the URL, and a confirmed
 * preparación's etiqueta state. Pure, no I/O.
 *
 * "Pendientes" (the default tab) is the lab's queue: recetas nobody took
 * yet that still need a preparación, oldest first. "En curso" lists the
 * recetas the lab took (domain/toma.ts) that still have ítems to confirm --
 * its URL key stays `estado=INICIADA` so existing links keep working.
 * Confirmadas and Descartadas list preparaciones by estado.
 *
 * Filters: the same ones as /recetas (Nº, paciente, médico, pago, ingreso and
 * prescripción ranges, same URL keys except prescripción) plus the tab's own
 * date range (`desde`/`hasta`: the receta's ingreso on Pendientes -- so that tab
 * has no separate ingreso range --, the toma on En curso, the preparación's
 * start on the others) and "sin etiqueta impresa" on the Confirmadas tab.
 */
import type { EstadoPreparacion } from "@/generated/prisma/enums";
import { parseFiltroPagoReceta, type FiltroPagoReceta } from "@/modules/recetas/domain/pago";
import { filtroFechaIso } from "@/shared/validation";

/** A /preparaciones tab: the pending queue, the taken recetas (`INICIADA`, "En curso"), or the preparaciones in one estado. */
export type PestanaPreparaciones = "PENDIENTE" | EstadoPreparacion;

export const PESTANA_PREPARACIONES_POR_DEFECTO: PestanaPreparaciones = "PENDIENTE";

export const PESTANAS_PREPARACIONES: ReadonlyArray<{ estado: PestanaPreparaciones; titulo: string }> = [
  { estado: "PENDIENTE", titulo: "Pendientes" },
  { estado: "INICIADA", titulo: "En curso" },
  { estado: "CONFIRMADA", titulo: "Confirmadas" },
  { estado: "DESCARTADA", titulo: "Descartadas" },
];

export interface FiltrosPreparaciones {
  estado: PestanaPreparaciones;
  /** Nº interno de la receta, digits only. */
  numero?: string;
  /** `YYYY-MM-DD` (tenant's calendar day): the receta's ingreso on Pendientes, the toma on En curso, the start date on the other tabs. */
  desde?: string;
  hasta?: string;
  /** Paciente name, DNI or CUIL (same search as /recetas). */
  paciente?: string;
  /** Médico name or matrícula (same search as /recetas). */
  medico?: string;
  pago?: FiltroPagoReceta;
  /** `YYYY-MM-DD` on the receta's ingreso; every tab but Pendientes (there `desde`/`hasta` already are the ingreso). */
  ingresoDesde?: string;
  ingresoHasta?: string;
  /** `YYYY-MM-DD` on the receta's fecha de prescripción. */
  prescripcionDesde?: string;
  prescripcionHasta?: string;
  /** Confirmadas tab only. */
  sinEtiquetaImpresa: boolean;
  page: number;
}

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function uno(valor: string | string[] | undefined): string | undefined {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/** A real calendar date or nothing (spec fechas-entrada FE2). */
function fecha(valor: string | string[] | undefined): string | undefined {
  return filtroFechaIso(uno(valor));
}

/** Free-text search, capped like /recetas' (100 characters). */
function texto(valor: string | string[] | undefined): string | undefined {
  return uno(valor)?.slice(0, 100);
}

/** Anything unknown or malformed is dropped (default tab: Pendientes). */
export function parsearFiltrosPreparaciones(params: SearchParams): FiltrosPreparaciones {
  const estadoCrudo = uno(params.estado);
  const estado = PESTANAS_PREPARACIONES.find((p) => p.estado === estadoCrudo)?.estado ?? PESTANA_PREPARACIONES_POR_DEFECTO;
  const numero = uno(params.numero)?.replace(/\D/g, "");
  const page = Number.parseInt(uno(params.page) ?? "1", 10);
  const conIngreso = estado !== "PENDIENTE";
  return {
    estado,
    numero: numero ? numero : undefined,
    desde: fecha(params.desde),
    hasta: fecha(params.hasta),
    paciente: texto(params.paciente),
    medico: texto(params.medico),
    pago: parseFiltroPagoReceta(uno(params.pago)),
    ingresoDesde: conIngreso ? fecha(params.ingresoDesde) : undefined,
    ingresoHasta: conIngreso ? fecha(params.ingresoHasta) : undefined,
    prescripcionDesde: fecha(params.prescripcionDesde),
    prescripcionHasta: fecha(params.prescripcionHasta),
    sinEtiquetaImpresa: estado === "CONFIRMADA" && uno(params.sinEtiqueta) === "1",
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/**
 * The list URL for `filtros` with `cambios` applied. Changing tab keeps the
 * common filters but starts again on page 1 and drops the Confirmadas-only
 * switch (and the ingreso range when landing on Pendientes, which has none).
 */
export function hrefPreparaciones(filtros: FiltrosPreparaciones, cambios: Partial<FiltrosPreparaciones> = {}): string {
  const cambiaPestana = cambios.estado !== undefined && cambios.estado !== filtros.estado;
  const f: FiltrosPreparaciones = {
    ...filtros,
    ...(cambiaPestana ? { page: 1, sinEtiquetaImpresa: false } : {}),
    ...cambios,
  };
  const qs = new URLSearchParams();
  if (f.estado !== PESTANA_PREPARACIONES_POR_DEFECTO) qs.set("estado", f.estado);
  if (f.numero) qs.set("numero", f.numero);
  if (f.desde) qs.set("desde", f.desde);
  if (f.hasta) qs.set("hasta", f.hasta);
  if (f.paciente) qs.set("paciente", f.paciente);
  if (f.medico) qs.set("medico", f.medico);
  if (f.pago) qs.set("pago", f.pago);
  if (f.estado !== "PENDIENTE") {
    if (f.ingresoDesde) qs.set("ingresoDesde", f.ingresoDesde);
    if (f.ingresoHasta) qs.set("ingresoHasta", f.ingresoHasta);
  }
  if (f.prescripcionDesde) qs.set("prescripcionDesde", f.prescripcionDesde);
  if (f.prescripcionHasta) qs.set("prescripcionHasta", f.prescripcionHasta);
  if (f.sinEtiquetaImpresa && f.estado === "CONFIRMADA") qs.set("sinEtiqueta", "1");
  if (f.page > 1) qs.set("page", String(f.page));
  const query = qs.toString();
  return query ? `/preparaciones?${query}` : "/preparaciones";
}

export type EstadoEtiqueta = "PENDIENTE" | "GENERADA" | "IMPRESA";

export const ESTADO_ETIQUETA_LABELS: Readonly<Record<EstadoEtiqueta, string>> = {
  PENDIENTE: "Pendiente",
  GENERADA: "Generada",
  IMPRESA: "Impresa",
};

/** No etiqueta yet -> Pendiente; generated but never printed -> Generada; printed at least once -> Impresa. */
export function estadoEtiqueta(etiqueta: { impresa: boolean } | null): EstadoEtiqueta {
  if (!etiqueta) return "PENDIENTE";
  return etiqueta.impresa ? "IMPRESA" : "GENERADA";
}
