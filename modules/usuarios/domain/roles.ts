/**
 * Role rules (M03, DP-03 RESUELTA 2026-10-01 -- docs/specs/roles-personalizables.md).
 * Pure: no I/O. Roles are per-tenant rows (`fsj.rol`, migration 0054); the
 * set of roles is DATA, not code. Only the three codes business rules
 * depend on are constants here:
 *
 *   - `ADMINISTRADOR`: locked (`esAdministrador`). Holds every `consulta`
 *     and `gestion` permiso of the catalog -- never an `operativo` one
 *     (modules/auth/domain/permisos.ts#PERMISOS_DE_ADMINISTRADOR) -- and
 *     cannot be edited or deleted. It may still GRANT operativo permisos
 *     to other roles (`permisosOtorgables`). Last-admin protections
 *     (cambiarRoles/suspender/baja, admin-guard.ts) key on it.
 *   - `DIRECTOR_TECNICO`: permisos, nombre and descripción editable; never
 *     deletable (INV-DT-001 keys on the code).
 *   - `SISTEMA`: internal role of the per-tenant technical user (migration
 *     0002). Hidden from every listing/picker, never assignable, untouchable.
 *
 * Every other role (the default FARMACEUTICO / ATENCION_PUBLICO /
 * SOLO_CONSULTA and any custom role) is fully editable and deletable while
 * no usuario holds it. The same rules are enforced by DB triggers
 * (INV-ROL-001..005, migration 0054); the checks here give the clear
 * Spanish message first.
 */
import { z } from "zod";
import type { CategoriaPermiso, Permiso } from "@/modules/auth/domain/permisos";
import { esPermisoAsignableARol, PERMISOS_BASE_DE_ROL, PERMISOS_OPERATIVOS } from "@/modules/auth/domain/permisos";

export const ROL_ADMINISTRADOR = "ADMINISTRADOR" as const;
export const ROL_DIRECTOR_TECNICO = "DIRECTOR_TECNICO" as const;
/** The one non-assignable, internal role code (migration 0002). Used to filter it out of any role/user listing that must never expose it. */
export const ROL_SISTEMA = "SISTEMA" as const;

/** Format of every `rol.codigo` (DB CHECK rol_codigo_formato, migration 0054). */
export const CODIGO_ROL_REGEX = /^[A-Z][A-Z0-9_]{0,59}$/;

export const NOMBRE_ROL_MAX = 80;
export const DESCRIPCION_ROL_MAX = 500;

/**
 * A role code submitted by a usuarios form (crearUsuario/cambiarRoles/
 * listUsuarios filter). Format-checked here; EXISTENCE in the session's
 * tenant is checked by the use case against the DB. SISTEMA is rejected
 * structurally, before any transaction opens.
 */
export const codigoRolAsignableSchema = z
  .string()
  .trim()
  .regex(CODIGO_ROL_REGEX, "Rol inválido.")
  .refine((codigo) => codigo !== ROL_SISTEMA, "El rol interno del sistema no se puede asignar.");

/**
 * One permiso of a role write, validated against the CATALOG
 * (modules/auth/domain/permisos.ts#PERMISO_CODES minus the permisos that
 * never belong to a role). An unknown code -- or a client-crafted one --
 * fails validation; nothing from the payload is persisted as-is.
 */
export const permisoDeRolSchema = z.custom<Permiso>(
  (value) => typeof value === "string" && esPermisoAsignableARol(value),
  "Permiso desconocido o que no se puede asignar a un rol.",
);

export const permisosDeRolSchema = z.array(permisoDeRolSchema).max(500);

/** Minimal shape the rules below need -- satisfied by every repository row. */
export interface RolIdentidad {
  codigo: string;
  esAdministrador: boolean;
}

/**
 * - `BLOQUEADO`: ADMINISTRADOR -- read-only, every consulta/gestion permiso (never operativo).
 * - `INTERNO`: SISTEMA -- never shown, never assignable.
 * - `NO_ELIMINABLE`: DIRECTOR_TECNICO -- editable, not deletable.
 * - `NINGUNA`: editable, deletable while unassigned.
 */
export type ProteccionRol = "BLOQUEADO" | "INTERNO" | "NO_ELIMINABLE" | "NINGUNA";

export function proteccionDeRol(rol: RolIdentidad): ProteccionRol {
  if (rol.esAdministrador || rol.codigo === ROL_ADMINISTRADOR) return "BLOQUEADO";
  if (rol.codigo === ROL_SISTEMA) return "INTERNO";
  if (rol.codigo === ROL_DIRECTOR_TECNICO) return "NO_ELIMINABLE";
  return "NINGUNA";
}

