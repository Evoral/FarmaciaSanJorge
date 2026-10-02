/**
 * `/admin/accesos/usuarios/nuevo` (M03, FASE 3 point 3.2). Server component:
 * loads the role options of the session's tenant (DP-03 -- roles are
 * per-tenant data, SISTEMA never offered) and renders the client form
 * (`./nuevo-usuario-form.tsx`). `crearUsuario` re-validates every submitted
 * role code server-side.
 */
import { listRolesAsignables } from "@/modules/usuarios/application/list-roles-asignables";
import { NuevoUsuarioForm } from "./nuevo-usuario-form";

export default async function NuevoUsuarioPage() {
  const roles = await listRolesAsignables();
  return <NuevoUsuarioForm roles={roles} />;
}
