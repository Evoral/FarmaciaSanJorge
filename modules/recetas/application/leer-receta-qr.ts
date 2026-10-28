/**
 * `leerRecetaQr` -- first step of the receta QR import
 * (openspec/specs/importacion-receta-qr/spec.md): the QR/link text -> the receta's hash
 * -> the RCTA decrypter -> the shared draft -> the same preview as the PDF
 * import. A MisRx QR (token instead of hash) goes to the MisRx API instead (./lectura-misrx.ts). Read-only: NOTHING is written (the confirmation, `recetas.importar`,
 * is what gets audited).
 *
 * Spec order, mandatory: session -> permiso `recetas.crear` (the pipeline's
 * `authorize()`) -> input validation + hash extraction -> external fetch ->
 * match. The fetch and the mapping live in the query's `prepare` step, which
 * runs after authorize + parse but OUTSIDE any transaction (it can take up to
 * 8 s and must not hold a pooled connection); only the match runs inside it.
 * The fetch target is never derived from the typed text, only the hash is
 * (domain/receta-qr.ts), and an invalid code is rejected before any network call.
 *
 * `prepare` maps every RCTA failure to the user-facing error itself: a raw
 * error escaping it would reach `mapDbError` and surface as a generic
 * INTERNAL_ERROR. Neither the hash nor any body is ever put in an error.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { acotarAvisos, type VistaPreviaImportacion } from "../domain/importacion-receta";
import { extraerHashRcta, MENSAJES_LECTURA_QR } from "../domain/receta-qr";
import { extraerTokenMisrx, MENSAJES_LECTURA_QR_MISRX } from "../domain/receta-misrx";
import { errorDeLecturaRcta, leerRecetaRcta } from "./lectura-rcta";
import { leerRecetaMisrx } from "./lectura-misrx";
import { construirVistaPrevia } from "./leer-receta-pdf";

/** A real receta link is ~100 characters; the cap only bounds what the hash scan has to read. */
export const MAX_LARGO_CODIGO_QR = 2048;
const leerRecetaQrInput = z.object({ codigo: z.string().max(MAX_LARGO_CODIGO_QR) });

export const leerRecetaQrQuery = defineQuery({
  name: "recetas.importar.leerQr",
  permiso: "recetas.crear",
  input: leerRecetaQrInput,
  prepare: async ({ input }) => {
    const hash = extraerHashRcta(input.codigo);
    if (hash !== null) return leerRecetaRcta(hash, MENSAJES_LECTURA_QR, "codigo");
    const token = extraerTokenMisrx(input.codigo);
    if (token !== null) return leerRecetaMisrx(token, MENSAJES_LECTURA_QR_MISRX, "codigo");
    throw errorDeLecturaRcta("QR_INVALIDO", MENSAJES_LECTURA_QR, "codigo");
  },
  handler: async ({ tx, session, prepared }): Promise<VistaPreviaImportacion> => {
    const vista = await construirVistaPrevia(tx, session.tenantId, prepared.borrador, prepared.advertencias, "QR");
    // The match step adds its own notices (unmatched drugs and units, differences) echoing the receta's text: bound the finished list.
    return { ...vista, advertencias: acotarAvisos(vista.advertencias) };
  },
});

export async function leerRecetaQr(codigo: unknown): Promise<VistaPreviaImportacion> {
  return leerRecetaQrQuery.execute({ codigo });
}
