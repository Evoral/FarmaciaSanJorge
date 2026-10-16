/**
 * Reads an uploaded .xls supplier price list (Excel 97-2003, BIFF8; docs/specs/costos-proveedor.md R14) with NO
 * dependency: the npm `xlsx` (SheetJS) package is abandoned at 0.18.5 with known vulnerabilities, so the format
 * is read here. It returns the same `LibroHojas` as `leer-xlsx.server.ts` (sheet names in workbook order each
 * flagged when empty, and raw rows for one sheet), so the Crystal parser stays format-agnostic.
 *
 * Two layers, both over a `Uint8Array` that only lives in memory (nothing is logged):
 *
 *   1. CFB / OLE2 compound file (MS-CFB): header, FAT (109 header entries + the DIFAT chain), directory, and the
 *      `Workbook` (or `Book`) stream, read from the regular FAT or -- when smaller than the mini stream cutoff
 *      (4096) -- from the mini stream through the mini FAT. EVERY sector index and chain is bounds-checked, cycles
 *      are detected and chains are capped by the number of sectors the file can hold, so a malformed file throws
 *      instead of looping or reading out of range.
 *   2. BIFF8 records (MS-XLS), a stream of `type u16, length u16, data`:
 *      - globals: `BOF` (only BIFF8, 0x0600, is read; older versions are refused with their own message),
 *        `FILEPASS` (encrypted: refused), `BOUNDSHEET` (sheet name + type + the stream offset of the sheet's BOF:
 *        a sheet is found by that offset, never by order; only worksheets are kept) and `SST` + `CONTINUE`
 *        (strings may be split across records: each continuation inside the characters restarts with an
 *        option-flags byte; rich-text runs and extended data are skipped, also across records);
 *      - sheets: `LABELSST`, `LABEL`, `NUMBER`, `RK`, `MULRK`, `FORMULA` (its cached result: a double, or the
 *        text that comes in the next `STRING` record; boolean, error and empty results are `null`), `BLANK`,
 *        `MULBLANK` and `BOOLERR` (`null`). Nested substreams (BOF/EOF pairs for embedded charts) are skipped.
 *
 * Cell values follow the xlsx reader: text and numbers only. Differences that are deliberate: a date is just
 * the number Excel stores (cell number formats are not read), and an empty string is an empty cell. Strings are
 * not trimmed (the xlsx reader does not trim either). Not supported: encrypted files, BIFF5/7 and older, macro
 * and chart sheets, cells beyond column 255 / row 65535 (the BIFF8 limits).
 *
 * Anything that is not a readable BIFF8 workbook is a `ValidationError` with a user-readable message, never a stack trace.
 */
import "server-only";
import { ValidationError } from "@/shared/errors";
import type { HojaLibro } from "../domain/importacion-lista";
import type { CeldaCruda } from "../domain/parsers/lista-xlsx-crystal";
import { MAX_COLUMNAS_HOJA, MAX_FILAS_HOJA, MENSAJES_LECTURA_HOJA, type LibroHojas } from "./libro-hojas";

export const MENSAJES_LECTURA_XLS = {
  ilegible: "No se pudo leer el archivo: no parece un .xls válido.",
  formatoAntiguo: "Formato .xls muy antiguo (anterior a Excel 97): guardalo como .xlsx.",
  protegido: "El archivo .xls está protegido con contraseña: quitale la protección o guardalo como .xlsx.",
  ...MENSAJES_LECTURA_HOJA,
} as const;

function ilegible(): never {
  throw new ValidationError(MENSAJES_LECTURA_XLS.ilegible);
}

