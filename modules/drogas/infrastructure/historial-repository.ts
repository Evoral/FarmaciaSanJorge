/**
 * Prisma-backed reads for the droga "Historial" view
 * (docs/specs/historial-droga.md). Every function runs inside an ALREADY OPEN
 * tenant transaction (RLS-scoped) and filters by `tenantId` explicitly as well:
 * EVERY `FROM` and EVERY `JOIN` of the raw SQL carries its own `tenant_id`
 * (composite-key discipline). HEALTH-ADJACENT DATA (receta, paciente, Ley
 * 25.326): no function passes a paciente field or any free text to a logger.
 *
 * What counts as "the droga reached a receta": ONLY the consumed path,
 * `partida (droga) -> movimiento_stock EGRESO_PREPARACION -> preparacion ->
 * item_receta -> receta`. EGRESO_PREPARACION is written only when a
 * preparación is confirmed and descartar never touches stock, so those
 * movements are by themselves the complete and exact source (spec "Goal").
 * DB constraint (migration 0008): an EGRESO_PREPARACION always has a
 * preparacion_id.
 *
 * Read pattern (no N+1, whatever the page size):
 *   1. the droga (header + unidad base) and the tenant's zona horaria,
 *   2. the droga's partidas with at least one egreso (the filter's options),
 *   3. ONE count that answers both the unfiltered and the filtered total,
 *   4. ONE page of recetas (GROUP BY receta, SUM in SQL numeric, newest first),
 *   5. ONE detail statement over the page's receta ids (receta x partida),
 *   6. ONE paciente-names statement, ONLY when the caller says the session may
 *      see them (it is not fetched and then hidden).
 * Queries run sequentially: they share one interactive transaction (one
 * connection).
 *
 * The partida filter is never trusted: only requested ids that are in the
 * droga's option list reach the SQL, as ONE bound `uuid[]`; the statements
 * switch on `cardinality(...) = 0` instead of building SQL text. The filter
 * selects recetas (HAVING bool_or over the receta's movements); it never
 * trims what a receta shows (the detail statement does not receive it).
 *
 * Quantities are SQL `numeric` aggregates read as text: never summed in JS and
 * never across drogas (one droga = one unidad base here). Cross-module reads
 * (`fsj.movimiento_stock`, `fsj.preparacion`, `fsj.item_receta`, `fsj.receta`,
 * `fsj.medico`, `fsj.paciente`, `fsj.proveedor`) go against the shared schema,
 * same convention as modules/proveedores/infrastructure/trayectoria-repository.ts:
 * a module does not import another module's infrastructure layer. Raw SQL with
 * explicit columns for receta data because `schema.prisma` still declares
 * receta columns the shared DB dropped.
 */
import type { Prisma } from "@/generated/prisma/client";
import { calcularPaginacion, filtrarPartidasDeLaDroga } from "../domain/historial";
import type {
  AccesoHistorialDroga,
  DrogaHistorial,
  HistorialDrogaCruda,
  PacienteRecetaCrudo,
  PartidaConsumidaCruda,
  PartidaOpcion,
  RecetaConsumoCruda,
} from "../domain/historial";

/** Which optional pieces to read: the subset of `AccesoHistorialDroga` that is about data (not links). */
export type BloquesHistorialDroga = Pick<AccesoHistorialDroga, "pacientes">;

export async function readDroga(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<DrogaHistorial | null> {
  const row = await tx.droga.findUnique({
    where: { id: drogaId, tenantId },
    select: { id: true, nombre: true, fechaBaja: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } },
  });
  if (!row) return null;
  return { id: row.id, nombre: row.nombre, fechaBaja: row.fechaBaja, unidadBaseId: row.unidadBaseId, unidadBaseSimbolo: row.unidadBase.simbolo };
}

/**
 * The droga's partidas that have at least one EGRESO_PREPARACION, newest
 * ingreso first: the options of the "filtrar por partida" control. Enters by
 * `partida (tenant_id, droga_id)`, then one EXISTS per partida through
 * `movimiento_stock (tenant_id, partida_id, registrado_en DESC)`.
 */
