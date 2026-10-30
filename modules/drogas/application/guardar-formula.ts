/**
 * A droga's fórmula (openspec/changes/lotes-elaborados EL3, INV-EL5): its components per `cantidadReferencia` of the
 * product, every quantity in its droga's unidad base. Saved with the droga's alta and edit form, in the SAME
 * transaction (`aplicarFormulaEnTx`, called by `drogas.crear` / `drogas.editar`), and audited as its own
 * `formula_elaboracion` row like a synonym is. `drogas.formula.guardar` / `drogas.formula.eliminar` run the same
 * helper on their own. The droga row is locked first, so two saves of the same fórmula serialize; the database
 * re-checks the one level rule.
 *
 * A fórmula an elaboración was precargada from can be edited (later elaborations use the new one; the lots already
 * made keep their real consumption in their movements) but never deleted: its FK keeps it.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError } from "@/shared/errors";
import { positiveDecimalString, uuid } from "@/shared/validation";
import { validarFormula } from "../domain/formula";
import {
  drogasConFormula,
  eliminarFormula as eliminarFormulaRepo,
  formulasQueUsan,
  formulaUsadaEnElaboracion,
  getDrogasParaFormula,
  getFormulasDeDrogas,
  guardarFormula as guardarFormulaRepo,
  lockDrogaParaFormula,
  type FormulaLeida,
} from "../infrastructure/formula-repository";

/** The fórmula as the droga commands take it; `null` = the droga has none (removes a stored one). */
export const formulaInput = z
  .object({
    cantidadReferencia: positiveDecimalString,
    componentes: z.array(z.object({ drogaId: uuid, cantidad: positiveDecimalString })).max(50, "Una fórmula admite hasta 50 componentes."),
  })
  .nullable();

export type FormulaInput = z.output<typeof formulaInput>;

/** PRE-parse shape (quantities as typed). */
export interface FormulaInputCrudo {
  cantidadReferencia: string;
  componentes: { drogaId: string; cantidad: string }[];
}

function resumen(formula: FormulaLeida) {
  return { cantidadReferencia: formula.cantidadReferencia, componentes: formula.componentes.map((c) => ({ droga: c.drogaNombre, cantidad: c.cantidad })) };
}

/**
 * Saves (`formula` given) or removes (`null`) the fórmula of `drogaId` inside the caller's transaction, auditing it
 * as `formula_elaboracion`. Removing a fórmula that does not exist is a no-op. Throws `DomainError` with the
 * offending field (`cantidadReferencia`, `componentes`, `componente_<drogaId>`).
 */
export async function aplicarFormulaEnTx(tx: Prisma.TransactionClient, session: AuthenticatedSession, drogaId: string, formula: FormulaInput): Promise<void> {
  const tenantId = session.tenantId;
  if (!(await lockDrogaParaFormula(tx, tenantId, drogaId))) throw new NotFoundError("Droga no encontrada.");
  const anterior = (await getFormulasDeDrogas(tx, tenantId, [drogaId])).get(drogaId) ?? null;

  if (formula === null) {
    if (!anterior) return;
    if (await formulaUsadaEnElaboracion(tx, tenantId, drogaId)) {
      throw new DomainError("Ya se elaboraron lotes con esta fórmula: se puede editar, pero no eliminar.", { fields: ["tieneFormula"] });
    }
    await eliminarFormulaRepo(tx, tenantId, drogaId);
    await auditRecord(tx, {
      tenantId,
      usuarioId: session.usuario.id,
      entidad: "formula_elaboracion",
      entidadId: anterior.id,
      accion: TipoAccion.BAJA,
      valorAnterior: { drogaId, ...resumen(anterior) },
    });
    return;
  }

  const drogas = await getDrogasParaFormula(tx, tenantId, [drogaId, ...formula.componentes.map((c) => c.drogaId)]);
  if (drogas.get(drogaId)?.deBaja) throw new DomainError("La droga está dada de baja: no se puede editar su fórmula.");
  const componentes = formula.componentes.map((c) => {
    const droga = drogas.get(c.drogaId);
    if (!droga) throw new NotFoundError("Uno de los componentes no existe.");
    if (droga.deBaja) throw new DomainError(`${droga.nombre} está dada de baja: no puede ser componente.`, { fields: [`componente_${c.drogaId}`] });
    return { drogaId: c.drogaId, drogaNombre: droga.nombre, cantidad: c.cantidad };
  });

  validarFormula({
    drogaId,
    cantidadReferencia: formula.cantidadReferencia,
    componentes,
    drogasConFormula: await drogasConFormula(tx, tenantId, componentes.map((c) => c.drogaId)),
    esComponenteDe: await formulasQueUsan(tx, tenantId, drogaId),
  });

  const id = await guardarFormulaRepo(tx, {
    tenantId,
    drogaId,
    cantidadReferencia: formula.cantidadReferencia.toString(),
    componentes: componentes.map((c) => ({ drogaId: c.drogaId, cantidad: c.cantidad.toString() })),
    usuarioId: session.usuario.id,
  });
  await auditRecord(tx, {
    tenantId,
    usuarioId: session.usuario.id,
    entidad: "formula_elaboracion",
    entidadId: id,
    accion: anterior ? TipoAccion.MODIFICAR : TipoAccion.CREAR,
    ...(anterior ? { valorAnterior: resumen(anterior) } : {}),
    valorNuevo: {
      drogaId,
      cantidadReferencia: formula.cantidadReferencia.toString(),
      componentes: componentes.map((c) => ({ droga: c.drogaNombre, cantidad: c.cantidad.toString() })),
    },
  });
}

const guardarFormulaInput = z.object({ drogaId: uuid, formula: formulaInput });

export const guardarFormulaCommand = defineCommand({
  name: "drogas.formula.guardar",
  permiso: "drogas.editar",
  input: guardarFormulaInput,
  audit: { entidad: "droga", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    await aplicarFormulaEnTx(tx, session, input.drogaId, input.formula);
    return { output: { drogaId: input.drogaId }, audit: { entidadId: input.drogaId, valorNuevo: { formula: input.formula === null ? "eliminada" : "guardada" } } };
  },
});

/** `formula: null` removes it. */
export async function guardarFormula(input: { drogaId: string; formula: FormulaInputCrudo | null }): Promise<{ drogaId: string }> {
  return guardarFormulaCommand.execute(input);
}
