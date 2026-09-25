/**
 * Prisma-backed access to the stock valorizado report (FASE 13 point
 * 13.2). Per-partida rows AND the per-droga/grand-total aggregates are all
 * computed in SQL with Postgres `numeric` (never summed/multiplied in JS
 * as a float) -- `p.cantidad_disponible * p.costo_unitario`, cast to
 * `text` before crossing into JS, same "numeric columns cast to text in
 * the query itself" discipline as `modules/stock/infrastructure/partida-repository.ts`.
 *
 * "Vencidas" excludes/includes against the TENANT's own jornada
 * (`fsj.jornada_actual`, migration 0018/0025's fix), never `CURRENT_DATE`
 * or a JS `Date` default -- see this file's gotcha comment on `jornadaActualTenant`.
 */
import type { Prisma } from "@/generated/prisma/client";

export interface ValorizadoFilter {
  tenantId: string;
  /** Droga name substring (ILIKE), same UX as `listStockDrogas`'s `search` -- not a raw droga id input in the UI. */
  search?: string;
  /** `false` excludes partidas whose `fecha_vencimiento` is before the tenant's current jornada. */
  incluirVencidas: boolean;
  /** `true` restricts to partidas with `cantidad_disponible > 0`. */
  soloConSaldo: boolean;
}

export interface ValorizadoItem {
  partidaId: string;
  drogaId: string;
  drogaNombre: string;
  lote: string;
  fechaVencimiento: string; // YYYY-MM-DD
  cantidadDisponible: string;
  unidadSimbolo: string;
  costoUnitario: string;
  /** `cantidad_disponible * costo_unitario`, computed in SQL -- see module doc comment. */
  valor: string;
}

export interface ValorizadoSubtotal {
  drogaId: string;
  drogaNombre: string;
  valorSubtotal: string;
}

export interface ListValorizadoResult {
  items: ValorizadoItem[];
  total: number;
  page: number;
  pageSize: number;
}

function toItem(row: {
  partida_id: string;
  droga_id: string;
  droga_nombre: string;
  lote: string;
  fecha_vencimiento: Date;
  cantidad_disponible: string;
  unidad_simbolo: string;
  costo_unitario: string;
  valor: string;
}): ValorizadoItem {
  return {
    partidaId: row.partida_id,
    drogaId: row.droga_id,
    drogaNombre: row.droga_nombre,
    lote: row.lote,
    fechaVencimiento: row.fecha_vencimiento.toISOString().slice(0, 10),
    cantidadDisponible: row.cantidad_disponible,
    unidadSimbolo: row.unidad_simbolo,
    costoUnitario: row.costo_unitario,
    valor: row.valor,
  };
}

export async function listValorizado(
  tx: Prisma.TransactionClient,
  filter: ValorizadoFilter,
  page: number,
  pageSize: number,
): Promise<ListValorizadoResult> {
  const search = filter.search?.trim() || null;
  const skip = (page - 1) * pageSize;

  const rows = await tx.$queryRaw<
    {
      partida_id: string;
      droga_id: string;
      droga_nombre: string;
      lote: string;
      fecha_vencimiento: Date;
      cantidad_disponible: string;
      unidad_simbolo: string;
      costo_unitario: string;
      valor: string;
    }[]
  >`
    SELECT
      p.id AS partida_id,
      d.id AS droga_id,
      d.nombre AS droga_nombre,
      p.lote,
      p.fecha_vencimiento,
      p.cantidad_disponible::text AS cantidad_disponible,
      u.simbolo AS unidad_simbolo,
      p.costo_unitario::text AS costo_unitario,
      (p.cantidad_disponible * p.costo_unitario)::text AS valor
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    WHERE p.tenant_id = ${filter.tenantId}::uuid
      AND (${search}::text IS NULL OR d.nombre ILIKE '%' || ${search}::text || '%')
      AND (${filter.incluirVencidas} OR p.fecha_vencimiento >= fsj.jornada_actual(${filter.tenantId}::uuid))
      AND (NOT ${filter.soloConSaldo} OR p.cantidad_disponible > 0)
    ORDER BY d.nombre ASC, p.fecha_vencimiento ASC, p.lote ASC
    LIMIT ${pageSize} OFFSET ${skip}
  `;

  const totalRows = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT count(*)::bigint AS total
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    WHERE p.tenant_id = ${filter.tenantId}::uuid
      AND (${search}::text IS NULL OR d.nombre ILIKE '%' || ${search}::text || '%')
      AND (${filter.incluirVencidas} OR p.fecha_vencimiento >= fsj.jornada_actual(${filter.tenantId}::uuid))
      AND (NOT ${filter.soloConSaldo} OR p.cantidad_disponible > 0)
  `;

  return { items: rows.map(toItem), total: Number(totalRows[0]?.total ?? BigInt(0)), page, pageSize };
}

/** Per-droga subtotal over the WHOLE filtered set (never just the current page) -- SQL `SUM`, numeric end to end. */
export async function subtotalesValorizado(tx: Prisma.TransactionClient, filter: ValorizadoFilter): Promise<ValorizadoSubtotal[]> {
  const search = filter.search?.trim() || null;

  const rows = await tx.$queryRaw<{ droga_id: string; droga_nombre: string; valor_subtotal: string }[]>`
    SELECT
      d.id AS droga_id,
      d.nombre AS droga_nombre,
      coalesce(sum(p.cantidad_disponible * p.costo_unitario), 0)::text AS valor_subtotal
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    WHERE p.tenant_id = ${filter.tenantId}::uuid
      AND (${search}::text IS NULL OR d.nombre ILIKE '%' || ${search}::text || '%')
      AND (${filter.incluirVencidas} OR p.fecha_vencimiento >= fsj.jornada_actual(${filter.tenantId}::uuid))
      AND (NOT ${filter.soloConSaldo} OR p.cantidad_disponible > 0)
    GROUP BY d.id, d.nombre
    ORDER BY d.nombre ASC
  `;

  return rows.map((row) => ({ drogaId: row.droga_id, drogaNombre: row.droga_nombre, valorSubtotal: row.valor_subtotal }));
}

/**
 * Walks every matching row in pages (export path -- same "async generator,
 * capped by the caller" shape as `modules/libro/infrastructure/asiento-repository.ts#iterarAsientosParaExportar`).
 */
export async function* iterarValorizadoParaExportar(
  tx: Prisma.TransactionClient,
  filter: ValorizadoFilter,
  pageSize: number,
): AsyncGenerator<ValorizadoItem[]> {
  let page = 1;
  for (;;) {
    const { items } = await listValorizado(tx, filter, page, pageSize);
    if (items.length === 0) return;
    yield items;
    if (items.length < pageSize) return;
    page += 1;
  }
}
