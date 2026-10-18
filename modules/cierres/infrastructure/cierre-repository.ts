/**
 * Prisma/raw-SQL access to `fsj.cierre_diario` and everything `firmarCierre`
 * / the pending list / the comprobante / the compliance report need (FASE
 * 10, M13a points 10.1-10.4). Every function here runs inside an ALREADY
 * OPEN tenant transaction (`tx`), same convention as every other module's
 * repository.
 *
 * Several reads below are "own small copies" of a query another module's
 * infrastructure layer already has (designación vigente, jornada actual)
 * -- `modules/cierres` cannot import
 * `modules/directores-tecnicos/infrastructure/**` (eslint.config.mjs's
 * `appBoundaryPatterns` forbids ANY `modules/**\/*.ts` from reaching into
 * another module's `infrastructure/` layer, not just `app/**`) -- same
 * "own copy per module" discipline `modules/libro/infrastructure/co-firma-repository.ts`
 * and `modules/preparaciones/infrastructure/preparacion-repository.ts`'s
 * "Receta state transitions" section already establish.
 */
import { Prisma } from "@/generated/prisma/client";
import type { EstadoUsuario } from "@/generated/prisma/enums";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";
import type { EstadoVisualAsiento } from "@/modules/libro/domain/estado-visual";

// ============================================================================
// jornada / parametro helpers -- own copies (see module doc comment).
// ============================================================================

export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

/** `plazo_firma_dias` (DP-18, migrations 0038/0075) -- defaults to 0 (only the day after the jornada is on time) when the tenant somehow lacks the row, mirroring `fsj.cierre_diario_calcular_fuera_de_termino`'s own defensive `COALESCE`. */
export async function getPlazoFirmaDias(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const row = await tx.parametro.findUnique({
    where: { tenantId_clave: { tenantId, clave: "plazo_firma_dias" } },
    select: { valor: true },
  });
  if (!row) return 0;
  const parsed = Number.parseInt(row.valor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

// ============================================================================
// 10.2: farmacia (tenant) data for the comprobante header -- own small copy,
// same reasoning as `modules/preparaciones/infrastructure/preparacion-repository.ts#getPreparacionParaEtiqueta`'s
// own `tx.tenant.findUniqueOrThrow` call.
// ============================================================================

export interface TenantDatosComprobante {
  razonSocial: string;
  nombreFantasia: string | null;
  matriculaFarmacia: string | null;
  domicilio: string | null;
  cuit: string;
}

export async function getTenantDatosComprobante(tx: Prisma.TransactionClient, tenantId: string): Promise<TenantDatosComprobante> {
  return tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { razonSocial: true, nombreFantasia: true, matriculaFarmacia: true, domicilio: true, cuit: true },
  });
}

// ============================================================================
// 10.1: jornadas pendientes de firma (DP-18d: only fechas with at least one
// unsigned VIGENTE asiento, recetario or contralor; DP-18b revised, migration
// 0075: only fechas before the current jornada -- today is signed tomorrow).
// ============================================================================

export interface JornadaPendienteRow {
  fecha: string;
  cantidadRecetario: number;
  cantidadContralor: number;
}

export async function listJornadasPendientes(tx: Prisma.TransactionClient, tenantId: string): Promise<JornadaPendienteRow[]> {
  const rows = await tx.$queryRaw<{ fecha: string; cantidad_recetario: number; cantidad_contralor: number }[]>`
    SELECT fecha::text AS fecha, sum(cantidad_recetario)::int AS cantidad_recetario, sum(cantidad_contralor)::int AS cantidad_contralor
    FROM (
      SELECT fecha_asiento AS fecha, count(*)::int AS cantidad_recetario, 0::int AS cantidad_contralor
      FROM fsj.asiento_recetario
      WHERE tenant_id = ${tenantId}::uuid AND estado = 'VIGENTE' AND cierre_diario_id IS NULL
      GROUP BY fecha_asiento
      UNION ALL
      SELECT fecha_asiento AS fecha, 0::int AS cantidad_recetario, count(*)::int AS cantidad_contralor
      FROM fsj.asiento_contralor
      WHERE tenant_id = ${tenantId}::uuid AND estado = 'VIGENTE' AND cierre_diario_id IS NULL
      GROUP BY fecha_asiento
    ) x
    WHERE fecha < fsj.jornada_actual(${tenantId}::uuid)
    GROUP BY fecha
    ORDER BY fecha ASC
  `;
  return rows.map((r) => ({ fecha: r.fecha, cantidadRecetario: r.cantidad_recetario, cantidadContralor: r.cantidad_contralor }));
}

