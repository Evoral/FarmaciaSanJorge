/**
 * `/admin/accesos/roles` (M03, FASE 3 point 3.8; DP-03 RESUELTA 2026-10-01):
 * the session tenant's roles with their description, how many usuarios
 * hold each, and their protection. Reading needs `roles.ver` (layout +
 * query); the "Nuevo rol" button shows only with `roles.gestionar` -- UX
 * only, every write command authorizes `roles.gestionar` itself.
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRolesConPermisos } from "@/modules/usuarios/application/list-roles-con-permisos";
import type { ProteccionRol } from "@/modules/usuarios/domain/roles";

const PROTECCION_BADGE: Record<ProteccionRol, { label: string; title: string } | null> = {
  BLOQUEADO: { label: "Bloqueado", title: "Tiene siempre todos los permisos de consulta y gestión, sin actos operativos. No se puede modificar ni eliminar." },
  NO_ELIMINABLE: { label: "Protegido", title: "Se pueden editar sus permisos, pero no se puede eliminar." },
  INTERNO: null,
  NINGUNA: null,
};

export default async function RolesPage() {
  const session = await requireSession();
  const roles = await listRolesConPermisos();
  const puedeGestionar = can(session, "roles.gestionar");

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Roles y permisos</h1>
        {puedeGestionar ? (
          <Link href="/admin/accesos/roles/nuevo" className="btn btn-primary">
            Nuevo rol
          </Link>
        ) : null}
      </div>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Cada rol agrupa permisos. Un usuario tiene la suma de los permisos de todos sus roles. Los cambios se aplican en la próxima
        acción de cada usuario.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Rol</th>
              <th scope="col" className="px-3 py-2 font-medium">Descripción</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Permisos</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Usuarios</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((rol) => {
              const badge = PROTECCION_BADGE[rol.proteccion];
              return (
                <tr key={rol.id}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/accesos/roles/${rol.id}`} className="font-medium underline-offset-2 hover:underline">
                      {rol.nombre}
                    </Link>
                    {badge ? (
                      <span title={badge.title} className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {badge.label}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{rol.descripcion ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{rol.esAdministrador ? "Consulta y gestión" : rol.permisos.length}</td>
                  <td className="px-3 py-2 text-right">{rol.cantidadUsuarios}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/accesos/roles/${rol.id}`} className="btn btn-secondary btn-sm">
                      {puedeGestionar && rol.proteccion !== "BLOQUEADO" ? "Editar" : "Ver"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
