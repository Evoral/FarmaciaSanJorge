/**
 * `/admin/accesos/roles/nuevo` (DP-03): create a custom role. Requires
 * `roles.gestionar` (redirects otherwise -- UX; `crearRol` authorizes it
 * again). The actor's grantable permisos are passed to the form so the
 * others render disabled (escalation rule, re-checked server-side).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listCatalogoPermisos } from "@/modules/usuarios/application/list-catalogo-permisos";
import { RolForm } from "@/modules/usuarios/ui/rol-form";

export default async function NuevoRolPage() {
  const session = await requireSession();
  if (!can(session, "roles.gestionar")) {
    redirect("/admin/accesos/roles");
  }
  const { catalogo, otorgables } = await listCatalogoPermisos();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2">
        <Link href="/admin/accesos/roles" className="text-sm underline">
          ← Volver a roles
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">Nuevo rol</h1>
      <RolForm catalogo={catalogo} otorgables={otorgables} />
    </div>
  );
}