/**
 * Cheap existence-only version for FASE 10 point 10.3's layout banner --
 * aggregates directly in SQL (count + min) instead of fetching every
 * pending fecha's per-type counts via `listJornadasPendientes` just to
 * throw all but the first one away. `UNION` (not `UNION ALL`) dedupes a
 * fecha that has BOTH an unsigned recetario and contralor asiento, same as
 * `listJornadasPendientes`'s `GROUP BY fecha`; the DP-18d filter (`estado =
 * 'VIGENTE' AND cierre_diario_id IS NULL`) is identical to that query's.
 */
export async function getResumenPendientes(tx: Prisma.TransactionClient, tenantId: string): Promise<{ cantidad: number; masAntiguaFecha: string | null }> {
  const rows = await tx.$queryRaw<{ cantidad: number; mas_antigua: string | null }[]>`
    SELECT count(*)::int AS cantidad, min(fecha)::text AS mas_antigua
    FROM (
      SELECT fecha_asiento AS fecha
      FROM fsj.asiento_recetario
      WHERE tenant_id = ${tenantId}::uuid AND estado = 'VIGENTE' AND cierre_diario_id IS NULL
      UNION
      SELECT fecha_asiento AS fecha
      FROM fsj.asiento_contralor
      WHERE tenant_id = ${tenantId}::uuid AND estado = 'VIGENTE' AND cierre_diario_id IS NULL
    ) x
    WHERE fecha < fsj.jornada_actual(${tenantId}::uuid)
  `;
  const row = rows[0];
  return { cantidad: row?.cantidad ?? 0, masAntiguaFecha: row?.mas_antigua ?? null };
}

/**
 * Recetario asientos registered on a pending jornada -- what the DT reviews
 * before signing it. Every estado is listed (an ANULADO asiento is part of
 * what happened that day), even though the firma only attaches the VIGENTE
 * ones. A pending fecha never has a cierre yet, so no `cierreDiarioId` filter.
 */
export interface AsientoJornadaItem {
  id: string;
  numeroCorrelativo: string;
  esRectificativo: boolean;
  asientoOriginalNumeroCorrelativo: string | null;
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
  estadoVisual: EstadoVisualAsiento;
}

export interface ListAsientosJornadaFilter {
  tenantId: string;
  fecha: string;
  page: number;
  pageSize: number;
}

export async function listAsientosJornada(tx: Prisma.TransactionClient, filter: ListAsientosJornadaFilter): Promise<{ items: AsientoJornadaItem[]; total: number }> {
  const where: Prisma.AsientoRecetarioWhereInput = { tenantId: filter.tenantId, fechaAsiento: new Date(filter.fecha) };

  const total = await tx.asientoRecetario.count({ where });
  const rows = await tx.asientoRecetario.findMany({
    where,
    orderBy: { numeroCorrelativo: "asc" },
    skip: (filter.page - 1) * filter.pageSize,
    take: filter.pageSize,
    select: {
      id: true,
      numeroCorrelativo: true,
      origen: true,
      pacienteTexto: true,
      medicoTexto: true,
      formulaTexto: true,
      estado: true,
      anulacion: {
        select: {
          motivo: true,
          anuladoEn: true,
          anuladoPor: { select: { nombre: true, apellido: true } },
          autorizadoPor: { select: { nombre: true, apellido: true } },
        },
      },
      rectificativos: { select: { numeroCorrelativo: true }, take: 1 },
      asientoOriginal: { select: { numeroCorrelativo: true } },
    },
  });

  return {
    total,
    items: rows.map((a) => ({
      id: a.id,
      numeroCorrelativo: a.numeroCorrelativo.toString(),
      esRectificativo: a.origen === "RECTIFICATIVO",
      asientoOriginalNumeroCorrelativo: a.asientoOriginal ? a.asientoOriginal.numeroCorrelativo.toString() : null,
      pacienteTexto: a.pacienteTexto,
      medicoTexto: a.medicoTexto,
      formulaTexto: a.formulaTexto,
      estadoVisual: resolverEstadoVisualAsiento({
        estado: a.estado,
        anulacion: a.anulacion
          ? {
              motivo: a.anulacion.motivo,
              anuladoEn: a.anulacion.anuladoEn,
              anuladoPorNombre: `${a.anulacion.anuladoPor.nombre} ${a.anulacion.anuladoPor.apellido}`,
              autorizadoPorNombre: `${a.anulacion.autorizadoPor.nombre} ${a.anulacion.autorizadoPor.apellido}`,
            }
          : null,
        rectificativoNumeroCorrelativo: a.rectificativos[0] ? a.rectificativos[0].numeroCorrelativo.toString() : null,
      }),
    })),
  };
}

