/**
 * Test-only writer of BIFF8 `.xls` files (docs/specs/costos-proveedor.md R14): no binary fixtures live in the repo, the
 * tests of `modules/costos-proveedor/infrastructure/leer-xls.server.ts` build their workbooks with this.
 *
 * Two layers, mirroring the reader:
 *   - `armarFlujoBiff8`: the `Workbook` stream -- globals (BOF, CODEPAGE, FILEPASS, BOUNDSHEET with the right
 *     `lbPlyPos`, SST + CONTINUE, EXTSST, EOF) and one substream per sheet (BOF, DIMENSIONS, cells, EOF);
 *   - `armarCfb`: the OLE2 / CFB container around any byte stream: header, FAT (several sectors, DIFAT chain when the
 *     FAT needs more than the 109 header entries), directory, and either a regular stream or -- under 4096 bytes --
 *     the mini stream with its mini FAT.
 *
 * It writes what Excel writes where that matters to the reader: strings in the SST that do not fit a record continue
 * in a CONTINUE record that opens with an option-flags byte; a text result of a FORMULA comes in a STRING record.
 * Nothing here is used outside tests.
 */

export type ModoRk = "entero" | "centesimos" | "doble" | "doble100";

/** An SST entry. Characters above 0xFF (or `utf16`) are written as UTF-16, the rest compressed (one byte each). */
export interface CadenaSst {
  texto: string;
  utf16?: boolean;
  /** Rich-text formatting runs (4 bytes each) written after the characters. */
  corridas?: number;
  /** Extended string data bytes (East Asian phonetics) written after the runs. */
  extendido?: number;
}

export type CeldaXls =
  | ({ tipo: "sst"; fila: number; col: number } & CadenaSst)
  | { tipo: "label"; fila: number; col: number; texto: string; utf16?: boolean }
  | { tipo: "numero"; fila: number; col: number; valor: number }
  | { tipo: "rk"; fila: number; col: number; valor: number; modo: ModoRk }
  | { tipo: "mulrk"; fila: number; colInicial: number; valores: number[] }
  | { tipo: "formulaNumero"; fila: number; col: number; valor: number }
  | { tipo: "formulaTexto"; fila: number; col: number; texto: string; utf16?: boolean; conArray?: boolean }
  | { tipo: "formulaBooleano"; fila: number; col: number; valor: boolean }
  | { tipo: "formulaError"; fila: number; col: number }
  | { tipo: "booleano"; fila: number; col: number; valor: boolean }
  | { tipo: "blank"; fila: number; col: number }
  | { tipo: "mulblank"; fila: number; colInicial: number; cantidad: number };

export interface HojaXls {
  nombre: string;
  celdas?: CeldaXls[];
  /** 0 = visible (default), 1 = hidden, 2 = very hidden. */
  visibilidad?: number;
  /** BOUNDSHEET sheet type: 0 worksheet (default), 1 macro sheet, 2 chart. */
  tipoHoja?: number;
  /** An embedded chart substream (BOF 0x0020 ... EOF) holding a NUMBER (row 20, column F) that must be ignored. */
  subflujoIncrustado?: boolean;
}

export interface OpcionesFlujo {
  hojas: HojaXls[];
  /** BOF version of every substream; 0x0600 = BIFF8 (default), 0x0500 = BIFF5/7. */
  versionBof?: number;
  /** Add a FILEPASS record (an encrypted workbook). */
  filepass?: boolean;
  /** Entries written to the SST BEFORE the strings the cells need (e.g. rich text ones). */
  sstExtra?: CadenaSst[];
  /** Capacity of one SST / CONTINUE record in bytes (8224 = Excel's). Small values force strings to span records. */
  limiteSst?: number;
  /** Physical order of the sheet substreams (indexes into `hojas`); BOUNDSHEET order stays the workbook order. */
  ordenFisico?: number[];
  /** Ignorable bytes appended to the last sheet (to make the stream bigger than the mini stream cutoff). */
  relleno?: number;
}

// ---------------------------------------------------------------------------
// bytes
// ---------------------------------------------------------------------------

