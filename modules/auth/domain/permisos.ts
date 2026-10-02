/**
 * The permiso CATALOG (M03, plan §7 -- the permission matrix; seeded into
 * `fsj.permiso` by prisma/migrations/*_0002_usuarios_roles_permisos and
 * later migrations), with the CATEGORY of every code (DP-03, migration
 * 0054). `PERMISO_CATALOGO` is the single source of truth: `Permiso` and
 * `PERMISO_CODES` are derived from it, so adding a code without a category
 * is a COMPILE error, and a typo in a call site like
 * `authorize(session, "usuarios.lsitar")` is too (not a silent runtime deny).
 *
 * The DB is still the ultimate source of truth for what exists:
 * tests/db/auth-permisos.test.ts asserts these codes AND their categories
 * match `fsj.permiso (codigo, categoria)` exactly, in BOTH directions.
 *
 * Categories:
 *   - `operativo`: registers or authorizes a movement in the regulated
 *     pharmacy circuit (stock movements, recetas, preparaciones, libro,
 *     cierres, entregas, archivo). The locked ADMINISTRADOR never holds
 *     these implicitly -- only a role that lists them explicitly does.
 *   - `consulta`: read / print / export / report (plus the session basics,
 *     see `PERMISOS_BASE_DE_ROL`).
 *   - `gestion`: administration and master data (usuarios, roles, config,
 *     catálogos, precios, designación DT).
 *   - `sistema`: never granted through any role (`auth.activar`: holder of
 *     a one-use credential, no session yet; `tenants.*`: platform operator,
 *     outside any tenant).
 *
 * Keep grouped by module and in the same order as the migrations' permiso
 * lists, to make the DB test's diff readable.
 *
 * Adding a permiso: see docs/specs/roles-personalizables.md ("Cómo agregar
 * un permiso nuevo"). A non-operativo one reaches ADMINISTRADOR
 * automatically (`PERMISOS_DE_ADMINISTRADOR`); every other role gets it
 * only through the role editor (or an explicit migration).
 */
export type CategoriaPermiso = "operativo" | "consulta" | "gestion" | "sistema";

export const CATEGORIAS_PERMISO = ["operativo", "consulta", "gestion", "sistema"] as const satisfies readonly CategoriaPermiso[];

export const PERMISO_CATALOGO = {
  // Session basics (always included in every role) + credential activation.
  "auth.login": "consulta",
  "auth.logout": "consulta",
  "auth.password.cambiar": "consulta",
  "auth.activar": "sistema",
  // Usuarios, designación DT, roles, configuración.
  "usuarios.listar": "gestion",
  "usuarios.ver": "gestion",
  "usuarios.crear": "gestion",
  "usuarios.editar": "gestion",
  "usuarios.roles.modificar": "gestion",
  "usuarios.suspender": "gestion",
  "usuarios.reactivar": "gestion",
  "usuarios.baja": "gestion",
  "usuarios.credencial.restablecer": "gestion",
  "usuarios.auditoria.ver": "gestion",
  "dt.designar": "gestion",
  "dt.cesar": "gestion",
  "roles.ver": "gestion",
  "roles.gestionar": "gestion",
  "config.ver": "gestion",
  "config.editar": "gestion",
  // Catálogos y precios.
  "unidades.crear": "gestion",
  "unidades.editar": "gestion",
  "unidades.baja": "gestion",
  "drogas.crear": "gestion",
  "drogas.editar": "gestion",
  "drogas.baja": "gestion",
  "drogas.reactivar": "gestion",
  "proveedores.gestionar": "gestion",
  "medicos.gestionar": "gestion",
  "pacientes.gestionar": "gestion",
  "precios.reglas.editar": "gestion",
  // Stock.
  "stock.ver": "consulta",
  "stock.valorizado.ver": "consulta",
  "stock.partida.ingresar": "operativo",
  // Corrects a partida's cost (money), not its quantity: no stock movement. Held by ADMINISTRADOR before DP-03.
  "stock.partida.costo.corregir": "gestion",
  "stock.ajuste.registrar": "operativo",
  "stock.ajuste.autorizar": "operativo",
  // Recetas, fichas, presupuestos, preparaciones, etiquetas.
  "recetas.crear": "operativo",
  "recetas.editar": "operativo",
  "recetas.anular": "operativo",
  "fichas.generar": "operativo",
  "fichas.imprimir": "consulta",
  "cotizaciones.calcular": "operativo",
  "cotizaciones.ver": "consulta",
  "preparaciones.iniciar": "operativo",
  "preparaciones.descartar": "operativo",
  "preparaciones.confirmar": "operativo",
  "etiquetas.generar": "operativo",
  "etiquetas.imprimir": "consulta",
  // Libro recetario / contralor, cierres, libros rubricados.
  "libro.ver": "consulta",
  "libro.exportar": "consulta",
  "libro.anulacion.solicitar": "operativo",
  "libro.anulacion.autorizar": "operativo",
  "libro.historico.digitalizar": "operativo",
  "cierres.ver": "consulta",
  "cierres.reporte": "consulta",
  "cierres.firmar": "operativo",
  "cierres.imprimir": "consulta",
  "cierres.folio.corregir": "operativo",
  "libros.crear": "operativo",
  "libros.cerrar": "operativo",
  // Platform operator (outside any tenant).
  "tenants.crear": "sistema",
  "tenants.editar": "sistema",
  "tenants.baja": "sistema",
  // Entregas, archivo.
  "entregas.registrar": "operativo",
  "entregas.firma.confirmar": "operativo",
  "archivo.lotes.gestionar": "operativo",
  "archivo.destruccion.gestionar": "operativo",
  // Reportes y auditoría.
  "reportes.ver": "consulta",
  "reportes.usuarios": "consulta",
  "reportes.auditoria": "consulta",
  "auditoria.ver": "consulta",
} as const satisfies Readonly<Record<string, CategoriaPermiso>>;