// ============================================================================
// 10.1: resolving the signer's OWN vigente designación at `fecha` --
// resolved SERVER-SIDE, never from client input (user decision 6).
// ============================================================================

export interface DesignacionVigenteRow {
  id: string;
  matricula: string;
}

export async function getDesignacionVigenteEnFecha(
  tx: Prisma.TransactionClient,
  tenantId: string,
  usuarioId: string,
  fecha: string,
): Promise<DesignacionVigenteRow | null> {
  const rows = await tx.$queryRaw<{ id: string; matricula: string }[]>`
    SELECT id, matricula
    FROM fsj.designacion_director_tecnico
    WHERE tenant_id = ${tenantId}::uuid
      AND usuario_id = ${usuarioId}::uuid
      AND vigente_desde <= ${fecha}::date
      AND (vigente_hasta IS NULL OR vigente_hasta >= ${fecha}::date)
    ORDER BY vigente_desde DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ============================================================================
// Own copy of the password-lockout fields (see module doc comment) --
// `modules/cierres` cannot import `modules/auth/infrastructure/usuario-repository.ts`.
// ============================================================================

export interface UsuarioParaPasswordFirma {
  passwordHash: string | null;
  estado: EstadoUsuario;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

export async function cargarUsuarioParaPasswordFirma(tx: Prisma.TransactionClient, usuarioId: string): Promise<UsuarioParaPasswordFirma | null> {
  return tx.usuario.findUnique({
    where: { id: usuarioId },
    select: { passwordHash: true, estado: true, intentosFallidos: true, bloqueadoHasta: true },
  });
}

export interface FirmaPasswordFailureUpdate {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

export async function registrarFallaPasswordFirma(tx: Prisma.TransactionClient, usuarioId: string, update: FirmaPasswordFailureUpdate): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { intentosFallidos: update.intentosFallidos, bloqueadoHasta: update.bloqueadoHasta } });
}

export async function registrarExitoPasswordFirma(tx: Prisma.TransactionClient, usuarioId: string, now: Date): Promise<void> {
  await tx.usuario.update({ where: { id: usuarioId }, data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoAcceso: now } });
}

// ============================================================================
// 10.1: firmar (calls the SECURITY DEFINER DB function).
// ============================================================================

export interface FirmarCierreDbInput {
  tenantId: string;
  fecha: string;
  directorTecnicoId: string;
  designacionId: string;
  motivoDemora: string | null;
  motivoDemoraDetalle: string | null;
}

export interface CierreFirmado {
  id: string;
  fecha: string;
  cantidadAsientos: number;
  hashLote: string;
  fueraDeTermino: boolean;
  motivoDemora: string | null;
  fechaFirma: Date;
}

/**
 * `fsj.cierre_diario_firmar` returns a single row shaped like
 * `fsj.cierre_diario` (a composite RETURNS type) -- selecting its columns
 * straight out of the function call in the FROM clause is the same pattern
 * `tests/db/cierre-diario.test.ts` uses against the raw function.
 */
export async function firmarCierreDb(tx: Prisma.TransactionClient, input: FirmarCierreDbInput): Promise<CierreFirmado> {
  const rows = await tx.$queryRaw<
    { id: string; fecha: string; cantidad_asientos: number; hash_lote: string; fuera_de_termino: boolean; motivo_demora: string | null; fecha_firma: Date }[]
  >`
    SELECT id, fecha::text AS fecha, cantidad_asientos, hash_lote, fuera_de_termino, motivo_demora::text AS motivo_demora, fecha_firma
    FROM fsj.cierre_diario_firmar(
      ${input.tenantId}::uuid,
      ${input.fecha}::date,
      ${input.directorTecnicoId}::uuid,
      ${input.designacionId}::uuid,
      ${input.motivoDemora},
      ${input.motivoDemoraDetalle}
    )
  `;
  const row = rows[0];
  if (!row) throw new Error("firmarCierreDb: fsj.cierre_diario_firmar returned no row");
  return {
    id: row.id,
    fecha: row.fecha,
    cantidadAsientos: row.cantidad_asientos,
    hashLote: row.hash_lote,
    fueraDeTermino: row.fuera_de_termino,
    motivoDemora: row.motivo_demora,
    fechaFirma: row.fecha_firma,
  };
}

// ============================================================================
// 10.1/10.2: historial paginado + detalle (comprobante).
// ============================================================================

export interface CierreListItem {
  id: string;
  fecha: string;
  directorTecnicoNombre: string;
  directorTecnicoApellido: string;
  matriculaDt: string;
  cantidadAsientos: number;
  fueraDeTermino: boolean;
  fechaFirma: Date;
  fechaImpresion: Date | null;
}

export interface ListCierresFilter {
  tenantId: string;
  fechaDesde?: string;
  fechaHasta?: string;
  page: number;
  pageSize: number;
}

export async function listCierres(tx: Prisma.TransactionClient, filter: ListCierresFilter): Promise<{ items: CierreListItem[]; total: number }> {
  const where: Prisma.CierreDiarioWhereInput = { tenantId: filter.tenantId };
  if (filter.fechaDesde || filter.fechaHasta) {
    where.fecha = {
      ...(filter.fechaDesde ? { gte: new Date(filter.fechaDesde) } : {}),
      ...(filter.fechaHasta ? { lte: new Date(filter.fechaHasta) } : {}),
    };
  }
  const skip = (filter.page - 1) * filter.pageSize;

  const total = await tx.cierreDiario.count({ where });
  const rows = await tx.cierreDiario.findMany({
    where,
    orderBy: [{ fecha: "desc" }],
    skip,
    take: filter.pageSize,
    select: {
      id: true,
      fecha: true,
      matriculaDt: true,
      cantidadAsientos: true,
      fueraDeTermino: true,
      fechaFirma: true,
      fechaImpresion: true,
      directorTecnico: { select: { nombre: true, apellido: true } },
    },
  });

  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      fecha: r.fecha.toISOString().slice(0, 10),
      directorTecnicoNombre: r.directorTecnico.nombre,
      directorTecnicoApellido: r.directorTecnico.apellido,
      matriculaDt: r.matriculaDt,
      cantidadAsientos: r.cantidadAsientos,
      fueraDeTermino: r.fueraDeTermino,
      fechaFirma: r.fechaFirma,
      fechaImpresion: r.fechaImpresion,
    })),
  };
}

export interface AsientoRecetarioComprobante {
  numeroCorrelativo: string;
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
  /** ANULADO within the jornada: printed as "SI" in the sheet's Anulado column. */
  anulado: boolean;
  /** "Droga: lote, lote" per droga the asiento's preparaciones used, by droga name (display-only, see `lotesPorAsiento`). */
  lotes: string[];
  estadoVisual: string;
}

export interface AsientoContralorComprobante {
  numeroCorrelativo: string;
  tipoLibro: string;
  drogaDescripcion: string;
  tipoMovimiento: string;
  cantidad: string;
  saldoPosterior: string;
}

export interface CierreDetalle {
  id: string;
  tenantId: string;
  fecha: string;
  directorTecnicoNombre: string;
  directorTecnicoApellido: string;
  matriculaDt: string;
  cantidadAsientos: number;
  hashLote: string;
  selloTiempo: Date;
  mecanismoFirma: string;
  fechaFirma: Date;
  fueraDeTermino: boolean;
  motivoDemora: string | null;
  motivoDemoraDetalle: string | null;
  fechaImpresion: Date | null;
  asientosRecetario: AsientoRecetarioComprobante[];
  asientosContralor: AsientoContralorComprobante[];
}

/**
 * The partida lotes each asiento of the jornada used, for the sheet's Lote column: asiento -> its preparaciones
 * (legacy per-ítem `preparacion_id`, or por-receta `asiento_preparacion`, D8; a RECTIFICATIVO through its original
 * asiento, like `recetaNumeroInterno`) -> `movimiento_stock` EGRESO_PREPARACION -> `partida.lote`. Display-only: not
 * an asiento column, not hashed. One line per droga, "Droga: lote, lote", by droga name; an asiento without
 * preparaciones (historic) has no entry.
 */
async function lotesPorAsiento(tx: Prisma.TransactionClient, tenantId: string, fecha: string): Promise<Map<string, string[]>> {
  const rows = await tx.$queryRaw<{ asiento_id: string; droga: string; lotes: string }[]>`
    SELECT x.asiento_id::text AS asiento_id, d.nombre::text AS droga, string_agg(DISTINCT p.lote, ', ' ORDER BY p.lote) AS lotes
    FROM (
      SELECT a.id AS asiento_id, COALESCE(a.preparacion_id, o.preparacion_id) AS preparacion_id
      FROM fsj.asiento_recetario a
      LEFT JOIN fsj.asiento_recetario o ON o.tenant_id = a.tenant_id AND o.id = a.asiento_original_id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.fecha_asiento = ${fecha}::date
      UNION ALL
      SELECT a.id, ap.preparacion_id
      FROM fsj.asiento_recetario a
      JOIN fsj.asiento_preparacion ap ON ap.tenant_id = a.tenant_id AND ap.asiento_recetario_id = COALESCE(a.asiento_original_id, a.id)
      WHERE a.tenant_id = ${tenantId}::uuid AND a.fecha_asiento = ${fecha}::date
    ) x
    JOIN fsj.movimiento_stock m ON m.tenant_id = ${tenantId}::uuid AND m.preparacion_id = x.preparacion_id AND m.tipo = 'EGRESO_PREPARACION'
    JOIN fsj.partida p ON p.tenant_id = ${tenantId}::uuid AND p.id = m.partida_id
    JOIN fsj.droga d ON d.tenant_id = ${tenantId}::uuid AND d.id = p.droga_id
    GROUP BY x.asiento_id, d.nombre
    ORDER BY x.asiento_id, d.nombre
  `;
  const porAsiento = new Map<string, string[]>();
  for (const row of rows) {
    const lineas = porAsiento.get(row.asiento_id) ?? [];
    lineas.push(`${row.droga}: ${row.lotes}`);
    porAsiento.set(row.asiento_id, lineas);
  }
  return porAsiento;
}

export async function getCierreDetalle(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<CierreDetalle | null> {
  const cierre = await tx.cierreDiario.findUnique({
    where: { id, tenantId },
    select: {
      id: true,
      tenantId: true,
      fecha: true,
      matriculaDt: true,
      cantidadAsientos: true,
      hashLote: true,
      selloTiempo: true,
      mecanismoFirma: true,
      fechaFirma: true,
      fueraDeTermino: true,
      motivoDemora: true,
      motivoDemoraDetalle: true,
      fechaImpresion: true,
      directorTecnico: { select: { nombre: true, apellido: true } },
      asientosContralor: {
        orderBy: [{ libroId: "asc" }, { numeroCorrelativo: "asc" }],
        select: {
          numeroCorrelativo: true,
          tipoMovimiento: true,
          drogaDescripcion: true,
          cantidad: true,
          saldoPosterior: true,
          libro: { select: { tipo: true } },
        },
      },
    },
  });
  if (!cierre) return null;

  // Every asiento of the jornada, not only the ones attached to the cierre: the firma attaches the VIGENTE ones
  // (migration 0075), but the sheet lists the ANULADO ones too, marked "SI" in its Anulado column
  // (docs/specs/libro-recetario-y-contralor.md, "Impresión"). An asiento can only be anulado before the firma
  // (INV-L02), so these are exactly the ones anulados within the jornada.
  const asientosRecetario = await tx.asientoRecetario.findMany({
    where: { tenantId, fechaAsiento: cierre.fecha },
    orderBy: { numeroCorrelativo: "asc" },
    select: {
      id: true,
      numeroCorrelativo: true,
      pacienteTexto: true,
      medicoTexto: true,
      formulaTexto: true,
      estado: true,
      anulacion: {
        select: {
          motivo: true,
          anuladoEn: true,
          anuladoPor: { select: { nombre: true, apellido: true } },
          autorizadoPor: { select: { nombre: true, apellido: true } },
        },
      },
      rectificativos: { select: { numeroCorrelativo: true }, take: 1 },
    },
  });
  const lotes = await lotesPorAsiento(tx, tenantId, cierre.fecha.toISOString().slice(0, 10));

  return {
    id: cierre.id,
    tenantId: cierre.tenantId,
    fecha: cierre.fecha.toISOString().slice(0, 10),
    directorTecnicoNombre: cierre.directorTecnico.nombre,
    directorTecnicoApellido: cierre.directorTecnico.apellido,
    matriculaDt: cierre.matriculaDt,
    cantidadAsientos: cierre.cantidadAsientos,
    hashLote: cierre.hashLote,
    selloTiempo: cierre.selloTiempo,
    mecanismoFirma: cierre.mecanismoFirma,
    fechaFirma: cierre.fechaFirma,
    fueraDeTermino: cierre.fueraDeTermino,
    motivoDemora: cierre.motivoDemora,
    motivoDemoraDetalle: cierre.motivoDemoraDetalle,
    fechaImpresion: cierre.fechaImpresion,
    asientosRecetario: asientosRecetario.map((a) => ({
      numeroCorrelativo: a.numeroCorrelativo.toString(),
      pacienteTexto: a.pacienteTexto,
      medicoTexto: a.medicoTexto,
      formulaTexto: a.formulaTexto,
      anulado: a.estado === "ANULADO",
      lotes: lotes.get(a.id) ?? [],
      estadoVisual: etiquetaEstadoVisual(
        resolverEstadoVisualAsiento({
          estado: a.estado,
          anulacion: a.anulacion
            ? {
                motivo: a.anulacion.motivo,
                anuladoEn: a.anulacion.anuladoEn,
                anuladoPorNombre: `${a.anulacion.anuladoPor.nombre} ${a.anulacion.anuladoPor.apellido}`,
                autorizadoPorNombre: `${a.anulacion.autorizadoPor.nombre} ${a.anulacion.autorizadoPor.apellido}`,
              }
            : null,
          rectificativoNumeroCorrelativo: a.rectificativos[0] ? a.rectificativos[0].numeroCorrelativo.toString() : null,
        }),
      ),
    })),
    asientosContralor: cierre.asientosContralor.map((a) => ({
      numeroCorrelativo: a.numeroCorrelativo.toString(),
      tipoLibro: a.libro.tipo,
      drogaDescripcion: a.drogaDescripcion,
      tipoMovimiento: a.tipoMovimiento,
      cantidad: a.cantidad.toString(),
      saldoPosterior: a.saldoPosterior.toString(),
    })),
  };
}

// ============================================================================
// 10.2: primera impresión -- fsj_app has column-grant UPDATE(fecha_impresion,
// impreso_por_id) only, and the DB's own C04 trigger freezes it once set
// (see migration 0015) -- the `fechaImpresion: null` guard below is a
// friendly pre-check, not the real backstop.
// ============================================================================

/** The oldest signed cierre never printed (print order, ../domain/impresion.ts), or `null`. */
export async function getPrimerCierreSinImprimir(tx: Prisma.TransactionClient, tenantId: string): Promise<{ id: string; fecha: string } | null> {
  const row = await tx.cierreDiario.findFirst({ where: { tenantId, fechaImpresion: null }, orderBy: { fecha: "asc" }, select: { id: true, fecha: true } });
  return row ? { id: row.id, fecha: row.fecha.toISOString().slice(0, 10) } : null;
}

export async function getFechaCierre(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<string | null> {
  const row = await tx.cierreDiario.findUnique({ where: { id, tenantId }, select: { fecha: true } });
  return row ? row.fecha.toISOString().slice(0, 10) : null;
}

export async function marcarCierreImpreso(tx: Prisma.TransactionClient, tenantId: string, id: string, impresoPorId: string): Promise<boolean> {
  const result = await tx.cierreDiario.updateMany({
    where: { id, tenantId, fechaImpresion: null },
    data: { fechaImpresion: new Date(), impresoPorId },
  });
  return result.count > 0;
}

// ============================================================================
// 10.4: reporte de cumplimiento.
// ============================================================================

export interface CumplimientoItem {
  fecha: string;
  fechaFirma: Date;
  /**
   * Computed IN SQL as `fsj.jornada_de(fecha_firma, tenant.zona_horaria) - fecha`
   * -- the SAME source of truth `fsj.cierre_diario_calcular_fuera_de_termino`
   * uses for `fuera_de_termino` (migration 0038/0018). Deriving this in
   * JS via `shared/time/jornada.ts#jornadaDe` would silently default to
   * `America/Argentina/Mendoza` instead of the tenant's actual
   * `zona_horaria`, which is wrong for any tenant in a different time zone.
   */
  demoraDias: number;
  fueraDeTermino: boolean;
  motivoDemora: string | null;
  motivoDemoraDetalle: string | null;
  directorTecnicoNombre: string;
  directorTecnicoApellido: string;
}

