/** `listJornadasLibro` -- the libro recetario per day (`/libro/dias`, ../domain/jornadas.ts). */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { estadoJornadaLibro, type EstadoJornadaLibro } from "../domain/jornadas";
import { listJornadasLibro as listJornadasLibroRepo, readJornadaActual } from "../infrastructure/jornada-repository";

export interface JornadaLibroItem {
  fecha: string;
  asientos: number;
  estado: EstadoJornadaLibro;
  cierreId: string | null;
  impresa: boolean;
}

export interface JornadasLibroResult {
  items: JornadaLibroItem[];
  total: number;
  /** Days that owe their firma, whatever the filter or page. */
  sinFirmar: number;
  /** The oldest signed day whose sheet was never printed (YYYY-MM-DD): later days cannot print until it is. */
  primerSinImprimir: string | null;
}

const listJornadasLibroInput = z.object({
  soloSinFirmar: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(31),
});

export const listJornadasLibroQuery = defineQuery({
  name: "libro.jornadas.listar",
  permiso: "libro.ver",
  input: listJornadasLibroInput,
  handler: async ({ tx, session, input }): Promise<JornadasLibroResult> => {
    const rows = await listJornadasLibroRepo(tx, session.tenantId);
    const jornadaActual = await readJornadaActual(tx, session.tenantId);
    const todas = rows.map((row) => ({
      fecha: row.fecha,
      asientos: row.asientos,
      cierreId: row.cierreId,
      impresa: row.impresa,
      estado: estadoJornadaLibro({ fecha: row.fecha, jornadaActual, firmada: row.cierreId !== null, vigentesSinFirmar: row.vigentesSinFirmar }),
    }));
    const filtradas = input.soloSinFirmar ? todas.filter((j) => j.estado === "SIN_FIRMAR") : todas;
    const desde = (input.page - 1) * input.pageSize;
    return {
      items: filtradas.slice(desde, desde + input.pageSize),
      total: filtradas.length,
      sinFirmar: todas.filter((j) => j.estado === "SIN_FIRMAR").length,
      // Rows come newest first: the last signed-and-unprinted one is the oldest.
      primerSinImprimir: todas.filter((j) => j.cierreId !== null && !j.impresa).at(-1)?.fecha ?? null,
    };
  },
});

export async function listJornadasLibro(input: z.input<typeof listJornadasLibroInput>): Promise<JornadasLibroResult> {
  return listJornadasLibroQuery.execute(input);
}
