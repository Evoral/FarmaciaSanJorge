/**
 * The typed `Permiso` union (M03, plan §7 -- the permission matrix; seeded
 * verbatim into `fsj.permiso` by prisma/migrations/*_0002_usuarios_roles_permisos).
 *
 * Hand-written (not code-generated from the DB) so a typo in a call site
 * like `authorize(session, "usuarios.lsitar")` is a COMPILE error, not a
 * silent runtime deny -- see `authorize.ts`. The DB is still the ultimate
 * source of truth: `tests/db/auth-permisos.test.ts` asserts this array
 * matches `SELECT codigo FROM fsj.permiso` exactly, in BOTH directions (a
 * code here with no DB row, and a DB row with no code here, both fail the
 * test) -- so this file can never silently drift from the seed.
 *
 * Keep alphabetical-by-module and in the same order as the migration's
 * `INSERT INTO fsj.permiso` list, to make that DB test's diff readable.
 */
export const PERMISO_CODES = [
  "auth.login",
  "auth.logout",
  "auth.password.cambiar",
  "auth.activar",
  "usuarios.listar",
  "usuarios.ver",
  "usuarios.crear",
  "usuarios.editar",
  "usuarios.roles.modificar",
  "usuarios.suspender",
  "usuarios.reactivar",
  "usuarios.baja",
  "usuarios.credencial.restablecer",
  "usuarios.auditoria.ver",
  "dt.designar",
  "dt.cesar",
  "roles.ver",
  "config.ver",
  "config.editar",
  "unidades.crear",
  "unidades.editar",
  "unidades.baja",
  "drogas.crear",
  "drogas.editar",
  "drogas.baja",
  "drogas.reactivar",
  "proveedores.gestionar",
  "medicos.gestionar",
  "pacientes.gestionar",
  "precios.reglas.editar",
  "stock.ver",
  "stock.partida.ingresar",
  "stock.partida.costo.corregir",
  "stock.ajuste.registrar",
  "stock.ajuste.autorizar",
  "recetas.crear",
  "recetas.editar",
  "recetas.anular",
  "recetas.fisica.registrar",
  "fichas.generar",
  "fichas.imprimir",
  "cotizaciones.calcular",
  "cotizaciones.ver",
  "preparaciones.iniciar",
  "preparaciones.descartar",
  "preparaciones.confirmar",
  "etiquetas.generar",
  "etiquetas.imprimir",
  "libro.ver",
  "libro.exportar",
  "libro.anulacion.solicitar",
  "libro.anulacion.autorizar",
  "libro.historico.digitalizar",
  "cierres.ver",
  "cierres.reporte",
  "cierres.firmar",
  "cierres.imprimir",
  "cierres.folio.corregir",
  "libros.crear",
  "libros.cerrar",
  "tenants.crear",
  "tenants.editar",
  "tenants.baja",
  "entregas.registrar",
  "entregas.firma.confirmar",
  "regularizacion.ver",
  "archivo.lotes.gestionar",
  "archivo.destruccion.gestionar",
  "reportes.ver",
  "reportes.usuarios",
  "reportes.auditoria",
  "auditoria.ver",
] as const;

/**
 * NOTE: this is intentionally a different type than the generated Prisma
 * model type of the same name (`Permiso` = a row of `fsj.permiso`, exported
 * from `@/generated/prisma/client`). This `Permiso` is the union of valid
 * permission CODES, used for `authorize`/`can`. Files that need both must
 * alias one of the two imports.
 */
export type Permiso = (typeof PERMISO_CODES)[number];

const PERMISO_SET: ReadonlySet<string> = new Set(PERMISO_CODES);

/** Runtime type guard -- e.g. for validating a `codigo` read back from the DB before trusting it as a `Permiso`. */
export function isPermiso(value: string): value is Permiso {
  return PERMISO_SET.has(value);
}
