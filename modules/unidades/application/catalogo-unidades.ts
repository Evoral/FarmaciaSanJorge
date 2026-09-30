/**
 * `getCatalogoUnidades` -- the GLOBAL unit catalog (DP-39) shaped for
 * `shared/format/cantidad.ts`, so every screen that shows stock quantities
 * can pick a readable display unit. Read-only.
 *
 * Gated on `stock.ver` rather than `unidades.editar` (ADM-only, see
 * list-unidades.ts): every consumer is a screen that displays stock
 * quantities, and migration 0002's seed grants `stock.ver` to every role.
 *
 * Wrapped in React's `cache()`: several components of one request (a page
 * and its tables) share ONE query per server request.
 */
import { cache } from "react";
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { crearCatalogoUnidades, type CatalogoUnidades } from "@/shared/format/cantidad";
import { listCatalogoUnidades } from "../infrastructure/unidad-repository";
import type { UnidadCatalogoItem } from "../infrastructure/unidad-repository";

export const catalogoUnidadesQuery = defineQuery({
  name: "unidades.catalogo-formato",
  permiso: "stock.ver",
  input: z.object({}),
  handler: async ({ tx }): Promise<UnidadCatalogoItem[]> => listCatalogoUnidades(tx),
});

export interface CatalogoUnidadesConFilas {
  catalogo: CatalogoUnidades;
  unidades: UnidadCatalogoItem[];
}

export const getCatalogoUnidades = cache(async (): Promise<CatalogoUnidadesConFilas> => {
  const unidades = await catalogoUnidadesQuery.execute({});
  return { catalogo: crearCatalogoUnidades(unidades), unidades };
});
