/**
 * The RCTA read shared by the QR and the PDF import (docs/specs/importacion-receta-qr.md,
 * docs/specs/importacion-receta-pdf.md "Lectura por RCTA"): hash -> RCTA decrypter -> the shared draft. Not a use case:
 * it runs inside the callers' `prepare` step (after authorize + parse, OUTSIDE any transaction). Each caller passes its
 * own messages, so a PDF failure never tells the user to "import the PDF". Every failure is mapped here to the
 * user-facing error: a raw error escaping `prepare` would surface as a generic INTERNAL_ERROR. Neither the hash nor any
 * body is ever put in an error.
 */
import { DomainError, ValidationError } from "@/shared/errors";
import type { CodigoErrorQr } from "../domain/receta-qr";
import type { AdvertenciaParser, BorradorReceta } from "../domain/receta-pdf-parser";
import { mapearRecetaRcta } from "../domain/receta-rcta-json";
import { consultarRecetaRcta } from "../infrastructure/receta-rcta-api.server";

/** Not found -> a validation error (on `campo` when given); RCTA down or an unexpected answer -> a domain error. */
export function errorDeLecturaRcta(codigo: CodigoErrorQr, mensajes: Readonly<Record<CodigoErrorQr, string>>, campo?: string): ValidationError | DomainError {
  if (codigo === "QR_INVALIDO") return new ValidationError(mensajes[codigo], campo ? { fields: [campo] } : undefined);
  return new DomainError(mensajes[codigo]);
}

export async function leerRecetaRcta(
  hash: string,
  mensajes: Readonly<Record<CodigoErrorQr, string>>,
  campo?: string,
): Promise<{ borrador: BorradorReceta; advertencias: AdvertenciaParser[] }> {
  const consulta = await consultarRecetaRcta(hash);
  if (!consulta.ok) throw errorDeLecturaRcta(consulta.codigo, mensajes, campo);
  const lectura = mapearRecetaRcta(consulta.json, hash);
  if (!lectura.ok) throw errorDeLecturaRcta(lectura.codigo, mensajes, campo);
  return { borrador: lectura.borrador, advertencias: lectura.advertencias };
}
