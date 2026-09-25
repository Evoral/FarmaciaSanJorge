/**
 * `/admin/roles` (M03, FASE 3 point 3.8). Read-only: editing is DP-03
 * (unresolved in the plan) -- no form, no mutation, on purpose.
 */
import Link from "next/link";
import { listRolesConPermisos } from "@/modules/usuarios/application/list-roles-con-permisos";

export default async function RolesPage() {
  const roles = await listRolesConPermisos();

  return (
    <div>
      <div className="mb-2">
        <Link href="/admin/usuarios" className="text-sm underline">
          ← Volver a usuarios
        </Link>
      </div>
      <h1 className="mb-2 text-2xl font-semibold">Roles y permisos</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Catálogo de solo lectura. La asignación de permisos a cada rol está fija por ahora.
      </p>

      <div className="flex flex-col gap-6">
        {roles.map((rol) => (
          <section key={rol.codigo} className="card p-4">
            <h2 className="text-base font-semibold">{rol.nombre}</h2>
            {rol.descripcion ? <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{rol.descripcion}</p> : null}
            <ul className="flex flex-wrap gap-2">
              {rol.permisos.map((permiso) => (
                <li key={permiso} className="rounded bg-zinc-100 px-2 py-1 text-xs font-mono dark:bg-zinc-800">
                  {permiso}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
