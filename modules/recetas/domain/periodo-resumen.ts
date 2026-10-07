/**
 * Time window of the per-estado summary on `/recetas`: which recetas the
 * counts include, by fecha de ingreso. Pure: works on jornadas
 * (`YYYY-MM-DD`); the caller supplies "today" in the farmacia's time zone.
 */
export const PERIODOS_RESUMEN = ["30d", "3m", "6m", "12m", "todos"] as const;
export type PeriodoResumen = (typeof PERIODOS_RESUMEN)[number];

export const PERIODO_RESUMEN_DEFAULT: PeriodoResumen = "30d";

export const PERIODO_RESUMEN_LABELS: Record<PeriodoResumen, string> = {
  "30d": "Últimos 30 días",
  "3m": "Últimos 3 meses",
  "6m": "Últimos 6 meses",
  "12m": "Últimos 12 meses",
  todos: "Todas las fechas",
};

/** Unknown or missing values fall back to the default window. */
export function parsePeriodoResumen(value: string | undefined): PeriodoResumen {
  return PERIODOS_RESUMEN.includes(value as PeriodoResumen) ? (value as PeriodoResumen) : PERIODO_RESUMEN_DEFAULT;
}

const MESES: Record<Exclude<PeriodoResumen, "30d" | "todos">, number> = { "3m": 3, "6m": 6, "12m": 12 };

/**
 * First jornada (inclusive) of `periodo` ending on `hoy`, or `undefined` for
 * "todos". Months go back to the same day of the month, clamped to the
 * month's last day (31/05 minus 3 months = 28/02 or 29/02).
 */
export function inicioDePeriodo(periodo: PeriodoResumen, hoy: string): string | undefined {
  if (periodo === "todos") return undefined;
  const [year, month, day] = hoy.split("-").map(Number) as [number, number, number];
  // 30 jornadas counting today.
  if (periodo === "30d") return new Date(Date.UTC(year, month - 1, day - 29)).toISOString().slice(0, 10);
  const index = year * 12 + (month - 1) - MESES[periodo];
  const targetYear = Math.floor(index / 12);
  const targetMonth = index % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}
