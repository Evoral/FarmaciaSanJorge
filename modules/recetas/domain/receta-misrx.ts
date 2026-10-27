/**
 * MisRx ("MRx Digital", Ministerio de Salud de Mendoza) receta import -- the pure part
 * (openspec/specs/importacion-receta-qr/spec.md, "Emisor MisRx"). Its QR encodes
 * `https://misrx.com.ar/prestacion?token=<uuid>`; the receta is read from the emisor's public JSON API with that token
 * (infrastructure/receta-misrx-api.server.ts). Its PDFs are one image with no text layer, so the PDF import decodes
 * that same QR from the image. As with RCTA, the scanned text is never a fetch target: only the token is taken from it.
 */
import { z } from "zod";
import {
  clasificarRenglonCuerpo,
  colapsar,
  conItem,
  domicilioDesdeRenglon,
  MISRX_HOST,
  parsearCuerpo,
  urlVerificacionMisrx,
  type AdvertenciaParser,
  type BorradorItem,
  type JurisdiccionMatriculaPdf,
  type NombreSeparado,
} from "./receta-pdf-parser";
import type { CodigoErrorQr, ResultadoLecturaQr } from "./receta-qr";
import { esObjetoVacio, fechaNacimientoIso, normalizarCodigoDiagnostico, sexoDesdeCodigo, soloDigitos } from "./receta-rcta-json";

/** The QR import's messages for a MisRx receta (the codes are shared with RCTA; "RCTA_NO_DISPONIBLE" means "the emisor did not answer"). */
export const MENSAJES_LECTURA_QR_MISRX: Readonly<Record<CodigoErrorQr, string>> = {
  QR_INVALIDO: "QR no válido o receta no encontrada",
  RCTA_NO_DISPONIBLE: "No se pudo consultar MisRx. Probá de nuevo en unos minutos o cargá la receta a mano.",
  FORMATO_INESPERADO: "MisRx devolvió la receta en un formato inesperado. Cargala a mano.",
};

export const MENSAJES_LECTURA_PDF_MISRX: Readonly<Record<CodigoErrorQr, string>> = {
  ...MENSAJES_LECTURA_QR_MISRX,
  QR_INVALIDO: "MisRx no encontró la receta de este PDF. Cargala a mano.",
};

const RE_ESQUEMA_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
/**
 * A UUID. A USB scanner with the wrong keyboard layout garbles punctuation, so any single non-hex character separates
 * its groups; the token is rebuilt with dashes.
 */
const RE_TOKEN = /(?<![0-9a-f])([0-9a-f]{8})[^0-9a-f]([0-9a-f]{4})[^0-9a-f]([0-9a-f]{4})[^0-9a-f]([0-9a-f]{4})[^0-9a-f]([0-9a-f]{12})(?![0-9a-f])/gi;
/** Canonical form sent to the API. */
export const RE_TOKEN_MISRX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function esHostMisrx(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === MISRX_HOST || host.endsWith(`.${MISRX_HOST}`);
}

/**
 * The receta token in `texto` (lowercase, dashed), or `null` when the text does not name the emisor (a bare UUID could
 * be anything), is a well-formed URL on another host, or carries no token / two different ones.
 */
export function extraerTokenMisrx(texto: string): string | null {
  const limpio = texto.trim();
  if (!/misrx/i.test(limpio)) return null;
  if (RE_ESQUEMA_URL.test(limpio)) {
    let url: URL | null = null;
    try {
      url = new URL(limpio);
    } catch {
      // Looks like a link but does not parse: fall through to the token scan.
    }
    if (url !== null && url.hostname.length > 0 && !esHostMisrx(url.hostname)) return null;
  }
  const tokens = new Set([...limpio.matchAll(RE_TOKEN)].map((m) => m.slice(1, 6).join("-").toLowerCase()));
  return tokens.size === 1 ? [...tokens][0]! : null;
}

/** The token of the first text (a PDF link, a QR decoded from a PDF image) that yields one. */
export function tokenMisrxDe(textos: readonly string[]): string | null {
  for (const texto of textos) {
    const token = extraerTokenMisrx(texto);
    if (token !== null) return token;
  }
  return null;
}

// ============================================================================
// JSON -> draft
// ============================================================================

const texto = z.string().nullish();
const textoONumero = z.union([z.string(), z.number()]).nullish();

