/**
 * A droga's fórmula (migration 0111, openspec/changes/lotes-elaborados EL3). The header is upserted and its
 * components replaced as a whole on every save; the database re-checks the one level rule (INV-EL5).
 */
import type { Prisma } from "@/generated/prisma/client";

export interface ComponenteFormulaLeido {
  drogaId: string;
  drogaNombre: string;
  /** The component droga's unidad base. */
  cantidad: string;
  unidadBaseSimbolo: string;
}

export interface FormulaLeida {
  id: string;
  drogaId: string;
  /** The produced droga's unidad base. */
  cantidadReferencia: string;
  componentes: ComponenteFormulaLeido[];
}

/** The fórmula of each of `drogaIds` (drogas without one are absent), components in their `orden`. ONE query each table. */
export async function getFormulasDeDrogas(tx: Prisma.TransactionClient, tenantId: string, drogaIds: readonly string[]): Promise<Map<string, FormulaLeida>> {
  if (drogaIds.length === 0) return new Map();
  const formulas = await tx.formulaElaboracion.findMany({
    where: { tenantId, drogaId: { in: [...drogaIds] } },
    select: { id: true, drogaId: true, cantidadReferencia: true },
  });
  if (formulas.length === 0) return new Map();

  const componentes = await tx.$queryRaw<{ formula_id: string; droga_id: string; nombre: string; cantidad: string; simbolo: string }[]>`
    SELECT c.formula_id, c.droga_id, d.nombre, c.cantidad::text, u.simbolo
    FROM fsj.formula_elaboracion_componente c
    JOIN fsj.droga d ON d.tenant_id = c.tenant_id AND d.id = c.droga_id
    JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
    WHERE c.tenant_id = ${tenantId}::uuid AND c.formula_id = ANY(${formulas.map((f) => f.id)}::uuid[])
    ORDER BY c.formula_id, c.orden
  `;

  return new Map(
    formulas.map((f) => [
      f.drogaId,
      {
        id: f.id,
        drogaId: f.drogaId,
        cantidadReferencia: f.cantidadReferencia.toString(),
        componentes: componentes
          .filter((c) => c.formula_id === f.id)
          .map((c) => ({ drogaId: c.droga_id, drogaNombre: c.nombre, cantidad: c.cantidad, unidadBaseSimbolo: c.simbolo })),
      },
    ]),
  );
}

/** Name and baja of each of `drogaIds` (missing ones are absent). */
export async function getDrogasParaFormula(tx: Prisma.TransactionClient, tenantId: string, drogaIds: readonly string[]): Promise<Map<string, { nombre: string; deBaja: boolean }>> {
  if (drogaIds.length === 0) return new Map();
  const rows = await tx.droga.findMany({ where: { tenantId, id: { in: [...drogaIds] } }, select: { id: true, nombre: true, fechaBaja: true } });
  return new Map(rows.map((r) => [r.id, { nombre: r.nombre, deBaja: r.fechaBaja !== null }]));
}

/** Which of `drogaIds` have their own fórmula. */
export async function drogasConFormula(tx: Prisma.TransactionClient, tenantId: string, drogaIds: readonly string[]): Promise<Set<string>> {
  if (drogaIds.length === 0) return new Set();
  const rows = await tx.formulaElaboracion.findMany({ where: { tenantId, drogaId: { in: [...drogaIds] } }, select: { drogaId: true } });
  return new Set(rows.map((r) => r.drogaId));
}

/** Names of the drogas whose fórmula lists `drogaId` as a component. */
export async function formulasQueUsan(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ nombre: string }[]>`
    SELECT d.nombre
    FROM fsj.formula_elaboracion_componente c
    JOIN fsj.formula_elaboracion f ON f.tenant_id = c.tenant_id AND f.id = c.formula_id
    JOIN fsj.droga d ON d.tenant_id = f.tenant_id AND d.id = f.droga_id
    WHERE c.tenant_id = ${tenantId}::uuid AND c.droga_id = ${drogaId}::uuid
    ORDER BY d.nombre
  `;
  return rows.map((r) => r.nombre);
}

/** Locks the droga row (serializes two saves of the same fórmula). Returns `false` when it does not exist. */
export async function lockDrogaParaFormula(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.droga WHERE tenant_id = ${tenantId}::uuid AND id = ${drogaId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

export interface GuardarFormulaInput {
  tenantId: string;
  drogaId: string;
  cantidadReferencia: string;
  componentes: readonly { drogaId: string; cantidad: string }[];
  usuarioId: string;
}

/** Upserts the header and replaces the components (DELETE + INSERT, `orden` = position). Returns the fórmula id. */
export async function guardarFormula(tx: Prisma.TransactionClient, input: GuardarFormulaInput): Promise<string> {
  const [header] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO fsj.formula_elaboracion (tenant_id, droga_id, cantidad_referencia, actualizada_por_id)
    VALUES (${input.tenantId}::uuid, ${input.drogaId}::uuid, ${input.cantidadReferencia}::numeric, ${input.usuarioId}::uuid)
    ON CONFLICT (tenant_id, droga_id) DO UPDATE
      SET cantidad_referencia = EXCLUDED.cantidad_referencia,
          actualizada_por_id = EXCLUDED.actualizada_por_id,
          actualizada_en = now()
    RETURNING id
  `;
  const formulaId = header!.id;

  await tx.formulaElaboracionComponente.deleteMany({ where: { tenantId: input.tenantId, formulaId } });
  await tx.formulaElaboracionComponente.createMany({
    data: input.componentes.map((c, orden) => ({ tenantId: input.tenantId, formulaId, orden, drogaId: c.drogaId, cantidad: c.cantidad })),
  });
  return formulaId;
}

/** Deletes the fórmula (its components cascade). `false` when the droga had none. A fórmula already used by an elaboración is kept by its FK. */
export async function eliminarFormula(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<boolean> {
  const { count } = await tx.formulaElaboracion.deleteMany({ where: { tenantId, drogaId } });
  return count > 0;
}

/** `true` when some elaboración was precargada from this fórmula (it can then be edited, never deleted). */
export async function formulaUsadaEnElaboracion(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ usada: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM fsj.elaboracion_lote e
      JOIN fsj.formula_elaboracion f ON f.tenant_id = e.tenant_id AND f.id = e.formula_id
      WHERE e.tenant_id = ${tenantId}::uuid AND f.droga_id = ${drogaId}::uuid
    ) AS usada
  `;
  return rows[0]?.usada ?? false;
}
