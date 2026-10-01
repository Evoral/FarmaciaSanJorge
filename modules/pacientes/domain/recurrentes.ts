/**
 * Pure derivation for the "Pacientes recurrentes" view
 * (docs/specs/pacientes-recurrentes.md): patients who periodically order the
 * same preparation, when their next order is expected, and the prefilled
 * WhatsApp reminder. No I/O, no Prisma (eslint's domainBoundaryPatterns
 * enforce this).
 *
 * HEALTH-ADJACENT DATA (Ley 25.326, DP-24 unresolved): this file only SHAPES
 * data the infrastructure layer already read under `pacientes.gestionar`; it
 * never logs and nothing here may end up in OUR URLs. The one deliberate
 * exception is `construirUrlWhatsapp`: a `wa.me` link carries the phone and the
 * message by design -- it is an external link the person clicks, built at render
 * time and never logged or stored by this system.
 *
 * Shape of the data flow:
 *   infrastructure/recurrentes-repository.ts       ->  `RecurrentesCrudos`
 *   application/list-pacientes-recurrentes.ts      ->  `calcularRecurrentes()` (this file)
 *   ui/recurrentes-tabla.tsx                       ->  renders the rows
 *
 * Every date is a CALENDAR DAY in the tenant's time zone (`jornadaDe`), never
 * the server's zone and never UTC: a receta ingresada at 22:00 in Mendoza is
 * already "tomorrow" in UTC, and "today" decides ATRASADO vs ESTA_SEMANA.
 */