/** Only the fields read; the rest of the answer is ignored. */
export const recetaMisrxJsonSchema = z.looseObject({
  nrorecetario: z.union([z.string().min(1), z.number()]),
  dni: textoONumero,
  cuil: textoONumero,
  apellido: texto,
  nombres: texto,
  sexo: texto,
  fecha_nacimiento: texto,
  medico_apellido: texto,
  medico_nombres: texto,
  tipo_matricula: texto,
  matricula: textoONumero,
  medico_direccion: texto,
  telefono_receta: texto,
  especialidad: texto,
  fecha_emision: texto,
  fecha_prestacion: texto,
  cie10: texto,
  descripcion_cie10: texto,
  diagnostico: texto,
  observaciones: texto,
  items: z.array(z.looseObject({ descripcion: texto })).min(1),
});

type RecetaMisrxJson = z.infer<typeof recetaMisrxJsonSchema>;

function fallo(codigo: CodigoErrorQr): ResultadoLecturaQr {
  return { ok: false, codigo, mensaje: MENSAJES_LECTURA_QR_MISRX[codigo] };
}

function textoDe(valor: string | number | null | undefined): string | null {
  return valor === null || valor === undefined ? null : colapsar(String(valor)) || null;
}

/** The JSON gives nombres and apellido apart: no split to confirm. */
function nombreDe(nombres: string | null | undefined, apellido: string | null | undefined): NombreSeparado | null {
  const nombre = textoDe(nombres);
  const ap = textoDe(apellido);
  if (nombre === null || ap === null) return null;
  return { nombreCompleto: `${nombre} ${ap}`, nombre, apellido: ap, requiereConfirmacion: false };
}

/** "MPM" (matrícula provincial de Mendoza), "MP" -> PROVINCIAL; "MN" -> NACIONAL. */
function jurisdiccionMisrx(tipo: string | null | undefined): JurisdiccionMatriculaPdf | null {
  const t = tipo?.trim().toUpperCase() ?? "";
  return t.startsWith("MP") ? "PROVINCIAL" : t.startsWith("MN") ? "NACIONAL" : null;
}

const RE_DOMICILIO_NOTA = /^domicilio\b\s*:?\s*(.+)$/i;
/** "San Martín 3407 Lujan de Cuyo. RECETA PARA PREPARADO": the address ends where a sentence in capitals starts. */
const RE_FIN_DOMICILIO = /\.\s+(?=[A-ZÁÉÍÓÚÑ]{2,}(?:\s|$))/;
/** "(1 caja)" after the presentación: how many boxes to dispense, meaningless for a preparado. */
const RE_SOLO_ENVASES = /^\d+\s+(?:cajas?|envases?|frascos?)$/i;

function informativo(advertencias: AdvertenciaParser[], linea: string): void {
  advertencias.push({ codigo: "RENGLON_INFORMATIVO", mensaje: `Nota de la receta (informativa, no se guarda): «${linea}»`, texto: linea });
}

/**
 * The doctor's free-text notes ("observaciones"): a "Domicilio ..." line is the patient's domicilio; a dosing line
 * ("Clomipramina 2xdia.") joins the item when the receta has only one; anything else is shown, not stored.
 */
function leerObservaciones(
  observaciones: string | null | undefined,
  cantidadItems: number,
  advertencias: AdvertenciaParser[],
): { domicilioPaciente: string | null; lineasItem: string[] } {
  let domicilioPaciente: string | null = null;
  const lineasItem: string[] = [];
  for (const linea of (observaciones ?? "").split(/\r\n|\r|\n/).map(colapsar).filter((l) => l.length > 0)) {
    const domicilio = RE_DOMICILIO_NOTA.exec(linea);
    if (domicilio && domicilioPaciente === null) {
      const [direccion, ...resto] = domicilio[1]!.split(RE_FIN_DOMICILIO);
      domicilioPaciente = domicilioDesdeRenglon(direccion!.replace(/\.$/, ""));
      const despues = colapsar(resto.join(". "));
      if (despues.length > 0) informativo(advertencias, despues);
      continue;
    }
    const clase = clasificarRenglonCuerpo(linea).clase;
    if (cantidadItems === 1 && (clase === "indicacion" || clase === "duracion")) lineasItem.push(linea);
    else informativo(advertencias, linea);
  }
  return { domicilioPaciente, lineasItem };
}

