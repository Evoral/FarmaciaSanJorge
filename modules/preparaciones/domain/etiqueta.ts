/**
 * Etiqueta content (M11, point 8.5): what goes on the printed label, modeled
 * on the farmacia's real label (docs/specs/etiqueta-preparado.md): top band
 * with the brand, the director técnico, the domicilio and the two phones;
 * "Rp/" with the fórmula; the paciente, receta number, dosis, quantity with
 * its forma, vía and fracción de dosis, and the vencimiento; the médico. Pure, no I/O. `infrastructure/etiqueta-pdf.ts`
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
import { dosisPorTomaDePosologia, tomasPorDiaDePosologia } from "@/modules/recetas/domain/receta-pdf-parser";
import type { ModoExpresion } from "@/modules/recetas/domain/receta";
import { esTipoVencimientoEnDias, type TipoVencimientoPreparado } from "./vencimiento";

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
  /** The DT TITULAR (never a suplente) vigente on the confirmation date, else the current one; `null` if none. */
  directorTecnico: { nombre: string; apellido: string; matricula: string } | null;
  tenantDomicilio: string | null;
  /** Farmacia phones (`tenant.telefono_fijo` / `telefono_celular`, migration 0089). */
  tenantTelefonoFijo: string | null;
  tenantTelefonoCelular: string | null;
  /** The ítem's prescribed posología (free text), printed as "Dosis". */
  posologia: string | null;
  /** Decimal string in (0, 1]: how much of a dose one unit holds (`item_receta.fraccion_dosis_por_unidad`). */
  fraccionDosisPorUnidad: string;
  /**
   * `YYYY-MM-DD` snapshot taken when the preparación was confirmed
   * (`preparacion.fecha_vencimiento`, migration 0068); `null` for one
   * confirmed before that, which keeps the blank "Vence" line.
   */
  fechaVencimiento: string | null;
  /** The tipo chosen at confirmation (`preparacion.tipo_vencimiento`, migration 0096); `null` before 0096. */
  tipoVencimiento: TipoVencimientoPreparado | null;
}

export interface ContenidoEtiqueta {
  /** Name already in capitals. `null` prints a blank line. */
  directorTecnico: { nombre: string; matricula: string } | null;
  domicilio: string | null;
  /** `null` leaves the phone's line blank. */
  telefonoFijo: string | null;
  celular: string | null;
  /** "Droga cantidad unidad", one per line. */
  rp: string[];
  vence: string;
  recetaNumero: string;
  /** Units per day ("2 cáp/día", `dosisEtiqueta`), or the posología as prescribed when it cannot be read; `null` when the receta has none. */
  dosis: string | null;
  cantidad: number;
  /** Forma label agreeing with `cantidad` ("Cápsulas", "Crema"). */
  forma: string;
  /** `null` when the vía cannot be derived from the forma. */
  via: string | null;
  /** "1/2 Dosis" when one unit holds a fraction of a dose; `null` for a whole dose. */
  fraccionDosis: string | null;
  conservacion: string;
  medico: string;
  /** `null` when the asiento has no paciente text. */
  paciente: string | null;
}

// ----------------------------------------------------------------------------
// PENDING (DP-28) rules
// ----------------------------------------------------------------------------

/**
 * DP-28 "Número de receta" (resolved 2026-10-07): the "Receta N" is the libro recetario asiento number.
 * A printable etiqueta always has one (it is written when the preparación is confirmed); the fallback to
 * the receta's número interno is only defensive.
 */
export function numeroRecetaEtiqueta(datos: Pick<DatosEtiqueta, "asientoNumeroCorrelativo" | "recetaNumeroInterno">): string {
  return datos.asientoNumeroCorrelativo ?? datos.recetaNumeroInterno;
}

/** The blank "Vence" line, for a preparación with no `fecha_vencimiento` (confirmed before migration 0068): filled in by hand. */
export const VENCE_ETIQUETA = "Vence: ______";

