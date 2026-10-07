/**
 * The synonym each receta componente was picked by (`drogaAliasId`, migration 0069 -- docs/specs/sinonimos-droga.md,
 * "Nombre elegido al cargar"), checked the same way by `crearReceta`, `editarReceta` and `importarReceta` before
 * anything is written. Display only: the droga stays the componente's identity.
 *
 *   - it must be a synonym of THAT droga (the DB's composite FK is the backstop);
 *   - it must be vigente when written -- unless the same droga + synonym pair is already stored on the receta being
 *     edited (`guardados`, read only when some synonym is no longer vigente): a synonym removed later never forces
 *     the user to re-pick a droga they did not touch.
 */
import type { Prisma } from "@/generated/prisma/client";
import { ValidationError } from "@/shared/errors";
import { getSinonimosParaComponentes } from "../infrastructure/receta-repository";

export const MENSAJE_SINONIMO_DE_OTRA_DROGA = "El nombre con que se eligió una droga no corresponde a esa droga. Volvé a elegirla.";

export function mensajeSinonimoDadoDeBaja(texto: string): string {
  return `«${texto}» ya no es un nombre vigente de esa droga. Volvé a elegir la droga.`;
}

/** Validates every componente's synonym; returns synonym id -> texto for the audit's readable summary. */
export async function validarSinonimosDeComponentes(
  tx: Prisma.TransactionClient,
  tenantId: string,
  componentes: readonly { drogaId: string; drogaAliasId?: string | null }[],
  guardados?: () => Promise<ReadonlySet<string>>,
): Promise<Map<string, string>> {
  const ids = componentes.flatMap((c) => (c.drogaAliasId ? [c.drogaAliasId] : []));
  if (ids.length === 0) return new Map();
  const sinonimos = await getSinonimosParaComponentes(tx, tenantId, ids);
  let yaGuardados: ReadonlySet<string> | null = null;
  for (const c of componentes) {
    if (!c.drogaAliasId) continue;
    const sinonimo = sinonimos.get(c.drogaAliasId);
    if (!sinonimo || sinonimo.drogaId !== c.drogaId) throw new ValidationError(MENSAJE_SINONIMO_DE_OTRA_DROGA);
    if (sinonimo.vigente) continue;
    yaGuardados ??= guardados ? await guardados() : new Set<string>();
    if (!yaGuardados.has(`${c.drogaId}|${c.drogaAliasId}`)) throw new ValidationError(mensajeSinonimoDadoDeBaja(sinonimo.texto));
  }
  return new Map([...sinonimos.values()].map((s) => [s.id, s.texto]));
}
