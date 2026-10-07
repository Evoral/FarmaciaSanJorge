/**
 * Pure rules of the receta PDF import's match step and confirmation
 * (docs/specs/importacion-receta-pdf.md, "Pieza 4 -- Match" and
 * "Confirmación"). The lookups themselves are infrastructure
 * (../infrastructure/importacion-repository.ts); what to do with what was
 * found is decided here, so it is testable without a database:
 *
 *   - drogas: `droga_alias.aliasNormalizado` first, then the normalized
 *     `droga.nombre` -- exact comparison, never fuzzy;
 *   - unidades: normalized `simbolo` or `codigo` ("mg" -> MILIGRAMO);
 *   - existing paciente/médico: only EMPTY fields are completed with the
 *     PDF's data, an existing value is never overwritten, and a differing
 *     value is an informative warning.
 */
import { normalizarTexto } from "./normalizar";
import type { AdvertenciaParser, BorradorReceta } from "./receta-pdf-parser";

// ============================================================================
// Completing existing paciente/médico
// ============================================================================

export const CAMPOS_PACIENTE_IMPORTABLES = ["dni", "cuil", "sexo", "fechaNacimiento", "nroCredencial"] as const;
export type CampoPacienteImportable = (typeof CAMPOS_PACIENTE_IMPORTABLES)[number];

export const CAMPOS_MEDICO_IMPORTABLES = ["especialidad", "telefono", "direccionRegistrada"] as const;
export type CampoMedicoImportable = (typeof CAMPOS_MEDICO_IMPORTABLES)[number];

export const ETIQUETAS_CAMPOS_IMPORTABLES: Readonly<Record<CampoPacienteImportable | CampoMedicoImportable | "nombre", string>> = {
  dni: "DNI",
  cuil: "CUIL",
  sexo: "Sexo",
  fechaNacimiento: "Fecha de nacimiento",
  nroCredencial: "Nº de credencial",
  especialidad: "Especialidad",
  telefono: "Teléfono",
  direccionRegistrada: "Dirección",
  nombre: "Nombre y apellido",
};

export interface DiferenciaDato {
  campo: CampoPacienteImportable | CampoMedicoImportable | "nombre";
  actual: string;
  pdf: string;
}

export interface Completado<C extends string> {
  /** Empty fields of the existing row that the PDF will fill. */
  completar: C[];
  /** Fields where both have a value and they differ (normalized): never overwritten, only warned about. */
  diferencias: DiferenciaDato[];
}

function vacio(valor: string | null | undefined): boolean {
  return valor === null || valor === undefined || valor.trim().length === 0;
}

/**
 * Which fields the PDF would complete on an existing row, and which differ
 * (spec: "se completan solo los campos vacíos ... nunca se pisa un valor
 * existente. Si hay diferencias -> advertencia informativa").
 */
export function calcularCompletado<C extends CampoPacienteImportable | CampoMedicoImportable>(
  campos: readonly C[],
  actual: Readonly<Record<C, string | null>>,
  pdf: Readonly<Record<C, string | null>>,
): Completado<C> {
  const completar: C[] = [];
  const diferencias: DiferenciaDato[] = [];
  for (const campo of campos) {
    const valorPdf = pdf[campo];
    if (vacio(valorPdf)) continue;
    const valorActual = actual[campo];
    if (vacio(valorActual)) completar.push(campo);
    else if (normalizarTexto(valorActual!) !== normalizarTexto(valorPdf!)) diferencias.push({ campo, actual: valorActual!, pdf: valorPdf! });
  }
  return { completar, diferencias };
}

/** The existing full name vs. the PDF's, compared as a whole (a 3+ word split may differ while the name is the same). */
export function diferenciaDeNombre(actual: { nombre: string; apellido: string }, nombreCompletoPdf: string | null): DiferenciaDato | null {
  if (vacio(nombreCompletoPdf)) return null;
  const completoActual = `${actual.nombre} ${actual.apellido}`;
  return normalizarTexto(completoActual) === normalizarTexto(nombreCompletoPdf!) ? null : { campo: "nombre", actual: completoActual, pdf: nombreCompletoPdf! };
}