const u8 = (...valores: number[]): Uint8Array => Uint8Array.from(valores);
const u16 = (v: number): Uint8Array => u8(v & 0xff, (v >> 8) & 0xff);
const u32 = (v: number): Uint8Array => u8(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
const f64 = (v: number): Uint8Array => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, v, true);
  return bytes;
};

function juntar(...partes: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const salida = new Uint8Array(partes.reduce((suma, parte) => suma + parte.length, 0));
  let posicion = 0;
  for (const parte of partes) {
    salida.set(parte, posicion);
    posicion += parte.length;
  }
  return salida;
}

function registro(tipo: number, ...datos: Uint8Array[]): Uint8Array {
  const cuerpo = juntar(...datos);
  if (cuerpo.length > 8224) throw new Error(`record 0x${tipo.toString(16)} too long: ${cuerpo.length}`);
  return juntar(u16(tipo), u16(cuerpo.length), cuerpo);
}

const esUtf16 = (texto: string, forzar?: boolean): boolean => forzar === true || [...texto].some((c) => c.charCodeAt(0) > 0xff);

function caracteres(texto: string, utf16: boolean): Uint8Array {
  return juntar(...[...texto].map((c) => (utf16 ? u16(c.charCodeAt(0)) : u8(c.charCodeAt(0)))));
}

// ---------------------------------------------------------------------------
// BIFF8 stream
// ---------------------------------------------------------------------------

const REG = {
  BOF: 0x0809,
  EOF: 0x000a,
  CODEPAGE: 0x0042,
  FILEPASS: 0x002f,
  BOUNDSHEET: 0x0085,
  SST: 0x00fc,
  EXTSST: 0x00ff,
  CONTINUE: 0x003c,
  DIMENSIONS: 0x0200,
  BLANK: 0x0201,
  NUMBER: 0x0203,
  LABEL: 0x0204,
  BOOLERR: 0x0205,
  STRING: 0x0207,
  FORMULA: 0x0006,
  ARRAY: 0x0221,
  MULRK: 0x00bd,
  MULBLANK: 0x00be,
  LABELSST: 0x00fd,
  RK: 0x027e,
  DESCONOCIDO: 0x7fff,
} as const;

const XF = u16(0x000f);

function bof(version: number, tipo: number): Uint8Array {
  return registro(REG.BOF, u16(version), u16(tipo), u16(0x0dbb), u16(0x07cc), u32(0), u32(6));
}

/** The SST record followed by the CONTINUE records its content spills into. */
function armarSst(cadenas: readonly CadenaSst[], referencias: number, limite: number): Uint8Array {
  const segmentos: number[][] = [[]];
  const actual = () => segmentos[segmentos.length - 1]!;
  const quedan = () => limite - actual().length;
  const escribir = (bytes: Uint8Array) => actual().push(...bytes);
  const nuevoSegmento = () => segmentos.push([]);
  /** Bytes with no flags byte at the boundary (formatting runs, extended data). */
  const escribirLibres = (cantidad: number) => {
    let restantes = cantidad;
    while (restantes > 0) {
      if (quedan() === 0) nuevoSegmento();
      const tomar = Math.min(restantes, quedan());
      escribir(new Uint8Array(tomar));
      restantes -= tomar;
    }
  };

  escribir(u32(referencias));
  escribir(u32(cadenas.length));
  for (const cadena of cadenas) {
    const utf16 = esUtf16(cadena.texto, cadena.utf16);
    const bytesPorCaracter = utf16 ? 2 : 1;
    const opciones = (utf16 ? 0x01 : 0) | (cadena.extendido ? 0x04 : 0) | (cadena.corridas ? 0x08 : 0);
    const codigos = [...cadena.texto];
    const cantidad = codigos.length;
    const cabecera = juntar(u16(cantidad), u8(opciones), cadena.corridas ? u16(cadena.corridas) : u8(), cadena.extendido ? u32(cadena.extendido) : u8());
    // A string whose header and first character do not fit starts the next record (no flags byte).
    if (quedan() < cabecera.length + bytesPorCaracter) nuevoSegmento();
    escribir(cabecera);
    let escritos = 0;
    while (escritos < cantidad) {
      const tomar = Math.min(cantidad - escritos, Math.floor(quedan() / bytesPorCaracter));
      escribir(caracteres(codigos.slice(escritos, escritos + tomar).join(""), utf16));
      escritos += tomar;
      if (escritos < cantidad) {
        // Characters continue in the next record, which opens with an option-flags byte.
        nuevoSegmento();
        escribir(u8(utf16 ? 0x01 : 0x00));
      }
    }
    escribirLibres((cadena.corridas ?? 0) * 4 + (cadena.extendido ?? 0));
  }
  return juntar(...segmentos.map((segmento, i) => registro(i === 0 ? REG.SST : REG.CONTINUE, Uint8Array.from(segmento))));
}