function vistaDe(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// ---------------------------------------------------------------------------
// 1. CFB / OLE2 container
// ---------------------------------------------------------------------------

const FIRMA_CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FIN_DE_CADENA = 0xfffffffe;
const SECTOR_LIBRE = 0xffffffff;
/** Sector numbers above this are the special values (DIFSECT, FATSECT, ENDOFCHAIN, FREESECT). */
const MAX_SECTOR_REGULAR = 0xfffffffa;
const TAM_ENTRADA_DIRECTORIO = 128;
const TAM_SECTOR_MINI = 64;

const TIPO_ENTRADA_STREAM = 2;
const TIPO_ENTRADA_RAIZ = 5;

interface Cfb {
  bytes: Uint8Array;
  tamSector: number;
  /** How many sectors the file can hold: the longest a chain can be. */
  totalSectores: number;
  fat: Uint32Array;
}

/** One sector, zero-padded when it is the (short) last one of the file. A sector outside the file is malformed. */
function leerSector(cfb: Pick<Cfb, "bytes" | "tamSector">, numero: number): Uint8Array {
  if (numero > MAX_SECTOR_REGULAR) ilegible();
  const inicio = (numero + 1) * cfb.tamSector;
  if (inicio >= cfb.bytes.length) ilegible();
  const fin = inicio + cfb.tamSector;
  if (fin <= cfb.bytes.length) return cfb.bytes.subarray(inicio, fin);
  const relleno = new Uint8Array(cfb.tamSector);
  relleno.set(cfb.bytes.subarray(inicio));
  return relleno;
}

/** The sectors of a chain, in order. Cycles, indexes outside `tabla`, special values in the middle and chains longer than `maxLargo` are malformed. */
function seguirCadena(inicio: number, tabla: Uint32Array, maxLargo: number): number[] {
  const sectores: number[] = [];
  const visto = new Uint8Array(tabla.length);
  let actual = inicio;
  while (actual !== FIN_DE_CADENA) {
    if (actual > MAX_SECTOR_REGULAR || actual >= tabla.length || visto[actual] === 1) ilegible();
    visto[actual] = 1;
    sectores.push(actual);
    if (sectores.length > maxLargo) ilegible();
    actual = tabla[actual]!;
  }
  return sectores;
}

/** Reads a FAT-like table (FAT or mini FAT) out of the sectors listed in `ids`. */
function tablaDeSectores(cfb: Pick<Cfb, "bytes" | "tamSector">, ids: readonly number[]): Uint32Array {
  const porSector = cfb.tamSector / 4;
  const tabla = new Uint32Array(ids.length * porSector);
  ids.forEach((id, indice) => {
    const vista = vistaDe(leerSector(cfb, id));
    for (let i = 0; i < porSector; i++) tabla[indice * porSector + i] = vista.getUint32(i * 4, true);
  });
  return tabla;
}

/** Copies the first `tamano` bytes of the units (regular or mini sectors) of a chain; a chain that holds fewer bytes is malformed. */
function copiarUnidades(ids: readonly number[], tamUnidad: number, leerUnidad: (id: number) => Uint8Array, tamano: number): Uint8Array {
  if (ids.length * tamUnidad < tamano) ilegible();
  const salida = new Uint8Array(tamano);
  for (let i = 0; i < ids.length && i * tamUnidad < tamano; i++) {
    const unidad = leerUnidad(ids[i]!);
    salida.set(unidad.subarray(0, Math.min(tamUnidad, tamano - i * tamUnidad)), i * tamUnidad);
  }
  return salida;
}

interface EntradaDirectorio {
  nombre: string;
  tipo: number;
  inicio: number;
  tamano: number;
}

function leerDirectorio(cfb: Cfb, primerSector: number): EntradaDirectorio[] {
  const sectores = seguirCadena(primerSector, cfb.fat, cfb.totalSectores);
  if (sectores.length === 0) ilegible();
  const bytes = new Uint8Array(sectores.length * cfb.tamSector);
  sectores.forEach((id, i) => bytes.set(leerSector(cfb, id), i * cfb.tamSector));
  const vista = vistaDe(bytes);

  const entradas: EntradaDirectorio[] = [];
  for (let base = 0; base + TAM_ENTRADA_DIRECTORIO <= bytes.length; base += TAM_ENTRADA_DIRECTORIO) {
    const largoNombre = vista.getUint16(base + 64, true); // bytes, terminator included
    const tipo = bytes[base + 66]!;
    let nombre = "";
    if (largoNombre >= 2 && largoNombre <= 64) {
      for (let i = 0; i < largoNombre / 2 - 1; i++) nombre += String.fromCharCode(vista.getUint16(base + i * 2, true));
    }
    // Only the low 32 bits of the size: a stream can not be larger than the file (checked by the caller).
    entradas.push({ nombre, tipo, inicio: vista.getUint32(base + 116, true), tamano: vista.getUint32(base + 120, true) });
  }
  return entradas;
}

/** The bytes of the workbook stream (`Workbook`, else the BIFF5 `Book`) of a CFB file. */
function extraerFlujoLibro(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 512 || !FIRMA_CFB.every((b, i) => bytes[i] === b)) ilegible();
  const cabecera = vistaDe(bytes);
  if (cabecera.getUint16(28, true) !== 0xfffe) ilegible(); // little-endian marker
  const desplazamiento = cabecera.getUint16(30, true);
  if (desplazamiento !== 9 && desplazamiento !== 12) ilegible(); // 512 or 4096 byte sectors
  if (cabecera.getUint16(32, true) !== 6) ilegible(); // 64 byte mini sectors

  const tamSector = 1 << desplazamiento;
  const totalSectores = Math.max(0, Math.ceil((bytes.length - tamSector) / tamSector));
  const cantidadFat = cabecera.getUint32(44, true);
  const primerDirectorio = cabecera.getUint32(48, true);
  const corteMini = cabecera.getUint32(56, true);
  const primerMiniFat = cabecera.getUint32(60, true);
  const primerDifat = cabecera.getUint32(68, true);
  const cantidadDifat = cabecera.getUint32(72, true);
  if (cantidadFat === 0 || cantidadFat > totalSectores || cantidadDifat > totalSectores) ilegible();

  // FAT sector ids: 109 in the header, then the DIFAT chain.
  const idsFat: number[] = [];
  const agregarIds = (vista: DataView, desde: number, cantidad: number) => {
    for (let i = 0; i < cantidad && idsFat.length < cantidadFat; i++) {
      const id = vista.getUint32(desde + i * 4, true);
      if (id === SECTOR_LIBRE) continue;
      if (id > MAX_SECTOR_REGULAR) ilegible();
      idsFat.push(id);
    }
  };
  agregarIds(cabecera, 76, 109);
  const porSectorDifat = tamSector / 4 - 1;
  const difatVistos = new Set<number>();
  let difat = primerDifat;
  while (idsFat.length < cantidadFat && difat !== FIN_DE_CADENA && difat !== SECTOR_LIBRE) {
    if (difatVistos.has(difat) || difatVistos.size >= cantidadDifat) ilegible();
    difatVistos.add(difat);
    const vista = vistaDe(leerSector({ bytes, tamSector }, difat));
    agregarIds(vista, 0, porSectorDifat);
    difat = vista.getUint32(porSectorDifat * 4, true);
  }
  if (idsFat.length !== cantidadFat) ilegible();

  const cfb: Cfb = { bytes, tamSector, totalSectores, fat: tablaDeSectores({ bytes, tamSector }, idsFat) };

  const entradas = leerDirectorio(cfb, primerDirectorio);
  const raiz = entradas[0];
  const flujos = entradas.filter((entrada) => entrada.tipo === TIPO_ENTRADA_STREAM);
  const libro = flujos.find((e) => e.nombre.toLowerCase() === "workbook") ?? flujos.find((e) => e.nombre.toLowerCase() === "book");
  if (!libro) ilegible();
  // A stream can not hold more bytes than the file does: refuses absurd sizes before allocating anything.
  if (libro.tamano > bytes.length) ilegible();

  if (libro.tamano >= corteMini) {
    return copiarUnidades(seguirCadena(libro.inicio, cfb.fat, totalSectores), tamSector, (id) => leerSector(cfb, id), libro.tamano);
  }

  // Small stream: it lives in the mini stream (the root entry's own stream), addressed through the mini FAT.
  if (!raiz || raiz.tipo !== TIPO_ENTRADA_RAIZ || raiz.tamano > bytes.length) ilegible();
  const miniFat = tablaDeSectores(cfb, seguirCadena(primerMiniFat, cfb.fat, totalSectores));
  const miniStream = copiarUnidades(seguirCadena(raiz.inicio, cfb.fat, totalSectores), tamSector, (id) => leerSector(cfb, id), raiz.tamano);
  const leerMini = (id: number): Uint8Array => {
    const inicio = id * TAM_SECTOR_MINI;
    if (inicio >= miniStream.length) ilegible();
    return miniStream.subarray(inicio, Math.min(inicio + TAM_SECTOR_MINI, miniStream.length));
  };
  const idsMini = seguirCadena(libro.inicio, miniFat, miniFat.length);
  // The last mini sector may be shorter than 64 bytes only if the root stream ends there: size what is really there.
  const disponible = idsMini.reduce((suma, id) => suma + leerMini(id).length, 0);
  if (disponible < libro.tamano) ilegible();
  return copiarUnidades(idsMini, TAM_SECTOR_MINI, leerMini, libro.tamano);
}

