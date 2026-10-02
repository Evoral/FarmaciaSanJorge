/**
 * Prisma-backed reads for the proveedor "Trayectoria" view
 * (docs/specs/trayectoria-proveedor.md). Every function runs inside an ALREADY
 * OPEN tenant transaction (RLS-scoped) and filters by `tenantId` explicitly as
 * well (raw SQL included). No function passes a free-text field (observación,
 * motivo) to a logger.
 *
 * Read pattern (no N+1, whatever the page size):
 *   1. the proveedor (header fields only),
 *   2. the tenant's zona horaria, jornada actual and
 *      `dias_alerta_vencimiento_partida` -- the SAME sources as the /stock
 *      alerts (`fsj.jornada_actual`, the `parametro` row),
 *   3. ONE aggregate over ALL the proveedor's partidas (counters; money only
 *      with `stock.valorizado.ver`), computed in SQL `numeric`,
 *   4. ONE query for the requested page of partidas (newest first),
 *   5. one batched query per block over the page's partida ids: movimientos
 *      (LATERAL ... LIMIT per partida, so the cost does not grow with a
 *      partida's history, plus a grouped count for the totals), usuarios,
 *      preparaciones (same shape), contralor, cost corrections (filtered in
 *      SQL, capped per partida).
 * The optional blocks are queried ONLY when the caller says the session may
 * see them -- they are not fetched and then hidden. Queries run sequentially:
 * they share one interactive transaction (one connection).
 *
 * EXPLICIT SELECTS EVERYWHERE: `schema.prisma` still declares receta columns
 * the shared database dropped, and this view must never reach `receta` at all
 * (no paciente / receta data: Ley 25.326). So there is no bare `findMany`, no
 * `include`, and the preparaciones are read with an explicit column list that
 * stops at `fsj.preparacion` (never `item_receta`, `receta` or `paciente`).
 *
 * Cross-module reads (`fsj.movimiento_stock`, `fsj.preparacion`,
 * `fsj.asiento_contralor`, `fsj.registro_auditoria`, `fsj.parametro`) go
 * against the shared schema, same convention as
 * modules/pacientes/infrastructure/trayectoria-repository.ts: a module does
 * not import another module's infrastructure layer. Stock is NEVER summed in
 * application code (see modules/stock/infrastructure/partida-repository.ts):
 * counters and money are SQL aggregates.
 */
import type { Prisma } from "@/generated/prisma/client";
import {
  CORRECCIONES_POR_PARTIDA_MAX,
  MOVIMIENTOS_POR_PARTIDA_MAX,
  PREPARACIONES_POR_PARTIDA_MAX,
  calcularPaginacion,
  filtrarDrogasDelProveedor,
  parseDiasAlertaVencimiento,
} from "../domain/trayectoria";
import type {
  AccesoTrayectoriaProveedor,
  AuditoriaCostoCruda,
  ContralorCrudo,
  DrogaOpcion,
  MovimientoCrudo,
  PartidaCruda,
  PreparacionCruda,
  ProveedorTrayectoria,
  ResumenCrudo,
  TipoMovimientoValor,
  TotalesCostoCrudos,
  TrayectoriaProveedorCruda,
  UsuarioNombre,
} from "../domain/trayectoria";

/** Which optional blocks to read: the subset of `AccesoTrayectoriaProveedor` that is about data (not links). */
export type BloquesTrayectoriaProveedor = Pick<AccesoTrayectoriaProveedor, "costos" | "preparaciones" | "contralor" | "correcciones">;

export async function readProveedor(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string): Promise<ProveedorTrayectoria | null> {
  return tx.proveedor.findUnique({
    where: { id: proveedorId, tenantId },
    select: { id: true, razonSocial: true, cuit: true, fechaBaja: true, motivoBaja: true },
  });
}

