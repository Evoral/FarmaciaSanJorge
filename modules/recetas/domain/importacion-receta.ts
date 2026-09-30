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
}

export interface DrogaCandidata {
  id: string;
  nombre: string;
}

export type ViaMatchDroga = "ALIAS" | "NOMBRE";

export interface MatchDroga {
  drogaId: string;
  via: ViaMatchDroga;
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
  if (porAlias) return { drogaId: porAlias.drogaId, via: "ALIAS" };
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
  | "UNIDAD_SIN_MATCH";

export interface AdvertenciaImportacion {
  codigo: CodigoAdvertenciaImportacion;
  mensaje: string;
  texto?: string;
}

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
  drogaNombre: string | null;
  via: ViaMatchDroga | null;
  unidadMedidaId: string | null;
}

export interface VistaPreviaImportacion {
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

export const MENSAJE_CAMBIOS_DESDE_LECTURA = "Los datos cambiaron desde que se leyó el PDF. Volvé a leerlo.";

/** One warning per differing field, naming whose data it is. */
export function advertenciasDeDiferencias(quien: "paciente" | "médico", diferencias: readonly DiferenciaDato[]): AdvertenciaImportacion[] {
  return diferencias.map((d) => ({
    codigo: "DIFERENCIA_DATOS" as const,
    mensaje: `${ETIQUETAS_CAMPOS_IMPORTABLES[d.campo]} del ${quien}: la receta dice «${d.pdf}», el sistema tiene «${d.actual}». Se conserva el del sistema.`,
  }));
}