// ---------------------------------------------------------------------------
// 2. BIFF8 records
// ---------------------------------------------------------------------------

const REG_BOF = 0x0809;
const REG_BOF_BIFF2 = 0x0009;
const REG_BOF_BIFF3 = 0x0209;
const REG_BOF_BIFF4 = 0x0409;
const REG_EOF = 0x000a;
const REG_FILEPASS = 0x002f;
const REG_BOUNDSHEET = 0x0085;
const REG_SST = 0x00fc;
const REG_CONTINUE = 0x003c;
const REG_LABELSST = 0x00fd;
const REG_LABEL = 0x0204;
const REG_NUMBER = 0x0203;
const REG_RK = 0x027e;
const REG_MULRK = 0x00bd;
const REG_FORMULA = 0x0006;
const REG_STRING = 0x0207;
const REG_BOOLERR = 0x0205;
const REG_BLANK = 0x0201;
const REG_MULBLANK = 0x00be;

const VERSION_BIFF8 = 0x0600;
const BOF_GLOBALES = 0x0005;
const BOF_HOJA = 0x0010;
const BOUNDSHEET_HOJA_DE_CALCULO = 0x00;

const MAX_FILA_BIFF8 = 65535;
const MAX_COLUMNA_BIFF8 = 255;

interface Registro {
  tipo: number;
  /** Data is `flujo[inicio, fin)`. */
  inicio: number;
  fin: number;
}