export interface ReporteCumplimientoFilter {
  tenantId: string;
  fechaDesde?: string;
  fechaHasta?: string;
}

/** The report's WHERE, shared by the full listing, the paged listing and its counts. */
function cumplimientoWhere(filter: ReporteCumplimientoFilter): Prisma.Sql {
  return Prisma.sql`
    cd.tenant_id = ${filter.tenantId}::uuid
      AND (${filter.fechaDesde ?? null}::date IS NULL OR cd.fecha >= ${filter.fechaDesde ?? null}::date)
      AND (${filter.fechaHasta ?? null}::date IS NULL OR cd.fecha <= ${filter.fechaHasta ?? null}::date)
  `;
}

/** Every matching row (the CSV export). */
export async function listCumplimiento(tx: Prisma.TransactionClient, filter: ReporteCumplimientoFilter): Promise<CumplimientoItem[]> {
  return queryCumplimiento(tx, filter, Prisma.empty);
}

export interface CumplimientoPaginado {
  items: CumplimientoItem[];
  total: number;
  /** Over ALL matching rows, not only the page (the screen's "en término / fuera de término" summary). */
  fueraDeTermino: number;
}

/** One page of the report (the screen), plus the totals over every matching row. */
export async function listCumplimientoPaginado(
  tx: Prisma.TransactionClient,
  filter: ReporteCumplimientoFilter & { page: number; pageSize: number },
): Promise<CumplimientoPaginado> {
  const [conteo] = await tx.$queryRaw<{ total: number; fuera_de_termino: number }[]>`
    SELECT count(*)::int AS total, (count(*) FILTER (WHERE cd.fuera_de_termino))::int AS fuera_de_termino
    FROM fsj.cierre_diario cd
    WHERE ${cumplimientoWhere(filter)}
  `;
  const offset = (filter.page - 1) * filter.pageSize;
  const items = await queryCumplimiento(tx, filter, Prisma.sql`LIMIT ${filter.pageSize} OFFSET ${offset}`);
  return { items, total: conteo?.total ?? 0, fueraDeTermino: conteo?.fuera_de_termino ?? 0 };
}

