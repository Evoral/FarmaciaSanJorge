/**
 * PDF layout for the libro recetario export (FASE 9, M12 point 9.1), printed as the libro's sheets
 * (openspec/specs/libro-recetario-y-contralor/spec.md, "Impresión"): A4 landscape, one jornada per sheet group -- each day
 * starts on a new sheet, a long day continues on the next ones, two days never share a sheet -- and "Hoja i de n"
 * numbered within each day. The table and the sheet helpers live in `shared/pdf/hojas.ts` (every cell wraps: the
 * whole fórmula de la prescripción is printed). Reuses `shared/pdf/pdf-document.ts#renderPdf`.
 */
import { renderPdf } from "@/shared/pdf/pdf-document";
import { HOJA_MARGEN, LEYENDA_ANULADO, OPCIONES_HOJA_LIBRO, celdaAnulado, dibujarTabla, formulaParaHoja, numerarHojas, type CeldaTabla, type ColumnaTabla, type GrupoDeHojas } from "@/shared/pdf/hojas";
import { formatFechaIso } from "@/shared/format/fecha";
import type { AsientoListItem } from "./asiento-repository";

// Fits the landscape width between margins (762 pt).
const COLUMNAS: ColumnaTabla[] = [
  { label: "Nº", width: 55 },
  { label: "Receta Nº", width: 55 },
  { label: "Paciente", width: 150 },
  { label: "Médico", width: 140 },
  { label: "Fórmula de la prescripción", width: 317 },
  { label: "Anulado", width: 45 },
];

export interface LibroPdfOptions {
  filtroResumen: string;
  truncated: boolean;
}

/** Correlative numbers come as strings (bigint): shorter first, then lexical, is numeric order. */
function compararNumero(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** The asientos per jornada, in date order and, within a day, in correlative order. */
function porJornada(items: readonly AsientoListItem[]): Array<{ fecha: string; asientos: AsientoListItem[] }> {
  const ordenados = [...items].sort((a, b) => (a.fechaAsiento < b.fechaAsiento ? -1 : a.fechaAsiento > b.fechaAsiento ? 1 : compararNumero(a.numeroCorrelativo, b.numeroCorrelativo)));
  const grupos: Array<{ fecha: string; asientos: AsientoListItem[] }> = [];
  for (const item of ordenados) {
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.fecha === item.fechaAsiento) ultimo.asientos.push(item);
    else grupos.push({ fecha: item.fechaAsiento, asientos: [item] });
  }
  return grupos;
}

/**
 * No estado column: only "SI" under Anulado for an ANULADO asiento, like the signed sheet
 * (openspec/specs/libro-recetario-y-contralor/spec.md, "Impresión").
 */
function fila(item: AsientoListItem): CeldaTabla[] {
  const numero: CeldaTabla =
    item.origen === "RECTIFICATIVO" && item.asientoOriginalNumeroCorrelativo ? { texto: item.numeroCorrelativo, nota: `Rectifica Nº ${item.asientoOriginalNumeroCorrelativo}` } : item.numeroCorrelativo;
  // Receta Nº: display-only (asiento-repository.ts#AsientoListItem.recetaNumeroInterno), "—" without a receta.
  return [numero, item.recetaNumeroInterno ?? "—", item.pacienteTexto, item.medicoTexto, formulaParaHoja(item.formulaTexto), celdaAnulado(item.estado === "ANULADO")];
}

export function buildLibroPdf(items: AsientoListItem[], options: LibroPdfOptions): Promise<Buffer> {
  return renderPdf((doc) => {
    const x0 = HOJA_MARGEN;
    const hojas: GrupoDeHojas[] = [];
    const jornadas = porJornada(items);

    function titulo(fecha: string | null, continuacion: boolean): void {
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#18181b")
        .text(fecha ? `Libro recetario — Jornada ${formatFechaIso(fecha)}${continuacion ? " (continuación)" : ""}` : "Libro recetario", x0, HOJA_MARGEN);
      doc.font("Helvetica").fontSize(8).fillColor("#52525b").text(options.filtroResumen, x0, doc.y + 2).fillColor("black");
      doc.moveDown(0.6);
    }

    if (jornadas.length === 0) {
      titulo(null, false);
      doc.fontSize(9).text("No hay asientos para este filtro.", x0);
      return;
    }

    jornadas.forEach((jornada, index) => {
      if (index > 0) doc.addPage();
      const primera = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
      titulo(jornada.fecha, false);
      dibujarTabla(doc, COLUMNAS, jornada.asientos.map(fila), () => titulo(jornada.fecha, true));

      if (options.truncated && index === jornadas.length - 1) {
        doc.moveDown(1);
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#b91c1c").text("El listado fue truncado por superar el máximo de filas exportables. Acotá el rango de fechas o números.", x0, doc.y, { width: 500 }).fillColor("black");
      }

      const rango = doc.bufferedPageRange();
      hojas.push({ primera, ultima: rango.start + rango.count - 1, etiqueta: `Jornada ${formatFechaIso(jornada.fecha)}` });
    });

    numerarHojas(doc, hojas, LEYENDA_ANULADO);
  }, OPCIONES_HOJA_LIBRO);
}
