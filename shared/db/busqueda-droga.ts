/**
 * THE droga search rule (docs/specs/sinonimos-droga.md), shared by every
 * droga picker and list: a droga matches a query when the normalized query
 * (`fsj.normalizar_nombre`: no accents, no case, collapsed whitespace,
 * migration 0067) is a substring of its normalized name OR of one of its
 * VIGENTE synonyms (`fsj.droga_alias`). When the match came only through a
 * synonym, callers get that synonym's text so the UI can hint it next to
 * the canonical name (`shared/ui/sinonimo-hint.tsx`).
 *
 * Why in `shared/` and not in `modules/drogas/infrastructure`: the pickers
 * live in recetas, stock and proveedores, and a module may not import
 * another module's infrastructure layer (eslint.config.mjs). One fragment
 * here instead of a copy per module keeps the rule from drifting.
 *
 * Every helper runs inside the caller's ALREADY OPEN tenant transaction
 * (RLS applies); `tenantId` is an explicit, defense-in-depth filter.
 */
import { Prisma } from "@/generated/prisma/client";

/** Trimmed, length-capped query with LIKE wildcards escaped (`\` is LIKE's default escape), or `null` for "no search". */
export function busquedaDrogaLike(busqueda: string | null | undefined): string | null {
  const texto = (busqueda ?? "").trim().slice(0, 100);
  if (texto.length === 0) return null;
  return texto.replace(/[\\%_]/g, "\\$&");
}

function patron(busqueda: string): Prisma.Sql {
  return Prisma.sql`('%' || fsj.normalizar_nombre(${busqueda}::text) || '%')`;
}

/**
 * Boolean SQL condition: the droga aliased `alias` (e.g. "d") matches
 * `busqueda` by name or vigente synonym. `TRUE` when there is no search.
 * `alias` must be a constant from code, never user input.
 */
export function drogaCoincideSql(alias: string, busqueda: string | null | undefined): Prisma.Sql {
  const like = busquedaDrogaLike(busqueda);
  if (like === null) return Prisma.sql`TRUE`;
  const d = Prisma.raw(alias);
  return Prisma.sql`(
    fsj.normalizar_nombre(${d}.nombre) LIKE ${patron(like)}
    OR EXISTS (
      SELECT 1 FROM fsj.droga_alias da
      WHERE da.tenant_id = ${d}.tenant_id
        AND da.droga_id = ${d}.id
        AND da.fecha_baja IS NULL
        AND fsj.normalizar_nombre(da.alias_normalizado) LIKE ${patron(like)}
    )
  )`;
}

/**
 * Text SQL expression: the first (alphabetical) vigente synonym of the
 * droga aliased `alias` that matches `busqueda`, or NULL when the name
 * itself matches (or there is no search). Pair it with `drogaCoincideSql`.
 * `columna`: the synonym's `texto` (default) or its `id` (as text) -- the
 * same synonym either way, for pickers that store which one was chosen
 * (receta componentes, migration 0069).
 */
export function sinonimoCoincidenteSql(alias: string, busqueda: string | null | undefined, columna: "texto" | "id" = "texto"): Prisma.Sql {
  const like = busquedaDrogaLike(busqueda);
  if (like === null) return Prisma.sql`NULL::text`;
  const d = Prisma.raw(alias);
  const valor = columna === "id" ? Prisma.sql`da.id::text` : Prisma.sql`da.texto`;
  return Prisma.sql`(
    CASE WHEN fsj.normalizar_nombre(${d}.nombre) LIKE ${patron(like)} THEN NULL::text
    ELSE (
      SELECT ${valor} FROM fsj.droga_alias da
      WHERE da.tenant_id = ${d}.tenant_id
        AND da.droga_id = ${d}.id
        AND da.fecha_baja IS NULL
        AND fsj.normalizar_nombre(da.alias_normalizado) LIKE ${patron(like)}
      ORDER BY da.texto
      LIMIT 1
    ) END
  )`;
}

/**
 * The drogas of the tenant matching `busqueda` (vigentes and dadas de baja
 * alike -- callers filter state themselves), as droga id -> matched
 * synonym text (`null` when the name matched). For Prisma-built queries
 * that cannot embed the fragment: filter them with `id: { in: [...keys] }`.
 */
export async function buscarDrogasPorTexto(tx: Prisma.TransactionClient, tenantId: string, busqueda: string): Promise<Map<string, string | null>> {
  const rows = await tx.$queryRaw<{ id: string; sinonimo: string | null }[]>`
    SELECT d.id, ${sinonimoCoincidenteSql("d", busqueda)} AS sinonimo
    FROM fsj.droga d
    WHERE d.tenant_id = ${tenantId}::uuid
      AND ${drogaCoincideSql("d", busqueda)}
  `;
  return new Map(rows.map((row) => [row.id, row.sinonimo]));
}

/**
 * Vigente synonyms (as typed, alphabetical) per droga -- for the pickers
 * that filter client-side (`filtrarOpciones` in shared/ui/combobox.tsx
 * searches them as keywords) and the catalog's muted "también" line.
 * `drogaIds` narrows the read; omitted = every droga of the tenant.
 */
export async function listSinonimosVigentes(tx: Prisma.TransactionClient, tenantId: string, drogaIds?: readonly string[]): Promise<Map<string, string[]>> {
  if (drogaIds && drogaIds.length === 0) return new Map();
  const rows = await tx.drogaAlias.findMany({
    where: { tenantId, fechaBaja: null, ...(drogaIds ? { drogaId: { in: [...new Set(drogaIds)] } } : {}) },
    orderBy: [{ texto: "asc" }],
    select: { drogaId: true, texto: true },
  });
  const porDroga = new Map<string, string[]>();
  for (const row of rows) {
    const lista = porDroga.get(row.drogaId);
    if (lista) lista.push(row.texto);
    else porDroga.set(row.drogaId, [row.texto]);
  }
  return porDroga;
}