/** The values to write: for each field to complete, the PDF's value (the caller writes them only where the row is STILL empty). */
export function valoresACompletar<C extends string>(completar: readonly C[], pdf: Readonly<Record<C, string | null>>): Partial<Record<C, string>> {
  const valores: Partial<Record<C, string>> = {};
  for (const campo of completar) {
    const valor = pdf[campo];
    if (!vacio(valor)) valores[campo] = valor!.trim();
  }
  return valores;
}

// ============================================================================
// Drogas / unidades
// ============================================================================

export interface AliasDroga {
  aliasNormalizado: string;
  drogaId: string;
  /** The synonym's id and text: a componente matched through it is loaded with it (migration 0069). */
  id?: string;
  texto?: string;
}

export interface DrogaCandidata {
  id: string;
  nombre: string;
}

export type ViaMatchDroga = "ALIAS" | "NOMBRE";

export interface MatchDroga {
  drogaId: string;
  via: ViaMatchDroga;
  /** `ALIAS` only: the synonym matched (when the caller's aliases carry it) -- the componente's `drogaAliasId`. */
  aliasId?: string;
  sinonimo?: string;
}

/**
 * Spec order: a remembered alias first, then the droga's own name, both
 * normalized and compared exactly. `aliases`/`drogas` must already be
 * restricted to vigente drogas by the caller.
 */
export function resolverDroga(texto: string, aliases: readonly AliasDroga[], drogas: readonly DrogaCandidata[]): MatchDroga | null {
  const buscado = normalizarTexto(texto);
  if (buscado.length === 0) return null;
  const porAlias = aliases.find((a) => a.aliasNormalizado === buscado);
  if (porAlias) return { drogaId: porAlias.drogaId, via: "ALIAS", aliasId: porAlias.id, sinonimo: porAlias.texto };
  const porNombre = drogas.find((d) => normalizarTexto(d.nombre) === buscado);
  return porNombre ? { drogaId: porNombre.id, via: "NOMBRE" } : null;
}

export interface UnidadCandidata {
  id: string;
  codigo: string;
  simbolo: string;
}

/** "mg" -> the unidad whose simbolo (or codigo) normalizes to "mg". */
export function resolverUnidad(texto: string, unidades: readonly UnidadCandidata[]): UnidadCandidata | null {
  const buscado = normalizarTexto(texto);
  if (buscado.length === 0) return null;
  return unidades.find((u) => normalizarTexto(u.simbolo) === buscado) ?? unidades.find((u) => normalizarTexto(u.codigo) === buscado) ?? null;
}

// ============================================================================
// Preview (what the read step hands to the form)
// ============================================================================

export type CodigoAdvertenciaImportacion =
  | AdvertenciaParser["codigo"]
  | "PACIENTE_DADO_DE_BAJA"
  | "DIFERENCIA_DATOS"
  | "DROGA_SIN_MATCH"
  | "UNIDAD_SIN_MATCH"
  | "AVISOS_OMITIDOS";

export interface AdvertenciaImportacion {
  codigo: CodigoAdvertenciaImportacion;
  mensaje: string;
  texto?: string;
}

/** How the preview shows a notice: a warning to review, or plain information (nothing to fix). */
export type SeveridadAdvertencia = "advertencia" | "informativa";

/** Exhaustive on purpose: a new notice code does not compile until someone decides how it is shown. */
export const SEVERIDAD_ADVERTENCIA: Readonly<Record<CodigoAdvertenciaImportacion, SeveridadAdvertencia>> = {
  RENGLON_NO_RECONOCIDO: "advertencia",
  UNIDADES_VS_DURACION: "advertencia",
  MAS_DE_UN_ITEM: "advertencia",
  DATO_FALTANTE: "advertencia",
  MATRICULA_DISTINTA: "advertencia",
  RENGLON_INFORMATIVO: "informativa",
  DATO_NO_IMPORTADO: "advertencia",
  PACIENTE_DADO_DE_BAJA: "advertencia",
  DIFERENCIA_DATOS: "advertencia",
  DROGA_SIN_MATCH: "advertencia",
  UNIDAD_SIN_MATCH: "advertencia",
  AVISOS_OMITIDOS: "advertencia",
};

