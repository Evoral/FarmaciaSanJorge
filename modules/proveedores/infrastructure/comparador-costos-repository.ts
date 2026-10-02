/**
 * Prisma-backed reads for the "Comparador de costos"
 * (docs/specs/comparador-costos.md). Every function runs inside an ALREADY
 * OPEN tenant transaction (RLS-scoped) and filters by `tenantId` explicitly
 * as well (raw SQL included). Queries run sequentially: they share one
 * interactive transaction (one connection).
 *
 * Read pattern for one droga (constant number of statements, no N+1):
 *   1. the tenant's zona horaria and jornada actual (same sources as the
 *      Trayectoria: `fsj.jornada_actual`),
 *   2. the droga (with its unidad base) and the global unit catalog of its
 *      magnitude,
 *   3. ONE droga-level statistic over the partidas with cost > 0 of the
 *      period: how many and their median (`percentile_disc(0.5)`, exact
 *      numeric). The outlier band (x10 / x0.1, >= 3 partidas) is decided by
 *      the DOMAIN from that median and handed back to SQL as two bounds,
 *   4. ONE aggregate per proveedor (counts, sums, min/max, outlier count,
 *      and the latest cost with `DISTINCT ON`),
 *   5. ONE batched query for the expandable detail: `unnest(proveedor ids)
 *      CROSS JOIN LATERAL (... LIMIT 50)`, so a proveedor with thousands of
 *      partidas costs the same as one with three (the total comes from 4).
 *
 * Numeric columns are cast to `text` in SQL and only ever travel as strings
 * (same discipline as modules/stock/infrastructure/valorizado-repository.ts);
 * sums and products are Postgres `numeric`, never JS floats (INV-PL-003).
 *
 * EXPLICIT SELECTS EVERYWHERE: `schema.prisma` still declares receta columns
 * the shared database dropped, so there is no bare `findMany`, no `include`,
 * and nothing here reaches `receta`, `item_receta` or `paciente` (a purchase
 * cost has nothing to do with them). `fsj.unidad_medida` is the GLOBAL unit
 * catalog (no `tenant_id`, no RLS), read without a tenant filter like
 * modules/unidades/infrastructure/unidad-repository.ts; reading it here
 * (instead of calling the unidades use case, gated on `stock.ver`) keeps this
 * query a single `defineQuery` with no nested permission checks.
 */
import type { Prisma } from "@/generated/prisma/client";
import { PARTIDAS_DETALLE_MAX, inicioPeriodo, limitesAtipicos } from "../domain/comparador-costos";
import type {
  AgregadoProveedorCrudo,
  ComparacionCruda,
  DrogaOpcionCruda,
  PartidaComparadorCruda,
  PeriodoComparador,
} from "../domain/comparador-costos";
import { readJornadaActual } from "./trayectoria-repository";

/**
 * Drogas of the tenant with at least ONE partida (any proveedor, any date),
 * by name: the options of the "Droga" select. Dadas de baja are included (the
 * domain sorts them after the vigentes); explicit select, no relation loaded.
 */
export async function readDrogasConPartidas(tx: Prisma.TransactionClient, tenantId: string): Promise<DrogaOpcionCruda[]> {
  return tx.droga.findMany({
    where: { tenantId, partidas: { some: { tenantId } } },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
    select: { id: true, nombre: true, fechaBaja: true },
  });
}

/** One droga of the tenant that has partidas, with its unidad base; `null` when it is not the tenant's or has no partida. */
async function readDrogaSeleccionada(tx: Prisma.TransactionClient, tenantId: string, drogaId: string) {
  return tx.droga.findFirst({
    where: { id: drogaId, tenantId, partidas: { some: { tenantId } } },
    select: {
      id: true,
      nombre: true,
      fechaBaja: true,
      unidadBase: { select: { id: true, codigo: true, simbolo: true, tipoMagnitud: true, factorABase: true, esBase: true, fechaBaja: true } },
    },
  });
}

/** The global unit catalog of ONE magnitude (a handful of rows), explicit select. */
async function readUnidadesDeMagnitud(tx: Prisma.TransactionClient, tipoMagnitud: Prisma.UnidadMedidaWhereInput["tipoMagnitud"]) {
  return tx.unidadMedida.findMany({
    where: { tipoMagnitud },
    orderBy: [{ factorABase: "asc" }, { codigo: "asc" }],
    select: { id: true, codigo: true, simbolo: true, tipoMagnitud: true, factorABase: true, esBase: true, fechaBaja: true },
  });
}

/**
 * Partidas of the droga with cost > 0 in the period (all proveedores): the
 * count and the median cost per unidad base. `percentile_disc` keeps the
 * result an exact `numeric` (it picks an existing value; for an even count the
 * lower middle one). The median is `null` without partidas.
 */
