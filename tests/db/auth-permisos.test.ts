/**
 * DB tests for FASE 2 points 2.1/2.6: the seeded permission catalog
 * (`fsj.permiso`, migration 0002) against the hand-written TS union
 * (`modules/auth/domain/permisos.ts#PERMISO_CODES`), and the seeded
 * `rol_permiso` matrix against the plan's §7 permission matrix (as
 * literally implemented by migration 0002's `INSERT INTO fsj.rol_permiso`
 * -- that INSERT list IS the executable form of the plan's prose matrix;
 * this test transcribes it independently here so a future accidental edit
 * to either the migration or PERMISO_CODES is caught).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx } from "./helpers";
import { PERMISO_CODES } from "@/modules/auth/domain/permisos";

async function permisoCodes(tx: Client): Promise<string[]> {
  const result = await tx.query(`SELECT codigo FROM fsj.permiso ORDER BY codigo`);
  return result.rows.map((r) => r.codigo as string);
}

async function rolPermisoCodes(tx: Client, rolCodigo: string): Promise<string[]> {
  const result = await tx.query(
    `SELECT p.codigo
     FROM fsj.rol_permiso rp
     JOIN fsj.rol r ON r.id = rp.rol_id
     JOIN fsj.permiso p ON p.id = rp.permiso_id
     WHERE r.codigo = $1
     ORDER BY p.codigo`,
    [rolCodigo],
  );
  return result.rows.map((r) => r.codigo as string);
}

/**
 * Expected role -> permission-code matrix, transcribed 1:1 from migration
 * 0002's `INSERT INTO fsj.rol_permiso (...) SELECT ... FROM (VALUES ...)`
 * block (plan §7's implementation). Kept sorted for a readable diff
 * against the DB's own `ORDER BY p.codigo` result.
 */
const EXPECTED_ROL_PERMISOS: Record<string, string[]> = {
  ADMINISTRADOR: [
    "auditoria.ver",
    "auth.login",
    "auth.logout",
    "auth.password.cambiar",
    "config.editar",
    "config.ver",
    "dt.cesar",
    "dt.designar",
    "drogas.baja",
    "drogas.crear",
    "drogas.editar",
    "drogas.reactivar",
    "precios.reglas.editar",
    "proveedores.gestionar",
    "reportes.auditoria",
    "reportes.usuarios",
    "roles.ver",
    "stock.partida.costo.corregir",
    "stock.valorizado.ver",
    "stock.ver",
    "unidades.baja",
    "unidades.crear",
    "unidades.editar",
    "usuarios.auditoria.ver",
    "usuarios.baja",
    "usuarios.credencial.restablecer",
    "usuarios.crear",
    "usuarios.editar",
    "usuarios.listar",
    "usuarios.reactivar",
    "usuarios.roles.modificar",
    "usuarios.suspender",
    "usuarios.ver",
  ].sort(),
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
    "config.ver",
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
    "recetas.fisica.registrar",
    "regularizacion.ver",
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
    "config.ver",
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
    "recetas.fisica.registrar",
    "regularizacion.ver",
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
    "config.ver",
    "cotizaciones.calcular",
    "cotizaciones.ver",
    "entregas.firma.confirmar",
    "entregas.registrar",
    "medicos.gestionar",
    "pacientes.gestionar",
    "recetas.crear",
    "recetas.editar",
    "recetas.fisica.registrar",
    "regularizacion.ver",
    "stock.ver",
  ].sort(),
  SOLO_CONSULTA: [
    "auth.login",
    "auth.logout",
    "auth.password.cambiar",
    "cierres.reporte",
    "cierres.ver",
    "config.ver",
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

describe.skipIf(dbTestSkipReason() !== null)("fsj.rol_permiso matrix matches the plan §7 matrix (EXPECTED_ROL_PERMISOS)", () => {
  for (const rolCodigo of Object.keys(EXPECTED_ROL_PERMISOS)) {
    it(`${rolCodigo}: seeded permissions match exactly`, async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const actual = await rolPermisoCodes(tx, rolCodigo);
          expect(actual).toEqual(EXPECTED_ROL_PERMISOS[rolCodigo]);
        }),
      );
    });
  }

  it("covers every seeded role (no role silently skipped by this test)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const result = await tx.query(`SELECT codigo FROM fsj.rol ORDER BY codigo`);
        const dbRoles = result.rows.map((r) => r.codigo as string).sort();
        expect(dbRoles).toEqual(Object.keys(EXPECTED_ROL_PERMISOS).sort());
      }),
    );
  });
});