/**
 * DP-28 "Vencimiento" (resolved 2026-10-07): "Vence: MM/YY" from the
 * `YYYY-MM-DD` snapshot -- the month and year of the expiry date, e.g.
 * "2026-03-31" -> "Vence: 03/26". A tipo counted in days prints the day too,
 * "Vence: 04/11/26" (docs/specs/vencimiento-preparado.md R12). `null` keeps `VENCE_ETIQUETA`.
 */
export function formatearVenceEtiqueta(fechaVencimiento: string | null, tipo: TipoVencimientoPreparado | null = null): string {
  if (fechaVencimiento === null) return VENCE_ETIQUETA;
  const [anio, mes, dia] = fechaVencimiento.split("-");
  return esTipoVencimientoEnDias(tipo) ? `Vence: ${dia}/${mes}/${anio!.slice(-2)}` : `Vence: ${mes}/${anio!.slice(-2)}`;
}

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
 * "Rp/" lists every principio activo and nothing else (DP-28, confirmed
 * 2026-10-07). PENDING (DP-28): when none is flagged, every componente except
 * the CS/CSP excipient, so the label is never left without a fórmula. In
 * `ordenarComponentes` order.
 */
export function componentesRp(componentes: readonly ComponenteEtiqueta[]): ComponenteEtiqueta[] {
  const ordenados = ordenarComponentes(componentes);
  const activos = ordenados.filter((c) => c.esPrincipioActivo);
  return activos.length > 0 ? activos : ordenados.filter((c) => c.modoExpresion !== "CS" && c.modoExpresion !== "CSP");
}

/** Rp/ lines that fit in one column of the label. */
export const LINEAS_RP_POR_COLUMNA = 7;

/** At most two columns: the label prints up to 14 Rp/ lines. */
export const MAX_LINEAS_RP = LINEAS_RP_POR_COLUMNA * 2;

/**
 * Rp/ lines as laid out on the label (DP-28, confirmed 2026-10-07: every
 * principio activo goes on the label). Up to 7 lines: one column. 8 to 14:
 * two balanced columns, the first one taking the odd line (9 -> 5 + 4).
 * Beyond 14, the first 13 are printed and the last slot says how many were
 * left out. Only the PRINTED label is capped; `etiqueta.contenido` keeps
 * every line.
 */
export function columnasRp(rp: readonly string[]): string[][] {
  if (rp.length === 0) return [];
  const lineas = rp.length > MAX_LINEAS_RP ? [...rp.slice(0, MAX_LINEAS_RP - 1), `… y ${rp.length - (MAX_LINEAS_RP - 1)} más`] : [...rp];
  if (lineas.length <= LINEAS_RP_POR_COLUMNA) return [lineas];
  const corte = Math.ceil(lineas.length / 2);
  return [lineas.slice(0, corte), lineas.slice(corte)];
}

/** The label shows the paciente (2026-10-19: the farmacia's current label does). */
export const MOSTRAR_PACIENTE_EN_ETIQUETA = true;

/** Forms counted in units ("60 Cápsulas"), the only ones whose unit can hold a fraction of a dose. */
export const FORMAS_POR_UNIDAD: ReadonlySet<string> = new Set(["CAPSULA", "COMPRIMIDO", "OVULO", "SUPOSITORIO"]);

/** ASCII on purpose: the PDF's standard fonts (WinAnsi) have no "⅓". */
const FRACCIONES_ETIQUETA: ReadonlyArray<{ valor: number; texto: string }> = [
  { valor: 0.5, texto: "1/2" },
  { valor: 1 / 3, texto: "1/3" },
  { valor: 0.25, texto: "1/4" },
];

/** "1/2 Dosis" for a capsule holding half a dose; `null` for a whole dose or a form not counted in units. */
export function fraccionDosisEtiqueta(forma: string, fraccionDosisPorUnidad: string): string | null {
  const valor = Number(fraccionDosisPorUnidad);
  if (!FORMAS_POR_UNIDAD.has(forma) || !(valor > 0) || valor >= 1) return null;
  const texto = FRACCIONES_ETIQUETA.find((f) => Math.abs(f.valor - valor) < 0.001)?.texto ?? formatNumero(fraccionDosisPorUnidad);
  return `${texto} Dosis`;
}

