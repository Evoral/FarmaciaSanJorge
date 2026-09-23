/**
 * Spanish messages for the calculator's V1-V9 validation codes (FASE 7
 * point 7.2). `modules/elaboracion/domain/calcular-ficha-tecnica.ts` throws
 * `FichaTecnicaValidationError` with an English, developer-facing message
 * (by design -- see that file's doc comment: "assert on `validationCode`
 * in tests, not on message text"). This is the ONLY place that turns a
 * `V<n>` code into the message a farmacéutico actually reads.
 *
 * SOURCE OF TRUTH for the wording: docs/specs/ficha-tecnica.md "Validaciones".
 * V5 gets special billing here because `modules/recetas/domain/receta.ts`
 * deliberately does NOT check it at receta alta time (its own doc comment
 * explains why: V5 needs each componente resolved to its magnitude's base
 * unit, which only the calculator does) -- so THIS is the first point in
 * the whole flow where a V5 receta is ever rejected, and the message says
 * so explicitly instead of reading like every other validation.
 */
export const MENSAJES_VALIDACION_FICHA: Readonly<Record<string, string>> = {
  V1: "El ítem no tiene componentes cargados: no se puede generar una ficha técnica sin al menos un componente.",
  V2: "El ítem tiene más de un componente csp (cantidad suficiente para completar): solo se permite uno.",
  V3: "El componente csp debe ser el último de la fórmula (último orden).",
  V4: "El componente csp requiere que el ítem tenga cargada la cantidad total y su unidad.",
  V5:
    "La suma de los componentes de la fórmula supera (o iguala) la cantidad total del preparado: el componente csp " +
    "resultaría en una cantidad menor o igual a cero. Revisá las cantidades de los demás componentes o la cantidad " +
    "total del ítem antes de generar la ficha (esta receta se aceptó al alta porque esta validación solo puede " +
    "hacerse al generar la ficha técnica).",
  V6: "Un componente TOTAL o POR_DOSIS requiere una cantidad mayor que 0.",
  V7: "Un componente CS o CSP no debe tener cantidad cargada.",
  V8: "La fracción de dosis por unidad debe ser mayor que 0 y menor o igual a 1.",
  V9: "La cantidad de unidades del ítem debe ser un número entero mayor que 0.",
};

const MENSAJE_GENERICO = "El ítem tiene datos inválidos para generar la ficha técnica.";

/** Maps a `FichaTecnicaValidationError.validationCode` (e.g. `"V5"`) to its Spanish message. Falls back to a generic message for a code not in the table (defensive -- every V1-V9 the calculator can throw is listed above). */
export function mensajeParaCodigoValidacion(codigo: string): string {
  return MENSAJES_VALIDACION_FICHA[codigo] ?? MENSAJE_GENERICO;
}
