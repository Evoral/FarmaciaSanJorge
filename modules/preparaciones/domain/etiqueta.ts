/**
 * Etiqueta content (M11, point 8.5): what goes on the printed label, modeled
 * on the farmacia's real label (top band with the brand and the director
 * técnico, "Rp/" with the fórmula, the receta number, the quantity with its
 * forma and vía, the médico). Pure, no I/O. `infrastructure/etiqueta-pdf.ts`
 * lays this out; `formatearContenidoEtiqueta` is its plain-text record,
 * persisted as `etiqueta.contenido`.
 *
 * DP-28 is still OPEN. Every rule the pharmacist has not confirmed yet is
 * isolated in ONE named constant or function below, marked PENDING (DP-28),
 * so changing it later is a one-line edit.
 */
import { formatNumero } from "@/shared/format/cantidad";
import { FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { ordenarComponentes } from "@/modules/elaboracion/domain/orden-componentes";
import type { ModoExpresion } from "@/modules/recetas/domain/receta";

type FormaFarmaceutica = keyof typeof FORMA_FARMACEUTICA_LABELS;

export interface ComponenteEtiqueta {
  drogaNombre: string;
  /** Decimal string as prescribed; `null` for CS/CSP. */
  cantidad: string | null;
  unidadSimbolo: string;
  modoExpresion: ModoExpresion;
  /** Snapshot of the droga's clase = DROGA when the receta was saved. */
  esPrincipioActivo: boolean;
}

export interface DatosEtiqueta {
  formaFarmaceutica: string;
  cantidadUnidades: number;
  componentes: readonly ComponenteEtiqueta[];
  asientoNumeroCorrelativo: string | null;
  recetaNumeroInterno: string;
  pacienteTexto: string;
  medicoNombre: string;
  medicoApellido: string;
  medicoMatricula: string;
  medicoJurisdiccion: "PROVINCIAL" | "NACIONAL";
  /** DT vigente on the confirmation date; `null` if none was designated. */
  directorTecnico: { nombre: string; apellido: string; matricula: string } | null;
  tenantDomicilio: string | null;
}

export interface ContenidoEtiqueta {
  /** Name already in capitals. `null` prints a blank line. */
  directorTecnico: { nombre: string; matricula: string } | null;
  domicilio: string | null;
  /** "Droga cantidad unidad", one per line. */
  rp: string[];
  vence: string;
  recetaNumero: string;
  cantidad: number;
  /** Forma label agreeing with `cantidad` ("Cápsulas", "Crema"). */
  forma: string;
  /** `null` when the vía cannot be derived from the forma. */
  via: string | null;
  conservacion: string;
  medico: string;
  /** `null` while the label does not show the paciente. */
  paciente: string | null;
}

// ----------------------------------------------------------------------------
// PENDING (DP-28) rules
// ----------------------------------------------------------------------------

/** PENDING (DP-28): the "Receta N" is the libro recetario asiento number, falling back to the receta's número interno. */
export function numeroRecetaEtiqueta(datos: Pick<DatosEtiqueta, "asientoNumeroCorrelativo" | "recetaNumeroInterno">): string {
  return datos.asientoNumeroCorrelativo ?? datos.recetaNumeroInterno;
}

/** PENDING (DP-28): no expiry data yet, so a blank line to fill in by hand. */
export const VENCE_ETIQUETA = "Vence: ______";

/** PENDING (DP-28): vía per forma, singular/plural. SOLUCION and SUSPENSION are ambiguous (oral or topical), so they have none. */
const VIA_POR_FORMA: Readonly<Record<FormaFarmaceutica, readonly [singular: string, plural: string] | null>> = {
  CAPSULA: ["Oral", "Orales"],
  COMPRIMIDO: ["Oral", "Orales"],
  JARABE: ["Oral", "Orales"],
  POLVO: ["Oral", "Orales"],
  CREMA: ["Uso externo", "Uso externo"],
  GEL: ["Uso externo", "Uso externo"],
  UNGUENTO: ["Uso externo", "Uso externo"],
  LOCION: ["Uso externo", "Uso externo"],
  OVULO: ["Vaginal", "Vaginales"],
  SUPOSITORIO: ["Rectal", "Rectales"],
  SOLUCION: null,
  SUSPENSION: null,
};

/** The vía agrees in number with the quantity ("30 Cápsulas / Orales", "1 Cápsula / Oral"). */
export function viaDeAdministracion(forma: string, cantidad: number): string | null {
  const via = VIA_POR_FORMA[forma as FormaFarmaceutica];
  if (!via) return null;
  return cantidad === 1 ? via[0] : via[1];
}

/**
 * PENDING (DP-28): "Rp/" lists only the principios activos; when none is
 * flagged, every componente except the CS/CSP excipient. In
 * `ordenarComponentes` order.
 */
export function componentesRp(componentes: readonly ComponenteEtiqueta[]): ComponenteEtiqueta[] {
  const ordenados = ordenarComponentes(componentes);
  const activos = ordenados.filter((c) => c.esPrincipioActivo);
  return activos.length > 0 ? activos : ordenados.filter((c) => c.modoExpresion !== "CS" && c.modoExpresion !== "CSP");
}

/** PENDING (DP-28): the label does not show the paciente (the real one doesn't). */
export const MOSTRAR_PACIENTE_EN_ETIQUETA = false;

export const CONSERVACION_ETIQUETA = "Conservar en lugar fresco y seco";

// ----------------------------------------------------------------------------
// Formatting
// ----------------------------------------------------------------------------

/** "Mazindol 2 mg", "Ácido salicílico 0,3 g" (es-AR decimals). */
export function formatearLineaRp(componente: Pick<ComponenteEtiqueta, "drogaNombre" | "cantidad" | "unidadSimbolo">): string {
  if (componente.cantidad === null) return componente.drogaNombre;
  return `${componente.drogaNombre} ${formatNumero(componente.cantidad)} ${componente.unidadSimbolo}`;
}

const PLURAL_FORMA: Readonly<Record<FormaFarmaceutica, string>> = {
  CAPSULA: "Cápsulas",
  COMPRIMIDO: "Comprimidos",
  CREMA: "Cremas",
  GEL: "Geles",
  UNGUENTO: "Ungüentos",
  JARABE: "Jarabes",
  SOLUCION: "Soluciones",
  SUSPENSION: "Suspensiones",
  POLVO: "Polvos",
  OVULO: "Óvulos",
  SUPOSITORIO: "Supositorios",
  LOCION: "Lociones",
};

export function formaSegunCantidad(forma: string, cantidad: number): string {
  if (cantidad === 1) return FORMA_FARMACEUTICA_LABELS[forma as FormaFarmaceutica] ?? forma;
  return PLURAL_FORMA[forma as FormaFarmaceutica] ?? forma;
}

/** "Médico Gómez, Ana  MAT MP 1234". */
export function formatearMedicoEtiqueta(datos: Pick<DatosEtiqueta, "medicoNombre" | "medicoApellido" | "medicoMatricula" | "medicoJurisdiccion">): string {
  const prefijo = datos.medicoJurisdiccion === "NACIONAL" ? "MN" : "MP";
  return `Médico ${datos.medicoApellido}, ${datos.medicoNombre}  MAT ${prefijo} ${datos.medicoMatricula}`;
}

export function armarContenidoEtiqueta(datos: DatosEtiqueta): ContenidoEtiqueta {
  const dt = datos.directorTecnico;
  return {
    directorTecnico: dt ? { nombre: `${dt.nombre} ${dt.apellido}`.toLocaleUpperCase("es-AR"), matricula: dt.matricula } : null,
    domicilio: datos.tenantDomicilio,
    rp: componentesRp(datos.componentes).map(formatearLineaRp),
    vence: VENCE_ETIQUETA,
    recetaNumero: numeroRecetaEtiqueta(datos),
    cantidad: datos.cantidadUnidades,
    forma: formaSegunCantidad(datos.formaFarmaceutica, datos.cantidadUnidades),
    via: viaDeAdministracion(datos.formaFarmaceutica, datos.cantidadUnidades),
    conservacion: CONSERVACION_ETIQUETA,
    medico: formatearMedicoEtiqueta(datos),
    paciente: MOSTRAR_PACIENTE_EN_ETIQUETA ? datos.pacienteTexto : null,
  };
}

/** URL of the etiqueta PDF route for a preparación, rendered on the size (`etiqueta_tamano.id`) chosen in the "Seleccionar tamaño" dialog. */
export function hrefEtiquetaPdf(preparacionId: string, tamanoId: string): string {
  return `/api/preparaciones/${encodeURIComponent(preparacionId)}/etiqueta/pdf?tamano=${encodeURIComponent(tamanoId)}`;
}

/** Plain-text record of the label, persisted to `etiqueta.contenido`: the same fields the PDF prints, in reading order. */
export function formatearContenidoEtiqueta(contenido: ContenidoEtiqueta): string {
  const dt = contenido.directorTecnico;
  const lineas = [
    dt ? `Director Técnico ${dt.nombre} - MAT. ${dt.matricula}` : "Director Técnico ______",
    contenido.domicilio,
    "Rp/",
    ...contenido.rp,
    contenido.vence,
    `Receta N ${contenido.recetaNumero}`,
    `${contenido.cantidad} ${contenido.forma}${contenido.via ? ` — ${contenido.via}` : ""}`,
    contenido.conservacion,
    contenido.paciente ? `Paciente ${contenido.paciente}` : null,
    contenido.medico,
  ];
  return lineas.filter((l): l is string => l !== null).join("\n");
}