function codificarRk(valor: number, modo: ModoRk): number {
  if (modo === "entero") return ((valor << 2) | 0x02) >>> 0;
  if (modo === "centesimos") return ((Math.round(valor * 100) << 2) | 0x03) >>> 0;
  const vista = new DataView(f64(valor).buffer);
  if (vista.getUint32(0, true) !== 0 || (vista.getUint32(4, true) & 0x03) !== 0) throw new Error(`${valor} is not representable as an RK double`);
  return ((vista.getUint32(4, true) & 0xfffffffc) | (modo === "doble100" ? 0x01 : 0)) >>> 0;
}

const FORMULA_COLA = [u16(0), u32(0), u16(3), u8(0x1e, 0x02, 0x00)]; // grbit, chn, cce, a ptgInt token

function registrosCelda(celda: CeldaXls, indiceSst: ReadonlyMap<string, number>): Uint8Array[] {
  switch (celda.tipo) {
    case "sst":
      return [registro(REG.LABELSST, u16(celda.fila), u16(celda.col), XF, u32(indiceSst.get(celda.texto)!))];
    case "label": {
      const utf16 = esUtf16(celda.texto, celda.utf16);
      return [registro(REG.LABEL, u16(celda.fila), u16(celda.col), XF, u16([...celda.texto].length), u8(utf16 ? 1 : 0), caracteres(celda.texto, utf16))];
    }
    case "numero":
      return [registro(REG.NUMBER, u16(celda.fila), u16(celda.col), XF, f64(celda.valor))];
    case "rk":
      return [registro(REG.RK, u16(celda.fila), u16(celda.col), XF, u32(codificarRk(celda.valor, celda.modo)))];
    case "mulrk":
      return [
        registro(
          REG.MULRK,
          u16(celda.fila),
          u16(celda.colInicial),
          ...celda.valores.flatMap((valor) => [XF, u32(codificarRk(valor, "entero"))]),
          u16(celda.colInicial + celda.valores.length - 1),
        ),
      ];
    case "formulaNumero":
      return [registro(REG.FORMULA, u16(celda.fila), u16(celda.col), XF, f64(celda.valor), ...FORMULA_COLA)];
    case "formulaTexto": {
      const utf16 = esUtf16(celda.texto, celda.utf16);
      return [
        registro(REG.FORMULA, u16(celda.fila), u16(celda.col), XF, u8(0, 0, 0, 0, 0, 0, 0xff, 0xff), ...FORMULA_COLA),
        // A shared / array formula record may sit between the FORMULA and its STRING.
        ...(celda.conArray ? [registro(REG.ARRAY, new Uint8Array(12))] : []),
        registro(REG.STRING, u16([...celda.texto].length), u8(utf16 ? 1 : 0), caracteres(celda.texto, utf16)),
      ];
    }
    case "formulaBooleano":
      return [registro(REG.FORMULA, u16(celda.fila), u16(celda.col), XF, u8(1, 0, celda.valor ? 1 : 0, 0, 0, 0, 0xff, 0xff), ...FORMULA_COLA)];
    case "formulaError":
      return [registro(REG.FORMULA, u16(celda.fila), u16(celda.col), XF, u8(2, 0, 0x07, 0, 0, 0, 0xff, 0xff), ...FORMULA_COLA)];
    case "booleano":
      return [registro(REG.BOOLERR, u16(celda.fila), u16(celda.col), XF, u8(celda.valor ? 1 : 0, 0))];
    case "blank":
      return [registro(REG.BLANK, u16(celda.fila), u16(celda.col), XF)];
    case "mulblank":
      return [registro(REG.MULBLANK, u16(celda.fila), u16(celda.colInicial), ...Array.from({ length: celda.cantidad }, () => XF), u16(celda.colInicial + celda.cantidad - 1))];
  }
}

