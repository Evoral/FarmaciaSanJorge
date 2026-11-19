/**
 * THE persona search rule, shared by every paciente and médico search (the
 * clientes list, the médicos catalog, the receta's pickers and the envíos
 * list): a persona matches when EVERY word of the query is a substring of its
 * nombre and apellido, in any order, ignoring accents, case, spaces and
 * punctuation (`fsj.normalizar_nombre`, migration 0067, plus only letters and
 * digits on both sides). "juan perez", "Pérez, Juan", "PEREZ juan", "perez" and
 * "delafuente" (for De La Fuente) all find their persona: as many matches as
 * the query allows.
 *
 * Why in `shared/` (like ./busqueda-droga.ts): pacientes are searched from
 * pacientes, recetas and entregas, and a module may not import another
 * module's infrastructure layer (eslint.config.mjs). One rule here instead of
 * a copy per module keeps them from drifting.
 *
 * Runs inside the caller's ALREADY OPEN tenant transaction (RLS applies);
 * `tenantId` is an explicit, defense-in-depth filter.
 */
import { Prisma } from "@/generated/prisma/client";

/** The tables a persona search reads; constants from code, never user input. */
export type TablaPersona = "paciente" | "medico";

/** The query's words, length-capped, with LIKE wildcards escaped (`\` is LIKE's default escape); empty = no search. */
export function palabrasBusquedaPersona(busqueda: string | null | undefined): string[] {
  const texto = (busqueda ?? "").trim().slice(0, 100);
  if (texto.length === 0) return [];
  return texto.split(/\s+/).map((palabra) => palabra.replace(/[\\%_]/g, "\\$&"));
}

/**
 * The ids of the tenant's personas (vigentes and dadas de baja alike -- callers filter state themselves) whose nombre
 * or apellido match every word of `busqueda`. For Prisma-built queries: filter them with `id: { in: ids }`.
 */
export async function buscarPersonasPorNombre(tx: Prisma.TransactionClient, tabla: TablaPersona, tenantId: string, busqueda: string): Promise<string[]> {
  // Commas, dots, hyphens... separate words too ("Pérez,Juan", "Dr. Pérez"); a term keeps letters and digits only, so
  // no LIKE wildcard survives and a query of punctuation alone searches nothing.
  const terminos = palabrasBusquedaPersona(busqueda).flatMap((palabra) => palabra.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  if (terminos.length === 0) return [];
  // "apellido nombre apellido" without spaces or punctuation: a term may sit in either, or across them in either
  // order ("delafuente", "juanperez", "perezjuan").
  const persona = Prisma.sql`regexp_replace(fsj.normalizar_nombre(coalesce(p.apellido, '') || coalesce(p.nombre, '') || coalesce(p.apellido, '')), '[^[:alnum:]]', '', 'g')`;
  const condiciones = terminos.map((termino) => Prisma.sql`${persona} LIKE ('%' || fsj.normalizar_nombre(${termino}::text) || '%')`);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM fsj.${Prisma.raw(tabla)} p
    WHERE p.tenant_id = ${tenantId}::uuid
      AND ${Prisma.join(condiciones, " AND ")}
  `;
  return rows.map((row) => row.id);
}