/**
 * NOTE: this is intentionally a different type than the generated Prisma
 * model type of the same name (`Permiso` = a row of `fsj.permiso`, exported
 * from `@/generated/prisma/client`). This `Permiso` is the union of valid
 * permission CODES, used for `authorize`/`can`. Files that need both must
 * alias one of the two imports.
 */
export type Permiso = keyof typeof PERMISO_CATALOGO;

/** Every catalog code, in catalog order. */
export const PERMISO_CODES: readonly Permiso[] = Object.keys(PERMISO_CATALOGO) as Permiso[];

const PERMISO_SET: ReadonlySet<string> = new Set(PERMISO_CODES);

/** Runtime type guard -- e.g. for validating a `codigo` read back from the DB before trusting it as a `Permiso`. */
export function isPermiso(value: string): value is Permiso {
  return PERMISO_SET.has(value);
}

export function categoriaDePermiso(permiso: Permiso): CategoriaPermiso {
  return PERMISO_CATALOGO[permiso];
}

export function esPermisoOperativo(permiso: Permiso): boolean {
  return PERMISO_CATALOGO[permiso] === "operativo";
}

/** Permisos that are NEVER granted through a role (category `sistema`). */
export const PERMISOS_FUERA_DE_ROLES: readonly Permiso[] = PERMISO_CODES.filter((codigo) => PERMISO_CATALOGO[codigo] === "sistema");

/** Every permiso a role can hold (everything but `sistema`), in catalog order. */
export const PERMISOS_ASIGNABLES_A_ROLES: readonly Permiso[] = PERMISO_CODES.filter((codigo) => PERMISO_CATALOGO[codigo] !== "sistema");

/** The `operativo` permisos, in catalog order. */
export const PERMISOS_OPERATIVOS: readonly Permiso[] = PERMISO_CODES.filter((codigo) => PERMISO_CATALOGO[codigo] === "operativo");

/**
 * EXACTLY the effective set of the locked ADMINISTRADOR role
 * (`rol.es_administrador`, migration 0054): every `consulta` and `gestion`
 * permiso of the catalog -- never `operativo`, never `sistema`. Computed
 * from the catalog, so a non-operativo permiso added later reaches it
 * automatically. An administrator who must also act operationally (e.g. a
 * pharmacist-owner) additionally holds an operational role.
 */
export const PERMISOS_DE_ADMINISTRADOR: readonly Permiso[] = PERMISO_CODES.filter((codigo) => {
  const categoria = PERMISO_CATALOGO[codigo];
  return categoria === "consulta" || categoria === "gestion";
});

/** `true` if `value` is a catalog permiso that a role may hold. */
export function esPermisoAsignableARol(value: string): value is Permiso {
  return isPermiso(value) && PERMISO_CATALOGO[value] !== "sistema";
}

/**
 * Session basics every role ALWAYS includes (the role use cases add them
 * on every write): without them a usuario whose only role is a custom one
 * could not log out, re-authenticate for a sensitive action
 * (`auth.login`, see modules/auth/application/reautenticar.ts) or change
 * their own password. Every default role already holds all three.
 */
export const PERMISOS_BASE_DE_ROL = ["auth.login", "auth.logout", "auth.password.cambiar"] as const satisfies readonly Permiso[];