/** `fsj.jornada_actual(tenant)`: the tenant's business day, the same function the /stock alerts use. */
export async function readJornadaActual(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`readJornadaActual: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

/** `dias_alerta_vencimiento_partida` (same `parametro` row as `getDiasAlertaVencimiento` in modules/stock), parsed by the domain. */
export async function readDiasAlerta(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const row = await tx.parametro.findUnique({
    where: { tenantId_clave: { tenantId, clave: "dias_alerta_vencimiento_partida" } },
    select: { valor: true },
  });
  return parseDiasAlertaVencimiento(row?.valor);
}

/**
 * Counters over ALL the proveedor's partidas. The two alert counters use the
 * predicates of `alertasVencidasConSaldo` / `alertasPorVencer`
 * (modules/stock/infrastructure/partida-repository.ts) against the SAME
 * `jornada` the per-partida estado is derived with (read once by the caller).
 */
export async function readResumen(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string, jornada: string, diasAlerta: number): Promise<ResumenCrudo> {
  const rows = await tx.$queryRaw<
    { partidas: number; drogas_distintas: number; ultimo_ingreso: Date | null; vencidas_con_saldo: number; por_vencer: number }[]
  >`
    SELECT
      count(*)::int AS partidas,
      count(DISTINCT p.droga_id)::int AS drogas_distintas,
      max(p.fecha_ingreso) AS ultimo_ingreso,
      (count(*) FILTER (WHERE p.cantidad_disponible > 0 AND p.fecha_vencimiento < ${jornada}::date))::int AS vencidas_con_saldo,
      (count(*) FILTER (
        WHERE p.cantidad_disponible > 0
          AND p.fecha_vencimiento >= ${jornada}::date
          AND p.fecha_vencimiento <= (${jornada}::date + (${diasAlerta}::int || ' days')::interval)
      ))::int AS por_vencer
    FROM fsj.partida p
    WHERE p.tenant_id = ${tenantId}::uuid AND p.proveedor_id = ${proveedorId}::uuid
  `;
  const r = rows[0];
  if (!r) return { partidas: 0, drogasDistintas: 0, ultimoIngreso: null, vencidasConSaldo: 0, porVencer: 0 };
  return {
    partidas: r.partidas,
    drogasDistintas: r.drogas_distintas,
    ultimoIngreso: r.ultimo_ingreso,
    vencidasConSaldo: r.vencidas_con_saldo,
    porVencer: r.por_vencer,
  };
}

/** Money over ALL the proveedor's partidas, `numeric` in SQL, at the CURRENT cost of each partida. Read ONLY with `stock.valorizado.ver`. */
export async function readTotalesCosto(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string): Promise<TotalesCostoCrudos> {
  const rows = await tx.$queryRaw<{ total_comprado: string; stock_valorizado: string }[]>`
    SELECT
      coalesce(sum(p.cantidad_inicial * p.costo_unitario), 0)::text AS total_comprado,
      coalesce(sum(p.cantidad_disponible * p.costo_unitario), 0)::text AS stock_valorizado
    FROM fsj.partida p
    WHERE p.tenant_id = ${tenantId}::uuid AND p.proveedor_id = ${proveedorId}::uuid
  `;
  const r = rows[0];
  return { totalComprado: r?.total_comprado ?? "0", stockValorizado: r?.stock_valorizado ?? "0" };
}

/**
 * The proveedor's partidas narrowed by the droga filter: always tenant +
 * proveedor, plus `drogaId IN (...)` only when the filter is not empty (one
 * droga per partida, so several selected drogas combine with OR). Shared by
 * the page query and its count so both always agree.
 */
function partidasWhere(tenantId: string, proveedorId: string, drogaIds: readonly string[]) {
  return { tenantId, proveedorId, ...(drogaIds.length > 0 ? { drogaId: { in: [...drogaIds] } } : {}) } satisfies Prisma.PartidaWhereInput;
}

/**
 * The distinct drogas the proveedor has partidas of, by name: the options of
 * the "filtrar por droga" control. Tenant + proveedor scoped (relation filter),
 * explicit select (id and name only), NOT narrowed by any selected filter.
 */
export async function readDrogasDisponibles(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string): Promise<DrogaOpcion[]> {
  return tx.droga.findMany({
    where: { tenantId, partidas: { some: { tenantId, proveedorId } } },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
    select: { id: true, nombre: true },
  });
}

/** Partidas of the proveedor matching the droga filter (the pagination's total when a filter is active). */
export async function countPartidasFiltradas(tx: Prisma.TransactionClient, tenantId: string, proveedorId: string, drogaIds: readonly string[]): Promise<number> {
  return tx.partida.count({ where: partidasWhere(tenantId, proveedorId, drogaIds) });
}

/** The select of the partidas page. `costoUnitario` is added ONLY with `stock.valorizado.ver`. */
function partidaSelect(costos: boolean) {
  return {
    id: true,
    lote: true,
    fechaIngreso: true,
    fechaVencimiento: true,
    fechaApertura: true,
    cantidadInicial: true,
    cantidadDisponible: true,
    ...(costos ? { costoUnitario: true } : {}),
    droga: { select: { nombre: true, tipoControl: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } } },
  } satisfies Prisma.PartidaSelect;
}

export async function readPartidasPagina(
  tx: Prisma.TransactionClient,
  tenantId: string,
  proveedorId: string,
  page: number,
  pageSize: number,
  costos: boolean,
  drogaIds: readonly string[] = [],
): Promise<PartidaCruda[]> {
  const rows = await tx.partida.findMany({
    where: partidasWhere(tenantId, proveedorId, drogaIds),
    // `id` as tie-break keeps pages stable when two partidas share a fechaIngreso.
    orderBy: [{ fechaIngreso: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: partidaSelect(costos),
  });
  return rows.map((r) => ({
    id: r.id,
    drogaNombre: r.droga.nombre,
    esControlada: r.droga.tipoControl !== "NINGUNO",
    unidadBaseId: r.droga.unidadBaseId,
    unidadBaseSimbolo: r.droga.unidadBase.simbolo,
    lote: r.lote,
    fechaIngreso: r.fechaIngreso,
    fechaVencimiento: r.fechaVencimiento,
    fechaApertura: r.fechaApertura,
    cantidadInicial: r.cantidadInicial.toString(),
    cantidadDisponible: r.cantidadDisponible.toString(),
    costoUnitario: "costoUnitario" in r && r.costoUnitario !== undefined ? r.costoUnitario.toString() : null,
  }));
}

/**
 * The latest `MOVIMIENTOS_POR_PARTIDA_MAX` movements of EACH partida of the
 * page, in ONE statement: `unnest(page ids) CROSS JOIN LATERAL (... ORDER BY
 * registrado_en DESC, id DESC LIMIT n)`. Each partida is a bounded backward
 * range scan of idx_movimiento_stock_tenant_partida_fecha (0043): the cost no
 * longer grows with the partida's history. The partida's TOTAL (for "mostrando
 * 20 de N") is a second, grouped `count(*)`, an index-only count that returns
 * one row per partida.
 */
export async function readMovimientos(tx: Prisma.TransactionClient, tenantId: string, partidaIds: string[]): Promise<MovimientoCrudo[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      partida_id: string;
      tipo: TipoMovimientoValor;
      cantidad: string;
      motivo_ajuste: string | null;
      observacion: string | null;
      registrado_en: Date;
      registrado_por_id: string;
      autorizado_por_id: string | null;
    }[]
  >`
    SELECT m.id, m.partida_id, m.tipo, m.cantidad, m.motivo_ajuste, m.observacion, m.registrado_en, m.registrado_por_id, m.autorizado_por_id
    FROM unnest(${partidaIds}::uuid[]) AS p(id)
    CROSS JOIN LATERAL (
      SELECT
        ms.id,
        ms.partida_id,
        ms.tipo::text AS tipo,
        ms.cantidad::text AS cantidad,
        ms.motivo_ajuste::text AS motivo_ajuste,
        ms.observacion,
        ms.registrado_en,
        ms.registrado_por_id,
        ms.autorizado_por_id
      FROM fsj.movimiento_stock ms
      WHERE ms.tenant_id = ${tenantId}::uuid AND ms.partida_id = p.id
      ORDER BY ms.registrado_en DESC, ms.id DESC
      LIMIT ${MOVIMIENTOS_POR_PARTIDA_MAX}::int
    ) m
    ORDER BY m.partida_id, m.registrado_en DESC, m.id DESC
  `;
  if (rows.length === 0) return [];

  const totales = await tx.$queryRaw<{ partida_id: string; total: number }[]>`
    SELECT ms.partida_id, count(*)::int AS total
    FROM fsj.movimiento_stock ms
    WHERE ms.tenant_id = ${tenantId}::uuid AND ms.partida_id = ANY(${partidaIds}::uuid[])
    GROUP BY ms.partida_id
  `;
  const totalPorPartida = new Map(totales.map((t) => [t.partida_id, t.total]));
  return rows.map((r) => ({
    id: r.id,
    partidaId: r.partida_id,
    tipo: r.tipo,
    cantidad: r.cantidad,
    motivoAjuste: r.motivo_ajuste,
    observacion: r.observacion,
    registradoEn: r.registrado_en,
    registradoPorId: r.registrado_por_id,
    autorizadoPorId: r.autorizado_por_id,
    totalDePartida: totalPorPartida.get(r.partida_id) ?? rows.filter((x) => x.partida_id === r.partida_id).length,
  }));
}

/** Names (only) of the users that registered / authorized the movements, in ONE query. */
export async function readUsuarios(tx: Prisma.TransactionClient, tenantId: string, usuarioIds: string[]): Promise<UsuarioNombre[]> {
  if (usuarioIds.length === 0) return [];
  return tx.usuario.findMany({
    where: { tenantId, id: { in: usuarioIds } },
    select: { id: true, nombre: true, apellido: true },
  });
}

/**
 * The preparaciones that consumed each partida, reached through
 * `movimiento_stock.preparacion_id`. Bounded like the movimientos: a LATERAL
 * takes the latest `PREPARACIONES_POR_PARTIDA_MAX` movements of each partida
 * that carry a preparacion (a bounded backward scan of the same index), and
 * the distinct preparaciones of those are joined (a preparación may have
 * consumed the partida in more than one movement, so there can be fewer than
 * the cap). The partida's total of distinct preparaciones is a second grouped
 * count. Selects ONLY id, estado and the three dates of `fsj.preparacion`: the
 * join stops there, it never reaches item_receta, receta or paciente, and the
 * free-text `motivo_descarte` is not read.
 */
export async function readPreparaciones(tx: Prisma.TransactionClient, tenantId: string, partidaIds: string[]): Promise<PreparacionCruda[]> {
  const rows = await tx.$queryRaw<
    {
      partida_id: string;
      id: string;
      estado: PreparacionCruda["estado"];
      iniciada_en: Date;
      confirmada_en: Date | null;
      descartada_en: Date | null;
    }[]
  >`
    SELECT r.partida_id, pr.id, pr.estado::text AS estado, pr.iniciada_en, pr.confirmada_en, pr.descartada_en
    FROM (
      SELECT x.partida_id, x.preparacion_id, max(x.registrado_en) AS ultimo
      FROM unnest(${partidaIds}::uuid[]) AS p(id)
      CROSS JOIN LATERAL (
        SELECT ms.partida_id, ms.preparacion_id, ms.registrado_en
        FROM fsj.movimiento_stock ms
        WHERE ms.tenant_id = ${tenantId}::uuid AND ms.partida_id = p.id AND ms.preparacion_id IS NOT NULL
        ORDER BY ms.registrado_en DESC, ms.id DESC
        LIMIT ${PREPARACIONES_POR_PARTIDA_MAX}::int
      ) x
      GROUP BY x.partida_id, x.preparacion_id
    ) r
    JOIN fsj.preparacion pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = r.preparacion_id
    ORDER BY r.partida_id, r.ultimo DESC, pr.id DESC
  `;
  if (rows.length === 0) return [];

  const totales = await tx.$queryRaw<{ partida_id: string; total: number }[]>`
    SELECT ms.partida_id, count(DISTINCT ms.preparacion_id)::int AS total
    FROM fsj.movimiento_stock ms
    WHERE ms.tenant_id = ${tenantId}::uuid AND ms.partida_id = ANY(${partidaIds}::uuid[]) AND ms.preparacion_id IS NOT NULL
    GROUP BY ms.partida_id
  `;
  const totalPorPartida = new Map(totales.map((t) => [t.partida_id, t.total]));
  return rows.map((r) => ({
    partidaId: r.partida_id,
    id: r.id,
    estado: r.estado,
    iniciadaEn: r.iniciada_en,
    confirmadaEn: r.confirmada_en,
    descartadaEn: r.descartada_en,
    totalDePartida: totalPorPartida.get(r.partida_id) ?? rows.filter((x) => x.partida_id === r.partida_id).length,
  }));
}

/**
 * Número de vale de adquisición and número de asiento contralor of the INGRESO
 * (INV-STK-002: exactly one INGRESO_COMPRA movement per partida) of the given
 * partidas. LEFT JOIN: a controlled partida that entered before the tenant's
 * contralor was active has no asiento.
 */
export async function readContralor(tx: Prisma.TransactionClient, tenantId: string, partidaIds: string[]): Promise<ContralorCrudo[]> {
  const rows = await tx.$queryRaw<{ partida_id: string; numero_vale_adquisicion: string | null; numero_asiento: string | null }[]>`
    SELECT ms.partida_id, ms.numero_vale_adquisicion, ac.numero_correlativo::text AS numero_asiento
    FROM fsj.movimiento_stock ms
    LEFT JOIN fsj.asiento_contralor ac ON ac.tenant_id = ${tenantId}::uuid AND ac.movimiento_stock_id = ms.id
    WHERE ms.tenant_id = ${tenantId}::uuid
      AND ms.partida_id = ANY(${partidaIds}::uuid[])
      AND ms.tipo = 'INGRESO_COMPRA'
  `;
  return rows.map((r) => ({ partidaId: r.partida_id, numeroValeAdquisicion: r.numero_vale_adquisicion, numeroAsiento: r.numero_asiento }));
}

/**
 * The cost corrections of the page's partidas, filtered IN SQL: audit rows of
 * entidad `partida`, accion MODIFICAR whose diff carries a `costoUnitario` key
 * (`corregirCostoPartida` writes `{ costoUnitario }` in BOTH `valor_anterior` and
 * `valor_nuevo`). One LATERAL per partida reads at most
 * `CORRECCIONES_POR_PARTIDA_MAX + 1` rows (the extra one only tells the UI
 * there are more), newest first, through idx_registro_auditoria_entidad
 * (0003: tenant_id, entidad, entidad_id, ocurrido_en). `jsonb_exists` is the
 * function behind the `?` operator (kept out of the template to avoid any
 * placeholder ambiguity). Explicit columns: no `ip`, no `contexto`. The domain
 * re-checks the diff (`correccionDeCosto`) as defense in depth.
 */
export async function readAuditoriaCosto(tx: Prisma.TransactionClient, tenantId: string, partidaIds: string[]): Promise<AuditoriaCostoCruda[]> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      partida_id: string;
      valor_anterior: unknown;
      valor_nuevo: unknown;
      motivo: string | null;
      ocurrido_en: Date;
      nombre: string;
      apellido: string;
    }[]
  >`
    SELECT a.id, a.entidad_id AS partida_id, a.valor_anterior, a.valor_nuevo, a.motivo, a.ocurrido_en, u.nombre, u.apellido
    FROM unnest(${partidaIds}::uuid[]) AS p(id)
    CROSS JOIN LATERAL (
      SELECT ra.id, ra.entidad_id, ra.usuario_id, ra.valor_anterior, ra.valor_nuevo, ra.motivo, ra.ocurrido_en
      FROM fsj.registro_auditoria ra
      WHERE ra.tenant_id = ${tenantId}::uuid
        AND ra.entidad = 'partida'
        AND ra.entidad_id = p.id
        AND ra.accion = 'MODIFICAR'
        AND (jsonb_exists(ra.valor_nuevo, 'costoUnitario') OR jsonb_exists(ra.valor_anterior, 'costoUnitario'))
      ORDER BY ra.ocurrido_en DESC, ra.id DESC
      LIMIT ${CORRECCIONES_POR_PARTIDA_MAX + 1}::int
    ) a
    JOIN fsj.usuario u ON u.tenant_id = ${tenantId}::uuid AND u.id = a.usuario_id
    ORDER BY a.entidad_id, a.ocurrido_en DESC, a.id DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    partidaId: r.partida_id,
    valorAnterior: r.valor_anterior,
    valorNuevo: r.valor_nuevo,
    motivo: r.motivo,
    ocurridoEn: r.ocurrido_en,
    usuarioNombre: r.nombre,
    usuarioApellido: r.apellido,
  }));
}

