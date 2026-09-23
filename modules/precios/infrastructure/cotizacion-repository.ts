/**
 * Prisma-backed access for M10 FASE 7.4 (`calcularCotizacion` and its
 * reads). Every function runs inside an ALREADY OPEN tenant transaction
 * (`tx`) -- same convention as every other repository in this codebase.
 *
 * Deliberately does NOT import modules/stock/infrastructure/partida-repository.ts
 * (a module reads through its OWN infrastructure layer, never another
 * module's -- see modules/stock/infrastructure/partida-repository.ts's
 * `getDiasAlertaVencimiento` doc comment for the same rule stated from the
 * other side). `getPartidasElegiblesDeDroga` below is a plain read-only
 * query against the SAME `fsj.partida` table (shared schema, not shared
 * module code) -- it never locks (`FOR UPDATE`) anything, matching INV-R02:
 * calculating a cotizacion reserves nothing.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { PartidaCosteo } from "../domain/calcular-cotizacion";

// ============================================================================
// jornada (own copy -- see module doc comment).
// ============================================================================
export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

// ============================================================================
// item_receta + su ULTIMA ficha_tecnica (por version) con lineas
// ============================================================================

export interface ItemParaCotizar {
  id: string;
  recetaId: string;
  descripcion: string | null;
  formaFarmaceutica: string;
}

export async function getItemParaCotizar(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<ItemParaCotizar | null> {
  const row = await tx.itemReceta.findUnique({
    where: { id: itemRecetaId, tenantId },
    select: { id: true, recetaId: true, descripcion: true, formaFarmaceutica: true },
  });
  return row;
}

export interface LineaParaCostear {
  drogaId: string;
  drogaNombre: string;
  unidadSimbolo: string;
  cantidadAPesar: string | null;
  esEnraseManual: boolean;
  orden: number;
}

export interface UltimaFicha {
  fichaTecnicaId: string;
  version: number;
  lineas: LineaParaCostear[];
}

/** The item's ficha_tecnica with the HIGHEST `version` (INV-R05/INV-R06-adjacent: cotizar always costs the LATEST ficha, task instruction). `null` when the item has no ficha at all. */
export async function getUltimaFichaConLineas(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<UltimaFicha | null> {
  const ficha = await tx.fichaTecnica.findFirst({
    where: { tenantId, itemRecetaId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      lineas: {
        orderBy: { orden: "asc" },
        select: {
          drogaId: true,
          drogaNombre: true,
          cantidadAPesar: true,
          esEnraseManual: true,
          orden: true,
          unidadMedida: { select: { simbolo: true } },
        },
      },
    },
  });
  if (!ficha) return null;

  return {
    fichaTecnicaId: ficha.id,
    version: ficha.version,
    lineas: ficha.lineas.map((l) => ({
      drogaId: l.drogaId,
      drogaNombre: l.drogaNombre,
      unidadSimbolo: l.unidadMedida.simbolo,
      cantidadAPesar: l.cantidadAPesar ? l.cantidadAPesar.toString() : null,
      esEnraseManual: l.esEnraseManual,
      orden: l.orden,
    })),
  };
}

// ============================================================================
// Partidas elegibles para costeo (read-only, NUNCA FOR UPDATE -- INV-R02)
// ============================================================================

/**
 * Every partida of `drogaId` with `cantidad_disponible > 0` -- expiry is
 * NOT filtered here (left to `calcularCotizacion`'s own eligibility check,
 * which needs `jornadaActual` anyway; see that module's doc comment).
 * Plain `SELECT`, no lock: this function must never take `FOR UPDATE`
 * (INV-R02 -- a cotizacion reserves nothing).
 */
export async function getPartidasElegiblesDeDroga(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<PartidaCosteo[]> {
  const rows = await tx.partida.findMany({
    where: { tenantId, drogaId, cantidadDisponible: { gt: 0 } },
    select: { id: true, cantidadDisponible: true, fechaVencimiento: true, fechaApertura: true, costoUnitario: true },
  });
  return rows.map((p) => ({
    id: p.id,
    cantidadDisponible: p.cantidadDisponible.toString(),
    fechaVencimiento: p.fechaVencimiento.toISOString().slice(0, 10),
    fechaApertura: p.fechaApertura ? p.fechaApertura.toISOString() : null,
    costoUnitario: p.costoUnitario.toString(),
  }));
}

// ============================================================================
// cotizacion: insert + reads (insert-only table -- migration 0031)
// ============================================================================

export interface NuevaCotizacionInput {
  tenantId: string;
  itemRecetaId: string;
  costoInsumos: string;
  margenAplicado: string;
  precioFinal: string;
  reglaPrecioId: string;
  esParcial: boolean;
  esIncompleta: boolean;
  detalle: Prisma.InputJsonValue;
  calculadaPorId: string;
}

export async function insertCotizacion(tx: Prisma.TransactionClient, input: NuevaCotizacionInput): Promise<{ id: string; calculadaEn: Date }> {
  const row = await tx.cotizacion.create({
    data: {
      tenantId: input.tenantId,
      itemRecetaId: input.itemRecetaId,
      costoInsumos: input.costoInsumos,
      margenAplicado: input.margenAplicado,
      precioFinal: input.precioFinal,
      reglaPrecioId: input.reglaPrecioId,
      esParcial: input.esParcial,
      esIncompleta: input.esIncompleta,
      detalle: input.detalle,
      calculadaPorId: input.calculadaPorId,
    },
    select: { id: true, calculadaEn: true },
  });
  return row;
}

export interface CotizacionItem {
  id: string;
  costoInsumos: string;
  margenAplicado: string;
  precioFinal: string;
  esParcial: boolean;
  esIncompleta: boolean;
  detalle: unknown;
  calculadaEn: Date;
  calculadaPorNombre: string;
  calculadaPorApellido: string;
}

const COTIZACION_SELECT = {
  id: true,
  costoInsumos: true,
  margenAplicado: true,
  precioFinal: true,
  esParcial: true,
  esIncompleta: true,
  detalle: true,
  calculadaEn: true,
  calculadaPor: { select: { nombre: true, apellido: true } },
} as const;

function mapCotizacion(row: {
  id: string;
  costoInsumos: Prisma.Decimal;
  margenAplicado: Prisma.Decimal;
  precioFinal: Prisma.Decimal;
  esParcial: boolean;
  esIncompleta: boolean;
  detalle: unknown;
  calculadaEn: Date;
  calculadaPor: { nombre: string; apellido: string };
}): CotizacionItem {
  return {
    id: row.id,
    costoInsumos: row.costoInsumos.toString(),
    margenAplicado: row.margenAplicado.toString(),
    precioFinal: row.precioFinal.toString(),
    esParcial: row.esParcial,
    esIncompleta: row.esIncompleta,
    detalle: row.detalle,
    calculadaEn: row.calculadaEn,
    calculadaPorNombre: row.calculadaPor.nombre,
    calculadaPorApellido: row.calculadaPor.apellido,
  };
}

/** INV-R06: "vigente" = highest `calculadaEn` for the item. `null` when the item was never cotizado. */
export async function getCotizacionVigente(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<CotizacionItem | null> {
  const row = await tx.cotizacion.findFirst({
    where: { tenantId, itemRecetaId },
    orderBy: { calculadaEn: "desc" },
    select: COTIZACION_SELECT,
  });
  return row ? mapCotizacion(row) : null;
}

/** Full history, most recent first -- previous cotizaciones are NEVER deleted (INV-R06). */
export async function listHistorialCotizaciones(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<CotizacionItem[]> {
  const rows = await tx.cotizacion.findMany({
    where: { tenantId, itemRecetaId },
    orderBy: { calculadaEn: "desc" },
    select: COTIZACION_SELECT,
  });
  return rows.map(mapCotizacion);
}
