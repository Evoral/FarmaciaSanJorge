/**
 * `generarPlantillaExistenciaInicial`
 * Builds the downloadable Excel (.xlsx) template for importing planilla de existencia inicial (R21).
 * Gated on `stock.relevamiento.editar`.
 */
import { z } from "zod";
import ExcelJS from "exceljs";
import { defineQuery } from "@/shared/usecase";

export const generarPlantillaExistenciaInicialQuery = defineQuery({
  name: "stock.relevamiento.plantilla",
  permiso: "stock.relevamiento.editar",
  input: z.object({}),
  handler: async (): Promise<Uint8Array> => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Farmacia San Jorge";
    workbook.created = new Date();

    // Sheet 1: Existencia inicial
    const sheetDatos = workbook.addWorksheet("Existencia inicial", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheetDatos.columns = [
      { header: "Droga", key: "droga", width: 32 },
      { header: "Lote", key: "lote", width: 16, style: { numFmt: "@" } },
      { header: "Vencimiento", key: "vencimiento", width: 16 },
      { header: "Cantidad", key: "cantidad", width: 14 },
      { header: "Unidad", key: "unidad", width: 12 },
      { header: "Potencia", key: "potencia", width: 12 },
      { header: "Costo", key: "costo", width: 14 },
      { header: "Proveedor", key: "proveedor", width: 28 },
    ];

    // Explicitly enforce text format on the Lote column so leading zeros (e.g. 00123) are kept
    sheetDatos.getColumn("lote").numFmt = "@";

    const headerRow = sheetDatos.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF037A5C" },
    };
    headerRow.alignment = { vertical: "middle" };

    // Example row
    const rowEjemplo = sheetDatos.addRow({
      droga: "Paracetamol",
      lote: "L1234",
      vencimiento: "31/12/2026",
      cantidad: "500",
      unidad: "g",
      potencia: "100",
      costo: "1250,50",
      proveedor: "Droguería Ejemplo S.A.",
    });
    rowEjemplo.getCell("lote").numFmt = "@";

    // Sheet 2: Instrucciones
    const sheetInstrucciones = workbook.addWorksheet("Instrucciones");
    sheetInstrucciones.columns = [
      { header: "Campo / Regla", key: "campo", width: 26 },
      { header: "Instrucciones", key: "detalle", width: 70 },
    ];

    const instHeader = sheetInstrucciones.getRow(1);
    instHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
    instHeader.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF037A5C" },
    };

    sheetInstrucciones.addRows([
      {
        campo: "Columnas requeridas",
        detalle: "Droga y Cantidad son obligatorias en la primera hoja. Las demás columnas son opcionales.",
      },
      {
        campo: "Droga",
        detalle: "Nombre o sinónimo de una droga activa en el catálogo. Si no se reconoce o es ambigua, se importa con droga en blanco y el texto conservado.",
      },
      {
        campo: "Lote",
        detalle: "Código o texto del lote físico del envase. Formateado como texto para preservar ceros a la izquierda (ej: 00123). Puede dejarse en blanco.",
      },
      {
        campo: "Vencimiento",
        detalle: "Fecha en formato dd/mm/aaaa (ej: 31/12/2026) o formato fecha de Excel. Obligatorio para drogas, opcional para insumos.",
      },
      {
        campo: "Cantidad",
        detalle: "Cantidad contada, número mayor a 0. Se admiten decimales con coma o con punto (ej: 1,5 o 1.5).",
      },
      {
        campo: "Unidad",
        detalle: "Símbolo de la unidad (ej: g, mg, ml) o código, compatible con la magnitud de la droga.",
      },
      {
        campo: "Potencia",
        detalle: "Porcentaje de potencia declarada (0 a 100). Opcional, con coma o punto decimal.",
      },
      {
        campo: "Costo",
        detalle: "Costo unitario estimado. Opcional (≥ 0), con coma o punto decimal.",
      },
      {
        campo: "Proveedor",
        detalle: "Razón social normalizada o CUIT del proveedor registrado. Opcional.",
      },
      {
        campo: "Celdas en blanco",
        detalle: "Las celdas opcionales pueden dejarse en blanco. Los valores no reconocidos se reportan en el resumen y quedan para completar en la planilla.",
      },
      {
        campo: "Límite de filas",
        detalle: "Se procesan hasta 1000 filas con datos por archivo.",
      },
    ]);

    const buffer = await workbook.xlsx.writeBuffer();
    return new Uint8Array(buffer);
  },
});

export async function generarPlantillaExistenciaInicial(): Promise<Uint8Array> {
  return generarPlantillaExistenciaInicialQuery.execute({});
}