function subflujoHoja(hoja: HojaXls, indiceSst: ReadonlyMap<string, number>, version: number, relleno: number): Uint8Array {
  const incrustado = hoja.subflujoIncrustado
    ? [bof(version, 0x0020), registro(REG.NUMBER, u16(20), u16(5), XF, f64(999999)), registro(REG.EOF)]
    : [];
  return juntar(
    bof(version, 0x0010),
    registro(REG.DIMENSIONS, u32(0), u32(10), u16(0), u16(10), u16(0)),
    ...incrustado,
    ...(hoja.celdas ?? []).flatMap((celda) => registrosCelda(celda, indiceSst)),
    ...Array.from({ length: Math.ceil(relleno / 8000) }, (_, i) => registro(REG.DESCONOCIDO, new Uint8Array(Math.min(8000, relleno - i * 8000)))),
    registro(REG.EOF),
  );
}

function boundsheet(hoja: HojaXls, desplazamiento: number): Uint8Array {
  const utf16 = esUtf16(hoja.nombre);
  return registro(
    REG.BOUNDSHEET,
    u32(desplazamiento),
    u8(hoja.visibilidad ?? 0, hoja.tipoHoja ?? 0),
    u8([...hoja.nombre].length, utf16 ? 1 : 0),
    caracteres(hoja.nombre, utf16),
  );
}

/** The `Workbook` stream of a BIFF8 file. */
export function armarFlujoBiff8(opciones: OpcionesFlujo): Uint8Array<ArrayBuffer> {
  const version = opciones.versionBof ?? 0x0600;
  const hojas = opciones.hojas;

  // Every distinct text a LABELSST cell needs, after the extra entries.
  const cadenas: CadenaSst[] = [...(opciones.sstExtra ?? [])];
  const indiceSst = new Map<string, number>();
  cadenas.forEach((cadena, i) => indiceSst.set(cadena.texto, i));
  let referencias = cadenas.length;
  for (const hoja of hojas) {
    for (const celda of hoja.celdas ?? []) {
      if (celda.tipo !== "sst") continue;
      referencias += 1;
      if (!indiceSst.has(celda.texto)) {
        indiceSst.set(celda.texto, cadenas.length);
        cadenas.push({ texto: celda.texto, utf16: celda.utf16, corridas: celda.corridas, extendido: celda.extendido });
      }
    }
  }

  const globales = (desplazamientos: readonly number[]): Uint8Array =>
    juntar(
      bof(version, 0x0005),
      ...(opciones.filepass ? [registro(REG.FILEPASS, u16(0), u16(1), u16(1), new Uint8Array(48))] : []),
      registro(REG.CODEPAGE, u16(0x04b0)),
      ...hojas.map((hoja, i) => boundsheet(hoja, desplazamientos[i]!)),
      armarSst(cadenas, referencias, opciones.limiteSst ?? 8224),
      registro(REG.EXTSST, u16(8), new Uint8Array(16)),
      registro(REG.EOF),
    );

  // BOUNDSHEET has a fixed size per sheet name, so the globals' length does not depend on the offsets.
  const largoGlobales = globales(hojas.map(() => 0)).length;
  const orden = opciones.ordenFisico ?? hojas.map((_, i) => i);
  const desplazamientos: number[] = hojas.map(() => 0);
  const cuerpos: Uint8Array[] = [];
  let posicion = largoGlobales;
  orden.forEach((indice, lugar) => {
    const cuerpo = subflujoHoja(hojas[indice]!, indiceSst, version, lugar === orden.length - 1 ? (opciones.relleno ?? 0) : 0);
    desplazamientos[indice] = posicion;
    posicion += cuerpo.length;
    cuerpos.push(cuerpo);
  });
  return juntar(globales(desplazamientos), ...cuerpos);
}

// ---------------------------------------------------------------------------
// CFB / OLE2 container
// ---------------------------------------------------------------------------

