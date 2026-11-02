/**
 * `getModoLectorQr` (openspec/specs/importacion-receta-qr/spec.md «Modo de la farmacia»): the farmacia's modo del
 * lector for the "Importar con QR" panel of `/recetas/nuevo`. Gated on `recetas.crear`, like the page: whoever loads
 * recetas needs the mode, not `config.ver`. The per-equipo override lives in the browser and never reaches the server.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { getModoLectorQrFarmacia } from "../infrastructure/receta-repository";
import type { ModoLectorQr } from "../domain/modo-lector-qr";

export const getModoLectorQrQuery = defineQuery({
  name: "recetas.modoLectorQr.ver",
  permiso: "recetas.crear",
  input: z.object({}),
  handler: async ({ tx, session }) => getModoLectorQrFarmacia(tx, session.tenantId),
});

export async function getModoLectorQr(): Promise<ModoLectorQr> {
  return getModoLectorQrQuery.execute({});
}