/** Abbreviation of each unit-counted form for the "Dosis" line. */
const UNIDAD_DOSIS: Readonly<Record<string, string>> = {
  CAPSULA: "cáp",
  COMPRIMIDO: "comp",
  OVULO: "óvulos",
  SUPOSITORIO: "sup",
};

/**
 * "Dosis" as the paciente reads it: units to take per day (2026-10-19, the farmacia writes "2 cáp/día" for
 * "Media dosis cada 12 horas"). Units per toma = doses per toma / dose fraction of one unit (one unit per toma when
 * the unit already holds the prescribed fraction, docs/specs/importacion-receta-pdf.md), times the tomas per day
 * ("cada N horas" -> 24 / N, "N veces al día"). Falls back to the posología as written when the form is not counted
 * in units or the text states no frequency.
 */
export function dosisEtiqueta(forma: string, posologia: string | null, fraccionDosisPorUnidad: string): string | null {
  const texto = textoDeUnaLinea(posologia);
  if (texto === null) return null;
  const unidad = UNIDAD_DOSIS[forma];
  const tomas = tomasPorDiaDePosologia(texto);
  const fraccion = Number(fraccionDosisPorUnidad);
  if (!unidad || tomas === null || !(fraccion > 0)) return texto;
  const porDia = tomas.times(dosisPorTomaDePosologia(texto)).div(fraccionDosisPorUnidad);
  return `${formatNumero(porDia, 2)} ${unidad}/día`;
}

/** Collapses whitespace (the snapshot is one line per field); blank -> `null`. */
export function textoDeUnaLinea(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").trim().replace(/\s+/g, " ");
  return limpio === "" ? null : limpio;
}

export const CONSERVACION_ETIQUETA = "Conservar en lugar fresco y seco";

/** R13: an aqueous preparado without conservante goes to the fridge. */
export const CONSERVACION_HELADERA_ETIQUETA = "Conservar en heladera (2 °C a 8 °C)";

export function conservacionEtiqueta(tipo: TipoVencimientoPreparado | null): string {
  return tipo === "ACUOSA_SIN_CONSERVANTE" ? CONSERVACION_HELADERA_ETIQUETA : CONSERVACION_ETIQUETA;
}

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

/** "Médico: Ana Gómez  -  MAT:1234", as on the farmacia's label (2026-10-19: no MP/MN prefix). */
export function formatearMedicoEtiqueta(datos: Pick<DatosEtiqueta, "medicoNombre" | "medicoApellido" | "medicoMatricula">): string {
  return `Médico: ${datos.medicoNombre} ${datos.medicoApellido}  -  MAT:${datos.medicoMatricula}`;
}

export function armarContenidoEtiqueta(datos: DatosEtiqueta): ContenidoEtiqueta {
  const dt = datos.directorTecnico;
  return {
    directorTecnico: dt ? { nombre: `${dt.nombre} ${dt.apellido}`.toLocaleUpperCase("es-AR"), matricula: dt.matricula } : null,
    domicilio: textoDeUnaLinea(datos.tenantDomicilio),
    telefonoFijo: textoDeUnaLinea(datos.tenantTelefonoFijo),
    celular: textoDeUnaLinea(datos.tenantTelefonoCelular),
    rp: componentesRp(datos.componentes).map(formatearLineaRp),
    vence: formatearVenceEtiqueta(datos.fechaVencimiento, datos.tipoVencimiento),
    recetaNumero: numeroRecetaEtiqueta(datos),
    dosis: dosisEtiqueta(datos.formaFarmaceutica, datos.posologia, datos.fraccionDosisPorUnidad),
    cantidad: datos.cantidadUnidades,
    forma: formaSegunCantidad(datos.formaFarmaceutica, datos.cantidadUnidades),
    via: viaDeAdministracion(datos.formaFarmaceutica, datos.cantidadUnidades),
    fraccionDosis: fraccionDosisEtiqueta(datos.formaFarmaceutica, datos.fraccionDosisPorUnidad),
    conservacion: conservacionEtiqueta(datos.tipoVencimiento),
    medico: formatearMedicoEtiqueta(datos),
    paciente: MOSTRAR_PACIENTE_EN_ETIQUETA ? textoDeUnaLinea(datos.pacienteTexto) : null,
  };
}

