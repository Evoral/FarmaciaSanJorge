/**
 * Payment of a receta (migration 0071, docs/specs/pago-receta.md): a simple
 * paid/unpaid FLAG -- no amounts, no medio de pago, no facturación. It is
 * orthogonal to `EstadoReceta` (a receta can be paid and pending, or
 * delivered and unpaid), so nothing here touches the state machine. Pure
 * rules, no I/O.
 *
 * The one hard rule: the payment of an ANULADA receta cannot change (the DB
 * backstop is INV-R13, migration 0071). Payment after delivery IS valid.
 */
import { DomainError } from "@/shared/errors";
import type { EstadoReceta } from "./receta";

export const MENSAJE_PAGO_RECETA_ANULADA = "La receta está anulada: no se puede modificar su pago.";

/** Values of the `/recetas` listado's "Pago" filter (`?pago=`); no value = all. */
export const FILTROS_PAGO_RECETA = ["pagadas", "impagas"] as const;
export type FiltroPagoReceta = (typeof FILTROS_PAGO_RECETA)[number];

export const FILTRO_PAGO_RECETA_LABELS: Readonly<Record<FiltroPagoReceta, string>> = {
  pagadas: "Pagadas",
  impagas: "Impagas",
};

/** Parses the `?pago=` URL param; anything else means "all". */
export function parseFiltroPagoReceta(valor: string | undefined | null): FiltroPagoReceta | undefined {
  return (FILTROS_PAGO_RECETA as readonly string[]).includes(valor ?? "") ? (valor as FiltroPagoReceta) : undefined;
}

/** Text of the paid/unpaid badge and of the CSV column. */
export function etiquetaPago(pagada: boolean): string {
  return pagada ? "Pagada" : "Impaga";
}

/** The payment can be changed in every estado except ANULADA (ENTREGADA included: payment after delivery is valid). */
export function puedeCambiarPago(estado: EstadoReceta): boolean {
  return estado !== "ANULADA";
}

export function validarPagoModificable(estado: EstadoReceta): void {
  if (!puedeCambiarPago(estado)) throw new DomainError(MENSAJE_PAGO_RECETA_ANULADA);
}

/** What writing `deseada` does to a receta that currently is `actual`. */
export type CambioPago = "marcar" | "desmarcar" | "sin-cambio";

/**
 * Asking for the state the receta already has is a no-op: marking a receta that
 * is already paid never overwrites who paid it or when (`pagadaEn` /
 * `pagadaPorId` keep the first marking).
 */
export function decidirCambioPago(actual: boolean, deseada: boolean): CambioPago {
  if (actual === deseada) return "sin-cambio";
  return deseada ? "marcar" : "desmarcar";
}
