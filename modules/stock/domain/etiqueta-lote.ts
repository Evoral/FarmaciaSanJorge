/**
 * The etiqueta of an elaborated lot (openspec/changes/lotes-elaborados; user decision 2026-11-02): the frasco on the
 * shelf. Same frame and top band as a preparado's etiqueta (modules/preparaciones/domain/etiqueta.ts); "Rp/" holds the
 * lot's name ("Clonazepam 1:100", edited when elaborating) and the panel its lote code, the lotes de origen of the
 * drugs it consumed (the purchased lot an inspection traces), the elaboration and vencimiento months, the aspecto and
 * the storage note. Pure, no I/O; `modules/preparaciones/infrastructure/etiqueta-pdf.ts#buildEtiquetaLotePdf` lays it out.
 */
import { CONSERVACION_ETIQUETA, textoDeUnaLinea } from "@/modules/preparaciones/domain/etiqueta";

/** One consumed partida of clase DROGA: where the lot's active comes from. */
export interface OrigenEtiquetaLote {
  drogaNombre: string;
  lote: string;
}

export interface DatosEtiquetaLote {
  nombre: string;
  lote: string;
  aspecto: string | null;
  /** The elaboration's jornada, `YYYY-MM-DD`. */
  elaboradoEl: string;
  /** The vencimiento VIGENTE, `YYYY-MM-DD`; `null` = does not expire. */
  fechaVencimiento: string | null;
  origenes: readonly OrigenEtiquetaLote[];
  directorTecnico: { nombre: string; apellido: string; matricula: string } | null;
  tenantDomicilio: string | null;
  tenantTelefonoFijo: string | null;
  tenantTelefonoCelular: string | null;
}

export interface ContenidoEtiquetaLote {
  /** Name already in capitals. `null` prints a blank line. */
  directorTecnico: { nombre: string; matricula: string } | null;
  domicilio: string | null;
  telefonoFijo: string | null;
  celular: string | null;
  nombre: string;
  lote: string;
  /** "L123" for one drug, "Clonazepam L123, Talco L9" for several; `null` when it consumed no drug. */
  origen: string | null;
  /** `MM/AA`. */
  elaborado: string;
  /** `MM/AA`, or "No vence". */
  vence: string;
  aspecto: string | null;
  conservacion: string;
}

/** `2026-06-15` -> `06/26`, as the farmacia's labels read. */
export function mesAnioEtiqueta(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

/** The lotes de origen: just the lote when every one is of the same droga, else each with its droga. */
export function origenEtiquetaLote(origenes: readonly OrigenEtiquetaLote[]): string | null {
  if (origenes.length === 0) return null;
  const unaDroga = new Set(origenes.map((o) => o.drogaNombre)).size === 1;
  return origenes.map((o) => (unaDroga ? o.lote : `${o.drogaNombre} ${o.lote}`)).join(", ");
}

export function armarContenidoEtiquetaLote(datos: DatosEtiquetaLote): ContenidoEtiquetaLote {
  const dt = datos.directorTecnico;
  return {
    directorTecnico: dt ? { nombre: `${dt.nombre} ${dt.apellido}`.toLocaleUpperCase("es-AR"), matricula: dt.matricula } : null,
    domicilio: textoDeUnaLinea(datos.tenantDomicilio),
    telefonoFijo: textoDeUnaLinea(datos.tenantTelefonoFijo),
    celular: textoDeUnaLinea(datos.tenantTelefonoCelular),
    nombre: datos.nombre,
    lote: datos.lote,
    origen: origenEtiquetaLote(datos.origenes),
    elaborado: mesAnioEtiqueta(datos.elaboradoEl),
    vence: datos.fechaVencimiento ? mesAnioEtiqueta(datos.fechaVencimiento) : "No vence",
    aspecto: textoDeUnaLinea(datos.aspecto),
    conservacion: CONSERVACION_ETIQUETA,
  };
}

/** URL of an elaborated lot's etiqueta PDF: the size and the cell of the sheet chosen in the print dialog (hoja-etiquetas R7). */
export function hrefEtiquetaLotePdf(partidaId: string): string {
  return `/api/partidas/${encodeURIComponent(partidaId)}/etiqueta/pdf`;
}
