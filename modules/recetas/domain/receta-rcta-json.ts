/**
 * RCTA decrypter JSON -> the shared receta draft (importacion-receta-qr spec,
 * R3). PURE: it receives the already-parsed JSON body and the hash it was
 * fetched with, and returns the same `BorradorReceta` + notices the PDF parser
 * produces, or a coded failure with its user-facing message.
 *
 * The schema is TOLERANT (undocumented API: unknown keys pass through, optional
 * fields may be absent, `null` or blank) and strict only on what the import
 * cannot do without. Failures never echo the data (patient data, DP-24).
 * Items (`prescripcion[]`) are mapped by the next slice; `items` is empty until then.
 */
import { z } from "zod";
import { esDiagnosticoCodigoValido, normalizarDiagnosticoCodigo } from "./receta";
import {
  colapsar,
  parsearFechaDdMmAaaa,
  separarContactoMedico,
  urlVerificacionRcta,
  type AdvertenciaParser,
  type BorradorMedico,
  type BorradorPaciente,
  type BorradorReceta,
  type JurisdiccionMatriculaPdf,
  type NombreSeparado,
} from "./receta-pdf-parser";
import { MENSAJES_LECTURA_QR, type CodigoErrorQr, type ResultadoLecturaQr } from "./receta-qr";

/** A string or number, trimmed and whitespace-collapsed; `null` when absent, `null` or blank. */
const texto = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((valor) => (valor === null || valor === undefined ? null : colapsar(String(valor)) || null));

const itemRctaSchema = z.looseObject({
  codDiagnostico: texto,
  diagnostico: texto,
});

export const recetaRctaJsonSchema = z.looseObject({
  emisor: z.literal("RCTA"),
  /** A STRING only: a JSON number would have lost the number's leading zeros. */
  numeroReceta: z.string().trim().regex(/^\d{10,}$/),
  /** dd/mm/aaaa, "Creada" on the PDF. */
  fechaConfeccion: texto,
  /** dd/mm/aaaa, "Vigencia desde" on the PDF. */
  fechaEmision: texto,
  codDiagnostico: texto,
  diagnostico: texto,
  paciente: z
    .looseObject({
      tipoDoc: texto,
      nroDoc: texto,
      cuil: texto,
      sexo: texto,
      fechaNacimiento: texto,
      cobertura: z.looseObject({ numero: texto }).nullish(),
    })
    .nullish(),
  medico: z
    .looseObject({
      nombre: texto,
      apellido: texto,
      especialidad: texto,
      lugarAtencion: texto,
      telefono: texto,
      matricula: z.looseObject({ tipo: texto, numero: texto }).nullish(),
    })
    .nullish(),
  prescripcion: z.array(itemRctaSchema).min(1),
});

export type RecetaRctaJson = z.infer<typeof recetaRctaJsonSchema>;

function fallo(codigo: CodigoErrorQr): ResultadoLecturaQr {
  return { ok: false, codigo, mensaje: MENSAJES_LECTURA_QR[codigo] };
}

function esObjetoVacio(valor: unknown): boolean {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor) && Object.keys(valor).length === 0;
}

const RE_FECHA_ISO = /^(\d{4}-\d{2}-\d{2})(?:T|$)/;

/** "1992-04-17T00:00:00" -> "1992-04-17"; the "0001-01-01" no-date sentinel, junk and impossible dates -> `null`. */
function fechaNacimientoIso(valor: string | null): string | null {
  const m = valor === null ? null : RE_FECHA_ISO.exec(valor);
  if (!m || m[1] === "0001-01-01") return null;
  const real = new Date(`${m[1]}T00:00:00Z`);
  return Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== m[1] ? null : m[1]!;
}

function sexoDesdeCodigo(codigo: string | null): string | null {
  const c = codigo?.toUpperCase();
  return c === "F" ? "Femenino" : c === "M" ? "Masculino" : null;
}

/** "E660" -> "E66.0"; an already dotted or short valid code is kept; anything else is `null`. */
function normalizarCodigoDiagnostico(crudo: string): string | null {
  const codigo = normalizarDiagnosticoCodigo(crudo).replace(/\s+/g, "");
  if (esDiagnosticoCodigoValido(codigo)) return codigo;
  const conPunto = /^[A-Z][0-9]{2}[0-9A-Z]{1,4}$/.test(codigo) ? `${codigo.slice(0, 3)}.${codigo.slice(3)}` : codigo;
  return esDiagnosticoCodigoValido(conPunto) ? conPunto : null;
}

function jurisdiccionDesdeTipo(tipo: string | null): JurisdiccionMatriculaPdf | null {
  const t = tipo?.toUpperCase();
  return t === "MP" ? "PROVINCIAL" : t === "MN" ? "NACIONAL" : null;
}

const soloDigitos = (valor: string | null): string | null => {
  const digitos = valor?.replace(/\D/g, "") ?? "";
  return digitos.length > 0 ? digitos : null;
};

