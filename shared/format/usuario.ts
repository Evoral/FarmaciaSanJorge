/**
 * Display name of a usuario wherever usuarios are listed or picked (auditoría, operador and DT pickers...). The
 * Administrador is flagged "(Admin)" so it is never mistaken for a namesake: a farmacia's owner may hold the
 * Administrador account and, as a separate usuario, the Director Técnico one. `esAdministrador` = holds the locked
 * ADMINISTRADOR role (`rol.es_administrador`); read it with `shared/db/usuario-administrador.ts`.
 */
export const ETIQUETA_ADMINISTRADOR = "Admin";

export interface UsuarioNombrable {
  nombre: string;
  apellido: string;
  esAdministrador?: boolean;
}

/** `orden`: "nombre" = "Roberto Juaire", "apellido" = "Juaire, Roberto" (lists sorted by apellido). */
export function nombreDeUsuario(usuario: UsuarioNombrable, orden: "nombre" | "apellido" = "nombre"): string {
  const nombre = orden === "apellido" ? `${usuario.apellido}, ${usuario.nombre}` : `${usuario.nombre} ${usuario.apellido}`;
  return usuario.esAdministrador ? `${nombre} (${ETIQUETA_ADMINISTRADOR})` : nombre;
}