export async function readEstadisticaDroga(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  inicio: Date | null,
): Promise<{ partidasConCosto: number; mediana: string | null }> {
  const rows = await tx.$queryRaw<{ partidas_con_costo: number; mediana: string | null }[]>`
    SELECT
      count(*)::int AS partidas_con_costo,
      (percentile_disc(0.5) WITHIN GROUP (ORDER BY p.costo_unitario))::text AS mediana
    FROM fsj.partida p
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.droga_id = ${drogaId}::uuid
      AND p.costo_unitario > 0
      AND (${inicio}::timestamptz IS NULL OR p.fecha_ingreso >= ${inicio}::timestamptz)
  `;
  const r = rows[0];
  return { partidasConCosto: r?.partidas_con_costo ?? 0, mediana: r?.mediana ?? null };
}

/**
 * ONE aggregate per proveedor over the droga's partidas in the period.
 * Cost-0 partidas are counted but excluded from every metric (`FILTER (WHERE
 * costo_unitario > 0)`). The latest cost / purchase come from a `DISTINCT ON`
 * over the costed partidas, newest first (`fecha_ingreso DESC, id DESC`).
 * `limiteMinimo` / `limiteMaximo` are the outlier band computed by the domain
 * (`null` = flag nothing); SQL only counts the partidas outside it.
 */
export async function readAgregadosPorProveedor(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  inicio: Date | null,
  limiteMinimo: string | null,
  limiteMaximo: string | null,
): Promise<AgregadoProveedorCrudo[]> {
  const rows = await tx.$queryRaw<
    {
      proveedor_id: string;
      razon_social: string;
      fecha_baja: Date | null;
      partidas_total: number;
      partidas_con_costo: number;
      partidas_costo_cero: number;
      partidas_atipicas: number;
      cantidad_con_costo: string;
      importe_con_costo: string;
      costo_min: string | null;
      costo_max: string | null;
      ultimo_costo: string | null;
      ultima_compra: Date | null;
    }[]
  >`
    WITH base AS (
      SELECT p.id, p.proveedor_id, p.costo_unitario, p.cantidad_inicial, p.fecha_ingreso
      FROM fsj.partida p
      WHERE p.tenant_id = ${tenantId}::uuid
        AND p.droga_id = ${drogaId}::uuid
        AND (${inicio}::timestamptz IS NULL OR p.fecha_ingreso >= ${inicio}::timestamptz)
    ),
    ultimo AS (
      SELECT DISTINCT ON (b.proveedor_id) b.proveedor_id, b.costo_unitario::text AS ultimo_costo, b.fecha_ingreso AS ultima_compra
      FROM base b
      WHERE b.costo_unitario > 0
      ORDER BY b.proveedor_id, b.fecha_ingreso DESC, b.id DESC
    ),
    agregado AS (
      SELECT
        b.proveedor_id,
        count(*)::int AS partidas_total,
        (count(*) FILTER (WHERE b.costo_unitario > 0))::int AS partidas_con_costo,
        (count(*) FILTER (WHERE b.costo_unitario = 0))::int AS partidas_costo_cero,
        (count(*) FILTER (
          WHERE b.costo_unitario > 0
            AND ((${limiteMaximo}::numeric IS NOT NULL AND b.costo_unitario > ${limiteMaximo}::numeric)
              OR (${limiteMinimo}::numeric IS NOT NULL AND b.costo_unitario < ${limiteMinimo}::numeric))
        ))::int AS partidas_atipicas,
        coalesce(sum(b.cantidad_inicial) FILTER (WHERE b.costo_unitario > 0), 0)::text AS cantidad_con_costo,
        coalesce(sum(b.cantidad_inicial * b.costo_unitario) FILTER (WHERE b.costo_unitario > 0), 0)::text AS importe_con_costo,
        (min(b.costo_unitario) FILTER (WHERE b.costo_unitario > 0))::text AS costo_min,
        (max(b.costo_unitario) FILTER (WHERE b.costo_unitario > 0))::text AS costo_max
      FROM base b
      GROUP BY b.proveedor_id
    )
    SELECT
      pr.id AS proveedor_id,
      pr.razon_social,
      pr.fecha_baja,
      a.partidas_total,
      a.partidas_con_costo,
      a.partidas_costo_cero,
      a.partidas_atipicas,
      a.cantidad_con_costo,
      a.importe_con_costo,
      a.costo_min,
      a.costo_max,
      u.ultimo_costo,
      u.ultima_compra
    FROM agregado a
    JOIN fsj.proveedor pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = a.proveedor_id
    LEFT JOIN ultimo u ON u.proveedor_id = a.proveedor_id
    ORDER BY pr.razon_social ASC, pr.id ASC
  `;
  return rows.map((r) => ({
    proveedorId: r.proveedor_id,
    razonSocial: r.razon_social,
    fechaBaja: r.fecha_baja,
    partidasTotal: r.partidas_total,
    partidasConCosto: r.partidas_con_costo,
    partidasCostoCero: r.partidas_costo_cero,
    partidasAtipicas: r.partidas_atipicas,
    cantidadConCosto: r.cantidad_con_costo,
    importeConCosto: r.importe_con_costo,
    costoMin: r.costo_min,
    costoMax: r.costo_max,
    ultimoCosto: r.ultimo_costo,
    ultimaCompra: r.ultima_compra,
  }));
}

