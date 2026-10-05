/**
 * `/admin/accesos/roles/nuevo` (DP-03): create a custom role. Requires
 * `roles.gestionar` (redirects otherwise -- UX; `crearRol` authorizes it
 * again). The actor's grantable permisos are passed to the form so the
 * others render disabled (escalation rule, re-checked server-side).
 */
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listCatalogoPermisos } from "@/modules/usuarios/application/list-catalogo-permisos";
import { RolForm } from "@/modules/usuarios/ui/rol-form";
import { PageHeader } from "@/shared/ui/page-header";

export default async function NuevoRolPage() {
  const session = await requireSession();
  if (!can(session, "roles.gestionar")) {
    redirect("/admin/accesos/roles");
  }
  const { catalogo, otorgables } = await listCatalogoPermisos();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Usuarios y accesos" }, { label: "Roles", href: "/admin/accesos/roles" }, { label: "Nuevo rol" }]}
        title="Nuevo rol"
        description="Elegí un nombre y los permisos que agrupa. Después se lo podés asignar a los usuarios."
      />
      <section className="panel" aria-label="Datos del rol">
        <div className="panel-body">
          <RolForm catalogo={catalogo} otorgables={otorgables} />
        </div>
      </section>
    </>
  );
}
