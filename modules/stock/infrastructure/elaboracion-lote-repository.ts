/**
 * Persistence of "Elaborar lote" (migration 0111, openspec/changes/lotes-elaborados). The produced partida, its
 * `elaboracion_lote`, its INGRESO_ELABORACION and the EGRESO_ELABORACION of every consumed partida are written in the
 * caller's transaction; the deferred triggers (INV-STK-002/S25, INV-EL1..EL4) check the whole at commit.
 */
import { Prisma } from "@/generated/prisma/client";
import type { TipoElaboracion } from "@/generated/prisma/enums";

/** Locks every partida in `partidaIds`, in id order (the order every multi-partida writer uses), in ONE statement. Returns the locked ids. */
export async function lockPartidasParaElaborar(tx: Prisma.TransactionClient, tenantId: string, partidaIds: readonly string[]): Promise<string[]> {
  if (partidaIds.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.partida
    WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${[...partidaIds]}::uuid[])
    ORDER BY id ASC
    FOR UPDATE
  `;
  return rows.map((r) => r.id);
}

export interface PartidaParaElaborar {
  id: string;
  lote: string;
  drogaId: string;
  drogaNombre: string;
  drogaTipoControl: string;
  unidadBaseSimbolo: string;
  /** `cantidad_disponible` minus what INICIADA preparaciones reserve (fsj.reserva_stock, 0071), never below 0. */
  cantidadDisponible: string;
  costoUnitario: string;
  potenciaDeclarada: string | null;
  /** Vencimiento VIGENTE, `YYYY-MM-DD`; `null` = does not expire. */
  fechaVencimiento: string | null;
  /** ISO-8601, `null` = never opened. */
  fechaApertura: string | null;
}

interface PartidaParaElaborarRow {
  id: string;
  lote: string;
  droga_id: string;
  droga_nombre: string;
  tipo_control: string;
  unidad_base_simbolo: string;
  cantidad_disponible: string;
  costo_unitario: string;
  potencia_declarada: string | null;
  fecha_vencimiento: string | null;
  fecha_apertura: string | null;
}

/** Same reserva rule as `fsj.v_stock_droga` and `reservadoPorPartida`. */
function selectPartidas(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT p.id, p.lote, d.id AS droga_id, d.nombre AS droga_nombre, d.tipo_control::text AS tipo_control,
      u.simbolo AS unidad_base_simbolo, greatest(p.cantidad_disponible - r.reservado, 0)::text AS cantidad_disponible,
      p.costo_unitario::text, p.potencia_declarada::text,
      p.fecha_vencimiento_vigente::text AS fecha_vencimiento, p.fecha_apertura::text
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(rs.cantidad), 0) AS reservado
      FROM fsj.reserva_stock rs
      JOIN fsj.preparacion rp ON rp.tenant_id = rs.tenant_id AND rp.id = rs.preparacion_id
      WHERE rs.tenant_id = p.tenant_id AND rs.partida_id = p.id AND rp.estado = 'INICIADA'
    ) r ON true
    WHERE ${where}
  `;
}

function aPartida(r: PartidaParaElaborarRow): PartidaParaElaborar {
  return {
    id: r.id,
    lote: r.lote,
    drogaId: r.droga_id,
    drogaNombre: r.droga_nombre,
    drogaTipoControl: r.tipo_control,
    unidadBaseSimbolo: r.unidad_base_simbolo,
    cantidadDisponible: r.cantidad_disponible,
    costoUnitario: r.costo_unitario,
    potenciaDeclarada: r.potencia_declarada,
    fechaVencimiento: r.fecha_vencimiento,
    fechaApertura: r.fecha_apertura,
  };
}

/** The partidas an elaboración consumes, read AFTER `lockPartidasParaElaborar` (a reserva is written only under the same lock). */
export async function getPartidasParaElaborar(tx: Prisma.TransactionClient, tenantId: string, partidaIds: readonly string[]): Promise<PartidaParaElaborar[]> {
  if (partidaIds.length === 0) return [];
  const rows = await tx.$queryRaw<PartidaParaElaborarRow[]>(
    selectPartidas(Prisma.sql`p.tenant_id = ${tenantId}::uuid AND p.id = ANY(${[...partidaIds]}::uuid[])`),
  );
  return rows.map(aPartida);
}

/** Candidate partidas of `drogaIds` for the "Elaborar lote" form: free balance > 0, not expired at the jornada. */
export async function listPartidasElegiblesParaElaborar(tx: Prisma.TransactionClient, tenantId: string, drogaIds: readonly string[]): Promise<PartidaParaElaborar[]> {
  if (drogaIds.length === 0) return [];
  const rows = await tx.$queryRaw<PartidaParaElaborarRow[]>(
    selectPartidas(Prisma.sql`
      p.tenant_id = ${tenantId}::uuid AND p.droga_id = ANY(${[...drogaIds]}::uuid[])
      AND p.cantidad_disponible - r.reservado > 0
      AND (p.fecha_vencimiento_vigente IS NULL OR p.fecha_vencimiento_vigente >= fsj.jornada_actual(${tenantId}::uuid))
    `),
  );
  return rows.map(aPartida);
}