import { dec } from "@/shared/decimal";
import { FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { inicioDeJornada, jornadaDe } from "@/shared/time/jornada";
import type { EstadoReceta, FormaFarmaceutica, ModoExpresion } from "@/modules/recetas/domain/receta";

// ============================================================================
// Constants (easy to change, see the spec)
// ============================================================================

/** A (paciente, fórmula) pair is recurrente when it shows up in this many DISTINCT recetas inside the window. */
export const OCURRENCIAS_MINIMAS = 2;

/** Window of recetas considered, in calendar months back from today. */
export const VENTANA_MESES = 12;

/** "Esta semana" = the próxima fecha is within this many days from today (inclusive). */
export const DIAS_ESTA_SEMANA = 7;

/** An overdue row older than this many intervals is dropped: the patient most likely stopped. */
export const FACTOR_DESCARTE_ATRASADO = 2;

/** Rows per page of the Recurrentes list. */
export const PAGE_SIZE_RECURRENTES = 20;

/** Upper bound of the `?page=` value accepted by the use case; callers clamp to it (the use case then clamps to the last real page). */
export const PAGE_MAX_RECURRENTES = 100_000;

const MS_POR_DIA = 86_400_000;

export const VENTANAS_RECURRENTES = ["proximos", "todos"] as const;
/** `proximos` (default) = ATRASADO + ESTA_SEMANA; `todos` also shows MAS_ADELANTE. */
export type VentanaRecurrentes = (typeof VENTANAS_RECURRENTES)[number];

export type EstadoRecurrente = "ATRASADO" | "ESTA_SEMANA" | "MAS_ADELANTE";

export const ESTADO_RECURRENTE_LABELS: Readonly<Record<EstadoRecurrente, string>> = {
  ATRASADO: "Atrasado",
  ESTA_SEMANA: "Esta semana",
  MAS_ADELANTE: "Más adelante",
};

export type MotivoSinWhatsapp = "SIN_CONSENTIMIENTO" | "SIN_TELEFONO" | "TELEFONO_INVALIDO";

export const MOTIVO_SIN_WHATSAPP_LABELS: Readonly<Record<MotivoSinWhatsapp, string>> = {
  SIN_CONSENTIMIENTO: "Sin consentimiento",
  SIN_TELEFONO: "Sin teléfono",
  TELEFONO_INVALIDO: "Teléfono inválido",
};

// ============================================================================
// Raw input (what the repository reads)
// ============================================================================

export interface ComponenteRecurrenteCrudo {
  drogaId: string;
  drogaNombre: string;
  /** Decimal string; `null` for c.s. / c.s.p. components without a quantity. */
  cantidad: string | null;
  unidadMedidaId: string;
  unidadSimbolo: string;
  modoExpresion: ModoExpresion;
}

export interface PacienteRecurrenteCrudo {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string | null;
  aceptaRecordatoriosWhatsapp: boolean;
  fechaBaja: Date | null;
}

/** One item de receta with its componentes, receta and paciente: one row of the repository's single batched read. */
export interface ItemRecurrenteCrudo {
  id: string;
  descripcion: string | null;
  formaFarmaceutica: FormaFarmaceutica;
  duracionTratamientoDias: number | null;
  componentes: ComponenteRecurrenteCrudo[];
  receta: { id: string; fechaIngreso: Date; estado: EstadoReceta };
  paciente: PacienteRecurrenteCrudo;
}

export interface RecurrentesCrudos {
  zonaHoraria: string;
  /** Display name of the farmacia (nombre de fantasía, else razón social), for the WhatsApp message. */
  farmaciaNombre: string;
  items: ItemRecurrenteCrudo[];
}

// ============================================================================
// Output
// ============================================================================

export interface RecurrenteFila {
  /** Stable React key: the paciente plus the latest item of the group. */
  clave: string;
  paciente: PacienteRecurrenteCrudo;
  /** "Qué pide", for the table. */
  quePide: string;
  /** Same thing worded to read inside a sentence (the WhatsApp message). */
  quePideEnMensaje: string;
  /** Number of distinct occurrences (recetas on distinct calendar days) with this fórmula inside the window. */
  veces: number;
  /** Typical interval in days (median gap, or the prescriber's own period). */
  intervaloDias: number;
  /** Instant of the latest receta's `fechaIngreso`. */
  ultimoPedido: Date;
  /** Estimated next date as a CALENDAR DAY: UTC midnight of the day in the tenant's zone (format it in UTC, like a Postgres `date`). */
  proximaFecha: Date;
  /** Days from today to `proximaFecha` (negative = overdue). */
  diasHastaProxima: number;
  estado: EstadoRecurrente;
}

// ============================================================================
// Calendar-day helpers (tenant time zone)
// ============================================================================

/** "YYYY-MM-DD" -> whole days since the epoch (a pure calendar number: no zone, no DST). */
function numeroDeDia(jornada: string): number {
  const [anio, mes, dia] = jornada.split("-").map(Number);
  return Date.UTC(anio!, mes! - 1, dia!) / MS_POR_DIA;
}

/** The calendar day an instant belongs to in `zonaHoraria`, as a day number. */
function diaDe(instante: Date, zonaHoraria: string): number {
  return numeroDeDia(jornadaDe(instante, zonaHoraria));
}

/** "YYYY-MM-DD" minus `meses` calendar months; the day is clamped to the target month's last day (31 Mar - 1 month = 28/29 Feb). */
export function restarMeses(jornada: string, meses: number): string {
  const [anio, mes, dia] = jornada.split("-").map(Number);
  const total = anio! * 12 + (mes! - 1) - meses;
  const nuevoAnio = Math.floor(total / 12);
  const nuevoMes = total - nuevoAnio * 12;
  const ultimoDia = new Date(Date.UTC(nuevoAnio, nuevoMes + 1, 0)).getUTCDate();
  const nuevoDia = Math.min(dia!, ultimoDia);
  return `${String(nuevoAnio).padStart(4, "0")}-${String(nuevoMes + 1).padStart(2, "0")}-${String(nuevoDia).padStart(2, "0")}`;
}

/** First instant of the window: local midnight of today minus `VENTANA_MESES` months, in the tenant's zone. The repository filters `fechaIngreso >= this`. */
export function inicioVentanaRecurrentes(ahora: Date, zonaHoraria: string): Date {
  return inicioDeJornada(restarMeses(jornadaDe(ahora, zonaHoraria), VENTANA_MESES), zonaHoraria);
}

// ============================================================================
// Fórmula signature
// ============================================================================

/**
 * `formaFarmaceutica` + the SORTED componentes as `(drogaId, cantidad,
 * unidadMedidaId, modoExpresion)`. Two items with the same signature are "the
 * same thing" (docs/specs/pacientes-recurrentes.md). Details that matter:
 *  - order of componentes is irrelevant (sorted);
 *  - the cantidad is compared as a NUMBER (`0.50` and `0.5` are equal: the
 *    `numeric` column keeps whatever scale was typed), so a different cantidad
 *    means a different fórmula;
 *  - `descripcion` / `cantidadUnidades` are NOT part of it;
 *  - the sort keeps duplicated tuples (a multiset, stricter than a set), so an
 *    item that lists the same componente twice is not the same as one that lists
 *    it once.
 */
export function firmaFormula(item: Pick<ItemRecurrenteCrudo, "formaFarmaceutica" | "componentes">): string {
  const partes = item.componentes
    .map((c) => [c.drogaId, c.cantidad === null ? "-" : dec(c.cantidad).toFixed(), c.unidadMedidaId, c.modoExpresion].join(":"))
    .sort();
  return `${item.formaFarmaceutica}|${partes.join("|")}`;
}

// ============================================================================
// Interval / next date / estado
// ============================================================================

/** Median of a non-empty list (the mean of the two middle values when even). */
export function mediana(valores: readonly number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? ordenados[medio]! : (ordenados[medio - 1]! + ordenados[medio]!) / 2;
}

/**
 * Typical interval in whole days between the recetas of one group, given their
 * calendar-day numbers in ascending order (at least two).
 *  - median of the gaps between consecutive recetas (rounded half up);
 *  - exactly 2 recetas and a known `duracionTratamientoDias` on the LATEST one:
 *    that value (the prescriber's own period) instead of the single gap.
 */
export function intervaloTipicoDias(dias: readonly number[], duracionTratamientoDiasUltima: number | null): number {
  if (dias.length === 2 && duracionTratamientoDiasUltima !== null && duracionTratamientoDiasUltima > 0) return duracionTratamientoDiasUltima;
  const saltos: number[] = [];
  for (let i = 1; i < dias.length; i += 1) saltos.push(dias[i]! - dias[i - 1]!);
  return Math.round(mediana(saltos));
}

/**
 * ATRASADO when the próxima fecha already passed (before today), ESTA_SEMANA
 * from today up to `DIAS_ESTA_SEMANA` days ahead (inclusive), MAS_ADELANTE
 * after that.
 */
export function estadoRecurrente(diasHastaProxima: number): EstadoRecurrente {
  if (diasHastaProxima < 0) return "ATRASADO";
  if (diasHastaProxima <= DIAS_ESTA_SEMANA) return "ESTA_SEMANA";
  return "MAS_ADELANTE";
}

/** True when the row is overdue by MORE than `FACTOR_DESCARTE_ATRASADO` times its interval (the patient likely stopped ordering it). */
export function esAtrasoDescartable(diasHastaProxima: number, intervaloDias: number): boolean {
  return diasHastaProxima < 0 && -diasHastaProxima > FACTOR_DESCARTE_ATRASADO * intervaloDias;
}

// ============================================================================
// "Qué pide"
// ============================================================================

function formatearCantidad(valor: string): string {
  return dec(valor).toFixed().replace(".", ",");
}

function textoComponente(c: ComponenteRecurrenteCrudo): string {
  const cantidad = c.cantidad === null ? "" : `${formatearCantidad(c.cantidad)} ${c.unidadSimbolo}`.trim();
  switch (c.modoExpresion) {
    case "CS":
      return `${c.drogaNombre} c.s.`;
    case "CSP":
      return `${c.drogaNombre} c.s.p.${cantidad ? ` ${cantidad}` : ""}`;
    case "POR_DOSIS":
      return `${c.drogaNombre} ${cantidad} por dosis`.replace(/\s+/g, " ").trim();
    default:
      return `${c.drogaNombre} ${cantidad}`.trim();
  }
}

/** The free-text `descripcion` ends up in the table AND in the WhatsApp message/URL: it is capped. */
export const MAX_DESCRIPCION_CARACTERES = 120;

/** At most `max` characters (code points), the last one being an ellipsis when something was cut. */
export function acotarTexto(texto: string, max: number): string {
  const caracteres = Array.from(texto);
  if (caracteres.length <= max) return texto;
  return `${caracteres.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * What the patient orders: the item's `descripcion` (capped at
 * `MAX_DESCRIPCION_CARACTERES`) when present, else the
 * forma farmacéutica plus its drogas with cantidad/unidad. `textoMensaje` is the
 * same text lower-cased at the start when it was built from the forma, so it
 * reads inside "...tu preparado de cápsula de Melatonina 3 mg".
 */
export function describirQuePide(item: Pick<ItemRecurrenteCrudo, "descripcion" | "formaFarmaceutica" | "componentes">): { texto: string; textoMensaje: string } {
  const descripcion = item.descripcion?.trim();
  if (descripcion) {
    const acotada = acotarTexto(descripcion, MAX_DESCRIPCION_CARACTERES);
    return { texto: acotada, textoMensaje: acotada };
  }

  const forma = FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica] ?? item.formaFarmaceutica;
  const drogas = item.componentes.map(textoComponente).join(", ");
  const detalle = drogas ? ` de ${drogas}` : "";
  return { texto: `${forma}${detalle}`, textoMensaje: `${forma.toLowerCase()}${detalle}` };
}

// ============================================================================
// Detection
// ============================================================================

interface GrupoFormula {
  paciente: PacienteRecurrenteCrudo;
  /** One item per distinct receta (the same fórmula twice in ONE receta counts once). */
  porReceta: Map<string, ItemRecurrenteCrudo>;
}

/** Recetas of a group, oldest first (receta id breaks ties so the order is deterministic). */
function ocurrenciasOrdenadas(grupo: GrupoFormula): ItemRecurrenteCrudo[] {
  return [...grupo.porReceta.values()].sort((a, b) => a.receta.fechaIngreso.getTime() - b.receta.fechaIngreso.getTime() || a.receta.id.localeCompare(b.receta.id));
}

/** Keeps ONE occurrence per calendar day of `zonaHoraria` (the latest of that day, input is oldest first), with its day number. */
function colapsarPorDia(ordenadas: readonly ItemRecurrenteCrudo[], zonaHoraria: string): { dia: number; item: ItemRecurrenteCrudo }[] {
  const porDia = new Map<number, ItemRecurrenteCrudo>();
  for (const item of ordenadas) porDia.set(diaDe(item.receta.fechaIngreso, zonaHoraria), item);
  return [...porDia].map(([dia, item]) => ({ dia, item })).sort((a, b) => a.dia - b.dia);
}

/**
 * The recurrent (paciente, fórmula) pairs, with their typical interval, próxima
 * fecha and estado relative to `ahora` in `zonaHoraria`, ordered for display.
 *
 *  - Source rows of ANULADA recetas and of pacientes dados de baja are ignored
 *    (the repository already filters them in the query; this keeps the rule
 *    true for any caller).
 *  - A pair is recurrente with `OCURRENCIAS_MINIMAS` or more DISTINCT recetas
 *    on DISTINCT calendar days (tenant zone): recetas of the same pair ingresadas
 *    the same day are collapsed into one occurrence (the latest of that day)
 *    BEFORE counting `veces` and gaps, so a duplicated entry cannot pull the
 *    median down (days 0, 0, 30 -> 2 occurrences, interval 30). Input order does
 *    not matter.
 *  - Overdue pairs older than `FACTOR_DESCARTE_ATRASADO` x interval are dropped.
 */
export function calcularRecurrentes(items: readonly ItemRecurrenteCrudo[], zonaHoraria: string, ahora: Date): RecurrenteFila[] {
  const grupos = new Map<string, GrupoFormula>();
  // Items sorted by id so "the item of a receta" is deterministic when a receta repeats a fórmula.
  const ordenados = [...items].sort((a, b) => a.id.localeCompare(b.id));
  for (const item of ordenados) {
    if (item.receta.estado === "ANULADA" || item.paciente.fechaBaja !== null) continue;
    const clave = `${item.paciente.id}\u0000${firmaFormula(item)}`;
    const grupo = grupos.get(clave);
    if (!grupo) grupos.set(clave, { paciente: item.paciente, porReceta: new Map([[item.receta.id, item]]) });
    else if (!grupo.porReceta.has(item.receta.id)) grupo.porReceta.set(item.receta.id, item);
  }

  const hoy = diaDe(ahora, zonaHoraria);
  const filas: RecurrenteFila[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.porReceta.size < OCURRENCIAS_MINIMAS) continue;

    const ocurrencias = colapsarPorDia(ocurrenciasOrdenadas(grupo), zonaHoraria);
    if (ocurrencias.length < OCURRENCIAS_MINIMAS) continue;
    const ultima = ocurrencias[ocurrencias.length - 1]!.item;
    const dias = ocurrencias.map((o) => o.dia);
    // Distinct days make every gap >= 1, so the interval is always >= 1 day.
    const intervaloDias = intervaloTipicoDias(dias, ultima.duracionTratamientoDias);

    const proximoDia = dias[dias.length - 1]! + intervaloDias;
    const diasHastaProxima = proximoDia - hoy;
    if (esAtrasoDescartable(diasHastaProxima, intervaloDias)) continue;

    const { texto, textoMensaje } = describirQuePide(ultima);
    filas.push({
      clave: `${grupo.paciente.id}:${ultima.id}`,
      paciente: grupo.paciente,
      quePide: texto,
      quePideEnMensaje: textoMensaje,
      veces: ocurrencias.length, // distinct calendar days
      intervaloDias,
      ultimoPedido: ultima.receta.fechaIngreso,
      proximaFecha: new Date(proximoDia * MS_POR_DIA),
      diasHastaProxima,
      estado: estadoRecurrente(diasHastaProxima),
    });
  }

  return filas.sort(compararRecurrentes);
}

/** Próxima fecha ascending; apellido, nombre, then the key, so the order (and therefore the pages) is stable. */
export function compararRecurrentes(a: RecurrenteFila, b: RecurrenteFila): number {
  return (
    a.proximaFecha.getTime() - b.proximaFecha.getTime() ||
    a.paciente.apellido.localeCompare(b.paciente.apellido, "es") ||
    a.paciente.nombre.localeCompare(b.paciente.nombre, "es") ||
    (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0)
  );
}

/** The default `proximos` window is ATRASADO + ESTA_SEMANA; `todos` adds MAS_ADELANTE. */
export function filtrarPorVentana<T extends Pick<RecurrenteFila, "estado">>(filas: readonly T[], ventana: VentanaRecurrentes): T[] {
  return ventana === "todos" ? [...filas] : filas.filter((f) => f.estado !== "MAS_ADELANTE");
}

// ============================================================================
// WhatsApp
// ============================================================================

const AREA_ARGENTINA = /^(11\d{8}|[23]\d{9})$/;

/** A trailing extension ("int 15", "interno 204", "ext. 3", "anexo 12", "x12", "#7"): not part of the number. */
const EXTENSION = /\s*(int|interno|ext|anexo|x|#)\.?\s*\d+\s*$/i;

/**
 * Removes the mobile prefix "15" from `area + 15 + number` (12 digits). The area
 * code is 2 (`11`), 3 (`[23]xx`) or 4 (`[23]xxx`) digits long, so the "15" can only
 * sit at index 2, 3 or 4 respectively. `null` unless exactly ONE candidate survives.
 */
function sinPrefijo15(digitos12: string): string | null {
  const candidatos: string[] = [];
  const quitarEn = (i: number) => digitos12.slice(0, i) + digitos12.slice(i + 2);
  if (digitos12.startsWith("11") && digitos12.slice(2, 4) === "15") candidatos.push(quitarEn(2));
  if (/^[23]\d{2}/.test(digitos12) && digitos12.slice(3, 5) === "15") candidatos.push(quitarEn(3));
  if (/^[23]\d{3}/.test(digitos12) && digitos12.slice(4, 6) === "15") candidatos.push(quitarEn(4));
  return candidatos.length === 1 ? candidatos[0]! : null;
}

/**
 * Free-text phone -> Argentine WhatsApp number `549` + area code + number (13
 * digits), or `null` when it cannot be normalized CONFIDENTLY (the UI then shows
 * "Teléfono inválido"). A wrong number would message a stranger, so any doubt is
 * a `null`.
 *
 *  1. Blank -> null. A trailing extension ("int 15") is dropped; then only the
 *     digits are kept. Whether the input started with `+` or `00` is remembered.
 *  2. International prefix: a leading `00` is dropped. If `+` or `00` was present
 *     the next digits MUST be the country code `54` (any other country -> null);
 *     without them a leading `54` is dropped anyway (no area code starts with 5).
 *  3. An optional mobile marker `9` is dropped, then 4. an optional trunk `0`.
 *  5. What remains is the national number: 10 digits (area + number), or 12 digits
 *     (area + `15` + number, the `15` removed when its position is unambiguous);
 *     any other length -> null.
 *  6. It must start with a real area code (`11`, or `2x` / `3x`).
 *  7. Result: `549` + the 10 digits.
 *
 * A landline cannot be told apart from a mobile when it is written without `9`
 * or `15`, so those are accepted too: the consent flag plus a person reviewing
 * the message before sending it are the safeguard. `15 1234 5678` (mobile prefix
 * but no area code) is rejected: the area code is unknown. A field holding TWO
 * numbers ("11 1234 5678 / 11 8765 4321") is rejected on purpose: it has too many
 * digits and cannot be split confidently.
 */
export function normalizarTelefonoWhatsappAR(telefono: string | null | undefined): string | null {
  if (!telefono || telefono.trim() === "") return null;
  const sinExtension = telefono.trim().replace(EXTENSION, "");
  let digitos = sinExtension.replace(/\D/g, "");
  const conPrefijoInternacional = sinExtension.startsWith("+") || digitos.startsWith("00");

  if (digitos.startsWith("00")) digitos = digitos.slice(2);
  if (conPrefijoInternacional) {
    if (!digitos.startsWith("54")) return null;
    digitos = digitos.slice(2);
  } else if (digitos.startsWith("54")) {
    digitos = digitos.slice(2);
  }

  if (digitos.startsWith("9")) digitos = digitos.slice(1);
  if (digitos.startsWith("0")) digitos = digitos.slice(1);

  let nacional: string | null = null;
  if (digitos.length === 10) nacional = digitos;
  else if (digitos.length === 12) nacional = sinPrefijo15(digitos);

  if (nacional === null || !AREA_ARGENTINA.test(nacional)) return null;
  return `549${nacional}`;
}

export type DisponibilidadWhatsapp = { disponible: true; telefono: string } | { disponible: false; motivo: MotivoSinWhatsapp };

/**
 * The WhatsApp button is offered only when the patient accepted reminders AND
 * the phone normalizes. Otherwise the reason, checked in this order: consent
 * first (without it the phone is irrelevant), then a missing phone, then an
 * invalid one.
 */
export function evaluarWhatsapp(aceptaRecordatorios: boolean, telefono: string | null): DisponibilidadWhatsapp {
  if (!aceptaRecordatorios) return { disponible: false, motivo: "SIN_CONSENTIMIENTO" };
  if (telefono === null || telefono.trim() === "") return { disponible: false, motivo: "SIN_TELEFONO" };
  const normalizado = normalizarTelefonoWhatsappAR(telefono);
  if (normalizado === null) return { disponible: false, motivo: "TELEFONO_INVALIDO" };
  return { disponible: true, telefono: normalizado };
}

/** The reminder text a person reviews and sends (docs/specs/pacientes-recurrentes.md, "WhatsApp"). */
export function construirMensajeRecordatorio(datos: { nombre: string; farmacia: string; formula: string }): string {
  const nombre = datos.nombre.trim().replace(/\s+/g, " ");
  const formula = datos.formula.trim();
  const cierreFormula = formula.endsWith(".") ? "" : ".";
  return `Hola ${nombre}, te escribimos de ${datos.farmacia}. Se acerca la fecha de tu preparado de ${formula}${cierreFormula} ¿Querés que lo preparemos? Respondé este mensaje y lo coordinamos.`;
}

/**
 * `https://wa.me/<digits>?text=<message>`. PRIVACY: unlike every other href in
 * this module, this one carries identifying data (phone + patient first name)
 * -- by design, it is the external link the person clicks to open WhatsApp. It
 * is rendered into the page only for a session holding `pacientes.gestionar`,
 * opened in a new tab (`rel="noopener noreferrer"`), and never logged or stored
 * by this system.
 */
export function construirUrlWhatsapp(telefonoNormalizado: string, mensaje: string): string {
  return `https://wa.me/${telefonoNormalizado}?text=${encodeURIComponent(mensaje)}`;
}