async function queryCumplimiento(tx: Prisma.TransactionClient, filter: ReporteCumplimientoFilter, limite: Prisma.Sql): Promise<CumplimientoItem[]> {
  const rows = await tx.$queryRaw<
    {
      fecha: string;
      fecha_firma: Date;
      demora_dias: number;
      fuera_de_termino: boolean;
      motivo_demora: string | null;
      motivo_demora_detalle: string | null;
      director_tecnico_nombre: string;
      director_tecnico_apellido: string;
    }[]
  >`
    SELECT
      cd.fecha::text AS fecha,
      cd.fecha_firma AS fecha_firma,
      (fsj.jornada_de(cd.fecha_firma, t.zona_horaria) - cd.fecha)::int AS demora_dias,
      cd.fuera_de_termino AS fuera_de_termino,
      cd.motivo_demora::text AS motivo_demora,
      cd.motivo_demora_detalle AS motivo_demora_detalle,
      u.nombre AS director_tecnico_nombre,
      u.apellido AS director_tecnico_apellido
    FROM fsj.cierre_diario cd
    JOIN fsj.tenant t ON t.id = cd.tenant_id
    JOIN fsj.usuario u ON u.id = cd.director_tecnico_id
    WHERE ${cumplimientoWhere(filter)}
    ORDER BY cd.fecha ASC
    ${limite}
  `;
  return rows.map((r) => ({
    fecha: r.fecha,
    fechaFirma: r.fecha_firma,
    demoraDias: r.demora_dias,
    fueraDeTermino: r.fuera_de_termino,
    motivoDemora: r.motivo_demora,
    motivoDemoraDetalle: r.motivo_demora_detalle,
    directorTecnicoNombre: r.director_tecnico_nombre,
    directorTecnicoApellido: r.director_tecnico_apellido,
  }));
}
