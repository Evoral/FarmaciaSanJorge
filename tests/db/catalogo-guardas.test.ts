/**
 * Catalog guards: rules every migration must keep, checked against the live
 * schema so a forgotten policy or index fails CI instead of waiting for an audit.
 *
 * - Every `fsj` table has RLS enabled AND forced, with at least one policy
 *   (security audit P1-02: `fsj.tenant` was the one table left out).
 * - Every foreign key has an index whose leading columns are the FK's columns
 *   (with or without `tenant_id`), so parent -> child lookups and the RI checks
 *   do not scan the child table (security audit P1-10).
 *
 * Both lists of exceptions are exact on purpose: a new table without RLS or a new
 * FK without an index fails, and so does an exception that no longer applies
 * (then remove it from the list).
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner } from "./helpers";

/** Global catalogs: no `tenant_id`, the same rows for every tenant. */
const TABLAS_SIN_RLS = ["permiso", "unidad_medida"];

/**
 * Parents whose FKs never need a child-side index: a usuario is never deleted
 * (actor columns such as `registrado_por_id` are never filtered by), and the two
 * global catalogs are never deleted either. A superadmin (0124) is never deleted either (forbid_delete) and its actor
 * columns (creado_por_id / anulado_por_id of cargos and pagos, 0126) are never filtered by.
 */
const REFERENCIAS_SIN_INDICE = ["fsj.usuario", "fsj.unidad_medida", "fsj.permiso", "fsj.superadmin"];

/**
 * FKs reviewed in migration 0121 and left without an index: no query filters the
 * child by them, and the parent row is never deleted (append-only or baja lógica).
 * Add one here only after checking the real queries; never to make the test pass.
 */
const FKS_SIN_INDICE_REVISADAS = [
  "asiento_contralor_asiento_recetario_fkey",
  "asiento_contralor_cierre_diario_fkey",
  "asiento_contralor_droga_fkey",
  "asiento_recetario_cierre_diario_fkey",
  "cierre_diario_designacion_fkey",
  "componente_item_receta_droga_alias_fkey",
  "componente_item_receta_droga_fkey",
  "costo_proveedor_lista_precio_fkey",
  "cotizacion_regla_precio_fkey",
  "detalle_asiento_linea_fkey",
  "excipiente_borrador_droga_fkey",
  "formula_elaboracion_componente_droga_fkey",
  "insumo_borrador_droga_fkey",
  "insumo_preparacion_droga_fkey",
  "libro_rubricado_numeracion_fijada_cierre_fkey",
  "linea_pesaje_droga_fkey",
  "pesada_real_preparacion_fkey",
  "preparacion_excipiente_droga_fkey",
  "reserva_stock_linea_pesaje_fkey",
];

describe.skipIf(dbTestSkipReason() !== null)("catalog guards (fsj schema)", () => {
  it("every fsj table has RLS enabled and forced with a policy, except the global catalogs", async () => {
    await asOwner(async (client) => {
      const result = await client.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'fsj' AND c.relkind IN ('r', 'p')
           AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
                OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
         ORDER BY c.relname`,
      );
      expect(result.rows.map((r) => r.relname).sort()).toEqual([...TABLAS_SIN_RLS].sort());
    });
  });

  it("every foreign key has an index on its columns, except the reviewed ones", async () => {
    await asOwner(async (client) => {
      const result = await client.query<{ conname: string }>(
        `WITH fk AS (
           SELECT c.conname, c.conrelid, c.conkey,
                  ARRAY(SELECT x FROM unnest(c.conkey) x
                        WHERE x <> ALL (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'tenant_id')) AS sin_tenant
           FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
           WHERE c.contype = 'f' AND n.nspname = 'fsj' AND c.confrelid::regclass::text <> ALL ($1::text[])
         )
         SELECT fk.conname FROM fk
         WHERE NOT EXISTS (
           SELECT 1 FROM pg_index i, LATERAL (SELECT string_to_array(i.indkey::text, ' ')::int2[] AS k) ik
           WHERE i.indrelid = fk.conrelid
             AND ((ik.k[1:cardinality(fk.conkey)] @> fk.conkey AND ik.k[1:cardinality(fk.conkey)] <@ fk.conkey)
               OR (cardinality(fk.sin_tenant) > 0
                   AND ik.k[1:cardinality(fk.sin_tenant)] @> fk.sin_tenant AND ik.k[1:cardinality(fk.sin_tenant)] <@ fk.sin_tenant))
         )
         ORDER BY fk.conname`,
        [REFERENCIAS_SIN_INDICE],
      );
      expect(result.rows.map((r) => r.conname).sort()).toEqual([...FKS_SIN_INDICE_REVISADAS].sort());
    });
  });
});