/** Assignable to a (human) usuario: every role but SISTEMA. */
export function esRolAsignable(rol: Pick<RolIdentidad, "codigo">): boolean {
  return rol.codigo !== ROL_SISTEMA;
}

/** nombre/descripción/permisos can change. */
export function esRolEditable(rol: RolIdentidad): boolean {
  const proteccion = proteccionDeRol(rol);
  return proteccion !== "BLOQUEADO" && proteccion !== "INTERNO";
}

/** Can be deleted at all (still subject to "no usuario holds it"). */
export function esRolEliminable(rol: RolIdentidad): boolean {
  return proteccionDeRol(rol) === "NINGUNA";
}

/** Why `rol` cannot be edited, or `null` when it can (protection only -- the actor rules are `motivoNoGestionable`). */
export function motivoNoEditable(rol: RolIdentidad): string | null {
  switch (proteccionDeRol(rol)) {
    case "BLOQUEADO":
      return "El rol Administrador tiene siempre todos los permisos de consulta y gestión (sin actos operativos) y no se puede modificar.";
    case "INTERNO":
      return "El rol interno del sistema no se puede modificar.";
    default:
      return null;
  }
}

/** Why `rol` cannot be deleted, or `null` when it can. `cantidadUsuarios` = usuarios currently holding it. */
export function motivoNoEliminable(rol: RolIdentidad, cantidadUsuarios: number): string | null {
  switch (proteccionDeRol(rol)) {
    case "BLOQUEADO":
      return "El rol Administrador no se puede eliminar.";
    case "INTERNO":
      return "El rol interno del sistema no se puede eliminar.";
    case "NO_ELIMINABLE":
      return "El rol Director Técnico no se puede eliminar: las designaciones de Director Técnico dependen de él.";
    default:
      break;
  }
  if (cantidadUsuarios > 0) {
    return cantidadUsuarios === 1
      ? "No se puede eliminar: 1 usuario tiene este rol. Quitáselo antes de eliminarlo."
      : `No se puede eliminar: ${cantidadUsuarios} usuarios tienen este rol. Quitáselo antes de eliminarlo.`;
  }
  return null;
}

/**
 * Escalation rule: nobody edits or deletes a role they hold themselves
 * (they would be widening or narrowing their own access).
 */
export function motivoNoGestionable(rolCodigo: string, rolesDelActor: readonly string[]): string | null {
  return rolesDelActor.includes(rolCodigo) ? "No podés modificar ni eliminar un rol que tenés asignado." : null;
}

export type ResolucionPermisos = { ok: true; permisos: Permiso[] } | { ok: false; noOtorgables: Permiso[] };

/**
 * The permisos an actor may GRANT (put into or take out of a role, or hand
 * to a usuario through a role): the permisos they hold, plus -- grant
 * authority exception -- EVERY `operativo` permiso when the actor holds the
 * ADMINISTRADOR role. The administrator does not EXERCISE operational acts
 * (they are not in its own effective set) but decides who may. Any other
 * role manager keeps the strict rule: only what they hold.
 */
export function permisosOtorgables(delActor: ReadonlySet<Permiso>, actorEsAdministrador: boolean): Set<Permiso> {
  const otorgables = new Set<Permiso>(delActor);
  if (actorEsAdministrador) {
    for (const permiso of PERMISOS_OPERATIVOS) otorgables.add(permiso);
  }
  return otorgables;
}

/**
 * The permisos a role ends up with after a create (`actuales` empty) or
 * edit, applying the escalation rule "nobody grants a permiso outside their
 * grantable set" (`otorgables`, see `permisosOtorgables`):
 *
 *   - a requested permiso outside `otorgables` that the role does not
 *     already have is rejected (`noOtorgables`) -- that would be a grant;
 *   - a permiso outside `otorgables` that the role already has is KEPT
 *     whatever the request says -- the actor cannot manage it in either
 *     direction (the editor shows it disabled, and a disabled checkbox is
 *     never submitted, so its absence from the request means "untouched");
 *   - `PERMISOS_BASE_DE_ROL` are always included (session basics; see
 *     modules/auth/domain/permisos.ts) and never count as a grant.
 *
 * `solicitados` must already be validated against the catalog (zod, see
 * `permisosDeRolSchema`). Result is sorted and de-duplicated.
 */
