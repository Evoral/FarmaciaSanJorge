/**
 * `leerListaPrecios` -- first step of the supplier price list import
 * (openspec/specs/costos-proveedor/spec.md R13-R18, R21), mirroring
 * modules/stock/application/leer-factura-compra-pdf.ts: permiso -> trust boundary -> read ->
 * parse -> match. Returns the preview the form is prefilled with; NOTHING is written and the
 * file only lives in memory for the duration of this call.
 *
 * Order (cheap and safe first):
 *   - `prepare`, OUTSIDE the transaction (it holds no pooled DB connection while the workbook is
 *     decoded): `validarArchivoLista` (R15, which also detects the format: .xls or .xlsx), SHA-256, the workbook
 *     (read by the reader of that format, both return a `LibroHojas`), the sheet (the one asked for, else
 *     the LAST one with data) and its rows through the Crystal parser;
 *   - in the transaction: the fecha de la lista (a real day, not after the jornada, R8), the proveedor (exists,
 *     not de baja, R12), the file not imported before for this proveedor (R21, with the date in the
 *     message), then the catalogs: vigente drogas, synonyms, units and this proveedor's vigente costos,
 *     and `construirVistaPrevia` (R17, R18).
 *
 * `archivo` is checked by `validarArchivoLista`, not by zod, so each step keeps its own message.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { formatFecha } from "@/shared/format/fecha";
import { uuid } from "@/shared/validation";
import { normalizarTextoDroga } from "@/modules/recetas/domain/importacion-receta";
import { validarArchivoLista } from "../domain/archivo-lista";
import type { FormatoLista } from "../domain/archivo-lista";
import { construirVistaPrevia, hojaPorDefecto, mensajeFechaListaInvalida, mensajeListaYaImportada } from "../domain/importacion-lista";
import type { HojaLibro, VistaPreviaLista } from "../domain/importacion-lista";
import { parsearListaCrystal } from "../domain/parsers/lista-xlsx-crystal";
import type { ResultadoParseoLista } from "../domain/parsers/lista-xlsx-crystal";
import { hashSha256, leerLibroXlsx } from "../infrastructure/leer-xlsx.server";
import { leerLibroXls } from "../infrastructure/leer-xls.server";
import {
  buscarListaPorHash,
  getContextoTemporal,
  getCostosVigentesDeProveedor,
  getProveedorParaCosto,
  listAliasesVigentesParaLista,
  listDrogasVigentesParaLista,
  listUnidadesParaLista,
} from "../infrastructure/costo-proveedor-repository";

export type { VistaPreviaLista };

const MAX_CARACTERES_NOMBRE_ARCHIVO = 200;

const leerListaPreciosInput = z.object({
  proveedorId: uuid,
  /** `YYYY-MM-DD`, checked against the jornada inside the transaction. */
  fechaLista: z.string().trim(),
  archivo: z.unknown(),
  /** The sheet to read; omitted = the last one with data. */
  hoja: z.string().trim().min(1).max(120).optional(),
});

export type LeerListaPreciosInput = z.input<typeof leerListaPreciosInput>;

interface ListaLeida {
  nombreArchivo: string;
  hashSha256: string;
  formato: FormatoLista;
  hojas: HojaLibro[];
  hoja: string;
  parseo: ResultadoParseoLista;
}

/** The file's own name, without any path and bounded: it is shown in the lists and stored (DB: not blank). */
function nombreArchivoDe(archivo: File, formato: FormatoLista): string {
  const nombre = archivo.name.split(/[\\/]/).pop()?.trim() ?? "";
  return (nombre || `lista.${formato.toLowerCase()}`).slice(0, MAX_CARACTERES_NOMBRE_ARCHIVO);
}

export const leerListaPreciosQuery = defineQuery({
  name: "costos-proveedor.leer-lista",
  permiso: "costos.proveedor.gestionar",
  input: leerListaPreciosInput,
  prepare: async ({ input }): Promise<ListaLeida> => {
    const { bytes, formato } = await validarArchivoLista(input.archivo);
    const libro = formato === "XLS" ? leerLibroXls(bytes) : await leerLibroXlsx(bytes);
    const hoja = input.hoja ?? hojaPorDefecto(libro.hojas);
    if (hoja === null) throw new ValidationError("El archivo no tiene ninguna hoja con datos.");
    const parseo = parsearListaCrystal(libro.leerHoja(hoja));
    return { nombreArchivo: nombreArchivoDe(input.archivo as File, formato), hashSha256: hashSha256(bytes), formato, hojas: libro.hojas, hoja, parseo };
  },
  handler: async ({ tx, session, input, prepared }): Promise<VistaPreviaLista> => {
    const { tenantId } = session;
    const { jornadaActual, zonaHoraria } = await getContextoTemporal(tx, tenantId);

    const mensajeFecha = mensajeFechaListaInvalida(input.fechaLista, jornadaActual);
    if (mensajeFecha) throw new ValidationError(mensajeFecha, { fields: ["fechaLista"] });

    const proveedor = await getProveedorParaCosto(tx, tenantId, input.proveedorId);
    if (!proveedor) throw new NotFoundError("Proveedor no encontrado.");
    if (proveedor.fechaBaja !== null) throw new DomainError("El proveedor está dado de baja: no se le pueden cargar costos.", { fields: ["proveedorId"] });

    const yaImportada = await buscarListaPorHash(tx, tenantId, proveedor.id, prepared.hashSha256);
    if (yaImportada) throw new DomainError(mensajeListaYaImportada(formatFecha(yaImportada.registradoEn, zonaHoraria)));

    const { filas, descartadas } = prepared.parseo;
    const [aliases, drogas, unidades, vigentes] = [
      await listAliasesVigentesParaLista(tx, tenantId, filas.filter((fila) => fila.presentacion === null).map((fila) => normalizarTextoDroga(fila.descripcion))),
      await listDrogasVigentesParaLista(tx, tenantId),
      await listUnidadesParaLista(tx),
      await getCostosVigentesDeProveedor(tx, tenantId, proveedor.id),
    ];

    const { filas: filasVistaPrevia, resumen } = construirVistaPrevia({ filas, drogas, aliases, unidades, vigentes, fechaLista: input.fechaLista });
    return {
      proveedor: { id: proveedor.id, razonSocial: proveedor.razonSocial },
      fechaLista: input.fechaLista,
      nombreArchivo: prepared.nombreArchivo,
      hashSha256: prepared.hashSha256,
      formato: prepared.formato,
      hojas: prepared.hojas,
      hoja: prepared.hoja,
      filasLeidas: filas.length,
      descartadas,
      filas: filasVistaPrevia,
      vigentes,
      resumen,
    };
  },
});

export async function leerListaPrecios(input: LeerListaPreciosInput): Promise<VistaPreviaLista> {
  return leerListaPreciosQuery.execute(input);
}
