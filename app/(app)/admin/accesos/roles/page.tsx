/**
 * `/admin/accesos/roles` (M03, FASE 3 point 3.8; DP-03 RESUELTA 2026-10-01):
 * the session tenant's roles with their description, how many usuarios
 * hold each (split into personal accounts and cuentas de sector, since a role
 * is not of either kind by itself -- openspec/specs/cuentas-de-sector/spec.md),
 * and their protection. Reading needs `roles.ver` (layout +
 * query); the "Nuevo rol" button shows only with `roles.gestionar` -- UX
 * only, every write command authorizes `roles.gestionar` itself. The
 * "Usuarios y accesos" tabs sit under the header.
 */
import Link from "next/link";
import { ChevronRight, Lock, Plus, ShieldCheck, User, Users } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRolesConPermisos } from "@/modules/usuarios/application/list-roles-con-permisos";
import type { RolConPermisos } from "@/modules/usuarios/application/list-roles-con-permisos";
import type { ProteccionRol } from "@/modules/usuarios/domain/roles";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { accesosSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

const PROTECCION_BADGE: Record<ProteccionRol, { label: string; title: string } | null> = {
  BLOQUEADO: { label: "Bloqueado", title: "Tiene siempre todos los permisos de consulta y gestión, sin actos operativos. No se puede modificar ni eliminar." },
  NO_ELIMINABLE: { label: "Protegido", title: "Se pueden editar sus permisos, pero no se puede eliminar." },
  INTERNO: null,
  NINGUNA: null,
};

const numberFormat = new Intl.NumberFormat("es-AR");

/** Which kind of account holds the role: personal (a person's own login) and/or de sector (a shared session per work area). */
function TipoDeCuenta({ rol }: { rol: RolConPermisos }) {
  const personales = rol.cantidadUsuarios - rol.cantidadUsuariosDeSector;
  const deSector = rol.cantidadUsuariosDeSector;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {rol.soloPersonal ? (
        <span title="Una cuenta de sector nunca puede tener este rol." className="badge inline-flex items-center gap-1 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          <User className="size-3" aria-hidden />
          Solo personal
        </span>
      ) : null}
      {!rol.soloPersonal && personales > 0 ? (
        <span title={`${numberFormat.format(personales)} ${personales === 1 ? "cuenta personal" : "cuentas personales"}`} className="badge inline-flex items-center gap-1 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          <User className="size-3" aria-hidden />
          Personal · <span className="font-mono tabular-nums">{numberFormat.format(personales)}</span>
        </span>
      ) : null}
      {deSector > 0 ? (
        <span title={`${numberFormat.format(deSector)} ${deSector === 1 ? "cuenta de sector" : "cuentas de sector"}`} className="badge inline-flex items-center gap-1 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
          <Users className="size-3" aria-hidden />
          Sector · <span className="font-mono tabular-nums">{numberFormat.format(deSector)}</span>
        </span>
      ) : null}
      {!rol.soloPersonal && rol.cantidadUsuarios === 0 ? <span className="text-zinc-400">Sin usuarios</span> : null}
    </span>
  );
}

export default async function RolesPage() {
  const session = await requireSession();
  const roles = await listRolesConPermisos();
  const puedeGestionar = can(session, "roles.gestionar");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Usuarios y accesos" }, { label: "Roles" }]}
        title="Roles y permisos"
        description="Cada rol agrupa permisos. Un usuario tiene la suma de los permisos de todos sus roles. Los cambios se aplican en la próxima acción de cada usuario."
        actions={
          puedeGestionar ? (
            <Link href="/admin/accesos/roles/nuevo" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nuevo rol
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de usuarios y accesos" links={accesosSections(session)} />

      <div className="list-panel">
        <div className="list-toolbar">
          <p role="status">
            <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(roles.length)}</span> {roles.length === 1 ? "rol" : "roles"}
          </p>
        </div>

        {roles.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="size-5" />} title="Todavía no hay roles" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Rol
                  </th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">
                    Descripción
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Permisos
                  </th>
                  <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">
                    Usuarios
                  </th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                    Tipo de cuenta
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {roles.map((rol) => {
                  const badge = PROTECCION_BADGE[rol.proteccion];
                  return (
                    <tr key={rol.id}>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href={`/admin/accesos/roles/${rol.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                            {rol.nombre}
                          </Link>
                          {badge ? (
                            <span title={badge.title} className="badge inline-flex items-center gap-1 bg-zinc-100 text-zinc-700">
                              <Lock className="size-3" aria-hidden />
                              {badge.label}
                            </span>
                          ) : null}
                        </span>
                        {rol.descripcion ? <span className="block text-xs text-zinc-500 md:hidden">{rol.descripcion}</span> : null}
                      </td>
                      <td className="hidden max-w-md px-3 py-2.5 text-zinc-600 md:table-cell">{rol.descripcion ?? <span className="text-zinc-400">-</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                        {rol.esAdministrador ? <span className="font-sans text-zinc-600">Consulta y gestión</span> : rol.permisos.length}
                      </td>
                      <td className="hidden px-3 py-2.5 text-right font-mono tabular-nums sm:table-cell">{rol.cantidadUsuarios}</td>
                      <td className="hidden px-3 py-2.5 sm:table-cell">
                        <TipoDeCuenta rol={rol} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/admin/accesos/roles/${rol.id}`} className="btn btn-ghost btn-sm">
                          {puedeGestionar && rol.proteccion !== "BLOQUEADO" ? "Editar" : "Ver"}
                          <ChevronRight className="size-3.5" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