/**
 * Why a CONFIRMADA preparación's etiqueta can no longer be generated or printed (docs/specs/reserva-stock-preparacion.md
 * R22), `null` when it can: its receta was ANULADA, or its asiento in the libro recetario was dejado sin efecto
 * (anulado or rectificado) -- the preparado is no longer valid.
 */
export function motivoEtiquetaNoImprimible(datos: { recetaEstado: string; asientoSinEfecto: boolean; asientoNumeroCorrelativo: string | null }): string | null {
  if (datos.recetaEstado === "ANULADA") return "La receta está anulada: no se pueden imprimir sus etiquetas.";
  if (datos.asientoSinEfecto) {
    const asiento = datos.asientoNumeroCorrelativo ? ` (asiento Nº ${datos.asientoNumeroCorrelativo})` : "";
    return `El asiento de esta preparación en el libro recetario${asiento} quedó sin efecto (anulado o rectificado): su etiqueta ya no se puede imprimir.`;
  }
  return null;
}

/** URL of the etiqueta PDF route for a preparación: the size (`etiqueta_tamano.id`) and the cell (columna, fila, 1-based) of the sheet chosen in the print dialog (docs/specs/hoja-etiquetas.md R7). */
export function hrefEtiquetaPdf(preparacionId: string, tamanoId: string, celda: { columna: number; fila: number }): string {
  return `/api/preparaciones/${encodeURIComponent(preparacionId)}/etiqueta/pdf?tamano=${encodeURIComponent(tamanoId)}&columna=${celda.columna}&fila=${celda.fila}`;
}

/** Plain-text record of the label, persisted to `etiqueta.contenido`: the same fields the PDF prints, in reading order. */
export function formatearContenidoEtiqueta(contenido: ContenidoEtiqueta): string {
  const dt = contenido.directorTecnico;
  const lineas = [
    dt ? `Director Técnico ${dt.nombre} - MAT. ${dt.matricula}` : "Director Técnico ______",
    contenido.domicilio,
    contenido.telefonoFijo ? `${PREFIJO_TELEFONO_FIJO}${contenido.telefonoFijo}` : null,
    contenido.celular ? `${PREFIJO_CELULAR}${contenido.celular}` : null,
    "Rp/",
    ...contenido.rp,
    contenido.vence,
    `Receta N ${contenido.recetaNumero}`,
    contenido.dosis ? `${PREFIJO_DOSIS}${contenido.dosis}` : null,
    `${contenido.cantidad} ${contenido.forma}${contenido.via ? ` — ${contenido.via}` : ""}`,
    contenido.fraccionDosis ? `${PREFIJO_FRACCION}${contenido.fraccionDosis}` : null,
    contenido.conservacion,
    contenido.paciente ? `Paciente ${contenido.paciente}` : null,
    contenido.medico,
  ];
  return lineas.filter((l): l is string => l !== null).join("\n");
}

const PREFIJO_DT = "Director Técnico ";
const DT_VACIO = "Director Técnico ______";
const SEPARADOR_MATRICULA = " - MAT. ";
const PREFIJO_RECETA = "Receta N ";
const PREFIJO_VENCE = "Vence: ";
const PREFIJO_PACIENTE = "Paciente ";
const SEPARADOR_VIA = " — ";
const PREFIJO_TELEFONO_FIJO = "Teléfono fijo ";
const PREFIJO_CELULAR = "Celular ";
const PREFIJO_DOSIS = "Dosis: ";
const PREFIJO_FRACCION = "Por unidad: ";

/**
 * The inverse of `formatearContenidoEtiqueta`: the persisted `etiqueta.contenido` snapshot back into the fields the
 * PDF lays out, so every print (first or reprint) shows exactly what was recorded when the etiqueta was generated --
 * never a rebuild from live data (docs/specs/vencimiento-preparado.md R7). `null` when the text is not in this
 * layout (an etiqueta stored by an older formatter): the caller then rebuilds it from the preparación's data, as
 * before. `formatearContenidoEtiqueta` + this function round-trip every `ContenidoEtiqueta` whose free texts are
 * single-line (the formatter's own precondition: it joins lines with "\n").
 */
