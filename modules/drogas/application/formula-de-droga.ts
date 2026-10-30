/**
 * Reading a droga's fórmula (openspec/changes/lotes-elaborados EL3).
 *
 *   - `formulasDeDrogasEnTx`: NOT a use case -- runs inside the caller's transaction (the "Elaborar lote" data and the
 *     cotización's costo fallback, R38), like `costosProveedorParaCotizar`.
 *   - `verFormulaQuery`: the droga's form (alta and edit, `drogas.editar` like `get-droga`).
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { formulasQueUsan, getFormulasDeDrogas, type FormulaLeida } from "../infrastructure/formula-repository";

export type { FormulaLeida };

export async function formulasDeDrogasEnTx(tx: Prisma.TransactionClient, tenantId: string, drogaIds: readonly string[]): Promise<Map<string, FormulaLeida>> {
  return getFormulasDeDrogas(tx, tenantId, drogaIds);
}

export interface FormulaDeDroga {
  formula: FormulaLeida | null;
  /** Names of the drogas whose fórmula uses this one: then it cannot have its own (one level, INV-EL5). */
  esComponenteDe: string[];
}

export const verFormulaQuery = defineQuery({
  name: "drogas.formula.ver",
  permiso: "drogas.editar",
  input: z.object({ drogaId: uuid }),
  handler: async ({ tx, session, input }): Promise<FormulaDeDroga> => {
    const formulas = await getFormulasDeDrogas(tx, session.tenantId, [input.drogaId]);
    return { formula: formulas.get(input.drogaId) ?? null, esComponenteDe: await formulasQueUsan(tx, session.tenantId, input.drogaId) };
  },
});

export async function verFormula(input: { drogaId: string }): Promise<FormulaDeDroga> {
  return verFormulaQuery.execute(input);
}