interface Flujo {
  bytes: Uint8Array;
  vista: DataView;
}

/** The record at `posicion`, or `null` at the end of the stream. A record that runs past the end is malformed. */
function leerRegistro(flujo: Flujo, posicion: number): Registro | null {
  if (posicion + 4 > flujo.bytes.length) return null;
  const longitud = flujo.vista.getUint16(posicion + 2, true);
  const fin = posicion + 4 + longitud;
  if (fin > flujo.bytes.length) ilegible();
  return { tipo: flujo.vista.getUint16(posicion, true), inicio: posicion + 4, fin };
}

/** A record's data followed by every `CONTINUE` right after it (SST, LABEL and STRING can spill into them). */
function conContinues(flujo: Flujo, registro: Registro): { segmentos: Uint8Array[]; siguiente: number } {
  const segmentos = [flujo.bytes.subarray(registro.inicio, registro.fin)];
  let posicion = registro.fin;
  for (;;) {
    const continuacion = leerRegistro(flujo, posicion);
    if (!continuacion || continuacion.tipo !== REG_CONTINUE) break;
    segmentos.push(flujo.bytes.subarray(continuacion.inicio, continuacion.fin));
    posicion = continuacion.fin;
  }
  return { segmentos, siguiente: posicion };
}

/** Sequential reader over the data of a record and its CONTINUE records. */
class LectorSegmentos {
  private segmento = 0;
  private posicion = 0;

  constructor(private readonly segmentos: readonly Uint8Array[]) {}

  /** Moves past exhausted (or empty) segments; true when unread bytes remain. */
  hayDatos(): boolean {
    while (this.segmento < this.segmentos.length && this.posicion >= this.segmentos[this.segmento]!.length) {
      this.segmento += 1;
      this.posicion = 0;
    }
    return this.segmento < this.segmentos.length;
  }