export interface DrogaProducida {
  id: string;
  nombre: string;
  clase: string;
  tipoControl: string;
  unidadBaseSimbolo: string;
  deBaja: boolean;
}

export async function getDrogaProducida(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<DrogaProducida | null> {
  const row = await tx.droga.findUnique({
    where: { id: drogaId, tenantId },
    select: { id: true, nombre: true, clase: true, tipoControl: true, fechaBaja: true, unidadBase: { select: { simbolo: true } } },
  });
  if (!row) return null;
  return { id: row.id, nombre: row.nombre, clase: row.clase, tipoControl: row.tipoControl, unidadBaseSimbolo: row.unidadBase.simbolo, deBaja: row.fechaBaja !== null };
}

/** How many partidas without proveedor of the tenant already use a lote starting with `prefijo` (the next suggestion). */
/**
 * Serializes the lote code assignment of one tenant's elaborations (EL9) until commit: two elaborations of the same
 * jornada would otherwise count the same lots and take the same number. Its own key, apart from the cierres' lock.
 */
export async function lockNumeracionLotesElaborados(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lote_elaborado:${tenantId}`}))`;
}

export async function contarLotesConPrefijo(tx: Prisma.TransactionClient, tenantId: string, prefijo: string): Promise<number> {
  return tx.partida.count({ where: { tenantId, proveedorId: null, lote: { startsWith: prefijo } } });
}

export interface NuevoLoteElaboradoInput {
  tenantId: string;
  tipo: TipoElaboracion;
  drogaId: string;
  formulaId: string | null;
  lote: string;
  /** The produced droga's unidad base. */
  cantidadProducida: string;
  costoUnitario: string;
  potenciaDeclarada: string | null;
  /** `YYYY-MM-DD`; `null` = does not expire (an insumo only, migration 0064). */
  fechaVencimiento: string | null;
  observacion: string | null;
  usuarioId: string;
  /** PHYSICAL quantities, each droga's unidad base. */
  consumos: readonly { partidaId: string; cantidad: string }[];
}

/**
 * INSERT the produced partida (origen ELABORACION_PROPIA, no proveedor), its `elaboracion_lote`, its
 * INGRESO_ELABORACION and one EGRESO_ELABORACION per consumed partida. The movimiento trigger moves every balance
 * (INV-S01/S04) and opens the consumed partidas (INV-S16).
 */
export async function insertLoteElaborado(tx: Prisma.TransactionClient, input: NuevoLoteElaboradoInput): Promise<{ partidaId: string; elaboracionLoteId: string }> {
  const partida = await tx.partida.create({
    data: {
      tenantId: input.tenantId,
      drogaId: input.drogaId,
      proveedorId: null,
      lote: input.lote,
      costoUnitario: input.costoUnitario,
      cantidadInicial: input.cantidadProducida,
      fechaVencimiento: input.fechaVencimiento ? new Date(`${input.fechaVencimiento}T00:00:00Z`) : null,
      potenciaDeclarada: input.potenciaDeclarada,
      origen: "ELABORACION_PROPIA",
    },
    select: { id: true },
  });

  const elaboracion = await tx.elaboracionLote.create({
    data: {
      tenantId: input.tenantId,
      partidaId: partida.id,
      tipo: input.tipo,
      formulaId: input.formulaId,
      elaboradoPorId: input.usuarioId,
      observacion: input.observacion,
    },
    select: { id: true },
  });

  await tx.movimientoStock.create({
    data: {
      tenantId: input.tenantId,
      partidaId: partida.id,
      tipo: "INGRESO_ELABORACION",
      cantidad: input.cantidadProducida,
      registradoPorId: input.usuarioId,
      elaboracionLoteId: elaboracion.id,
    },
  });

  await tx.movimientoStock.createMany({
    data: input.consumos.map((c) => ({
      tenantId: input.tenantId,
      partidaId: c.partidaId,
      tipo: "EGRESO_ELABORACION" as const,
      cantidad: c.cantidad,
      registradoPorId: input.usuarioId,
      elaboracionLoteId: elaboracion.id,
    })),
  });

  return { partidaId: partida.id, elaboracionLoteId: elaboracion.id };
}

export interface ElaboracionDePartida {
  tipo: TipoElaboracion;
  /** Precargada from the droga's fórmula. */
  conFormula: boolean;
  elaboradoPorNombre: string;
  elaboradoPorApellido: string;
  registradoEn: Date;
  observacion: string | null;
  /** The partidas it consumed, each quantity in its droga's unidad base. */
  consumos: { partidaId: string; lote: string; drogaNombre: string; cantidad: string; unidadId: string; unidadSimbolo: string; potenciaDeclarada: string | null }[];
}

/** The elaboración that PRODUCED `partidaId` (`null` for a bought or counted partida). */
export async function getElaboracionDePartida(tx: Prisma.TransactionClient, tenantId: string, partidaId: string): Promise<ElaboracionDePartida | null> {
  const [cabecera] = await tx.$queryRaw<
    { id: string; tipo: TipoElaboracion; con_formula: boolean; nombre: string; apellido: string; registrado_en: Date; observacion: string | null }[]
  >`
    SELECT el.id, el.tipo::text AS tipo, el.formula_id IS NOT NULL AS con_formula, u.nombre, u.apellido, el.registrado_en, el.observacion
    FROM fsj.elaboracion_lote el
    JOIN fsj.usuario u ON u.id = el.elaborado_por_id
    WHERE el.tenant_id = ${tenantId}::uuid AND el.partida_id = ${partidaId}::uuid
  `;
  if (!cabecera) return null;
  const consumos = await tx.$queryRaw<
    { partida_id: string; lote: string; droga_nombre: string; cantidad: string; unidad_id: string; unidad_simbolo: string; potencia_declarada: string | null }[]
  >`
    SELECT m.partida_id, p.lote, d.nombre AS droga_nombre, m.cantidad::text AS cantidad, u.id AS unidad_id, u.simbolo AS unidad_simbolo, p.potencia_declarada::text
    FROM fsj.movimiento_stock m
    JOIN fsj.partida p ON p.tenant_id = m.tenant_id AND p.id = m.partida_id
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.elaboracion_lote_id = ${cabecera.id}::uuid AND m.tipo::text = 'EGRESO_ELABORACION'
    ORDER BY d.nombre ASC, p.lote ASC
  `;
  return {
    tipo: cabecera.tipo,
    conFormula: cabecera.con_formula,
    elaboradoPorNombre: cabecera.nombre,
    elaboradoPorApellido: cabecera.apellido,
    registradoEn: cabecera.registrado_en,
    observacion: cabecera.observacion,
    consumos: consumos.map((c) => ({
      partidaId: c.partida_id,
      lote: c.lote,
      drogaNombre: c.droga_nombre,
      cantidad: c.cantidad,
      unidadId: c.unidad_id,
      unidadSimbolo: c.unidad_simbolo,
      potenciaDeclarada: c.potencia_declarada,
    })),
  };
}

/** The lots elaborated FROM `partidaId` (its EGRESO_ELABORACION movements), newest first. */
export async function listLotesElaboradosDesde(
  tx: Prisma.TransactionClient,
  tenantId: string,
  partidaId: string,
): Promise<{ partidaId: string; lote: string; drogaNombre: string; tipo: TipoElaboracion; cantidadConsumida: string }[]> {
  const rows = await tx.$queryRaw<{ partida_id: string; lote: string; droga_nombre: string; tipo: TipoElaboracion; cantidad: string }[]>`
    SELECT el.partida_id, pp.lote, d.nombre AS droga_nombre, el.tipo::text AS tipo, m.cantidad::text AS cantidad
    FROM fsj.movimiento_stock m
    JOIN fsj.elaboracion_lote el ON el.tenant_id = m.tenant_id AND el.id = m.elaboracion_lote_id
    JOIN fsj.partida pp ON pp.tenant_id = el.tenant_id AND pp.id = el.partida_id
    JOIN fsj.droga d ON d.tenant_id = pp.tenant_id AND d.id = pp.droga_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.partida_id = ${partidaId}::uuid AND m.tipo::text = 'EGRESO_ELABORACION'
    ORDER BY el.registrado_en DESC
  `;
  return rows.map((r) => ({ partidaId: r.partida_id, lote: r.lote, drogaNombre: r.droga_nombre, tipo: r.tipo, cantidadConsumida: r.cantidad }));
}

/** partidaId -> how it was elaborated, for the partidas of a listing page (absent = not elaborated). */
export async function tiposElaboracionDePartidas(tx: Prisma.TransactionClient, tenantId: string, partidaIds: readonly string[]): Promise<Map<string, TipoElaboracion>> {
  if (partidaIds.length === 0) return new Map();
  const rows = await tx.elaboracionLote.findMany({ where: { tenantId, partidaId: { in: [...partidaIds] } }, select: { partidaId: true, tipo: true } });
  return new Map(rows.map((r) => [r.partidaId, r.tipo]));
}
