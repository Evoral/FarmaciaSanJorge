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
 *      (window function, capped per partida), usuarios, preparaciones,
 *      contralor, audit.
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
import { MOVIMIENTOS_POR_PARTIDA_MAX, PREPARACIONES_POR_PARTIDA_MAX, calcularPaginacion, parseDiasAlertaVencimiento } from "../domain/trayectoria";
import type {
  AccesoTrayectoriaProveedor,
  AuditoriaCostoCruda,
  ContralorCrudo,
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

/** Safety bound on audit rows read for one page (only cost corrections write MODIFICAR on a partida, so this is generous). */
export const AUDITORIA_COSTO_MAX = 200;

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
): Promise<PartidaCruda[]> {
  const rows = await tx.partida.findMany({
    where: { tenantId, proveedorId },
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
 * page in ONE query (window function, no N+1), plus the partida's total count
 * (`COUNT(*) OVER`) so the UI can say "mostrando 20 de N". The window scans
 * only the movements of the page's (<= 10) partidas, through
 * idx_movimiento_stock_tenant_partida_fecha (0043).
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
      total: number;
    }[]
  >`
    SELECT m.id, m.partida_id, m.tipo, m.cantidad, m.motivo_ajuste, m.observacion, m.registrado_en, m.registrado_por_id, m.autorizado_por_id, m.total
    FROM (
      SELECT
        ms.id,
        ms.partida_id,
        ms.tipo::text AS tipo,
        ms.cantidad::text AS cantidad,
        ms.motivo_ajuste::text AS motivo_ajuste,
        ms.observacion,
        ms.registrado_en,
        ms.registrado_por_id,
        ms.autorizado_por_id,
        ROW_NUMBER() OVER (PARTITION BY ms.partida_id ORDER BY ms.registrado_en DESC, ms.id DESC) AS rn,
        (COUNT(*) OVER (PARTITION BY ms.partida_id))::int AS total
      FROM fsj.movimiento_stock ms
      WHERE ms.tenant_id = ${tenantId}::uuid AND ms.partida_id = ANY(${partidaIds}::uuid[])
    ) m
    WHERE m.rn <= ${MOVIMIENTOS_POR_PARTIDA_MAX}::int
    ORDER BY m.partida_id, m.rn
  `;
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
    totalDePartida: r.total,
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
 * `movimiento_stock.preparacion_id` (distinct per partida), capped per partida
 * with a window function. Selects ONLY id, estado and the three dates of
 * `fsj.preparacion`: the join stops there, it never reaches item_receta,
 * receta or paciente, and the free-text `motivo_descarte` is not read.
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
      total: number;
    }[]
  >`
    SELECT r.partida_id, r.id, r.estado, r.iniciada_en, r.confirmada_en, r.descartada_en, r.total
    FROM (
      SELECT
        pp.partida_id,
        pr.id,
        pr.estado::text AS estado,
        pr.iniciada_en,
        pr.confirmada_en,
        pr.descartada_en,
        ROW_NUMBER() OVER (PARTITION BY pp.partida_id ORDER BY pr.iniciada_en DESC, pr.id DESC) AS rn,
        (COUNT(*) OVER (PARTITION BY pp.partida_id))::int AS total
      FROM (
        SELECT DISTINCT ms.partida_id, ms.preparacion_id
        FROM fsj.movimiento_stock ms
        WHERE ms.tenant_id = ${tenantId}::uuid
          AND ms.partida_id = ANY(${partidaIds}::uuid[])
          AND ms.preparacion_id IS NOT NULL
      ) pp
      JOIN fsj.preparacion pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = pp.preparacion_id
    ) r
    WHERE r.rn <= ${PREPARACIONES_POR_PARTIDA_MAX}::int
    ORDER BY r.partida_id, r.rn
  `;
  return rows.map((r) => ({
    partidaId: r.partida_id,
    id: r.id,
    estado: r.estado,
    iniciadaEn: r.iniciada_en,
    confirmadaEn: r.confirmada_en,
    descartadaEn: r.descartada_en,
    totalDePartida: r.total,
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
 * The audit rows of the page's partidas that MAY be cost corrections: entidad
 * `partida`, accion MODIFICAR (the shape `corregirCostoPartida` writes). The
 * domain then keeps only those whose diff actually touches `costoUnitario`.
 * Explicit select: no `ip`, no `contexto`.
 */
export async function readAuditoriaCosto(tx: Prisma.TransactionClient, tenantId: string, partidaIds: string[]): Promise<AuditoriaCostoCruda[]> {
  const rows = await tx.registroAuditoria.findMany({
    where: { tenantId, entidad: "partida", entidadId: { in: partidaIds }, accion: "MODIFICAR" },
    orderBy: [{ ocurridoEn: "desc" }, { id: "desc" }],
    take: AUDITORIA_COSTO_MAX,
    select: {
      id: true,
      entidadId: true,
      valorAnterior: true,
      valorNuevo: true,
      motivo: true,
      ocurridoEn: true,
      usuario: { select: { nombre: true, apellido: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    partidaId: r.entidadId,
    valorAnterior: r.valorAnterior,
    valorNuevo: r.valorNuevo,
    motivo: r.motivo,
    ocurridoEn: r.ocurridoEn,
    usuarioNombre: r.usuario.nombre,
    usuarioApellido: r.usuario.apellido,
  }));
}

/**
 * The raw Trayectoria of one proveedor: header, counters, one page of partidas
 * and the requested blocks. `null` when the proveedor does not exist in the
 * tenant. `page` is clamped to the last page.
 */
export async function getTrayectoriaProveedorCruda(
  tx: Prisma.TransactionClient,
  tenantId: string,
  proveedorId: string,
  page: number,
  pageSize: number,
  bloques: BloquesTrayectoriaProveedor,
): Promise<TrayectoriaProveedorCruda | null> {
  const proveedor = await readProveedor(tx, tenantId, proveedorId);
  if (!proveedor) return null;

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  const jornada = await readJornadaActual(tx, tenantId);
  const diasAlerta = await readDiasAlerta(tx, tenantId);
  const resumen = await readResumen(tx, tenantId, proveedorId, jornada, diasAlerta);
  const totales = bloques.costos ? await readTotalesCosto(tx, tenantId, proveedorId) : null;
  const paginacion = calcularPaginacion(resumen.partidas, page, pageSize);

  const partidas = resumen.partidas === 0 ? [] : await readPartidasPagina(tx, tenantId, proveedorId, paginacion.page, pageSize, bloques.costos);
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
    page: paginacion.page,
    partidas,
    movimientos,
    usuarios,
    preparaciones,
    contralor,
    auditoria,
  };
}
