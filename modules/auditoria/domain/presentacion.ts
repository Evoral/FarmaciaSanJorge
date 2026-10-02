/**
 * Human-readable presentation of `registro_auditoria` rows (M01/M03). Pure,
 * DB- and React-free -- unit-tested in tests/unit/auditoria-presentacion.test.ts.
 *
 * The stored `valor_anterior`/`valor_nuevo` JSON stays exactly as written
 * (immutable, INV-A02). Everything here is computed at READ time: a
 * one-line sentence ("María López modificó la droga"), a per-field table
 * with ONLY the fields that changed, labeled in Spanish, and formatted
 * values. The raw JSON is still available to the UI as a "detalle técnico"
 * fallback, so no information is ever hidden -- only reorganized.
 *
 * `ENTIDADES` must list every `entidad` string the code audits:
 * tests/unit/auditoria-entidades-catalogo.test.ts scans the sources and
 * fails when a new one is added without a label here.
 */
import type { TipoAccion } from "@/generated/prisma/enums";
import { fieldLabel } from "@/shared/labels/field-labels";

export interface EntidadInfo {
  /** Singular noun, lower case: "droga", "lote de archivo". */
  nombre: string;
  articulo: "el" | "la" | "los" | "una";
}

export const ENTIDADES: Readonly<Record<string, EntidadInfo>> = {
  acceso: { nombre: "operación sin permiso", articulo: "una" },
  asiento_historico: { nombre: "asiento histórico", articulo: "el" },
  asiento_recetario: { nombre: "asiento del libro recetario", articulo: "el" },
  cierre_diario: { nombre: "cierre diario", articulo: "el" },
  cierre_diario_reporte: { nombre: "reporte de cumplimiento de firma", articulo: "el" },
  co_firma_dt: { nombre: "co-firma del director técnico", articulo: "la" },
  designacion_director_tecnico: { nombre: "designación de director técnico", articulo: "la" },
  droga: { nombre: "droga", articulo: "la" },
  droga_alias: { nombre: "equivalencia de droga", articulo: "la" },
  entrega: { nombre: "entrega", articulo: "la" },
  etiqueta: { nombre: "etiqueta", articulo: "la" },
  libro_contralor: { nombre: "libro contralor", articulo: "el" },
  libro_recetario: { nombre: "libro recetario", articulo: "el" },
  lote_archivo_recetas: { nombre: "lote de archivo", articulo: "el" },
  medico: { nombre: "médico", articulo: "el" },
  movimiento_stock: { nombre: "movimiento de stock", articulo: "el" },
  paciente: { nombre: "paciente", articulo: "el" },
  parametro: { nombre: "parámetro", articulo: "el" },
  partida: { nombre: "partida", articulo: "la" },
  preparacion: { nombre: "preparación", articulo: "la" },
  proveedor: { nombre: "proveedor", articulo: "el" },
  receta: { nombre: "receta", articulo: "la" },
  receta_reporte: { nombre: "reporte de recetas", articulo: "el" },
  regla_precio: { nombre: "regla de precio", articulo: "la" },
  rol: { nombre: "rol", articulo: "el" },
  stock_kardex_reporte: { nombre: "reporte de kardex", articulo: "el" },
  stock_valorizado_reporte: { nombre: "reporte de stock valorizado", articulo: "el" },
  tenant: { nombre: "datos de la farmacia", articulo: "los" },
  unidad_medida: { nombre: "unidad de medida", articulo: "la" },
  usuario: { nombre: "usuario", articulo: "el" },
};

/** Noun used by the filter dropdown and the sentence -- falls back to the raw code for an entidad not in the catalog (never throws on old/unknown rows). */
export function etiquetaEntidad(entidad: string): string {
  const info = ENTIDADES[entidad];
  return info ? info.nombre.charAt(0).toUpperCase() + info.nombre.slice(1) : entidad;
}

/** Noun-form labels (filter dropdown, table column). */
export const ACCION_LABELS: Readonly<Record<TipoAccion, string>> = {
  CREAR: "Creación",
  MODIFICAR: "Modificación",
  BAJA: "Baja",
  REACTIVAR: "Reactivación",
  ANULAR: "Anulación",
  AUTORIZAR: "Autorización",
  FIRMAR: "Firma",
  CONFIRMAR: "Confirmación",
  DESCARTAR: "Descarte",
  CAMBIAR_ESTADO: "Cambio de estado",
  ASIGNAR_ROL: "Asignación de rol",
  QUITAR_ROL: "Quita de rol",
  SUSPENDER: "Suspensión",
  RESTABLECER_CREDENCIAL: "Restablecimiento de credencial",
  ACTIVAR_CUENTA: "Activación de cuenta",
  LOGIN_FALLIDO_BLOQUEO: "Bloqueo por intentos fallidos",
  CORREGIR_FOLIO: "Corrección de folio",
  INUTILIZAR_FOJAS: "Inutilización de fojas",
  DESTRUIR: "Destrucción",
  IMPRIMIR_CIERRE: "Impresión de cierre",
  EXPORTAR: "Exportación",
  ACCESO_DENEGADO: "Acceso denegado",
  CREAR_ROL: "Creación de rol",
  EDITAR_ROL: "Modificación de rol",
  ELIMINAR_ROL: "Eliminación de rol",
};

