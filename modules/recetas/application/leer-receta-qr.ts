/**
 * `leerRecetaQr` -- first step of the receta QR import
 * (docs/specs/importacion-receta-qr.md): the QR/link text -> the receta's hash
 * -> the RCTA decrypter -> the shared draft -> the same preview as the PDF
 * import. Read-only: NOTHING is written (the confirmation, `recetas.importar`,
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
import { DomainError, ValidationError } from "@/shared/errors";
import { acotarAvisos, type VistaPreviaImportacion } from "../domain/importacion-receta";
import { extraerHashRcta, MENSAJES_LECTURA_QR } from "../domain/receta-qr";
import { mapearRecetaRcta } from "../domain/receta-rcta-json";
import { consultarRecetaRcta } from "../infrastructure/receta-rcta-api.server";
import { construirVistaPrevia } from "./leer-receta-pdf";

/** A real receta link is ~100 characters; the cap only bounds what the hash scan has to read. */
export const MAX_LARGO_CODIGO_QR = 2048;
const leerRecetaQrInput = z.object({ codigo: z.string().max(MAX_LARGO_CODIGO_QR) });

/** Not found -> a validation error on the field; RCTA down or an unexpected answer -> a domain error. */
const errorDeLectura = (codigo: keyof typeof MENSAJES_LECTURA_QR): ValidationError | DomainError =>
  codigo === "QR_INVALIDO" ? new ValidationError(MENSAJES_LECTURA_QR[codigo], { fields: ["codigo"] }) : new DomainError(MENSAJES_LECTURA_QR[codigo]);

export const leerRecetaQrQuery = defineQuery({
  name: "recetas.importar.leerQr",
  permiso: "recetas.crear",
  input: leerRecetaQrInput,
  prepare: async ({ input }) => {
    const hash = extraerHashRcta(input.codigo);
    if (hash === null) throw errorDeLectura("QR_INVALIDO");
    const consulta = await consultarRecetaRcta(hash);
    if (!consulta.ok) throw errorDeLectura(consulta.codigo);
    const lectura = mapearRecetaRcta(consulta.json, hash);
    if (!lectura.ok) throw errorDeLectura(lectura.codigo);
    return lectura;
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