  u8(): number {
    if (!this.hayDatos()) ilegible();
    return this.segmentos[this.segmento]![this.posicion++]!;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  /** Skips `cantidad` bytes across segments (no option-flags byte: that only exists inside character data). */
  saltar(cantidad: number): void {
    let restantes = cantidad;
    while (restantes > 0) {
      if (!this.hayDatos()) ilegible();
      const tomar = Math.min(restantes, this.segmentos[this.segmento]!.length - this.posicion);
      this.posicion += tomar;
      restantes -= tomar;
    }
  }

  /**
   * `cantidad` characters of a string. When they continue into the next CONTINUE record, that record starts with
   * an option-flags byte whose bit 0 says whether the rest is UTF-16 or one byte per character.
   */
  caracteres(cantidad: number, utf16Inicial: boolean): string {
    let utf16 = utf16Inicial;
    let restantes = cantidad;
    let texto = "";
    while (restantes > 0) {
      if (this.segmento < this.segmentos.length && this.posicion >= this.segmentos[this.segmento]!.length) {
        // Boundary inside the character data: the next (non-empty) record opens with the flags byte.
        if (!this.hayDatos()) ilegible();
        utf16 = (this.u8() & 1) === 1;
        continue;
      }
      const segmento = this.segmentos[this.segmento];
      if (!segmento) ilegible();
      const bytesPorCaracter = utf16 ? 2 : 1;
      const tomar = Math.min(restantes, Math.floor((segmento.length - this.posicion) / bytesPorCaracter));
      if (tomar === 0) ilegible();
      const codigos: number[] = [];
      for (let i = 0; i < tomar; i++) {
        const desde = this.posicion + i * bytesPorCaracter;
        codigos.push(utf16 ? segmento[desde]! | (segmento[desde + 1]! << 8) : segmento[desde]!);
      }
      for (let i = 0; i < codigos.length; i += 4096) texto += String.fromCharCode(...codigos.slice(i, i + 4096));
      this.posicion += tomar * bytesPorCaracter;
      restantes -= tomar;
    }
    return texto;
  }
}

/** XLUnicodeRichExtendedString: char count, flags, [rich run count], [extended data size], characters, runs, extended data. */
function leerCadenaSst(lector: LectorSegmentos): string {
  const cantidad = lector.u16();
  const opciones = lector.u8();
  const corridas = (opciones & 0x08) !== 0 ? lector.u16() : 0;
  const bytesExtendidos = (opciones & 0x04) !== 0 ? lector.u32() : 0;
  const texto = lector.caracteres(cantidad, (opciones & 0x01) !== 0);
  lector.saltar(corridas * 4 + bytesExtendidos);
  return texto;
}

function leerSst(segmentos: readonly Uint8Array[]): string[] {
  const lector = new LectorSegmentos(segmentos);
  lector.u32(); // total references to strings
  const unicas = lector.u32();
  const cadenas: string[] = [];
  while (cadenas.length < unicas && lector.hayDatos()) cadenas.push(leerCadenaSst(lector));
  return cadenas;
}

/** XLUnicodeString of a LABEL / STRING record: char count (u16), flags, characters. */
function leerCadenaSimple(lector: LectorSegmentos): string {
  const cantidad = lector.u16();
  const opciones = lector.u8();
  return lector.caracteres(cantidad, (opciones & 0x01) !== 0);
}

/** An RK value: a 30-bit integer or the high 30 bits of an IEEE double, optionally divided by 100. */
function decodificarRk(rk: number): number {
  const entero = (rk & 0x02) !== 0;
  let valor: number;
  if (entero) {
    valor = (rk | 0) >> 2; // signed 30-bit
  } else {
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setUint32(4, (rk & 0xfffffffc) >>> 0, true); // the high 32 bits of the double; the low 32 are zero
    valor = bytes.getFloat64(0, true);
  }
  return (rk & 0x01) !== 0 ? valor / 100 : valor;
}

/** BOF check of the very first record: BIFF8 only. Older BIFF versions get their own message. */
function validarPrimerBof(flujo: Flujo): Registro {
  const registro = leerRegistro(flujo, 0);
  if (!registro) ilegible();
  if (registro.tipo === REG_BOF_BIFF2 || registro.tipo === REG_BOF_BIFF3 || registro.tipo === REG_BOF_BIFF4) {
    throw new ValidationError(MENSAJES_LECTURA_XLS.formatoAntiguo);
  }
  if (registro.tipo !== REG_BOF || registro.fin - registro.inicio < 4) ilegible();
  const version = flujo.vista.getUint16(registro.inicio, true);
  if (version < VERSION_BIFF8) throw new ValidationError(MENSAJES_LECTURA_XLS.formatoAntiguo); // BIFF5 / 7
  if (version !== VERSION_BIFF8) ilegible();
  if (flujo.vista.getUint16(registro.inicio + 2, true) !== BOF_GLOBALES) ilegible();
  return registro;
}

interface HojaDeclarada {
  nombre: string;
  /** Stream offset of the sheet's BOF. */
  desplazamiento: number;
}

function leerBoundsheet(flujo: Flujo, registro: Registro): HojaDeclarada | null {
  if (registro.fin - registro.inicio < 8) ilegible();
  const { inicio } = registro;
  const tipoHoja = flujo.bytes[inicio + 5]!;
  const cantidad = flujo.bytes[inicio + 6]!;
  const utf16 = (flujo.bytes[inicio + 7]! & 0x01) !== 0;
  const largo = utf16 ? cantidad * 2 : cantidad;
  if (inicio + 8 + largo > registro.fin) ilegible();
  if (tipoHoja !== BOUNDSHEET_HOJA_DE_CALCULO) return null; // macro / chart / VB module sheets carry no list
  const nombre = new LectorSegmentos([flujo.bytes.subarray(inicio + 8, inicio + 8 + largo)]).caracteres(cantidad, utf16);
  return { nombre, desplazamiento: flujo.vista.getUint32(inicio, true) };
}

/** The workbook globals substream: the worksheets declared and the shared strings. */
function leerGlobales(flujo: Flujo): { hojas: HojaDeclarada[]; cadenas: string[] } {
  const primero = validarPrimerBof(flujo);
  const hojas: HojaDeclarada[] = [];
  let cadenas: string[] = [];
  let profundidad = 1;
  let posicion = primero.fin;
  for (;;) {
    const registro = leerRegistro(flujo, posicion);
    if (!registro) ilegible(); // the substream never closed: truncated
    posicion = registro.fin;
    if (registro.tipo === REG_BOF) {
      profundidad += 1;
    } else if (registro.tipo === REG_EOF) {
      profundidad -= 1;
      if (profundidad === 0) return { hojas, cadenas };
    } else if (profundidad === 1) {
      if (registro.tipo === REG_FILEPASS) throw new ValidationError(MENSAJES_LECTURA_XLS.protegido);
      if (registro.tipo === REG_BOUNDSHEET) {
        const hoja = leerBoundsheet(flujo, registro);
        if (hoja) hojas.push(hoja);
      } else if (registro.tipo === REG_SST) {
        const { segmentos, siguiente } = conContinues(flujo, registro);
        cadenas = leerSst(segmentos);
        posicion = siguiente;
      }
    }
  }
}

interface CeldaConValor {
  fila: number;
  columna: number;
  valor: string | number;
}

interface DatosHoja {
  celdas: CeldaConValor[];
  /** Highest row / column index holding a value (-1 when the sheet has none). */
  maxFila: number;
  maxColumna: number;
}

/** One worksheet substream, from its BOF to the matching EOF. */
function leerHoja(flujo: Flujo, cadenas: readonly string[], desplazamiento: number): DatosHoja {
  const inicial = leerRegistro(flujo, desplazamiento);
  if (!inicial || inicial.tipo !== REG_BOF || inicial.fin - inicial.inicio < 4) ilegible();
  if (flujo.vista.getUint16(inicial.inicio + 2, true) !== BOF_HOJA) ilegible();

  const datos: DatosHoja = { celdas: [], maxFila: -1, maxColumna: -1 };
  const poner = (fila: number, columna: number, valor: CeldaCruda) => {
    if (valor === null || fila > MAX_FILA_BIFF8 || columna > MAX_COLUMNA_BIFF8) return;
    if (typeof valor === "number" ? !Number.isFinite(valor) : valor.length === 0) return;
    datos.celdas.push({ fila, columna, valor });
    if (fila > datos.maxFila) datos.maxFila = fila;
    if (columna > datos.maxColumna) datos.maxColumna = columna;
  };
  const { vista } = flujo;

  let profundidad = 1;
  let posicion = inicial.fin;
  /** A FORMULA whose cached result is text: that text arrives in the next STRING record. */
  let formulaConTexto: { fila: number; columna: number } | null = null;

  for (;;) {
    const registro = leerRegistro(flujo, posicion);
    if (!registro) ilegible(); // the substream never closed: truncated
    posicion = registro.fin;
    if (registro.tipo === REG_BOF) {
      profundidad += 1;
      continue;
    }
    if (registro.tipo === REG_EOF) {
      profundidad -= 1;
      if (profundidad === 0) return datos;
      continue;
    }
    if (profundidad !== 1) continue; // inside an embedded substream (e.g. a chart)

    const base = registro.inicio;
    const largo = registro.fin - registro.inicio;
    switch (registro.tipo) {
      case REG_NUMBER: {
        formulaConTexto = null;
        if (largo < 14) ilegible();
        poner(vista.getUint16(base, true), vista.getUint16(base + 2, true), vista.getFloat64(base + 6, true));
        break;
      }
      case REG_RK: {
        formulaConTexto = null;
        if (largo < 10) ilegible();
        poner(vista.getUint16(base, true), vista.getUint16(base + 2, true), decodificarRk(vista.getUint32(base + 6, true)));
        break;
      }
      case REG_MULRK: {
        formulaConTexto = null;
        if (largo < 10) ilegible();
        const fila = vista.getUint16(base, true);
        const primeraColumna = vista.getUint16(base + 2, true);
        const cantidad = Math.floor((largo - 6) / 6);
        for (let i = 0; i < cantidad; i++) poner(fila, primeraColumna + i, decodificarRk(vista.getUint32(base + 4 + i * 6 + 2, true)));
        break;
      }
      case REG_LABELSST: {
        formulaConTexto = null;
        if (largo < 10) ilegible();
        poner(vista.getUint16(base, true), vista.getUint16(base + 2, true), cadenas[vista.getUint32(base + 6, true)] ?? null);
        break;
      }
      case REG_LABEL: {
        formulaConTexto = null;
        const { segmentos, siguiente } = conContinues(flujo, registro);
        posicion = siguiente;
        const lector = new LectorSegmentos(segmentos);
        const fila = lector.u16();
        const columna = lector.u16();
        lector.u16(); // XF index
        poner(fila, columna, leerCadenaSimple(lector));
        break;
      }
      case REG_FORMULA: {
        formulaConTexto = null;
        if (largo < 14) ilegible();
        const fila = vista.getUint16(base, true);
        const columna = vista.getUint16(base + 2, true);
        if (vista.getUint16(base + 12, true) === 0xffff) {
          // Not a number: byte 0 of the result says what it is. 0 = text in the next STRING record; boolean, error and empty = no value.
          if (flujo.bytes[base + 6] === 0) formulaConTexto = { fila, columna };
        } else {
          poner(fila, columna, vista.getFloat64(base + 6, true));
        }
        break;
      }
      case REG_STRING: {
        if (formulaConTexto) {
          const { segmentos, siguiente } = conContinues(flujo, registro);
          posicion = siguiente;
          poner(formulaConTexto.fila, formulaConTexto.columna, leerCadenaSimple(new LectorSegmentos(segmentos)));
          formulaConTexto = null;
        }
        break;
      }
      case REG_BOOLERR:
      case REG_BLANK:
      case REG_MULBLANK:
        formulaConTexto = null;
        break;
      default:
        break;
    }
  }
}

/** Opens the workbook. Throws a `ValidationError` for anything that is not a readable, unprotected BIFF8 .xls. */
export function leerLibroXls(bytes: Uint8Array): LibroHojas {
  try {
    const contenido = extraerFlujoLibro(bytes);
    const flujo: Flujo = { bytes: contenido, vista: vistaDe(contenido) };
    const { hojas: declaradas, cadenas } = leerGlobales(flujo);
    const datos = declaradas.map((hoja) => leerHoja(flujo, cadenas, hoja.desplazamiento));

    const hojas = declaradas.map((hoja, indice): HojaLibro => ({ nombre: hoja.nombre, vacia: datos[indice]!.maxFila < 0 }));

    return {
      hojas,
      leerHoja(nombre) {
        const indice = declaradas.findIndex((hoja) => hoja.nombre === nombre);
        if (indice === -1) throw new ValidationError(MENSAJES_LECTURA_XLS.hojaInexistente(nombre));
        const hoja = datos[indice]!;
        const cantidadFilas = hoja.maxFila + 1;
        if (cantidadFilas > MAX_FILAS_HOJA) throw new ValidationError(MENSAJES_LECTURA_XLS.hojaDemasiadoGrande);
        const cantidadColumnas = Math.min(hoja.maxColumna + 1, MAX_COLUMNAS_HOJA);
        const filas: CeldaCruda[][] = Array.from({ length: cantidadFilas }, () => new Array<CeldaCruda>(cantidadColumnas).fill(null));
        for (const celda of hoja.celdas) {
          if (celda.columna < cantidadColumnas) filas[celda.fila]![celda.columna] = celda.valor;
        }
        return filas;
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(MENSAJES_LECTURA_XLS.ilegible);
  }
}
