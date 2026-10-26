/**
 * Pure rules of the "Hoja de envíos" PDF (openspec/specs/envios-repartidores/spec.md E8-E11): the filter line, the Pago text,
 * the empty-result notice and the file name (which never carries patient data). No I/O.
 */
import { formatFechaIso } from "@/shared/format/fecha";

export const MENSAJE_HOJA_ENVIOS_VACIA = "Este repartidor no tiene envíos pendientes para este filtro";

export const TEXTO_PAGO_PAGADA = "Pagada";
/** The repartidor has to charge: the cell is printed bold. */
export const TEXTO_PAGO_IMPAGA = "IMPAGA — cobrar";

/** The header's filter line: "Fecha de envío: 20/10/2026" or, with no date, "Todos los pendientes". */
export function textoFiltroHoja(fecha: string | null): string {
  return fecha ? `Fecha de envío: ${formatFechaIso(fecha)}` : "Todos los pendientes";
}

export function textoPagoHoja(pagada: boolean): string {
  return pagada ? TEXTO_PAGO_PAGADA : TEXTO_PAGO_IMPAGA;
}

/** Lower-case ASCII slug of an apellido for the file name ("Núñez de Arce" -> "nunez-de-arce"); "repartidor" when nothing is left. */
export function slugApellido(apellido: string): string {
  const slug = apellido
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "repartidor";
}

/** `envios-<apellido>-<aaaa-mm-dd | pendientes>.pdf`. Only the repartidor's apellido and the filter: no patient data. */
export function nombreArchivoHojaEnvios(apellido: string, fecha: string | null): string {
  return `envios-${slugApellido(apellido)}-${fecha ?? "pendientes"}.pdf`;
}