/**
 * The latest `PARTIDAS_DETALLE_MAX` partidas of EACH proveedor (the droga in
 * the period), in ONE statement: `unnest(proveedor ids) CROSS JOIN LATERAL
 * (... ORDER BY fecha_ingreso DESC, id DESC LIMIT n)`, so the result is bounded
 * per proveedor. Access path: `idx_partida_tenant_droga` is only (tenant_id,
 * droga_id); for the per-proveedor lookup the planner will most likely use the
 * unique (tenant_id, droga_id, proveedor_id, lote) index and sort that
 * proveedor's partidas of the droga by fecha_ingreso (a small set). No
 * dedicated index is needed. Only id, lote, fecha, cantidad inicial and costo
 * are read.
 */
export async function readPartidasPorProveedor(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  inicio: Date | null,
  proveedorIds: string[],
): Promise<PartidaComparadorCruda[]> {
  if (proveedorIds.length === 0) return [];
  const rows = await tx.$queryRaw<
    { id: string; proveedor_id: string; lote: string; fecha_ingreso: Date; cantidad_inicial: string; costo_unitario: string }[]
  >`
    SELECT d.id, d.proveedor_id, d.lote, d.fecha_ingreso, d.cantidad_inicial, d.costo_unitario
    FROM unnest(${proveedorIds}::uuid[]) AS pv(id)
    CROSS JOIN LATERAL (
      SELECT
        p.id,
        p.proveedor_id,
        p.lote,
        p.fecha_ingreso,
        p.cantidad_inicial::text AS cantidad_inicial,
        p.costo_unitario::text AS costo_unitario
      FROM fsj.partida p
      WHERE p.tenant_id = ${tenantId}::uuid
        AND p.droga_id = ${drogaId}::uuid
        AND p.proveedor_id = pv.id
        AND (${inicio}::timestamptz IS NULL OR p.fecha_ingreso >= ${inicio}::timestamptz)
      ORDER BY p.fecha_ingreso DESC, p.id DESC
      LIMIT ${PARTIDAS_DETALLE_MAX}::int
    ) d
    ORDER BY d.proveedor_id, d.fecha_ingreso DESC, d.id DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    proveedorId: r.proveedor_id,
    lote: r.lote,
    fechaIngreso: r.fecha_ingreso,
    cantidadInicial: r.cantidad_inicial,
    costoUnitario: r.costo_unitario,
  }));
}

/**
 * The raw comparison of one droga for the periodo. `null` when the droga is
 * not one of the tenant's drogas with partidas (an unknown, foreign or
 * partida-less id is never trusted). A droga with partidas but none in the
 * period comes back with empty `agregados`.
 */
export async function getComparacionCruda(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  periodo: PeriodoComparador,
): Promise<ComparacionCruda | null> {
  const droga = await readDrogaSeleccionada(tx, tenantId, drogaId);
  if (!droga) return null;

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  const jornada = await readJornadaActual(tx, tenantId);
  const inicio = inicioPeriodo(periodo, jornada, tenant.zonaHoraria);

  const unidades = await readUnidadesDeMagnitud(tx, droga.unidadBase.tipoMagnitud);
  const aFormato = (u: { id: string; codigo: string; simbolo: string; tipoMagnitud: string; factorABase: { toString(): string }; esBase: boolean; fechaBaja: Date | null }) => ({
    id: u.id,
    codigo: u.codigo,
    simbolo: u.simbolo,
    tipoMagnitud: u.tipoMagnitud,
    factorABase: u.factorABase.toString(),
    esBase: u.esBase,
    vigente: u.fechaBaja === null,
  });

  const estadistica = await readEstadisticaDroga(tx, tenantId, drogaId, inicio);
  const limites = limitesAtipicos(estadistica.mediana, estadistica.partidasConCosto);
  const agregados = await readAgregadosPorProveedor(tx, tenantId, drogaId, inicio, limites?.minimo ?? null, limites?.maximo ?? null);
  const partidas = await readPartidasPorProveedor(
    tx,
    tenantId,
    drogaId,
    inicio,
    agregados.map((a) => a.proveedorId),
  );

  return {
    droga: { id: droga.id, nombre: droga.nombre, deBaja: droga.fechaBaja !== null },
    unidadBase: aFormato(droga.unidadBase),
    unidadesCatalogo: unidades.map(aFormato),
    periodo,
    jornada,
    zonaHoraria: tenant.zonaHoraria,
    inicio,
    limites,
    partidasConCosto: estadistica.partidasConCosto,
    agregados,
    partidas,
  };
}