const FIN_DE_CADENA = 0xfffffffe;
const SECTOR_LIBRE = 0xffffffff;
const SECTOR_FAT = 0xfffffffd;
const SECTOR_DIFAT = 0xfffffffc;
const SIN_ENTRADA = 0xffffffff;

export interface OpcionesCfb {
  /** Name of the stream (`Workbook`, or `Book` for BIFF5). */
  nombre?: string;
  /** 9 = 512 byte sectors (default), 12 = 4096. */
  desplazamientoSector?: 9 | 12;
}

export interface ContenedorCfb {
  bytes: Uint8Array<ArrayBuffer>;
  tamSector: number;
  /** Byte offset inside `bytes` of the FAT entry of `sector` (to corrupt it in a test). */
  offsetEntradaFat(sector: number): number;
  /** Sector where the stream starts in the regular FAT (-1 when it lives in the mini stream). */
  primerSectorFlujo: number;
  idsFat: number[];
}

function entradaDirectorio(nombre: string, tipo: number, hijo: number, inicio: number, tamano: number): Uint8Array {
  const entrada = new Uint8Array(128);
  const vista = new DataView(entrada.buffer);
  [...nombre].forEach((c, i) => vista.setUint16(i * 2, c.charCodeAt(0), true));
  vista.setUint16(64, nombre.length === 0 ? 0 : (nombre.length + 1) * 2, true);
  entrada[66] = tipo;
  entrada[67] = 1; // black
  vista.setUint32(68, SIN_ENTRADA, true); // left sibling
  vista.setUint32(72, SIN_ENTRADA, true); // right sibling
  vista.setUint32(76, hijo, true);
  vista.setUint32(116, inicio, true);
  vista.setUint32(120, tamano, true);
  return entrada;
}

