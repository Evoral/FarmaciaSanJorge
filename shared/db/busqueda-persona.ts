/**
 * THE persona search rule, shared by every paciente and médico search (the
 * clientes list, the médicos catalog, the receta's pickers and the envíos
 * list): a persona matches when EVERY word of the query is a substring of its
 * nombre or of its apellido, in any order, ignoring accents and case
 * (`fsj.normalizar_nombre`, migration 0067). "juan perez", "Pérez Juan" and
 * "perez" all find Juan Pérez.
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
  const palabras = palabrasBusquedaPersona(busqueda);
  if (palabras.length === 0) return [];
  const condiciones = palabras.map(
    (palabra) => Prisma.sql`(
      fsj.normalizar_nombre(p.nombre) LIKE ('%' || fsj.normalizar_nombre(${palabra}::text) || '%')
      OR fsj.normalizar_nombre(p.apellido) LIKE ('%' || fsj.normalizar_nombre(${palabra}::text) || '%')
    )`,
  );
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM fsj.${Prisma.raw(tabla)} p
    WHERE p.tenant_id = ${tenantId}::uuid
      AND ${Prisma.join(condiciones, " AND ")}
  `;
  return rows.map((row) => row.id);
}
