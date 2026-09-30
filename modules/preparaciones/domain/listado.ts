/**
 * The /preparaciones list: its tabs (one per estado), its filters as they
 * travel in the URL, and a confirmed preparación's etiqueta state. Pure, no
 * I/O.
 *
 * No paciente filter: the URL must never carry personal data (DP-24) -- the
 * filters are the receta number and the start date range, plus "sin
 * etiqueta impresa" on the Confirmadas tab.
 */
import type { EstadoPreparacion } from "@/generated/prisma/enums";

export const PESTANAS_PREPARACIONES: ReadonlyArray<{ estado: EstadoPreparacion; titulo: string }> = [
  { estado: "INICIADA", titulo: "En curso" },
  { estado: "CONFIRMADA", titulo: "Confirmadas" },
  { estado: "DESCARTADA", titulo: "Descartadas" },
];

export interface FiltrosPreparaciones {
  estado: EstadoPreparacion;
  /** Nº interno de la receta, digits only. */
  numero?: string;
  /** `YYYY-MM-DD`, on the start date (tenant's calendar day). */
  desde?: string;
  hasta?: string;
  /** Confirmadas tab only. */
  sinEtiquetaImpresa: boolean;
  page: number;
}

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function uno(valor: string | string[] | undefined): string | undefined {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Anything unknown or malformed is dropped (default tab: En curso). */
export function parsearFiltrosPreparaciones(params: SearchParams): FiltrosPreparaciones {
  const estadoCrudo = uno(params.estado);
  const estado = PESTANAS_PREPARACIONES.find((p) => p.estado === estadoCrudo)?.estado ?? "INICIADA";
  const numero = uno(params.numero)?.replace(/\D/g, "");
  const desde = uno(params.desde);
  const hasta = uno(params.hasta);
  const page = Number.parseInt(uno(params.page) ?? "1", 10);
  return {
    estado,
    numero: numero ? numero : undefined,
    desde: desde && FECHA.test(desde) ? desde : undefined,
    hasta: hasta && FECHA.test(hasta) ? hasta : undefined,
    sinEtiquetaImpresa: estado === "CONFIRMADA" && uno(params.sinEtiqueta) === "1",
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/**
 * The list URL for `filtros` with `cambios` applied. Changing tab keeps the
 * common filters (número, fechas) but starts again on page 1 and drops the
 * Confirmadas-only switch.
 */
export function hrefPreparaciones(filtros: FiltrosPreparaciones, cambios: Partial<FiltrosPreparaciones> = {}): string {
  const cambiaPestana = cambios.estado !== undefined && cambios.estado !== filtros.estado;
  const f: FiltrosPreparaciones = {
    ...filtros,
    ...(cambiaPestana ? { page: 1, sinEtiquetaImpresa: false } : {}),
    ...cambios,
  };
  const qs = new URLSearchParams();
  if (f.estado !== "INICIADA") qs.set("estado", f.estado);
  if (f.numero) qs.set("numero", f.numero);
  if (f.desde) qs.set("desde", f.desde);
  if (f.hasta) qs.set("hasta", f.hasta);
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
