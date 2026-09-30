/**
 * Notices from the automatic ficha técnica + cotización generation that
 * runs right after a receta is confirmed or edited
 * (docs/specs/presupuesto-receta.md, "Generación automática al confirmar").
 * That generation runs AFTER the receta committed, as separate use cases,
 * so a failure never undoes the receta -- it only becomes a notice on the
 * receta's detail page.
 *
 * The notice travels in the redirect URL, so it carries NO free text and
 * no personal data: only the step (`f` ficha / `c` cotización), the item
 * number and a code from a closed list (`?aviso=f1-V5&aviso=c2-SIN_REGLA_PRECIO`).
 * The page rebuilds the Spanish message from the code, and anything it
 * does not recognize is ignored. Pure, no I/O.
 *
 * Where it lands: after CREATING a receta (alta manual or PDF import), the
 * list `/recetas?registrada=<id>&aviso=...` (a success banner with the
 * notices and a link to the receta); after EDITING, the receta's own
 * detail page `/recetas/<id>?aviso=...`.
 */
import { CODIGOS_FICHA_NO_GENERABLE } from "@/modules/elaboracion/domain/ficha-no-generable";
import type { CodigoFichaNoGenerable } from "@/modules/elaboracion/domain/ficha-no-generable";
import { mensajeParaCodigoValidacion } from "@/modules/elaboracion/domain/mensajes-validacion";

export const PARAM_AVISO = "aviso";
/** `/recetas?registrada=<receta id>`: the receta just created (an id, never personal data). */
export const PARAM_REGISTRADA = "registrada";

export type TipoAviso = "ficha" | "cotizacion";
export type CodigoAviso = CodigoFichaNoGenerable | "SIN_REGLA_PRECIO" | "SIN_FICHA" | "ERROR";

const CODIGOS_AVISO: readonly CodigoAviso[] = [...CODIGOS_FICHA_NO_GENERABLE, "SIN_REGLA_PRECIO", "SIN_FICHA", "ERROR"];

export interface AvisoGeneracion {
  tipo: TipoAviso;
  /** 1-based, in the order the receta's detail page lists its items. */
  item: number;
  codigo: CodigoAviso;
}

export function esCodigoAviso(codigo: string): codigo is CodigoAviso {
  return (CODIGOS_AVISO as readonly string[]).includes(codigo);
}

function agregarAvisos(params: URLSearchParams, avisos: readonly AvisoGeneracion[]): URLSearchParams {
  for (const a of avisos) params.append(PARAM_AVISO, `${a.tipo === "ficha" ? "f" : "c"}${a.item}-${a.codigo}`);
  return params;
}

/** `""` when there is nothing to report, else a query string starting with `?`. */
export function codificarAvisos(avisos: readonly AvisoGeneracion[]): string {
  if (avisos.length === 0) return "";
  return `?${agregarAvisos(new URLSearchParams(), avisos).toString()}`;
}

/** Where to go after creating a receta: the list, with its success banner and notices. */
export function urlTrasRegistrar(recetaId: string, avisos: readonly AvisoGeneracion[]): string {
  const params = new URLSearchParams({ [PARAM_REGISTRADA]: recetaId });
  return `/recetas?${agregarAvisos(params, avisos).toString()}`;
}

/** Where to go after editing a receta: its detail page, with the notices. */
export function urlTrasEditar(recetaId: string, avisos: readonly AvisoGeneracion[]): string {
  return `/recetas/${recetaId}${codificarAvisos(avisos)}`;
}

/** Parses what `codificarAvisos` wrote; anything malformed, unknown or about an item the receta does not have is dropped. */
export function decodificarAvisos(valor: string | string[] | undefined, cantidadItems: number): AvisoGeneracion[] {
  const crudos = valor === undefined ? [] : Array.isArray(valor) ? valor : [valor];
  const avisos: AvisoGeneracion[] = [];
  for (const crudo of crudos.slice(0, 50)) {
    const m = /^([fc])(\d{1,3})-([A-Z0-9_]{1,40})$/.exec(crudo);
    if (!m) continue;
    const item = Number(m[2]);
    if (item < 1 || item > cantidadItems || !esCodigoAviso(m[3]!)) continue;
    avisos.push({ tipo: m[1] === "f" ? "ficha" : "cotizacion", item, codigo: m[3] });
  }
  return avisos;
}

function motivo(codigo: CodigoAviso): string {
  switch (codigo) {
    case "SIN_UNIDAD_BASE":
      return "falta configurar la unidad de medida base de alguna magnitud";
    case "DATOS_INVALIDOS":
      return "el ítem tiene datos inválidos para generar la ficha técnica";
    case "SIN_REGLA_PRECIO":
      return "no hay regla de precios configurada";
    case "SIN_FICHA":
      return "el ítem no tiene ficha técnica";
    case "ERROR":
      return "ocurrió un error inesperado";
    default:
      // V1-V9: the same Spanish text the manual generation shows.
      return mensajeParaCodigoValidacion(codigo).replace(/\.$/, "");
  }
}

export function mensajeAviso(aviso: AvisoGeneracion): string {
  return aviso.tipo === "ficha"
    ? `No se pudo generar la ficha técnica del ítem ${aviso.item}: ${motivo(aviso.codigo)}. Podés generarla desde la receta.`
    : `No se pudo calcular la cotización del ítem ${aviso.item}: ${motivo(aviso.codigo)}. Podés calcularla desde la receta.`;
}
