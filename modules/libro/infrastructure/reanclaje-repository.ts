/**
 * Re-anchors of a libro's hash chain (`fsj.libro_reanclaje`, migration 0087, openspec/specs/libro-recetario-y-contralor/spec.md
 * "Reanclaje de la cadena"). Raw SQL: the table is append-only and only touched by this module.
 */
import type { Prisma } from "@/generated/prisma/client";

export interface HuecoCadena {
  /** The first existing row after the quiebre point. */
  desdeNumero: string;
  /** That row's stored hash_anterior (the link the chain would have to accept). */
  hashAnterior: string;
  /** True when a row exists AT the quiebre number: the chain broke on content, not on a missing row. */
  hayFilaEnElQuiebre: boolean;
}

/** The first row at or after `quiebre` in the libro (its rows live in asiento_recetario or asiento_contralor, never both), or null when there is none. */
export async function leerHuecoDesde(tx: Prisma.TransactionClient, tenantId: string, libroId: string, quiebre: string): Promise<HuecoCadena | null> {
  const rows = await tx.$queryRaw<{ numero: string; hashAnterior: string }[]>`
    SELECT t.numero_correlativo::text AS numero, t.hash_anterior AS "hashAnterior"
    FROM (
      SELECT numero_correlativo, hash_anterior FROM fsj.asiento_recetario WHERE tenant_id = ${tenantId}::uuid AND libro_id = ${libroId}::uuid
      UNION ALL
      SELECT numero_correlativo, hash_anterior FROM fsj.asiento_contralor WHERE tenant_id = ${tenantId}::uuid AND libro_id = ${libroId}::uuid
    ) t
    WHERE t.numero_correlativo >= ${quiebre}::bigint
    ORDER BY t.numero_correlativo
    LIMIT 1
  `;
  const fila = rows[0];
  if (!fila) return null;
  return { desdeNumero: fila.numero, hashAnterior: fila.hashAnterior, hayFilaEnElQuiebre: fila.numero === quiebre };
}

export async function insertReanclaje(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; libroId: string; numeroEsperado: string; desdeNumero: string; hashAnteriorAceptado: string; motivo: string; registradoPorId: string },
): Promise<{ id: string }> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO fsj.libro_reanclaje (tenant_id, libro_id, numero_esperado, desde_numero, hash_anterior_aceptado, motivo, registrado_por_id)
    VALUES (${input.tenantId}::uuid, ${input.libroId}::uuid, ${input.numeroEsperado}::bigint, ${input.desdeNumero}::bigint, ${input.hashAnteriorAceptado}, ${input.motivo}, ${input.registradoPorId}::uuid)
    RETURNING id::text AS id
  `;
  const fila = rows[0];
  if (!fila) throw new Error("insertReanclaje: no row returned");
  return fila;
}

export interface ReanclajeRow {
  id: string;
  libroId: string;
  tipo: "RECETARIO" | "PSICOTROPICO" | "ESTUPEFACIENTE";
  numeroEsperado: string;
  desdeNumero: string;
  motivo: string;
  registradoPor: string;
  registradoEn: Date;
}

export async function listReanclajes(tx: Prisma.TransactionClient, tenantId: string): Promise<ReanclajeRow[]> {
  return tx.$queryRaw<ReanclajeRow[]>`
    SELECT r.id::text AS id, r.libro_id::text AS "libroId", l.tipo::text AS tipo,
           r.numero_esperado::text AS "numeroEsperado", r.desde_numero::text AS "desdeNumero",
           r.motivo, (u.nombre || ' ' || u.apellido) AS "registradoPor", r.registrado_en AS "registradoEn"
    FROM fsj.libro_reanclaje r
    JOIN fsj.libro_rubricado l ON l.tenant_id = r.tenant_id AND l.id = r.libro_id
    JOIN fsj.usuario u ON u.tenant_id = r.tenant_id AND u.id = r.registrado_por_id
    WHERE r.tenant_id = ${tenantId}::uuid
    ORDER BY r.registrado_en DESC
  `;
}
