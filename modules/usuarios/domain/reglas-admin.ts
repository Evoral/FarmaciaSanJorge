/**
 * Pure decision rules for INV-USR-004 (always >= 1 ACTIVO ADMINISTRADOR per
 * tenant) and INV-USR-005 (an ADM cannot act on their own account for these
 * operations) -- both [APP]-level invariants (plan §9 M03), unlike
 * INV-U02/INV-USR-006 which the DB itself enforces.
 *
 * These functions take already-loaded data (never touch Prisma/tx
 * themselves) so the DECISION is unit-testable without a database --
 * `modules/usuarios/infrastructure/admin-guard.ts` is what actually loads
 * (and row-locks, via `SELECT ... FOR UPDATE`) the list of currently-ACTIVO
 * administrator ids that these functions are handed.
 */

/** INV-USR-005: an ADMINISTRADOR cannot suspend, dar de baja, restablecer su propia credencial, ni quitarse su propio rol ADMINISTRADOR. */
export function esAccionSobreSiMismo(actorUsuarioId: string, usuarioObjetivoId: string): boolean {
  return actorUsuarioId === usuarioObjetivoId;
}

/**
 * INV-USR-004: `true` when removing/deactivating `usuarioObjetivoId` would
 * leave the tenant with zero ACTIVO administrators. `idsAdministradoresActivos`
 * must be the row-locked (`FOR UPDATE`) snapshot for the CURRENT tenant,
 * taken inside the same transaction that will perform the write -- see
 * `modules/usuarios/infrastructure/admin-guard.ts#lockUsuarioYAdministradoresActivos`.
 */
export function quedariaSinAdministradores(
  idsAdministradoresActivos: readonly string[],
  usuarioObjetivoId: string,
): boolean {
  return idsAdministradoresActivos.includes(usuarioObjetivoId) && idsAdministradoresActivos.length <= 1;
}