/** Splits the notices by severity, keeping the order inside each group. */
export function separarPorSeveridad<A extends AdvertenciaImportacion>(lista: readonly A[]): { advertencias: A[]; informativas: A[] } {
  const advertencias: A[] = [];
  const informativas: A[] = [];
  for (const a of lista) (SEVERIDAD_ADVERTENCIA[a.codigo] === "informativa" ? informativas : advertencias).push(a);
  return { advertencias, informativas };
}

/** The most characters (code points) a notice's `texto`, or ONE fragment of the receta's text echoed in its `mensaje`, carries; longer text is cut and ends in an ellipsis. */
export const MAX_CARACTERES_AVISO = 200;
/** Final safety bound on a whole `mensaje`: room for two cut fragments («…» of «…») plus the fixed wording around them. */
export const MAX_CARACTERES_MENSAJE = 600;
/** The most notices a preview carries, the overflow notice included. */
export const MAX_AVISOS_VISTA_PREVIA = 50;
export const MENSAJE_AVISOS_OMITIDOS = "Hay más avisos que no se muestran.";

/**
 * The match step's notices: each one asks the user to DO something (reactivate a
 * paciente, check a difference, pick a droga or a unidad), so they are the last to
 * be dropped on overflow. Every code that `construirVistaPrevia` adds, and no parser one.
 */
const CODIGOS_ACCIONABLES: ReadonlySet<CodigoAdvertenciaImportacion> = new Set(["PACIENTE_DADO_DE_BAJA", "DIFERENCIA_DATOS", "DROGA_SIN_MATCH", "UNIDAD_SIN_MATCH"]);

/** 0 = actionable match-step notice, 1 = any other warning, 2 = informational. Lower survives overflow first. */
const prioridadAviso = (codigo: CodigoAdvertenciaImportacion): 0 | 1 | 2 =>
  CODIGOS_ACCIONABLES.has(codigo) ? 0 : SEVERIDAD_ADVERTENCIA[codigo] === "informativa" ? 2 : 1;

/** Cut to `max` code points (a surrogate pair, an emoji, is never split into a lone, invalid half) plus an ellipsis. */
function acotarA(texto: string, max: number): string {
  if (texto.length <= max) return texto; // UTF-16 units >= code points: it cannot be over the cap
  const puntos = Array.from(texto);
  return puntos.length > max ? `${puntos.slice(0, max).join("")}…` : texto;
}

const acotarTexto = (texto: string): string => acotarA(texto, MAX_CARACTERES_AVISO);

/**
 * Cuts what the receta echoes inside the message, keeping the message's own
 * wording (closing «», advice, "(ítem N)") intact: first the notice's `texto`
 * as a whole (it may itself contain a "»"), then every remaining «…» fragment.
 */
function acotarEcos(mensaje: string, texto: string | undefined): string {
  const conTexto = texto !== undefined && texto.length > 0 ? mensaje.split(texto).join(acotarTexto(texto)) : mensaje;
  return conTexto.replace(/«[^»]*»/g, (cita) => {
    const interior = cita.slice(1, -1);
    const corto = acotarTexto(interior);
    return corto === interior ? cita : `«${corto}»`;
  });
}

/**
 * The final bound on a preview's notices: they echo text that is not ours (the
 * receta's own lines, drug names) and several stages add them, so the bound is
 * applied once, to the finished list (the PDF flow never goes through it).
 * Each echoed fragment and each `texto` is cut to `MAX_CARACTERES_AVISO`, so the
 * message keeps its closing marks, its advice and its item suffix; the whole
 * `mensaje` has a last safety bound of `MAX_CARACTERES_MENSAJE`. Past
 * `MAX_AVISOS_VISTA_PREVIA` notices the survivors are chosen by priority
 * (actionable match-step notices, other warnings, informational ones; original
 * order inside each group), kept in their original order, and the last slot says
 * that more exist. Pure: returns new objects and leaves the input alone.
 */
