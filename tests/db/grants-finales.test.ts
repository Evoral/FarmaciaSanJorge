/**
 * DB tests for prisma/migrations/.../0017_grants_finales (FASE 1 point
 * 1.15, INV-X01), as revised by 0018_legal_core_fixes (M1: INSERT is
 * checked too; M3: the table set is derived structurally from the
 * forbid_update_delete / forbid_delete triggers instead of a hardcoded
 * list). Reads the actual Postgres catalogs through fsj.v_grants_legal
 * (has_table_privilege/has_column_privilege), not a copy of what SHOULD
 * have happened, so a widened grant is caught regardless of the mechanism
 * (missing REVOKE, an extra GRANT, a table-level default).
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx } from "./helpers";

interface GrantRule {
  /** Whether fsj_app may INSERT. */
  insert: boolean;
  /** The exact UPDATE columns fsj_app may write (sorted). */
  update: string[];
}

/**
 * The legal core (INV-X01). DELETE and TRUNCATE are NEVER allowed on any of
 * them. cierre_diario and contador_correlativo are safe precisely BECAUSE
 * fsj_app has no INSERT on them: their only insert paths are the SECURITY
 * DEFINER functions fsj.cierre_diario_firmar() and the libro_rubricado /
 * asiento triggers.
 */
const LEGAL: Record<string, GrantRule> = {
  registro_auditoria: { insert: true, update: [] },
  movimiento_stock: { insert: true, update: [] },
  ficha_tecnica: { insert: true, update: [] },
  linea_pesaje: { insert: true, update: [] },
  contador_correlativo: { insert: false, update: [] },
  // DP-38 (migration 0018 B3): rubric data is filled in once, when actually issued.
  libro_rubricado: { insert: true, update: ["expediente_rubrica", "fecha_cierre", "fecha_rubrica", "numero"] },
  asiento_recetario: { insert: true, update: [] },
  detalle_asiento: { insert: true, update: [] },
  anulacion_asiento: { insert: true, update: [] },
  asiento_historico: { insert: true, update: [] },
  asiento_contralor: { insert: true, update: [] },
  cierre_diario: { insert: false, update: ["fecha_impresion", "impreso_por_id"] },
};

/**
 * Tables that ALSO carry a forbid_* trigger (so the structural derivation
 * finds them) but are ordinary soft-deletable/mutable catalog or workflow
 * tables, not part of the legal core. Listing them explicitly means a NEW
 * forbid_*-protected table fails the classification test below until
 * someone consciously decides whether it is legal -- it can never be
 * silently missed.
 */
const PROTEGIDAS_NO_LEGALES = [
  "designacion_director_tecnico",
  "droga",
  "entrega",
  "lote_archivo_recetas",
  "medico",
  "paciente",
  "partida",
  "proveedor",
  "unidad_medida",
  "usuario",
  "usuario_estado_historial",
];

interface FilaGrants {
  tabla: string;
  protecciones: string[];
  insert_permitido: boolean;
  delete_permitido: boolean;
  truncate_permitido: boolean;
  columnas_update: string[];
}

async function leerVista(): Promise<FilaGrants[]> {
  return asOwner((client) =>
    inRollbackTx(client, async (tx) => {
      const result = await tx.query(
        `SELECT tabla, protecciones, insert_permitido, delete_permitido, truncate_permitido, columnas_update FROM fsj.v_grants_legal ORDER BY tabla`,
      );
      return result.rows as FilaGrants[];
    }),
  );
}

describe.skipIf(dbTestSkipReason() !== null)("0017/0018 grants -- INV-X01 (fsj schema)", () => {
  it("the structurally derived set (tables with a forbid_update_delete/forbid_delete trigger) is a SUPERSET of the known legal tables", async () => {
    const tablas = new Set((await leerVista()).map((r) => r.tabla));
    for (const legal of Object.keys(LEGAL)) {
      expect(tablas.has(legal), `${legal} must carry a forbid_* trigger and appear in fsj.v_grants_legal`).toBe(true);
    }
  });

  it("the view derives its set from pg_trigger, not a hardcoded list (every row reports the trigger that put it there)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const def = await tx.query(`SELECT pg_get_viewdef('fsj.v_grants_legal'::regclass) AS d`);
        expect(def.rows[0].d).toContain("pg_trigger");
        expect(def.rows[0].d).not.toMatch(/relname\s*=\s*ANY|relname\s+IN\s*\(/i);
      }),
    );
    for (const row of await leerVista()) {
      expect(row.protecciones.length, `${row.tabla} protecciones`).toBeGreaterThan(0);
      for (const p of row.protecciones) expect(["forbid_delete", "forbid_update_delete"]).toContain(p);
    }
  });

  it("every derived table is classified (legal or explicitly non-legal) -- a new forbid_*-protected table cannot be silently missed", async () => {
    const conocidas = new Set([...Object.keys(LEGAL), ...PROTEGIDAS_NO_LEGALES]);
    for (const row of await leerVista()) {
      expect(conocidas.has(row.tabla), `${row.tabla} is forbid_*-protected but not classified in this test`).toBe(true);
    }
  });

  it("every derived table: fsj_app has NO DELETE and NO TRUNCATE; forbid_update_delete tables grant NO UPDATE column", async () => {
    for (const row of await leerVista()) {
      expect(row.delete_permitido, `${row.tabla} must not grant DELETE to fsj_app`).toBe(false);
      expect(row.truncate_permitido, `${row.tabla} must not grant TRUNCATE to fsj_app`).toBe(false);
      if (row.protecciones.includes("forbid_update_delete")) {
        expect(row.columnas_update, `${row.tabla} is forbid_update_delete but grants UPDATE`).toEqual([]);
      }
    }
  });

  it("legal tables: INSERT is exactly as expected for EVERY legal table (cierre_diario and contador_correlativo: none)", async () => {
    const filas = new Map((await leerVista()).map((r) => [r.tabla, r]));
    for (const [tabla, rule] of Object.entries(LEGAL)) {
      expect(filas.get(tabla)?.insert_permitido, `${tabla} INSERT`).toBe(rule.insert);
    }
  });

  it("legal tables: fsj_app has NO UPDATE beyond the explicitly allowed columns", async () => {
    const filas = new Map((await leerVista()).map((r) => [r.tabla, r]));
    for (const [tabla, rule] of Object.entries(LEGAL)) {
      const actual = [...(filas.get(tabla)?.columnas_update ?? ["<missing>"])].sort();
      expect(actual, `${tabla} UPDATE columns`).toEqual([...rule.update].sort());
    }
  });

  it("if the immutability trigger were removed, the grants alone would still block a plain fsj_app UPDATE (belt-and-suspenders check)", async () => {
    // Sanity check that this isn't a vacuous test: asiento_recetario has NO
    // UPDATE grant at all, so even a column NOT covered by any trigger
    // (e.g. registrado_en) is rejected by privileges alone.
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const check = await tx.query(`SELECT has_column_privilege('fsj_app', 'fsj.asiento_recetario', 'registrado_en', 'UPDATE') AS ok`);
        expect(check.rows[0].ok).toBe(false);
      }),
    );
  });
});