export async function readPartidasConConsumo(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<PartidaOpcion[]> {
  const rows = await tx.$queryRaw<{ id: string; lote: string; fecha_vencimiento: Date | null; proveedor: string }[]>`
    SELECT p.id, p.lote, p.fecha_vencimiento, pv.razon_social AS proveedor
    FROM fsj.partida p
    JOIN fsj.proveedor pv ON pv.tenant_id = ${tenantId}::uuid AND pv.id = p.proveedor_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.droga_id = ${drogaId}::uuid
      AND EXISTS (
        SELECT 1
        FROM fsj.movimiento_stock m
        WHERE m.tenant_id = ${tenantId}::uuid AND m.partida_id = p.id AND m.tipo = 'EGRESO_PREPARACION'
      )
    ORDER BY p.fecha_ingreso DESC, p.id DESC
  `;
  return rows.map((r) => ({ id: r.id, lote: r.lote, proveedor: r.proveedor, fechaVencimiento: r.fecha_vencimiento }));
}

/**
 * Distinct recetas that consumed the droga: `totalRecetas` ignores the filter,
 * `totalFiltradas` honours it (a receta matches when it consumed from ANY
 * selected partida; an empty filter matches everything). One pass, one group
 * per receta.
 */
export async function countRecetas(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  partidaIds: readonly string[],
): Promise<{ totalRecetas: number; totalFiltradas: number }> {
  const ids = [...partidaIds];
  const rows = await tx.$queryRaw<{ total_recetas: number; total_filtradas: number }[]>`
    SELECT
      count(*)::int AS total_recetas,
      (count(*) FILTER (WHERE cardinality(${ids}::uuid[]) = 0 OR g.coincide))::int AS total_filtradas
    FROM (
      SELECT ir.receta_id, bool_or(m.partida_id = ANY(${ids}::uuid[])) AS coincide
      FROM fsj.partida p
      JOIN fsj.movimiento_stock m ON m.tenant_id = ${tenantId}::uuid AND m.partida_id = p.id AND m.tipo = 'EGRESO_PREPARACION'
      JOIN fsj.preparacion pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = m.preparacion_id
      JOIN fsj.item_receta ir ON ir.tenant_id = ${tenantId}::uuid AND ir.id = pr.item_receta_id
      WHERE p.tenant_id = ${tenantId}::uuid AND p.droga_id = ${drogaId}::uuid
      GROUP BY ir.receta_id
    ) g
  `;
  const r = rows[0];
  return { totalRecetas: r?.total_recetas ?? 0, totalFiltradas: r?.total_filtradas ?? 0 };
}

/**
 * One page of recetas, ONE row per receta: `consumido` is the SUM of this
 * droga's EGRESO_PREPARACION over ALL the receta's items and partidas (the
 * filter never trims it), `preparada_en` the latest confirmación among those
 * movements. Newest first; `numero_interno` (unique per tenant) is the stable
 * tie-break. `page` must already be clamped by the caller.
 */
export async function readRecetasPagina(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  partidaIds: readonly string[],
  page: number,
  pageSize: number,
): Promise<RecetaConsumoCruda[]> {
  const ids = [...partidaIds];
  const offset = (page - 1) * pageSize;
  const rows = await tx.$queryRaw<
    {
      id: string;
      numero_interno: string;
      estado: string;
      consumido: string;
      preparada_en: Date | null;
      medico_apellido: string;
      medico_nombre: string;
    }[]
  >`
    SELECT
      r.id,
      r.numero_interno::text AS numero_interno,
      r.estado::text AS estado,
      x.consumido::text AS consumido,
      x.preparada_en,
      me.apellido AS medico_apellido,
      me.nombre AS medico_nombre
    FROM (
      SELECT ir.receta_id, sum(m.cantidad) AS consumido, max(pr.confirmada_en) AS preparada_en
      FROM fsj.partida p
      JOIN fsj.movimiento_stock m ON m.tenant_id = ${tenantId}::uuid AND m.partida_id = p.id AND m.tipo = 'EGRESO_PREPARACION'
      JOIN fsj.preparacion pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = m.preparacion_id
      JOIN fsj.item_receta ir ON ir.tenant_id = ${tenantId}::uuid AND ir.id = pr.item_receta_id
      WHERE p.tenant_id = ${tenantId}::uuid AND p.droga_id = ${drogaId}::uuid
      GROUP BY ir.receta_id
      HAVING cardinality(${ids}::uuid[]) = 0 OR bool_or(m.partida_id = ANY(${ids}::uuid[]))
    ) x
    JOIN fsj.receta r ON r.tenant_id = ${tenantId}::uuid AND r.id = x.receta_id
    JOIN fsj.medico me ON me.tenant_id = ${tenantId}::uuid AND me.id = r.medico_id
    ORDER BY x.preparada_en DESC NULLS LAST, r.numero_interno DESC
    LIMIT ${pageSize}::int OFFSET ${offset}::int
  `;
  return rows.map((r) => ({
    id: r.id,
    numeroInterno: r.numero_interno,
    estado: r.estado,
    preparadaEn: r.preparada_en,
    consumido: r.consumido,
    medicoApellido: r.medico_apellido,
    medicoNombre: r.medico_nombre,
  }));
}

/**
 * Detail for the page: what each receta consumed of THIS droga, per partida
 * (`SUM(cantidad)` grouped by receta x partida) with lote / proveedor /
 * vencimiento. Deliberately does NOT receive the partida filter: an expanded
 * receta always shows everything it consumed.
 */
export async function readPartidasConsumidas(tx: Prisma.TransactionClient, tenantId: string, drogaId: string, recetaIds: string[]): Promise<PartidaConsumidaCruda[]> {
  const rows = await tx.$queryRaw<
    { receta_id: string; partida_id: string; lote: string; fecha_vencimiento: Date | null; proveedor: string; cantidad: string }[]
  >`
    SELECT
      ir.receta_id,
      p.id AS partida_id,
      p.lote,
      p.fecha_vencimiento,
      pv.razon_social AS proveedor,
      sum(m.cantidad)::text AS cantidad
    FROM fsj.partida p
    JOIN fsj.movimiento_stock m ON m.tenant_id = ${tenantId}::uuid AND m.partida_id = p.id AND m.tipo = 'EGRESO_PREPARACION'
    JOIN fsj.preparacion pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = m.preparacion_id
    JOIN fsj.item_receta ir ON ir.tenant_id = ${tenantId}::uuid AND ir.id = pr.item_receta_id AND ir.receta_id = ANY(${recetaIds}::uuid[])
    JOIN fsj.proveedor pv ON pv.tenant_id = ${tenantId}::uuid AND pv.id = p.proveedor_id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.droga_id = ${drogaId}::uuid
    GROUP BY ir.receta_id, p.id, p.lote, p.fecha_vencimiento, p.fecha_ingreso, pv.razon_social
    ORDER BY ir.receta_id, p.fecha_ingreso DESC, p.id DESC
  `;
  return rows.map((r) => ({
    recetaId: r.receta_id,
    partidaId: r.partida_id,
    lote: r.lote,
    proveedor: r.proveedor,
    fechaVencimiento: r.fecha_vencimiento,
    cantidad: r.cantidad,
  }));
}

/** Names (only) of the pacientes of the page's recetas, in ONE statement. Read ONLY with `pacientes.gestionar`. */
export async function readPacientes(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<PacienteRecetaCrudo[]> {
  const rows = await tx.$queryRaw<{ receta_id: string; apellido: string; nombre: string }[]>`
    SELECT r.id AS receta_id, pa.apellido, pa.nombre
    FROM fsj.receta r
    JOIN fsj.paciente pa ON pa.tenant_id = ${tenantId}::uuid AND pa.id = r.paciente_id
    WHERE r.tenant_id = ${tenantId}::uuid AND r.id = ANY(${recetaIds}::uuid[])
  `;
  return rows.map((r) => ({ recetaId: r.receta_id, apellido: r.apellido, nombre: r.nombre }));
}

/**
 * The raw Historial of one droga: header, options, one page of recetas and
 * the requested optional pieces. `null` when the droga does not exist in the
 * tenant. `page` is clamped to the last page of the FILTERED result.
 * `partidaIdsSolicitados` is the (already parsed) filter: ids that are not one
 * of the droga's option partidas are ignored.
 */
export async function getHistorialDrogaCruda(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  page: number,
  pageSize: number,
  bloques: BloquesHistorialDroga,
  partidaIdsSolicitados: readonly string[] = [],
): Promise<HistorialDrogaCruda | null> {
  const droga = await readDroga(tx, tenantId, drogaId);
  if (!droga) return null;

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  const partidasDisponibles = await readPartidasConConsumo(tx, tenantId, drogaId);
  // The requested ids are never trusted: only those that are one of the droga's own option partidas are applied.
  const partidaIds = filtrarPartidasDeLaDroga(partidaIdsSolicitados, partidasDisponibles);

  // No partida with an egreso means no receta at all: skip the heavy statements.
  const { totalRecetas, totalFiltradas } = partidasDisponibles.length === 0 ? { totalRecetas: 0, totalFiltradas: 0 } : await countRecetas(tx, tenantId, drogaId, partidaIds);
  const paginacion = calcularPaginacion(totalFiltradas, page, pageSize);

  const recetas = totalFiltradas === 0 ? [] : await readRecetasPagina(tx, tenantId, drogaId, partidaIds, paginacion.page, pageSize);
  const recetaIds = recetas.map((r) => r.id);
  const partidasConsumidas = recetaIds.length > 0 ? await readPartidasConsumidas(tx, tenantId, drogaId, recetaIds) : [];
  const pacientes = bloques.pacientes && recetaIds.length > 0 ? await readPacientes(tx, tenantId, recetaIds) : [];

  return {
    droga,
    zonaHoraria: tenant.zonaHoraria,
    partidasDisponibles,
    partidaIds,
    totalRecetas,
    totalFiltradas,
    page: paginacion.page,
    recetas,
    pacientes,
    partidasConsumidas,
  };
}
