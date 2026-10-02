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
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getRol } from "@/modules/usuarios/application/get-rol";
import { agruparPermisos, motivoNoEditable, motivoNoEliminable, motivoNoGestionable } from "@/modules/usuarios/domain/roles";
import { CategoriaBadge } from "@/modules/usuarios/ui/rol-form";
import { RolForm } from "@/modules/usuarios/ui/rol-form";
import { EliminarRolForm } from "@/modules/usuarios/ui/eliminar-rol-form";

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
    <div className="mx-auto max-w-3xl">
      <div className="mb-2">
        <Link href="/admin/accesos/roles" className="text-sm underline">
          ← Volver a roles
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">{rol.nombre}</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        {rol.cantidadUsuarios === 1 ? "1 usuario tiene este rol." : `${rol.cantidadUsuarios} usuarios tienen este rol.`}
      </p>

      {noEditable ? (
        <section className="flex flex-col gap-4">
          {rol.descripcion ? <p className="text-sm">{rol.descripcion}</p> : null}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{noEditable}</p>
          <h2 className="text-lg font-medium">Permisos: consulta y gestión (sin actos operativos)</h2>
          {agruparPermisos(catalogo.filter((permiso) => permisosDelRol.has(permiso.codigo))).map((grupo) => (
            <div key={grupo.grupo} className="card p-3">
              <h3 className="mb-1 text-sm font-semibold">{grupo.etiqueta}</h3>
              <ul className="list-inside list-disc text-sm">
                {grupo.permisos.map((permiso) => (
                  <li key={permiso.codigo}>
                    {permiso.descripcion}
                    <CategoriaBadge categoria={permiso.categoria} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          {motivoSoloLectura ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{motivoSoloLectura}</p> : null}
          <RolForm
            rol={{ id: rol.id, nombre: rol.nombre, descripcion: rol.descripcion, permisos: rol.permisos }}
            catalogo={catalogo}
            otorgables={otorgables}
            disabled={motivoSoloLectura !== null}
          />
        </section>
      )}

      {puedeGestionar && !noEditable ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-medium">Eliminar</h2>
          {noEliminable || noGestionable ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{noGestionable ?? noEliminable}</p>
          ) : (
            <EliminarRolForm rolId={rol.id} nombre={rol.nombre} />
          )}
        </section>
      ) : null}
    </div>
  );
}
