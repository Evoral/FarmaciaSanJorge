/**
 * Why a ficha técnica could not be calculated, as a stable code next to the
 * Spanish message (FASE 7 point 7.2 + docs/specs/presupuesto-receta.md).
 * The message is what the farmacéutico reads (unchanged from before); the
 * code is what a caller that must NOT carry free text around -- the
 * post-confirmation generation's redirect notice (modules/recetas) -- keeps.
 *
 * Also the "is the latest ficha still current" comparison used to avoid a
 * redundant new version after an edit that did not change an item.
 * Pure, no I/O.
 */
import { DomainError } from "@/shared/errors";
import { dec } from "@/shared/decimal";
import type { LineaPesajeCalculada } from "./calcular-ficha-tecnica";

/** `V1`..`V9` (docs/specs/ficha-tecnica.md) or a missing piece of configuration/data. */
export type CodigoFichaNoGenerable = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "V9" | "SIN_UNIDAD_BASE" | "DATOS_INVALIDOS";

export const CODIGOS_FICHA_NO_GENERABLE: readonly CodigoFichaNoGenerable[] = [
  "V1",
  "V2",
  "V3",
  "V4",
  "V5",
  "V6",
  "V7",
  "V8",
  "V9",
  "SIN_UNIDAD_BASE",
  "DATOS_INVALIDOS",
];

export function esCodigoFichaNoGenerable(codigo: string): codigo is CodigoFichaNoGenerable {
  return (CODIGOS_FICHA_NO_GENERABLE as readonly string[]).includes(codigo);
}

export class FichaNoGenerableError extends DomainError {
  readonly codigo: CodigoFichaNoGenerable;

  constructor(codigo: CodigoFichaNoGenerable, message: string) {
    super(message);
    this.codigo = codigo;
  }
}

/** What a stored linea_pesaje looks like for the comparison below (decimals as strings). */
export interface LineaPesajeGuardada {
  drogaId: string;
  cantidadTeorica: string | null;
  excesoAplicado: string;
  cantidadAPesar: string | null;
  unidadMedidaId: string;
  esEnraseManual: boolean;
  orden: number;
}

function mismoDecimal(a: { toString(): string } | null, b: string | null): boolean {
  if (a === null || b === null) return a === null && b === null;
  return dec(a.toString()).equals(dec(b));
}

/**
 * `true` when freshly calculated lines are exactly the latest ficha's
 * (same droga, orden, unidad, manual flag and quantities, compared as
 * decimals): the stored ficha is still current, and a new version would
 * only duplicate it.
 */
export function mismasLineasPesaje(calculadas: readonly LineaPesajeCalculada[], guardadas: readonly LineaPesajeGuardada[]): boolean {
  if (calculadas.length !== guardadas.length) return false;
  const porOrden = [...guardadas].sort((a, b) => a.orden - b.orden);
  return [...calculadas]
    .sort((a, b) => a.orden - b.orden)
    .every((c, i) => {
      const g = porOrden[i]!;
      return (
        c.orden === g.orden &&
        c.drogaId === g.drogaId &&
        c.unidadMedida.id === g.unidadMedidaId &&
        c.esEnraseManual === g.esEnraseManual &&
        mismoDecimal(c.cantidadTeorica, g.cantidadTeorica) &&
        mismoDecimal(c.excesoAplicado, g.excesoAplicado) &&
        mismoDecimal(c.cantidadAPesar, g.cantidadAPesar)
      );
    });
}
