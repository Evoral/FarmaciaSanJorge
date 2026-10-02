/**
 * DB tests for FASE 2 points 2.1/2.6: the seeded permission catalog
 * (`fsj.permiso`, migration 0002) against the hand-written TS union
 * (`modules/auth/domain/permisos.ts#PERMISO_CODES`), and the seeded
 * `rol_permiso` matrix against the plan's §7 permission matrix (as
 * literally implemented by migration 0002's `INSERT INTO fsj.rol_permiso`
 * -- that INSERT list IS the executable form of the plan's prose matrix;
 * this test transcribes it independently here so a future accidental edit
 * to either the migration or PERMISO_CODES is caught).
 *
 * DP-03 (migration 0054): roles are per-tenant. `EXPECTED_ROL_PERMISOS` now
 * validates the DEFAULT TEMPLATE every new tenant gets
 * (fsj.seed_roles_tenant / fsj.plantilla_rol_permisos), read from a tenant
 * created inside the rolled-back transaction -- an admin's later edits to a
 * real tenant's roles are legitimate data and are not compared here.
 * ADMINISTRADOR is locked with `es_administrador` and has NO rows (its
 * effective set -- every consulta/gestion permiso, never an operativo one --
 * is computed in TS from the catalog categories, which are checked here
 * against `fsj.permiso.categoria` both ways).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx } from "./helpers";
import { CATEGORIAS_PERMISO, PERMISO_CATALOGO, PERMISO_CODES, PERMISOS_DE_ADMINISTRADOR } from "@/modules/auth/domain/permisos";

async function permisoCodes(tx: Client): Promise<string[]> {
  const result = await tx.query(`SELECT codigo FROM fsj.permiso ORDER BY codigo`);
  return result.rows.map((r) => r.codigo as string);
}

async function insertTenant(tx: Client): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-perm-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

async function rolPermisoCodes(tx: Client, tenantId: string, rolCodigo: string): Promise<string[]> {
  const result = await tx.query(
    `SELECT p.codigo
     FROM fsj.rol_permiso rp
     JOIN fsj.rol r ON r.tenant_id = rp.tenant_id AND r.id = rp.rol_id
     JOIN fsj.permiso p ON p.id = rp.permiso_id
     WHERE r.tenant_id = $1 AND r.codigo = $2
     ORDER BY p.codigo`,
    [tenantId, rolCodigo],
  );
  return result.rows.map((r) => r.codigo as string);
}

/**
 * Expected role -> permission-code matrix, transcribed 1:1 from migration
 * 0002's `INSERT INTO fsj.rol_permiso (...) SELECT ... FROM (VALUES ...)`
 * block (plan §7's implementation) PLUS every later migration that edits
 * the matrix: 0043 grants `stock.valorizado.ver` (ADM/DT/FAR) and 0046
 * revokes `config.ver` from every role except ADMINISTRADOR (user decision
 * 2026-09-28: "Configuración" is admin-only, DT keeps only
 * `precios.reglas.editar`), and 0051 deletes `recetas.fisica.registrar` and
 * `regularizacion.ver` altogether (client decision 2026-10-01: a receta is
 * never pendiente de receta física). Kept sorted for a readable diff against the
 * DB's own `ORDER BY p.codigo` result.
 */
const EXPECTED_ROL_PERMISOS: Record<string, string[]> = {
  // Locked (migration 0054): es_administrador, no rol_permiso rows. Its
  // effective set is modules/auth/domain/permisos.ts#PERMISOS_DE_ADMINISTRADOR.
  ADMINISTRADOR: [],
  DIRECTOR_TECNICO: [
    "archivo.destruccion.gestionar",
    "archivo.lotes.gestionar",
    "auditoria.ver",
    "auth.login",
    "auth.logout",
    "auth.password.cambiar",
    "cierres.firmar",
    "cierres.folio.corregir",
    "cierres.imprimir",
    "cierres.reporte",
    "cierres.ver",
    "cotizaciones.calcular",
    "cotizaciones.ver",
    "drogas.baja",
    "drogas.crear",
    "drogas.editar",
    "drogas.reactivar",
    "entregas.firma.confirmar",
    "entregas.registrar",
    "etiquetas.generar",
    "etiquetas.imprimir",
    "fichas.generar",
    "fichas.imprimir",
    "libro.anulacion.autorizar",
    "libro.anulacion.solicitar",
    "libro.exportar",
    "libro.historico.digitalizar",
    "libro.ver",
    "libros.cerrar",
    "libros.crear",
    "medicos.gestionar",
    "pacientes.gestionar",
    "precios.reglas.editar",
    "preparaciones.confirmar",
    "preparaciones.descartar",
    "preparaciones.iniciar",
    "proveedores.gestionar",
    "recetas.anular",
    "recetas.crear",
    "recetas.editar",
    "reportes.ver",
    "stock.ajuste.autorizar",
    "stock.ajuste.registrar",
    "stock.partida.costo.corregir",
    "stock.partida.ingresar",
    "stock.valorizado.ver",
    "stock.ver",
    "usuarios.auditoria.ver",
  ].sort(),
  FARMACEUTICO: [
    "auth.login",
    "auth.logout",
    "auth.password.cambiar",
    "cierres.imprimir",
    "cierres.reporte",
    "cierres.ver",
    "cotizaciones.calcular",
    "cotizaciones.ver",
    "drogas.baja",
    "drogas.crear",
    "drogas.editar",
    "drogas.reactivar",
    "entregas.firma.confirmar",
    "entregas.registrar",
    "etiquetas.generar",
    "etiquetas.imprimir",
    "fichas.generar",
    "fichas.imprimir",
    "libro.anulacion.solicitar",
    "libro.exportar",
    "libro.ver",
    "medicos.gestionar",
    "pacientes.gestionar",
    "preparaciones.confirmar",
    "preparaciones.descartar",
    "preparaciones.iniciar",
    "proveedores.gestionar",
    "recetas.anular",
    "recetas.crear",
    "recetas.editar",
    "reportes.ver",
    "stock.ajuste.registrar",
    "stock.partida.ingresar",
    "stock.valorizado.ver",
    "stock.ver",
  ].sort(),
  ATENCION_PUBLICO: [
    "auth.login",
    "auth.logout",
    "auth.password.cambiar",
    "cotizaciones.calcular",
    "cotizaciones.ver",
    "entregas.firma.confirmar",
    "entregas.registrar",
    "medicos.gestionar",
    "pacientes.gestionar",
    "recetas.crear",
    "recetas.editar",
    "stock.ver",
  ].sort(),
  SOLO_CONSULTA: [
    "auth.login",
    "auth.logout",
    "auth.password.cambiar",
    "cierres.reporte",
    "cierres.ver",
    "libro.exportar",
    "libro.ver",
    "reportes.ver",
    "stock.ver",
  ].sort(),
  // SISTEMA is deliberately permission-less (migration 0002 comment:
  // "Sin permisos propios: los procesos automaticos no pasan por
  // authorize()") -- it exists only to satisfy INV-U02 for the per-tenant
  // technical user.
  SISTEMA: [],
};

