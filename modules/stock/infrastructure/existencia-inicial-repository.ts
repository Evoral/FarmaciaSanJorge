/**
 * Relevamiento inicial (openspec/specs/existencia-inicial/spec.md, migration 0100).
 * The window is read from `fsj.relevamiento_inicial_abierto` /
 * `fsj.relevamiento_inicial_fecha_limite`, the functions INV-S24 enforces
 * with -- never recomputed here.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoRelevamientoInicial, SaldoControlada } from "../domain/existencia-inicial";

export async function relevamientoInicialAbierto(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ abierto: boolean }[]>`SELECT fsj.relevamiento_inicial_abierto(${tenantId}::uuid) AS abierto`;
  return rows[0]?.abierto ?? false;
}

export async function getEstadoRelevamientoInicial(tx: Prisma.TransactionClient, tenantId: string): Promise<EstadoRelevamientoInicial> {
  const rows = await tx.$queryRaw<{ abierto: boolean; cerrado_en: Date | null; cerrado_por: string | null; fecha_limite: string | null }[]>`
    SELECT fsj.relevamiento_inicial_abierto(t.id) AS abierto,
      t.relevamiento_inicial_cerrado_en AS cerrado_en,
      CASE WHEN u.id IS NULL THEN NULL ELSE u.apellido || ', ' || u.nombre END AS cerrado_por,
      fsj.relevamiento_inicial_fecha_limite(t.id)::text AS fecha_limite
    FROM fsj.tenant t
    LEFT JOIN fsj.usuario u ON u.tenant_id = t.id AND u.id = t.relevamiento_inicial_cerrado_por_id
    WHERE t.id = ${tenantId}::uuid
  `;
  const row = rows[0];
  if (!row) throw new Error(`getEstadoRelevamientoInicial: no tenant ${tenantId}`);
  return { abierto: row.abierto, cerradoEn: row.cerrado_en, cerradoPor: row.cerrado_por, fechaLimite: row.fecha_limite };
}

/** Locks the tenant row: two concurrent closes serialize, the second sees the first one's columns. */
export async function lockTenantRelevamiento(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM fsj.tenant WHERE id = ${tenantId}::uuid FOR UPDATE`;
}

/**
 * Shared lock on the tenant row for an existencia inicial alta: it conflicts with the close's FOR UPDATE, so an
 * alta and the close serialize -- the close never misses a partida committed after its R8 check.
 */
export async function lockTenantRelevamientoCompartido(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM fsj.tenant WHERE id = ${tenantId}::uuid FOR SHARE`;
}

/** INV-S26 (DB) re-checks the DT vigente and the write-once rule. */
export async function cerrarRelevamientoInicial(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<Date> {
  const row = await tx.tenant.update({
    where: { id: tenantId },
    data: { relevamientoInicialCerradoEn: new Date(), relevamientoInicialCerradoPorId: usuarioId },
    select: { relevamientoInicialCerradoEn: true },
  });
  return row.relevamientoInicialCerradoEn as Date;
}

export interface ExistenciaInicialPorDroga {
  drogaId: string;
  drogaNombre: string;
  partidas: number;
}

/** What was loaded, per droga -- shown before the DT confirms the close (spec R7). */
export async function contarExistenciaInicialPorDroga(tx: Prisma.TransactionClient, tenantId: string): Promise<ExistenciaInicialPorDroga[]> {
  const rows = await tx.$queryRaw<{ droga_id: string; nombre: string; partidas: number }[]>`
    SELECT d.id AS droga_id, d.nombre::text AS nombre, count(*)::int AS partidas
    FROM fsj.partida p
    JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.origen = 'EXISTENCIA_INICIAL'
    GROUP BY d.id, d.nombre
    ORDER BY d.nombre
  `;
  return rows.map((r) => ({ drogaId: r.droga_id, drogaNombre: r.nombre, partidas: r.partidas }));
}

/**
 * Every controlled droga: the `saldo_posterior` of its latest vigente asiento in the open libro of its
 * `tipo_control` (INV-L13's own reading), and the sum of its partidas' `cantidad_disponible` (spec R8).
 */
export async function listSaldosControladas(tx: Prisma.TransactionClient, tenantId: string): Promise<SaldoControlada[]> {
  const rows = await tx.$queryRaw<{ droga_id: string; nombre: string; simbolo: string; saldo_contralor: string | null; stock_fisico: string }[]>`
    SELECT d.id AS droga_id, d.nombre::text AS nombre, u.simbolo,
      (
        SELECT ac.saldo_posterior::text
        FROM fsj.asiento_contralor ac
        JOIN fsj.libro_rubricado l ON l.tenant_id = ac.tenant_id AND l.id = ac.libro_id
        WHERE ac.tenant_id = d.tenant_id AND ac.droga_id = d.id AND ac.estado = 'VIGENTE'
          AND l.tipo::text = d.tipo_control::text AND l.fecha_cierre IS NULL
        ORDER BY ac.numero_correlativo DESC
        LIMIT 1
      ) AS saldo_contralor,
      coalesce((SELECT sum(p.cantidad_disponible) FROM fsj.partida p WHERE p.tenant_id = d.tenant_id AND p.droga_id = d.id), 0)::text AS stock_fisico
    FROM fsj.droga d
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    WHERE d.tenant_id = ${tenantId}::uuid AND d.tipo_control <> 'NINGUNO'
    ORDER BY d.nombre
  `;
  return rows.map((r) => ({
    drogaId: r.droga_id,
    drogaNombre: r.nombre,
    unidadSimbolo: r.simbolo,
    saldoContralor: r.saldo_contralor,
    stockFisico: r.stock_fisico,
  }));
}