export function parsearContenidoEtiqueta(texto: unknown): ContenidoEtiqueta | null {
  if (typeof texto !== "string" || texto.length === 0) return null;
  const lineas = texto.split("\n");
  let i = 0;

  const lineaDt = lineas[i++];
  let directorTecnico: ContenidoEtiqueta["directorTecnico"];
  if (lineaDt === DT_VACIO) {
    directorTecnico = null;
  } else if (lineaDt?.startsWith(PREFIJO_DT) && lineaDt.includes(SEPARADOR_MATRICULA)) {
    const resto = lineaDt.slice(PREFIJO_DT.length);
    const corte = resto.lastIndexOf(SEPARADOR_MATRICULA);
    directorTecnico = { nombre: resto.slice(0, corte), matricula: resto.slice(corte + SEPARADOR_MATRICULA.length) };
  } else {
    return null;
  }

  // The domicilio and phone lines are omitted when null (a text stored before 0089 has no phone lines).
  const esTelefono = (l: string | undefined) => !!l && (l.startsWith(PREFIJO_TELEFONO_FIJO) || l.startsWith(PREFIJO_CELULAR));
  let domicilio: string | null = null;
  if (lineas[i] !== "Rp/" && !esTelefono(lineas[i])) domicilio = lineas[i++] ?? null;
  let telefonoFijo: string | null = null;
  if (lineas[i]?.startsWith(PREFIJO_TELEFONO_FIJO)) telefonoFijo = lineas[i++]!.slice(PREFIJO_TELEFONO_FIJO.length);
  let celular: string | null = null;
  if (lineas[i]?.startsWith(PREFIJO_CELULAR)) celular = lineas[i++]!.slice(PREFIJO_CELULAR.length);
  if (lineas[i++] !== "Rp/") return null;

  // Rp/ lines run up to the "Vence" line, which is followed by "Receta N ...".
  const indiceReceta = lineas.findIndex((l, j) => j > i && l.startsWith(PREFIJO_RECETA) && lineas[j - 1]?.startsWith(PREFIJO_VENCE));
  if (indiceReceta < 0) return null;
  const rp = lineas.slice(i, indiceReceta - 1);
  const vence = lineas[indiceReceta - 1]!;
  const recetaNumero = lineas[indiceReceta]!.slice(PREFIJO_RECETA.length);
  i = indiceReceta + 1;
  let dosis: string | null = null;
  if (lineas[i]?.startsWith(PREFIJO_DOSIS)) dosis = lineas[i++]!.slice(PREFIJO_DOSIS.length);

  const lineaCantidad = lineas[i++];
  const cantidadMatch = lineaCantidad ? /^(\d+) (.+)$/.exec(lineaCantidad) : null;
  if (!cantidadMatch) return null;
  const [formaTexto, via] = cantidadMatch[2]!.includes(SEPARADOR_VIA)
    ? [cantidadMatch[2]!.slice(0, cantidadMatch[2]!.indexOf(SEPARADOR_VIA)), cantidadMatch[2]!.slice(cantidadMatch[2]!.indexOf(SEPARADOR_VIA) + SEPARADOR_VIA.length)]
    : [cantidadMatch[2]!, null];

  let fraccionDosis: string | null = null;
  if (lineas[i]?.startsWith(PREFIJO_FRACCION)) fraccionDosis = lineas[i++]!.slice(PREFIJO_FRACCION.length);
  const conservacion = lineas[i++];
  if (conservacion === undefined) return null;
  let paciente: string | null = null;
  if (lineas[i]?.startsWith(PREFIJO_PACIENTE) && i < lineas.length - 1) paciente = lineas[i++]!.slice(PREFIJO_PACIENTE.length);
  const medico = lineas[i++];
  if (medico === undefined || i !== lineas.length) return null;

  return {
    directorTecnico,
    domicilio,
    telefonoFijo,
    celular,
    rp,
    vence,
    recetaNumero,
    dosis,
    cantidad: Number(cantidadMatch[1]),
    forma: formaTexto,
    via,
    fraccionDosis,
    conservacion,
    medico,
    paciente,
  };
}
