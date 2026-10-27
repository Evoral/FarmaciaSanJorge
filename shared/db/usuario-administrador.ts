/**
 * Prisma `select` fragment for a `usuario` row: its ADMINISTRADOR assignment, if any (at most one row). Spread it into
 * a usuario select and read the flag with `esAdministradorDe`, so a listing can flag the Administrador
 * (`shared/format/usuario.ts`) without loading every role.
 */
export const SELECT_ROL_ADMINISTRADOR = {
  rolesAsignados: { where: { rol: { esAdministrador: true } }, select: { rolId: true }, take: 1 },
} as const;

export function esAdministradorDe(row: { rolesAsignados: readonly unknown[] }): boolean {
  return row.rolesAsignados.length > 0;
}