function mapearPaciente(json: RecetaRctaJson, advertencias: AdvertenciaParser[]): BorradorPaciente {
  const p = json.paciente;
  // The JSON's own `nombre` is anonymized: it is never read. The user types it when the paciente is new.
  advertencias.push({ codigo: "DATO_FALTANTE", mensaje: "El QR no incluye el nombre del paciente: escribilo para confirmar la importación." });
  return {
    nombre: null,
    dni: p?.tipoDoc === null || p?.tipoDoc === undefined || /^DNI$/i.test(p.tipoDoc) ? soloDigitos(p?.nroDoc ?? null) : null,
    cuil: soloDigitos(p?.cuil ?? null),
    sexo: sexoDesdeCodigo(p?.sexo ?? null),
    fechaNacimiento: fechaNacimientoIso(p?.fechaNacimiento ?? null),
    nroCredencial: p?.cobertura?.numero ?? null,
  };
}

function mapearMedico(json: RecetaRctaJson, advertencias: AdvertenciaParser[]): BorradorMedico {
  const m = json.medico;
  const faltante = (mensaje: string) => advertencias.push({ codigo: "DATO_FALTANTE", mensaje });

  let nombre: NombreSeparado | null = null;
  if (m?.nombre && m.apellido) nombre = { nombreCompleto: `${m.nombre} ${m.apellido}`, nombre: m.nombre, apellido: m.apellido, requiereConfirmacion: false };
  else faltante("No se encontró el nombre del médico.");

  const matricula = m?.matricula?.numero ?? null;
  const matriculaJurisdiccion = jurisdiccionDesdeTipo(m?.matricula?.tipo ?? null);
  if (matricula === null) faltante("No se encontró la matrícula del médico.");
  else if (matriculaJurisdiccion === null) faltante("No se reconoció el tipo de matrícula del médico (MP o MN): elegí la jurisdicción.");

  // "<dirección> Teléfono <número>" like the PDF's footer; without a phone the whole text is the dirección.
  const contacto = m?.lugarAtencion ? separarContactoMedico(m.lugarAtencion) : null;
  return {
    nombre,
    especialidad: m?.especialidad ?? null,
    matricula,
    matriculaJurisdiccion,
    direccionRegistrada: contacto?.direccion ?? m?.lugarAtencion ?? null,
    telefono: contacto?.telefono ?? m?.telefono ?? null,
  };
}

/** Same limit as the confirm input (`diagnosticoDescripcion` in importar-receta.ts). */
const MAX_DIAGNOSTICO_DESCRIPCION = 2000;

/**
 * Merged PER FIELD: the top-level code (or description) wins when it is non-empty,
 * otherwise the first item's. The real response keeps both at the top level and
 * leaves the item's blank, but either may be the one that is filled.
 */
function mapearDiagnostico(json: RecetaRctaJson, advertencias: AdvertenciaParser[]): Pick<BorradorReceta, "diagnosticoCodigo" | "diagnosticoDescripcion"> {
  const item = json.prescripcion[0]!;
  const codigoCrudo = json.codDiagnostico ?? item.codDiagnostico;
  const descripcion = json.diagnostico ?? item.diagnostico;
  const codigo = codigoCrudo === null ? null : normalizarCodigoDiagnostico(codigoCrudo);
  if (codigoCrudo !== null && codigo === null) {
    advertencias.push({
      codigo: "DATO_FALTANTE",
      mensaje: "El código de diagnóstico de la receta no tiene formato CIE-10: se conserva solo la descripción.",
    });
  }
  return { diagnosticoCodigo: codigo, diagnosticoDescripcion: descripcion?.slice(0, MAX_DIAGNOSTICO_DESCRIPCION) ?? null };
}

/**
 * `json` is the decrypter's parsed body; `hash` is the validated hash it was
 * fetched with (the verification URL is rebuilt from it, never taken from the JSON).
 * `null`/`{}` mean "no such receta"; a body that does not fit the schema is an unexpected format.
 */
export function mapearRecetaRcta(json: unknown, hash: string): ResultadoLecturaQr {
  if (json === null || json === undefined || esObjetoVacio(json)) return fallo("QR_INVALIDO");
  const parseado = recetaRctaJsonSchema.safeParse(json);
  if (!parseado.success) return fallo("FORMATO_INESPERADO");

  const datos = parseado.data;
  const advertencias: AdvertenciaParser[] = [];

  const fechaPrescripcion = datos.fechaConfeccion === null ? null : parsearFechaDdMmAaaa(datos.fechaConfeccion);
  if (fechaPrescripcion === null) advertencias.push({ codigo: "DATO_FALTANTE", mensaje: "No se encontró la fecha de creación de la receta." });

  const paciente = mapearPaciente(datos, advertencias);
  const medico = mapearMedico(datos, advertencias);
  const diagnostico = mapearDiagnostico(datos, advertencias);

  return {
    ok: true,
    borrador: {
      emisor: "RCTA",
      nroRecetaEmisor: datos.numeroReceta,
      urlVerificacion: urlVerificacionRcta(hash),
      fechaPrescripcion,
      fechaValidaDesde: datos.fechaEmision === null ? null : parsearFechaDdMmAaaa(datos.fechaEmision),
      ...diagnostico,
      paciente,
      medico,
      items: [],
    },
    advertencias,
  };
}