export function acotarAvisos(lista: readonly AdvertenciaImportacion[]): AdvertenciaImportacion[] {
  const acotadas = lista.map((a) => {
    const mensaje = acotarA(acotarEcos(a.mensaje, a.texto), MAX_CARACTERES_MENSAJE);
    return a.texto === undefined ? { ...a, mensaje } : { ...a, mensaje, texto: acotarTexto(a.texto) };
  });
  if (acotadas.length <= MAX_AVISOS_VISTA_PREVIA) return acotadas;

  const porPrioridad = acotadas.map((a, i) => ({ i, prioridad: prioridadAviso(a.codigo) })).sort((x, y) => x.prioridad - y.prioridad || x.i - y.i);
  const conservadas = new Set(porPrioridad.slice(0, MAX_AVISOS_VISTA_PREVIA - 1).map((p) => p.i));
  return [...acotadas.filter((_, i) => conservadas.has(i)), { codigo: "AVISOS_OMITIDOS", mensaje: MENSAJE_AVISOS_OMITIDOS }];
}

/** Where the receta was read from: the PDF upload or the QR/link of the receta. Audit-only. */
export const FUENTES_IMPORTACION = ["PDF", "QR"] as const;
export type FuenteImportacion = (typeof FUENTES_IMPORTACION)[number];

export interface PersonaExistente {
  id: string;
  nombre: string;
  apellido: string;
}

export interface PacienteVistaPrevia extends Completado<CampoPacienteImportable> {
  /** `null` -> alta on confirmation. */
  existente: (PersonaExistente & { dadoDeBaja: boolean }) | null;
}

export interface MedicoVistaPrevia extends Completado<CampoMedicoImportable> {
  existente: (PersonaExistente & { matricula: string }) | null;
}

export interface ComponenteVistaPrevia {
  drogaId: string | null;
  /** Canonical name. */
  drogaNombre: string | null;
  via: ViaMatchDroga | null;
  /** `via` ALIAS: the synonym matched, prefilled as the componente's chosen name (migration 0069). */
  drogaAliasId: string | null;
  sinonimo: string | null;
  unidadMedidaId: string | null;
}

export interface VistaPreviaImportacion {
  /** Set by the server when it reads the receta; the client echoes it back on confirmation (audit only). */
  fuente: FuenteImportacion;
  borrador: BorradorReceta;
  advertencias: AdvertenciaImportacion[];
  paciente: PacienteVistaPrevia;
  medico: MedicoVistaPrevia;
  /** Same shape as `borrador.items[i].componentes[j]`. */
  componentes: ComponenteVistaPrevia[][];
}

export const MENSAJE_PACIENTE_DADO_DE_BAJA =
  "El paciente de la receta está dado de baja. Reactivalo desde Catálogos › Pacientes para poder importar la receta (no se reactiva solo).";

export function mensajeRecetaYaImportada(numeroInterno: string): string {
  return `Esta receta ya fue cargada (receta interna Nº ${numeroInterno}).`;
}

export const MENSAJE_CAMBIOS_DESDE_LECTURA = "Los datos cambiaron desde que se leyó la receta. Volvé a leerla.";

/** One warning per differing field, naming whose data it is. */
export function advertenciasDeDiferencias(quien: "paciente" | "médico", diferencias: readonly DiferenciaDato[]): AdvertenciaImportacion[] {
  return diferencias.map((d) => ({
    codigo: "DIFERENCIA_DATOS" as const,
    mensaje: `${ETIQUETAS_CAMPOS_IMPORTABLES[d.campo]} del ${quien}: la receta dice «${d.pdf}», el sistema tiene «${d.actual}». Se conserva el del sistema.`,
  }));
}