export function resolverPermisosDeRol(params: {
  solicitados: readonly Permiso[];
  actuales: readonly Permiso[];
  otorgables: ReadonlySet<Permiso>;
}): ResolucionPermisos {
  const base: ReadonlySet<string> = new Set(PERMISOS_BASE_DE_ROL);
  const actuales = new Set<Permiso>(params.actuales);

  const noOtorgables = [...new Set(params.solicitados)].filter(
    (permiso) => !base.has(permiso) && !params.otorgables.has(permiso) && !actuales.has(permiso),
  );
  if (noOtorgables.length > 0) {
    return { ok: false, noOtorgables: noOtorgables.sort() };
  }

  const resultado = new Set<Permiso>(PERMISOS_BASE_DE_ROL);
  for (const permiso of params.solicitados) {
    if (params.otorgables.has(permiso)) resultado.add(permiso);
  }
  for (const permiso of params.actuales) {
    if (!params.otorgables.has(permiso)) resultado.add(permiso);
  }
  return { ok: true, permisos: [...resultado].sort() };
}

/**
 * Escalation rule for ASSIGNING roles (crearUsuario/cambiarRoles): the
 * actor cannot hand a usuario a role whose effective permisos fall outside
 * their grantable set (`permisosOtorgables` -- an ADMINISTRADOR may assign
 * roles carrying operativo permisos). Returns the offending permisos
 * (empty = allowed). `permisosDelRol` is the role's EFFECTIVE set.
 */
export function permisosFueraDeAlcance(permisosDelRol: readonly Permiso[], otorgables: ReadonlySet<Permiso>): Permiso[] {
  return permisosDelRol.filter((permiso) => !otorgables.has(permiso));
}

/**
 * Stable `codigo` for a NEW role, derived from its nombre: accents removed,
 * upper case, non-alphanumerics collapsed into `_`, prefixed `ROL_` when it
 * would not start with a letter, at most 50 chars before the uniqueness
 * suffix (`_2`, `_3`, ...) against `existentes` (the tenant's codes,
 * including SISTEMA). Never changes afterwards (INV-ROL-001), even if the
 * nombre does.
 */
export function generarCodigoRol(nombre: string, existentes: ReadonlySet<string>): string {
  let base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50)
    .replace(/_+$/g, "");
  if (!/^[A-Z]/.test(base)) base = base ? `ROL_${base}`.slice(0, 50) : "ROL";

  if (!existentes.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidato = `${base}_${n}`;
    if (!existentes.has(candidato)) return candidato;
  }
}

/** Permiso group = prefix before the first dot ("stock.ajuste.registrar" -> "stock"). */
export function grupoDePermiso(codigo: string): string {
  const punto = codigo.indexOf(".");
  return punto === -1 ? codigo : codigo.slice(0, punto);
}

/** Display label of each permiso group in the role editor. */
export const GRUPO_PERMISO_LABELS: Readonly<Record<string, string>> = {
  auth: "Sesión y cuenta",
  usuarios: "Usuarios",
  dt: "Directores técnicos",
  roles: "Roles",
  config: "Configuración",
  unidades: "Unidades de medida",
  drogas: "Drogas",
  proveedores: "Proveedores",
  medicos: "Médicos",
  pacientes: "Pacientes",
  precios: "Precios",
  stock: "Stock",
  recetas: "Recetas",
  fichas: "Fichas técnicas",
  cotizaciones: "Presupuestos",
  preparaciones: "Preparaciones",
  etiquetas: "Etiquetas",
  libro: "Libro recetario",
  cierres: "Cierres diarios",
  libros: "Libros rubricados",
  entregas: "Entregas",
  archivo: "Archivo de recetas",
  reportes: "Reportes",
  auditoria: "Auditoría",
};

export function etiquetaGrupoPermiso(grupo: string): string {
  return Object.hasOwn(GRUPO_PERMISO_LABELS, grupo) ? GRUPO_PERMISO_LABELS[grupo]! : grupo.charAt(0).toUpperCase() + grupo.slice(1);
}

export interface PermisoCatalogo {
  codigo: Permiso;
  descripcion: string;
  categoria: CategoriaPermiso;
}

/** Badge text of each permiso category in the role editor. */
export const CATEGORIA_PERMISO_LABELS: Readonly<Record<CategoriaPermiso, string>> = {
  operativo: "Operativo",
  consulta: "Consulta",
  gestion: "Gestión",
  sistema: "Sistema",
};

export interface GrupoPermisos {
  grupo: string;
  etiqueta: string;
  permisos: PermisoCatalogo[];
}

/** Groups catalog permisos by module, keeping the catalog order (first appearance of each group). */
export function agruparPermisos(catalogo: readonly PermisoCatalogo[]): GrupoPermisos[] {
  const grupos = new Map<string, GrupoPermisos>();
  for (const permiso of catalogo) {
    const grupo = grupoDePermiso(permiso.codigo);
    let entry = grupos.get(grupo);
    if (!entry) {
      entry = { grupo, etiqueta: etiquetaGrupoPermiso(grupo), permisos: [] };
      grupos.set(grupo, entry);
    }
    entry.permisos.push(permiso);
  }
  return [...grupos.values()];
}
