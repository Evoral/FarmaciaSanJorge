/**
 * The MisRx read shared by the QR and the PDF import (openspec/specs/importacion-receta-qr/spec.md, "Emisor MisRx"):
 * token -> MisRx API -> the shared draft. Same contract as ./lectura-rcta.ts: it runs inside the callers' `prepare`
 * step, OUTSIDE any transaction, each caller passes its own messages, and every failure is mapped here to the
 * user-facing error. Neither the token nor any body is ever put in an error.
 */
import type { CodigoErrorQr } from "../domain/receta-qr";
import type { AdvertenciaParser, BorradorReceta } from "../domain/receta-pdf-parser";
import { mapearRecetaMisrx } from "../domain/receta-misrx";
import { consultarRecetaMisrx } from "../infrastructure/receta-misrx-api.server";
import { errorDeLecturaRcta } from "./lectura-rcta";

export async function leerRecetaMisrx(
  token: string,
  mensajes: Readonly<Record<CodigoErrorQr, string>>,
  campo?: string,
): Promise<{ borrador: BorradorReceta; advertencias: AdvertenciaParser[] }> {
  const consulta = await consultarRecetaMisrx(token);
  if (!consulta.ok) throw errorDeLecturaRcta(consulta.codigo, mensajes, campo);
  const lectura = mapearRecetaMisrx(consulta.json, token);
  if (!lectura.ok) throw errorDeLecturaRcta(lectura.codigo, mensajes, campo);
  return { borrador: lectura.borrador, advertencias: lectura.advertencias };
}
