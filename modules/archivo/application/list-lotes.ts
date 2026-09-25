/** `/archivo` listado paginado + `/archivo/[id]` detalle (FASE 12 point 12.1/12.3). */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { listLotesFiltro, loteIdInput } from "../domain/filtros";
import {
  puedeSolicitarDestruccion,
  puedeAutorizarDestruccion,
  puedeRegistrarDestruccion,
  estaDestruido,
  type EstadoLoteArchivoValue,
} from "../domain/lote-archivo";
import { listLotes, getLoteDetalle, type LoteRow } from "../infrastructure/archivo-repository";

// `vencimiento`/`plazoCumplido` are computed by the repository in SQL
// (single source of truth shared with the daily job -- see
// `archivo-repository.ts`'s module doc comment), so `LoteRow` already
// carries both fields. No JS-side re-derivation here.
export type LoteListItem = LoteRow;

export interface ListLotesOutput {
  items: LoteListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const listLotesQuery = defineQuery({
  name: "archivo.lotes.listar",
  permiso: "archivo.lotes.gestionar",
  input: listLotesFiltro,
  handler: async ({ tx, session, input }): Promise<ListLotesOutput> => {
    const { items, total } = await listLotes(tx, { tenantId: session.tenantId, estado: input.estado, periodoDesde: input.periodoDesde, periodoHasta: input.periodoHasta, page: input.page, pageSize: input.pageSize });
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
});

export async function listLotesArchivo(input: z.input<typeof listLotesFiltro>): Promise<ListLotesOutput> {
  return listLotesQuery.execute(input);
}

export interface LoteDetalleOutput extends LoteListItem {
  expedienteAutorizacion: string | null;
  fechaAutorizacion: string | null;
  fechaDestruccion: string | null;
  registradoPorNombre: string;
  registradoPorApellido: string;
  recetas: { id: string; numeroInterno: string; pacienteNombre: string; pacienteApellido: string; estado: string }[];
  puedeSolicitarDestruccion: boolean;
  puedeAutorizarDestruccion: boolean;
  puedeRegistrarDestruccion: boolean;
  estaDestruido: boolean;
}

export const getLoteDetalleQuery = defineQuery({
  name: "archivo.lotes.detalle",
  permiso: "archivo.lotes.gestionar",
  input: loteIdInput,
  handler: async ({ tx, session, input }): Promise<LoteDetalleOutput> => {
    const detalle = await getLoteDetalle(tx, session.tenantId, input.id);
    if (!detalle) throw new NotFoundError("El lote de archivo no existe.");

    const estado = detalle.estado as EstadoLoteArchivoValue;

    return {
      ...detalle,
      puedeSolicitarDestruccion: puedeSolicitarDestruccion(estado),
      puedeAutorizarDestruccion: puedeAutorizarDestruccion(estado),
      puedeRegistrarDestruccion: puedeRegistrarDestruccion(estado),
      estaDestruido: estaDestruido(estado),
    };
  },
});

export async function getLoteArchivoDetalle(id: string): Promise<LoteDetalleOutput> {
  return getLoteDetalleQuery.execute({ id });
}