/** Wraps `flujo` in a CFB file. */
export function armarCfb(flujo: Uint8Array, opciones: OpcionesCfb = {}): ContenedorCfb {
  const desplazamiento = opciones.desplazamientoSector ?? 9;
  const tam = 1 << desplazamiento;
  const porSector = tam / 4;
  const mini = flujo.length < 4096;

  const cuenta = (bytes: number, unidad: number) => Math.max(1, Math.ceil(bytes / unidad));
  // Data sectors in id order: [the stream, or the mini stream container] [mini FAT] [directory] [FAT] [DIFAT].
  const cantidadMini = mini ? cuenta(flujo.length, 64) : 0;
  const contenedor = mini ? juntar(flujo, new Uint8Array(cantidadMini * 64 - flujo.length)) : flujo;
  const sectoresDatos = cuenta(contenedor.length, tam);
  const sectoresMiniFat = mini ? cuenta(cantidadMini, porSector) : 0;
  const sectoresDirectorio = 1;
  const otros = sectoresDatos + sectoresMiniFat + sectoresDirectorio;

  // The FAT must also map its own sectors and the DIFAT's: iterate to the fixed point.
  let cantidadFat = 1;
  let cantidadDifat = 0;
  for (;;) {
    cantidadDifat = cantidadFat > 109 ? Math.ceil((cantidadFat - 109) / (porSector - 1)) : 0;
    const necesarios = Math.ceil((otros + cantidadDifat + cantidadFat) / porSector);
    if (necesarios === cantidadFat) break;
    cantidadFat = necesarios;
  }

  const primerDatos = 0;
  const primerMiniFat = primerDatos + sectoresDatos;
  const primerDirectorio = primerMiniFat + sectoresMiniFat;
  const primerFat = primerDirectorio + sectoresDirectorio;
  const primerDifat = primerFat + cantidadFat;
  const total = primerDifat + cantidadDifat;
  const idsFat = Array.from({ length: cantidadFat }, (_, i) => primerFat + i);

  // FAT
  const fat = new Uint32Array(cantidadFat * porSector).fill(SECTOR_LIBRE);
  const encadenar = (inicio: number, cantidad: number) => {
    for (let i = 0; i < cantidad; i++) fat[inicio + i] = i === cantidad - 1 ? FIN_DE_CADENA : inicio + i + 1;
  };
  encadenar(primerDatos, sectoresDatos);
  if (mini) encadenar(primerMiniFat, sectoresMiniFat);
  encadenar(primerDirectorio, sectoresDirectorio);
  idsFat.forEach((id) => (fat[id] = SECTOR_FAT));
  for (let i = 0; i < cantidadDifat; i++) fat[primerDifat + i] = SECTOR_DIFAT;

  // Mini FAT
  const miniFat = new Uint32Array(Math.max(1, sectoresMiniFat) * porSector).fill(SECTOR_LIBRE);
  for (let i = 0; i < cantidadMini; i++) miniFat[i] = i === cantidadMini - 1 ? FIN_DE_CADENA : i + 1;

  // Directory: the root entry and the stream (the rest of the sector is empty entries).
  const nombre = opciones.nombre ?? "Workbook";
  const entradas = [
    entradaDirectorio("Root Entry", 5, 1, mini ? primerDatos : FIN_DE_CADENA, mini ? contenedor.length : 0),
    entradaDirectorio(nombre, 2, SIN_ENTRADA, mini ? 0 : primerDatos, flujo.length),
  ];
  const vacia = entradaDirectorio("", 0, SIN_ENTRADA, 0, 0);
  const directorio = new Uint8Array(tam);
  for (let i = 0; i < tam / 128; i++) directorio.set(entradas[i] ?? vacia, i * 128);

  // Header
  const cabecera = new Uint8Array(tam);
  const vista = new DataView(cabecera.buffer);
  cabecera.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  vista.setUint16(24, 0x003e, true);
  vista.setUint16(26, desplazamiento === 9 ? 3 : 4, true);
  vista.setUint16(28, 0xfffe, true);
  vista.setUint16(30, desplazamiento, true);
  vista.setUint16(32, 6, true);
  vista.setUint32(40, desplazamiento === 9 ? 0 : sectoresDirectorio, true);
  vista.setUint32(44, cantidadFat, true);
  vista.setUint32(48, primerDirectorio, true);
  vista.setUint32(56, 4096, true);
  vista.setUint32(60, mini ? primerMiniFat : FIN_DE_CADENA, true);
  vista.setUint32(64, sectoresMiniFat, true);
  vista.setUint32(68, cantidadDifat > 0 ? primerDifat : FIN_DE_CADENA, true);
  vista.setUint32(72, cantidadDifat, true);
  for (let i = 0; i < 109; i++) vista.setUint32(76 + i * 4, idsFat[i] ?? SECTOR_LIBRE, true);

  // DIFAT sectors: the FAT ids beyond the header's 109, `porSector - 1` per sector and the link to the next one.
  const sectoresDifat: Uint8Array[] = [];
  for (let d = 0; d < cantidadDifat; d++) {
    const sector = new Uint8Array(tam);
    const v = new DataView(sector.buffer);
    for (let i = 0; i < porSector - 1; i++) v.setUint32(i * 4, idsFat[109 + d * (porSector - 1) + i] ?? SECTOR_LIBRE, true);
    v.setUint32((porSector - 1) * 4, d === cantidadDifat - 1 ? FIN_DE_CADENA : primerDifat + d + 1, true);
    sectoresDifat.push(sector);
  }

  const relleno = new Uint8Array(sectoresDatos * tam - contenedor.length);
  const bytes = juntar(
    cabecera,
    contenedor,
    relleno,
    ...(mini ? [new Uint8Array(miniFat.buffer)] : []),
    directorio,
    new Uint8Array(fat.buffer),
    ...sectoresDifat,
  );
  if (bytes.length !== (total + 1) * tam) throw new Error(`CFB layout mismatch: ${bytes.length} vs ${(total + 1) * tam}`);

  return {
    bytes,
    tamSector: tam,
    primerSectorFlujo: mini ? -1 : primerDatos,
    idsFat,
    offsetEntradaFat: (sector) => (idsFat[Math.floor(sector / porSector)]! + 1) * tam + (sector % porSector) * 4,
  };
}

/** A complete `.xls`: BIFF8 stream inside a CFB container. */
export function armarXls(opciones: OpcionesFlujo, cfb: OpcionesCfb = {}): Uint8Array<ArrayBuffer> {
  return armarCfb(armarFlujoBiff8(opciones), cfb).bytes;
}
