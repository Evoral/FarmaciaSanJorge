/**
 * A validated platform (superadmin) session (openspec/specs/plataforma/spec.md P4/P6). The superadmin has no
 * tenant: nothing here can open a tenant transaction. `tokenHash` travels to every platform SQL function, which
 * derives the actor from it again (fsj.plataforma_actor) instead of trusting `superadminId`.
 */
export interface SuperAdminSession {
  superadminId: string;
  email: string;
  nombre: string;
  tokenHash: string;
}
