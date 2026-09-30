/**
 * Automatic ficha técnica + cotización after a receta is confirmed
 * (`recetas.crear` / `recetas.importar`) or edited (`recetas.editar`) --
 * docs/specs/presupuesto-receta.md, "Generación automática al confirmar".
 *
 * Called by the Server Action AFTER the receta's own transaction
 * committed, and it runs the EXISTING use cases (`fichas.generar`, then
 * `cotizaciones.calcular`, which persists the cotización) one by one, each
 * in its own transaction: a failure here never rolls back the receta, it
 * only becomes an `AvisoGeneracion` for the receta's detail page. It never
 * throws.
 *
 *   - Without `fichas.generar` nothing is generated; without
 *     `cotizaciones.calcular` only the fichas are (silently -- the same
 *     role split as the manual screens).
 *   - A cotización is only attempted for an item whose ficha was generated.
 *   - After an edit (`soloSiDesactualizadas`), an item whose latest ficha
 *     already has exactly the recalculated lines keeps it (no duplicate
 *     version) and is not re-cotizado; the others get a new version and a
 *     new cotización. That is the staleness rule: `editarReceta` itself
 *     never touches fichas (they are immutable, INV-R05).
 *
 * Not a use case itself: it has no transaction of its own, only calls the
 * ones above (each with its own authorize()).
 */
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getLogger } from "@/shared/logging/logger";
import { generarFichaTecnica } from "@/modules/elaboracion/application/generar-ficha-tecnica";
import { FichaNoGenerableError } from "@/modules/elaboracion/domain/ficha-no-generable";
import { calcularCotizacionItem } from "@/modules/precios/application/calcular-cotizacion";
import { CotizacionNoCalculableError } from "@/modules/precios/application/cotizar-lineas";
import type { AvisoGeneracion, CodigoAviso } from "../domain/avisos-generacion";
import { getReceta } from "./get-receta";

function codigoDeError(error: unknown, contexto: { recetaId: string; itemRecetaId: string; paso: string }): CodigoAviso {
  if (error instanceof FichaNoGenerableError || error instanceof CotizacionNoCalculableError) return error.codigo;
  // Ids only: no receta/paciente content reaches the logs (DP-24).
  getLogger().warn({ error, ...contexto }, "generacion automatica: paso fallido");
  return "ERROR";
}

export async function generarFichasYCotizaciones(recetaId: string, opciones: { soloSiDesactualizadas: boolean }): Promise<AvisoGeneracion[]> {
  const avisos: AvisoGeneracion[] = [];
  try {
    const session = await requireSession();
    if (!can(session, "fichas.generar")) return [];
    const puedeCotizar = can(session, "cotizaciones.calcular");

    const receta = await getReceta(recetaId);
    if (!receta) return [];

    for (const [indice, item] of receta.items.entries()) {
      const numero = indice + 1;
      let generada: boolean;
      try {
        const ficha = await generarFichaTecnica({ itemRecetaId: item.id, soloSiDesactualizada: opciones.soloSiDesactualizadas });
        generada = ficha.generada;
      } catch (error) {
        avisos.push({ tipo: "ficha", item: numero, codigo: codigoDeError(error, { recetaId, itemRecetaId: item.id, paso: "ficha" }) });
        continue;
      }

      if (!puedeCotizar || !generada) continue;
      try {
        await calcularCotizacionItem({ itemRecetaId: item.id });
      } catch (error) {
        avisos.push({ tipo: "cotizacion", item: numero, codigo: codigoDeError(error, { recetaId, itemRecetaId: item.id, paso: "cotizacion" }) });
      }
    }
  } catch (error) {
    // Reading the receta/session failed: the receta is saved regardless; the manual links still work.
    getLogger().warn({ error, recetaId }, "generacion automatica: no se pudo iniciar");
  }
  return avisos;
}
