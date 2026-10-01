/**
 * Prisma-backed access to `fsj.regla_precio` and its tramos
 * (`fsj.regla_precio_tramo`, migration 0052) for M08 (FASE 4 point 4.6).
 * Every function runs inside an ALREADY OPEN tenant transaction (`tx`) --
 * same convention as every other repository in this codebase (e.g.
 * modules/stock/infrastructure/partida-repository.ts).
 *
 * VERSIONING (INV-PR-001): `lockReglaAbierta` takes a `SELECT ... FOR
 * UPDATE` on the currently open row (if any) BEFORE the caller decides
 * whether to close it -- same "lock the row, THEN decide from a fresh
 * read" discipline as modules/stock/infrastructure/partida-repository.ts's
 * `lockPartidaParaAccion`. Two concurrent `guardarReglaPrecio` calls
 * serialize on this lock; the second one's `lockReglaAbierta` blocks until
 * the first commits (closing the row it just locked) or rolls back.
 */
import type { Prisma } from "@/generated/prisma/client";

/** One tramo as stored (decimal strings; `costoHasta` null only on the last). Ordered by `orden` wherever returned. */
export interface TramoGuardado {
  costoHasta: string | null;
  margen: string;
}

const TRAMOS_SELECT = { orderBy: { orden: "asc" }, select: { costoHasta: true, margen: true } } as const;

function mapTramos(rows: { costoHasta: Prisma.Decimal | null; margen: Prisma.Decimal }[]): TramoGuardado[] {
  return rows.map((t) => ({ costoHasta: t.costoHasta === null ? null : t.costoHasta.toString(), margen: t.margen.toString() }));
}

export interface ReglaAbierta {
  id: string;
  precioMinimo: string;
  tramos: TramoGuardado[];
  vigenteDesde: Date;
}

/** Locks the tenant's OPEN regla_precio row (`vigente_hasta IS NULL`), if any, and reads its tramos. Returns `null` when there is none (first-ever regla for this tenant). */
export async function lockReglaAbierta(tx: Prisma.TransactionClient, tenantId: string): Promise<ReglaAbierta | null> {
  const rows = await tx.$queryRaw<{ id: string; precio_minimo: string; vigente_desde: Date }[]>`
    SELECT id, precio_minimo::text, vigente_desde
    FROM fsj.regla_precio
    WHERE tenant_id = ${tenantId}::uuid AND vigente_hasta IS NULL
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  // Tramos are immutable (forbid_update_delete), so no lock is needed on them.
  const tramos = await tx.reglaPrecioTramo.findMany({ where: { tenantId, reglaPrecioId: row.id }, ...TRAMOS_SELECT });
  return { id: row.id, precioMinimo: row.precio_minimo, tramos: mapTramos(tramos), vigenteDesde: row.vigente_desde };
}

/** Server-side "now" (`SELECT now()`), used as BOTH the closed row's `vigente_hasta` and the new row's `vigente_desde` -- one instant, no gap or overlap between versions (INV-PL-002: fecha de negocio, del servidor, nunca del cliente). */
export async function ahoraServidor(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ ahora: Date }[]>`SELECT now() AS ahora`;
  if (!rows[0]) throw new Error("ahoraServidor: SELECT now() returned no row");
  return rows[0].ahora;
}

/** Closes the currently open regla_precio row (INV-PR-001's ONLY allowed write after insert). MUST be called with the SAME `id` `lockReglaAbierta` just returned, inside the SAME transaction. */
export async function cerrarReglaAbierta(tx: Prisma.TransactionClient, tenantId: string, id: string, vigenteHasta: Date): Promise<void> {
  await tx.reglaPrecio.update({
    where: { id, tenantId },
    data: { vigenteHasta },
  });
}

export interface NuevaReglaPrecioInput {
  tenantId: string;
  precioMinimo: string;
  /** Already validated (domain/regla-precio.ts#validarReglasPrecio), in order. */
  tramos: readonly TramoGuardado[];
  vigenteDesde: Date;
  creadoPorId: string;
}

/**
 * Inserts the header (deprecated `margen` left NULL -- migration 0052) and
 * its tramos (`orden` 1..n, in the given order). The DB re-checks the set
 * at COMMIT (INV-PR-002), so this must run inside the caller's transaction.
 */
export async function insertReglaPrecio(
  tx: Prisma.TransactionClient,
  input: NuevaReglaPrecioInput,
): Promise<{ id: string; precioMinimo: string; tramos: TramoGuardado[]; vigenteDesde: Date }> {
  const row = await tx.reglaPrecio.create({
    data: {
      tenantId: input.tenantId,
      precioMinimo: input.precioMinimo,
      vigenteDesde: input.vigenteDesde,
      creadoPorId: input.creadoPorId,
    },
    select: { id: true, precioMinimo: true, vigenteDesde: true },
  });
  await tx.reglaPrecioTramo.createMany({
    data: input.tramos.map((t, i) => ({
      tenantId: input.tenantId,
      reglaPrecioId: row.id,
      orden: i + 1,
      costoHasta: t.costoHasta,
      margen: t.margen,
    })),
  });
  const tramos = await tx.reglaPrecioTramo.findMany({ where: { tenantId: input.tenantId, reglaPrecioId: row.id }, ...TRAMOS_SELECT });
  return { id: row.id, precioMinimo: row.precioMinimo.toString(), tramos: mapTramos(tramos), vigenteDesde: row.vigenteDesde };
}

export interface ReglaVigente {
  id: string;
  precioMinimo: string;
  tramos: TramoGuardado[];
  vigenteDesde: Date;
  creadoPorNombre: string;
  creadoPorApellido: string;
}

/** The tenant's currently open regla_precio (`vigente_hasta IS NULL`) with its tramos -- read-only, no lock. `null` when none exists yet (a tenant may cotizar only once ADM/DT configures the rules). */
export async function getReglaVigente(tx: Prisma.TransactionClient, tenantId: string): Promise<ReglaVigente | null> {
  const row = await tx.reglaPrecio.findFirst({
    where: { tenantId, vigenteHasta: null },
    select: {
      id: true,
      precioMinimo: true,
      vigenteDesde: true,
      creadoPor: { select: { nombre: true, apellido: true } },
      tramos: TRAMOS_SELECT,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    precioMinimo: row.precioMinimo.toString(),
    tramos: mapTramos(row.tramos),
    vigenteDesde: row.vigenteDesde,
    creadoPorNombre: row.creadoPor.nombre,
    creadoPorApellido: row.creadoPor.apellido,
  };
}

export interface ReglaHistorialItem {
  id: string;
  precioMinimo: string;
  tramos: TramoGuardado[];
  vigenteDesde: Date;
  vigenteHasta: Date | null;
  creadoPorNombre: string;
  creadoPorApellido: string;
}

/** Full version history with each version's tramos, most recent first. */
export async function listHistorialReglas(tx: Prisma.TransactionClient, tenantId: string): Promise<ReglaHistorialItem[]> {
  const rows = await tx.reglaPrecio.findMany({
    where: { tenantId },
    orderBy: { vigenteDesde: "desc" },
    select: {
      id: true,
      precioMinimo: true,
      vigenteDesde: true,
      vigenteHasta: true,
      creadoPor: { select: { nombre: true, apellido: true } },
      tramos: TRAMOS_SELECT,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    precioMinimo: row.precioMinimo.toString(),
    tramos: mapTramos(row.tramos),
    vigenteDesde: row.vigenteDesde,
    vigenteHasta: row.vigenteHasta,
    creadoPorNombre: row.creadoPor.nombre,
    creadoPorApellido: row.creadoPor.apellido,
  }));
}
