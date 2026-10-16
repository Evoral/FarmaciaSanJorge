/**
 * Days of the libro recetario with their firma (`/libro/dias`, ../domain/jornadas.ts). One row per `fecha_asiento`
 * that has at least one asiento_recetario, with its cierre diario when signed. A tenant writes a few hundred days a
 * year, so the whole list is read at once and paginated by the caller (the debt count needs every day anyway).
 */
import type { Prisma } from "@/generated/prisma/client";

export interface JornadaLibroRow {
  fecha: string; // YYYY-MM-DD
  asientos: number;
  vigentesSinFirmar: number;
  cierreId: string | null;
  /** The cierre's sheet was printed at least once (`cierre_diario.fecha_impresion`). */
  impresa: boolean;
}

export async function listJornadasLibro(tx: Prisma.TransactionClient, tenantId: string): Promise<JornadaLibroRow[]> {
  return tx.$queryRaw<JornadaLibroRow[]>`
    SELECT a.fecha_asiento::text AS fecha,
           count(*)::int AS asientos,
           (count(*) FILTER (WHERE a.estado = 'VIGENTE' AND a.cierre_diario_id IS NULL))::int AS "vigentesSinFirmar",
           c.id::text AS "cierreId",
           (c.fecha_impresion IS NOT NULL) AS impresa
    FROM fsj.asiento_recetario a
    LEFT JOIN fsj.cierre_diario c ON c.tenant_id = a.tenant_id AND c.fecha = a.fecha_asiento
    WHERE a.tenant_id = ${tenantId}::uuid
    GROUP BY a.fecha_asiento, c.id, c.fecha_impresion
    ORDER BY a.fecha_asiento DESC
  `;
}

/** `fsj.jornada_actual(tenant)`: the tenant's business day. */
export async function readJornadaActual(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`readJornadaActual: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}
