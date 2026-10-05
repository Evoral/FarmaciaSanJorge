/**
 * `/admin/accesos/roles/[id]` (DP-03): role detail + editor + delete.
 *
 *   - ADMINISTRADOR (locked): read-only "consulta y gestión (sin actos
 *     operativos)" view, listing exactly its effective permisos.
 *   - Without `roles.gestionar`, or for a role the actor holds: read-only
 *     editor with the reason shown.
 *   - Delete: only for deletable roles nobody holds; otherwise the reason
 *     (protected / "N usuarios tienen este rol") is shown instead.
 *
 * Every rule here is UX: editarRol/eliminarRol re-check them server-side,
 * and the DB triggers (INV-ROL-001..004) are the final backstop.
 */
import { notFound } from "next/navigation";
import { Info, Lock } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getRol } from "@/modules/usuarios/application/get-rol";
import { agruparPermisos, motivoNoEditable, motivoNoEliminable, motivoNoGestionable } from "@/modules/usuarios/domain/roles";
import { CategoriaBadge } from "@/modules/usuarios/ui/rol-form";
import { RolForm } from "@/modules/usuarios/ui/rol-form";
import { EliminarRolForm } from "@/modules/usuarios/ui/eliminar-rol-form";
import { PageHeader } from "@/shared/ui/page-header";

interface RolDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function RolDetallePage({ params }: RolDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;
  const resultado = await getRol(id);
  if (!resultado) notFound();
  const { rol, catalogo, rolesDelActor, otorgables } = resultado;
  const permisosDelRol = new Set<string>(rol.permisos);

  const puedeGestionar = can(session, "roles.gestionar");
  const noEditable = motivoNoEditable(rol);
  const noGestionable = motivoNoGestionable(rol.codigo, rolesDelActor);
  const noEliminable = motivoNoEliminable(rol, rol.cantidadUsuarios);
  const motivoSoloLectura = !puedeGestionar ? "No tenés permiso para modificar roles." : noGestionable;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Usuarios y accesos" }, { label: "Roles", href: "/admin/accesos/roles" }, { label: rol.nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {rol.nombre}
            {rol.proteccion === "BLOQUEADO" ? (
              <span className="badge inline-flex items-center gap-1 bg-zinc-100 text-zinc-700">
                <Lock className="size-3" aria-hidden />
                Bloqueado
              </span>
            ) : null}
          </span>
        }
        description={rol.cantidadUsuarios === 1 ? "1 usuario tiene este rol." : `${rol.cantidadUsuarios} usuarios tienen este rol.`}
      />

      {noEditable ? (
        <section className="flex flex-col gap-4" aria-labelledby="permisos-heading">
          {rol.descripcion ? <p className="text-sm text-zinc-700">{rol.descripcion}</p> : null}
          <p role="note" className="alert alert-info">
            <Info aria-hidden />
            <span>{noEditable}</span>
          </p>
          <h2 id="permisos-heading" className="text-[0.9375rem] font-semibold text-zinc-900">
            Permisos: consulta y gestión (sin actos operativos)
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {agruparPermisos(catalogo.filter((permiso) => permisosDelRol.has(permiso.codigo))).map((grupo) => (
              <div key={grupo.grupo} className="group-card">
                <div className="group-card-header">
                  <h3 className="text-[0.8125rem] font-semibold text-zinc-900">{grupo.etiqueta}</h3>
                </div>
                <ul className="flex flex-col divide-y divide-zinc-100">
                  {grupo.permisos.map((permiso) => (
                    <li key={permiso.codigo} className="flex items-start justify-between gap-3 px-3 py-2 text-[0.8125rem] text-zinc-900">
                      {permiso.descripcion}
                      <CategoriaBadge categoria={permiso.categoria} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel" aria-label="Datos y permisos del rol">
          <div className="panel-body flex flex-col gap-4">
            {motivoSoloLectura ? (
              <p role="note" className="alert alert-info">
                <Info aria-hidden />
                <span>{motivoSoloLectura}</span>
              </p>
            ) : null}
            <RolForm
              rol={{ id: rol.id, nombre: rol.nombre, descripcion: rol.descripcion, permisos: rol.permisos }}
              catalogo={catalogo}
              otorgables={otorgables}
              disabled={motivoSoloLectura !== null}
            />
          </div>
        </section>
      )}

      {puedeGestionar && !noEditable ? (
        <section className="panel mt-6 max-w-2xl" data-tone="danger" aria-labelledby="eliminar-heading">
          <div className="panel-header">
            <h2 id="eliminar-heading">Eliminar rol</h2>
          </div>
          <div className="panel-body">
            {noEliminable || noGestionable ? (
              <p className="text-[0.8125rem] text-zinc-600">{noGestionable ?? noEliminable}</p>
            ) : (
              <EliminarRolForm rolId={rol.id} nombre={rol.nombre} />
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