describe.skipIf(dbTestSkipReason() !== null)("fsj.permiso catalog matches modules/auth/domain/permisos.ts#PERMISO_CODES", () => {
  it("every code in PERMISO_CODES exists in fsj.permiso, and vice versa (bidirectional)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const dbCodes = await permisoCodes(tx);
        const tsCodes: string[] = [...PERMISO_CODES].sort();

        const inTsNotDb = tsCodes.filter((c) => !dbCodes.includes(c));
        const inDbNotTs = dbCodes.filter((c) => !tsCodes.includes(c));

        expect(inTsNotDb, "PERMISO_CODES has entries missing from the seeded fsj.permiso catalog").toEqual([]);
        expect(inDbNotTs, "fsj.permiso has seeded codes missing from PERMISO_CODES").toEqual([]);
        expect(dbCodes).toEqual(tsCodes);
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("fsj.permiso.categoria matches modules/auth/domain/permisos.ts#PERMISO_CATALOGO (migration 0054)", () => {
  it("every (codigo, categoria) pair matches in BOTH directions", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT codigo, categoria FROM fsj.permiso`);
        const db = Object.fromEntries(result.rows.map((r) => [r.codigo as string, r.categoria as string]));
        expect(db).toEqual({ ...PERMISO_CATALOGO });
      }),
    );
  });

  it("categoria is mandatory and restricted to the TS categories (NOT NULL + CHECK)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'permiso_categoria_valida' AND conrelid = 'fsj.permiso'::regclass`,
        );
        const def = result.rows[0]?.def as string;
        for (const categoria of CATEGORIAS_PERMISO) expect(def).toContain(`'${categoria}'`);
        const nullable = await tx.query(
          `SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'fsj' AND table_name = 'permiso' AND column_name = 'categoria'`,
        );
        expect(nullable.rows[0].is_nullable).toBe("NO");
      }),
    );
  });

  it("the DB-side ADMINISTRADOR set (categoria consulta/gestion) equals PERMISOS_DE_ADMINISTRADOR", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT codigo FROM fsj.permiso WHERE categoria IN ('consulta', 'gestion')`);
        expect(result.rows.map((r) => r.codigo as string).sort()).toEqual([...PERMISOS_DE_ADMINISTRADOR].sort());
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("default role template of a new tenant matches EXPECTED_ROL_PERMISOS", () => {
  for (const rolCodigo of Object.keys(EXPECTED_ROL_PERMISOS)) {
    it(`${rolCodigo}: seeded permissions match exactly`, async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const tenantId = await insertTenant(tx);
          const actual = await rolPermisoCodes(tx, tenantId, rolCodigo);
          expect(actual).toEqual(EXPECTED_ROL_PERMISOS[rolCodigo]);
        }),
      );
    });
  }

  it("covers every seeded role (no role silently skipped by this test)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx);
        const result = await tx.query(`SELECT codigo FROM fsj.rol WHERE tenant_id = $1 ORDER BY codigo`, [tenantId]);
        const dbRoles = result.rows.map((r) => r.codigo as string).sort();
        expect(dbRoles).toEqual(Object.keys(EXPECTED_ROL_PERMISOS).sort());
      }),
    );
  });

  it("fsj.plantilla_rol_permisos() is exactly the non-empty part of EXPECTED_ROL_PERMISOS", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT rol_codigo, permiso_codigo FROM fsj.plantilla_rol_permisos() ORDER BY 1, 2`);
        const plantilla: Record<string, string[]> = {};
        for (const row of result.rows) (plantilla[row.rol_codigo as string] ??= []).push(row.permiso_codigo as string);
        for (const permisos of Object.values(plantilla)) permisos.sort();
        const esperado = Object.fromEntries(Object.entries(EXPECTED_ROL_PERMISOS).filter(([, permisos]) => permisos.length > 0));
        expect(plantilla).toEqual(esperado);
      }),
    );
  });
});