/**
 * The raw Trayectoria of one proveedor: header, counters, one page of partidas
 * and the requested blocks. `null` when the proveedor does not exist in the
 * tenant. `page` is clamped to the last page. `drogaIdsSolicitados` is the
 * (already parsed) droga filter: ids that are not one of the proveedor's drogas
 * are ignored, and the filter never reaches the resumen counters / money.
 */
export async function getTrayectoriaProveedorCruda(
  tx: Prisma.TransactionClient,
  tenantId: string,
  proveedorId: string,
  page: number,
  pageSize: number,
  bloques: BloquesTrayectoriaProveedor,
  drogaIdsSolicitados: readonly string[] = [],
): Promise<TrayectoriaProveedorCruda | null> {
  const proveedor = await readProveedor(tx, tenantId, proveedorId);
  if (!proveedor) return null;

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  const jornada = await readJornadaActual(tx, tenantId);
  const diasAlerta = await readDiasAlerta(tx, tenantId);
  const resumen = await readResumen(tx, tenantId, proveedorId, jornada, diasAlerta);
  const totales = bloques.costos ? await readTotalesCosto(tx, tenantId, proveedorId) : null;

  // The droga filter only narrows the partidas list (and its pagination); the resumen above stays proveedor-wide.
  // The requested ids are never trusted: only those that are one of the proveedor's own drogas are applied.
  const drogasDisponibles = resumen.partidas === 0 ? [] : await readDrogasDisponibles(tx, tenantId, proveedorId);
  const drogaIds = filtrarDrogasDelProveedor(drogaIdsSolicitados, drogasDisponibles);
  const totalFiltrado = drogaIds.length === 0 ? resumen.partidas : await countPartidasFiltradas(tx, tenantId, proveedorId, drogaIds);
  const paginacion = calcularPaginacion(totalFiltrado, page, pageSize);

  const partidas = totalFiltrado === 0 ? [] : await readPartidasPagina(tx, tenantId, proveedorId, paginacion.page, pageSize, bloques.costos, drogaIds);
  const partidaIds = partidas.map((p) => p.id);
  const controladasIds = partidas.filter((p) => p.esControlada).map((p) => p.id);

  const movimientos = partidaIds.length > 0 ? await readMovimientos(tx, tenantId, partidaIds) : [];
  const usuarioIds = [...new Set(movimientos.flatMap((m) => (m.autorizadoPorId ? [m.registradoPorId, m.autorizadoPorId] : [m.registradoPorId])))];
  const usuarios = await readUsuarios(tx, tenantId, usuarioIds);
  const preparaciones = bloques.preparaciones && partidaIds.length > 0 ? await readPreparaciones(tx, tenantId, partidaIds) : [];
  const contralor = bloques.contralor && controladasIds.length > 0 ? await readContralor(tx, tenantId, controladasIds) : [];
  const auditoria = bloques.correcciones && partidaIds.length > 0 ? await readAuditoriaCosto(tx, tenantId, partidaIds) : [];

  return {
    proveedor,
    zonaHoraria: tenant.zonaHoraria,
    jornada,
    diasAlerta,
    resumen,
    totales,
    drogasDisponibles,
    drogaIds,
    totalFiltrado,
    page: paginacion.page,
    partidas,
    movimientos,
    usuarios,
    preparaciones,
    contralor,
    auditoria,
  };
}
