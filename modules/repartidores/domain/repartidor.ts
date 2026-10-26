/**
 * Pure domain rules for the repartidor catalog (`fsj.repartidor`, migration 0093, openspec/specs/envios-repartidores/spec.md).
 * A repartidor is a person who carries the envios of the farmacia: not a usuario, never logs in. Soft delete via
 * `activo` (an inactive repartidor is not offered for new envios but keeps the ones it already has).
 */
import { z } from "zod";

/** Mirror the `repartidor_*_check` constraints of migration 0093. */
export const NOMBRE_MAX_LENGTH = 100;
export const APELLIDO_MAX_LENGTH = 100;
export const TELEFONO_MAX_LENGTH = 30;

/** Trims and collapses runs of whitespace to a single space, so "  Juan   Carlos " is stored as "Juan Carlos". */
export function normalizarTexto(texto: string): string {
  return texto.trim().replace(/\s+/g, " ");
}

function campoRequerido(max: number) {
  return z
    .string()
    .transform(normalizarTexto)
    .pipe(z.string().min(1, "Este campo no puede estar vacío.").max(max, `No puede superar los ${max} caracteres.`));
}

/** The editable data of a repartidor: shared by `crear` and `editar`. */
export const repartidorDatosShape = {
  nombre: campoRequerido(NOMBRE_MAX_LENGTH),
  apellido: campoRequerido(APELLIDO_MAX_LENGTH),
  /** Free text (no forced format): "261 555-1234", "+54 9 261 555 1234". */
  telefono: campoRequerido(TELEFONO_MAX_LENGTH),
} as const;

/** A repartidor as the autocompletes of envios receive it. */
export interface RepartidorOpcion {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  activo: boolean;
}

/** "Pérez, Juan". */
export function formatearNombreRepartidor(repartidor: Pick<RepartidorOpcion, "nombre" | "apellido">): string {
  return `${repartidor.apellido}, ${repartidor.nombre}`;
}

/** Autocomplete label: "Pérez, Juan · 261 555-1234", suffixed " (inactivo)" when it is no longer offered for new envios. */
export function formatearRepartidorOpcion(repartidor: RepartidorOpcion): string {
  const base = `${formatearNombreRepartidor(repartidor)} · ${repartidor.telefono}`;
  return repartidor.activo ? base : `${base} (inactivo)`;
}