/** Past-tense verb phrase for the sentence. A trailing " de"/" a" contracts with "el" ("del"/"al"). */
const ACCION_VERBOS: Readonly<Record<TipoAccion, string>> = {
  CREAR: "creó",
  MODIFICAR: "modificó",
  BAJA: "dio de baja",
  REACTIVAR: "reactivó",
  ANULAR: "anuló",
  AUTORIZAR: "autorizó",
  FIRMAR: "firmó",
  CONFIRMAR: "confirmó",
  DESCARTAR: "descartó",
  CAMBIAR_ESTADO: "cambió el estado de",
  ASIGNAR_ROL: "asignó un rol a",
  QUITAR_ROL: "quitó un rol a",
  SUSPENDER: "suspendió",
  RESTABLECER_CREDENCIAL: "restableció la credencial de",
  ACTIVAR_CUENTA: "activó la cuenta de",
  LOGIN_FALLIDO_BLOQUEO: "registró un bloqueo por intentos fallidos de",
  CORREGIR_FOLIO: "corrigió el folio de",
  INUTILIZAR_FOJAS: "inutilizó fojas de",
  DESTRUIR: "registró la destrucción de",
  IMPRIMIR_CIERRE: "imprimió",
  EXPORTAR: "exportó",
  ACCESO_DENEGADO: "intentó realizar",
  CREAR_ROL: "creó",
  EDITAR_ROL: "modificó",
  ELIMINAR_ROL: "eliminó",
};

/** "María López modificó la droga", "Juan Pérez cambió el estado del usuario". */
export function describirRegistro(actor: string, accion: TipoAccion, entidad: string): string {
  const verbo = ACCION_VERBOS[accion] ?? ACCION_LABELS[accion] ?? accion;
  const info = ENTIDADES[entidad];
  if (!info) return `${actor} ${verbo} ${entidad}`;
  let frase = `${verbo} ${info.articulo} ${info.nombre}`;
  if (info.articulo === "el") frase = frase.replace(/ de el /, " del ").replace(/ a el /, " al ");
  return `${actor} ${frase}`;
}

/**
 * Field label for the per-field diff table. The dictionary is shared with
 * validation error messages (shared/labels/field-labels.ts) so a field is
 * named the same way in a form error and in its audit trail.
 */
export function etiquetaCampo(campo: string): string {
  return fieldLabel(campo);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENUM_CODE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[A-Z]{4,}$/;

/** "dd/mm/aaaa hh:mm" in `timeZone` -- never the server's own zone (Vercel runs in UTC). */
export function formatearFechaHora(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(instant));
}

/** One stored JSON value as display text. `null`/absent -> "—". */
export function formatearValor(valor: unknown, timeZone: string): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  if (typeof valor === "number") return valor.toLocaleString("es-AR");
  if (typeof valor === "string") {
    if (ISO_DATE.test(valor)) {
      const [y, m, d] = valor.split("-");
      return `${d}/${m}/${y}`;
    }
    if (ISO_DATETIME.test(valor) && !Number.isNaN(Date.parse(valor))) return formatearFechaHora(valor, timeZone);
    // Referenced rows are stored by id only; the full id stays in the "detalle técnico".
    if (UUID.test(valor)) return `ref. ${valor.slice(0, 8)}`;
    if (ENUM_CODE.test(valor)) {
      const texto = valor.replace(/_/g, " ").toLowerCase();
      return texto.charAt(0).toUpperCase() + texto.slice(1);
    }
    return valor;
  }
  if (Array.isArray(valor) && valor.every((item) => item === null || typeof item !== "object")) {
    return valor.map((item) => formatearValor(item, timeZone)).join(", ") || "—";
  }
  return JSON.stringify(valor);
}

export interface CambioCampo {
  campo: string;
  etiqueta: string;
  /** Formatted value before, `null` when the action created/recorded it (no "antes"). */
  antes: string | null;
  /** Formatted value after, `null` when the action removed it (no "después"). */
  despues: string | null;
}

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Per-field rows to show. Both sides objects -> ONLY the fields whose value
 * differs; one side only -> every field on that side; anything else -> a
 * single "Valor" row.
 */
export function calcularCambios(valorAnterior: unknown, valorNuevo: unknown, timeZone: string): CambioCampo[] {
  const hayAnterior = valorAnterior !== null && valorAnterior !== undefined;
  const hayNuevo = valorNuevo !== null && valorNuevo !== undefined;
  if (!hayAnterior && !hayNuevo) return [];

  if ((!hayAnterior || esObjetoPlano(valorAnterior)) && (!hayNuevo || esObjetoPlano(valorNuevo))) {
    const antes = (hayAnterior ? valorAnterior : {}) as Record<string, unknown>;
    const despues = (hayNuevo ? valorNuevo : {}) as Record<string, unknown>;
    const todos = new Set([...Object.keys(despues), ...Object.keys(antes)]);
    // A readable sibling written alongside a raw reference supersedes it here (the raw value stays in the technical detail):
    // `drogaId` is hidden when `droga` exists, `items` when `itemsResumen` exists.
    const campos = [...todos].filter((campo) => {
      const legible = campo.endsWith("Id") ? campo.slice(0, -2) : `${campo}Resumen`;
      return !todos.has(legible);
    });
    return campos
      .filter((campo) => !(hayAnterior && hayNuevo) || JSON.stringify(antes[campo]) !== JSON.stringify(despues[campo]))
      .map((campo) => ({
        campo,
        etiqueta: etiquetaCampo(campo),
        antes: hayAnterior ? formatearValor(antes[campo], timeZone) : null,
        despues: hayNuevo ? formatearValor(despues[campo], timeZone) : null,
      }));
  }

  return [
    {
      campo: "valor",
      etiqueta: "Valor",
      antes: hayAnterior ? formatearValor(valorAnterior, timeZone) : null,
      despues: hayNuevo ? formatearValor(valorNuevo, timeZone) : null,
    },
  ];
}