function mapearItems(json: RecetaMisrxJson, lineasExtra: readonly string[], advertencias: AdvertenciaParser[]): BorradorItem[] {
  const total = json.items.length;
  return json.items.map((item, i) => {
    const lineas = (item.descripcion ?? "").split(/\r\n|\r|\n/).map(colapsar).filter((l) => l.length > 0);
    const parseado = parsearCuerpo([...lineas, ...lineasExtra]);
    const conNumero = (mensaje: string) => conItem(mensaje, i + 1, total);
    for (const a of parseado.advertencias) {
      if (a.codigo === "RENGLON_NO_RECONOCIDO" && a.texto !== undefined && RE_SOLO_ENVASES.test(a.texto)) continue;
      advertencias.push({ ...a, mensaje: conNumero(a.mensaje) });
    }
    const faltante = (mensaje: string) => advertencias.push({ codigo: "DATO_FALTANTE", mensaje: conNumero(mensaje) });
    if (parseado.item.componentes.length === 0) faltante("No se encontraron componentes con su dosis.");
    if (parseado.item.cantidadUnidades === null) faltante("No se encontró la cantidad de unidades (por ejemplo, «30 comprimidos»).");
    return parseado.item;
  });
}

/** `json` is the API's parsed body; `token` is the validated token it was fetched with (the verification URL is rebuilt from it). */
export function mapearRecetaMisrx(json: unknown, token: string): ResultadoLecturaQr {
  if (json === null || json === undefined || esObjetoVacio(json)) return fallo("QR_INVALIDO");
  const parseado = recetaMisrxJsonSchema.safeParse(json);
  if (!parseado.success) return fallo("FORMATO_INESPERADO");
  const datos = parseado.data;
  const advertencias: AdvertenciaParser[] = [];
  const faltante = (mensaje: string) => advertencias.push({ codigo: "DATO_FALTANTE", mensaje });

  const fechaPrescripcion = fechaNacimientoIso(datos.fecha_emision ?? null);
  if (fechaPrescripcion === null) faltante("No se encontró la fecha de creación de la receta.");

  const pacienteNombre = nombreDe(datos.nombres, datos.apellido);
  if (pacienteNombre === null) faltante("No se encontró el nombre del paciente.");

  const medicoNombre = nombreDe(datos.medico_nombres, datos.medico_apellido);
  if (medicoNombre === null) faltante("No se encontró el nombre del médico.");
  const matricula = soloDigitos(textoDe(datos.matricula));
  const matriculaJurisdiccion = jurisdiccionMisrx(datos.tipo_matricula);
  if (matricula === null) faltante("No se encontró la matrícula del médico.");
  else if (matriculaJurisdiccion === null) faltante("No se reconoció el tipo de matrícula del médico (MP o MN): elegí la jurisdicción.");

  const codigoCrudo = textoDe(datos.cie10);
  const diagnosticoCodigo = codigoCrudo === null ? null : normalizarCodigoDiagnostico(codigoCrudo);
  if (codigoCrudo !== null && diagnosticoCodigo === null) {
    faltante("El código de diagnóstico de la receta no tiene formato CIE-10: se conserva solo la descripción.");
  }

  const { domicilioPaciente, lineasItem } = leerObservaciones(datos.observaciones, datos.items.length, advertencias);
  const items = mapearItems(datos, lineasItem, advertencias);

  return {
    ok: true,
    borrador: {
      emisor: "MISRX",
      nroRecetaEmisor: String(datos.nrorecetario).trim(),
      urlVerificacion: urlVerificacionMisrx(token),
      fechaPrescripcion,
      fechaValidaDesde: fechaNacimientoIso(datos.fecha_prestacion ?? null),
      diagnosticoCodigo,
      diagnosticoDescripcion: textoDe(datos.descripcion_cie10) ?? textoDe(datos.diagnostico),
      domicilioPaciente,
      paciente: {
        nombre: pacienteNombre,
        dni: soloDigitos(textoDe(datos.dni)),
        cuil: soloDigitos(textoDe(datos.cuil)),
        sexo: sexoDesdeCodigo(datos.sexo ?? null),
        fechaNacimiento: fechaNacimientoIso(datos.fecha_nacimiento ?? null),
        // MisRx's "nroafiliado" is its own afiliado number (the same for OSDE and "Particular"), not the coverage's credencial.
        nroCredencial: null,
      },
      medico: {
        nombre: medicoNombre,
        especialidad: textoDe(datos.especialidad),
        matricula,
        matriculaJurisdiccion,
        direccionRegistrada: textoDe(datos.medico_direccion),
        telefono: textoDe(datos.telefono_receta),
      },
      items,
    },
    advertencias,
  };
}
