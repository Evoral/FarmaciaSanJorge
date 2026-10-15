/**
 * Is a ficha técnica still VIGENTE for its ítem? (docs/specs/reserva-stock-preparacion.md R18,
 * docs/specs/ficha-tecnica.md "Versiones, vigencia y preparación"). A ficha is vigente when:
 *   (a) it is the ítem's LATEST version, and
 *   (b) recomputing the ítem's líneas from its CURRENT data (forma, totals, componentes, cantidades) with the current
 *       weighing parameters gives exactly its líneas (`mismasLineasPesaje`).
 *
 * (b) is the same rule the automatic regeneration after a receta edit uses (`generarFichaTecnica` with
 * `soloSiDesactualizada`), so "desactualizada" means exactly "generating now would create a new version". Chosen over
 * timestamps: `item_receta` has no change timestamp, `editarReceta` rewrites every ítem even when unchanged, and a
 * generation that started before an edit committed could carry an earlier `generada_en`. An ítem whose current data no
 * longer computes (V1-V9...) cannot be verified: it counts as not vigente, with the reason.
 *
 * Not a use case: callers run it inside their own transaction (the reserva, under the receta + ítem locks; the toma
 * workspace's read). Plain reads only.
 */
import type { Prisma } from "@/generated/prisma/client";
import { FichaNoGenerableError, mismasLineasPesaje } from "../domain/ficha-no-generable";
import { getItemParaFicha, getLineasUltimaFicha } from "../infrastructure/ficha-repository";
import { calcularLineasDeItemEnTx } from "./generar-ficha-tecnica";

export type EstadoFichaDeItem =
  | { vigente: true }
  | { vigente: false; motivo: "NO_ES_ULTIMA" | "DESACTUALIZADA" | "NO_VERIFICABLE"; mensaje: string };

export const MENSAJE_FICHA_DESACTUALIZADA =
  "La ficha técnica de este ítem está desactualizada: no corresponde a los datos actuales del ítem. Generá la ficha técnica de nuevo antes de reservar el stock.";

/** `fichaTecnicaId` against the ítem's latest version and its current data -- see this file's doc comment. */
export async function evaluarFichaDeItemEnTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemRecetaId: string,
  fichaTecnicaId: string,
): Promise<EstadoFichaDeItem> {
  const ultima = await getLineasUltimaFicha(tx, tenantId, itemRecetaId);
  if (!ultima || ultima.id !== fichaTecnicaId) {
    return {
      vigente: false,
      motivo: "NO_ES_ULTIMA",
      mensaje: "Esta ficha técnica ya no es la última versión del ítem: recargá la página para trabajar con la ficha vigente.",
    };
  }

  const item = await getItemParaFicha(tx, tenantId, itemRecetaId);
  if (!item) return { vigente: false, motivo: "NO_VERIFICABLE", mensaje: "Ítem de receta no encontrado." };

  try {
    const lineas = await calcularLineasDeItemEnTx(tx, tenantId, item);
    return mismasLineasPesaje(lineas, ultima.lineas) ? { vigente: true } : { vigente: false, motivo: "DESACTUALIZADA", mensaje: MENSAJE_FICHA_DESACTUALIZADA };
  } catch (error) {
    if (!(error instanceof FichaNoGenerableError)) throw error;
    return {
      vigente: false,
      motivo: "NO_VERIFICABLE",
      mensaje: `La ficha técnica de este ítem no se puede verificar contra sus datos actuales: ${error.message}`,
    };
  }
}
