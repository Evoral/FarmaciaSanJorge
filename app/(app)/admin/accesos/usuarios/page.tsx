/**
 * `/admin/accesos/usuarios` (M03, FASE 3 point 3.1). Server component: search,
 * estado/rol filters and pagination are all plain GET query params
 * (`FilterForm`: a native `<form method="get">` that auto-applies, and
 * still works with JS disabled) so the list is
 * bookmarkable, back-button-friendly, and works with JS disabled --
 * appropriate density/accessibility priorities for an internal tool (see
 * this task's frontend-design guidance). The search is an autocomplete
 * (suggestions open the usuario; its last row filters the list by the typed
 * text). The "Usuarios y accesos" tabs sit under the header.
 */
import Link from "next/link";
import { ChevronRight, Plus, SearchX, Users, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listUsuarios } from "@/modules/usuarios/application/list-usuarios";
import { listRolesAsignables } from "@/modules/usuarios/application/list-roles-asignables";
import { buscarUsuariosAction } from "@/modules/usuarios/ui/buscar-usuarios-action";
import { ESTADO_USUARIO_LABELS } from "@/shared/labels/enum-labels";
import { FilterForm } from "@/shared/ui/filter-form";
import { BuscadorNavegable } from "@/shared/ui/buscador-navegable";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { Avatar } from "@/shared/ui/avatar";
import { StatusBadge } from "@/shared/ui/status-badge";
import { accesosSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

const ESTADOS = ["PENDIENTE_ACTIVACION", "ACTIVO", "SUSPENDIDO", "BAJA"] as const;
type EstadoFiltro = (typeof ESTADOS)[number];

const PAGE_SIZE = 20;

type FilterParam = "q" | "estado" | "rol";

interface UsuariosPageProps {
  searchParams: Promise<{ q?: string; estado?: string; rol?: string; page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function UsuariosPage({ searchParams }: UsuariosPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const estado = params.estado && (ESTADOS as readonly string[]).includes(params.estado) ? (params.estado as EstadoFiltro) : undefined;
  // Roles are per-tenant data (DP-03): the filter only accepts a code of one of the tenant's own roles.
  const rolesOpciones = await listRolesAsignables();
  const rol = params.rol && rolesOpciones.some((opcion) => opcion.codigo === params.rol) ? params.rol : undefined;

  const result = await listUsuarios({ search: params.q, estado, rolCodigo: rol, page, pageSize: PAGE_SIZE });

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (estado) qs.set("estado", estado);
    if (rol) qs.set("rol", rol);
    qs.set("page", String(targetPage));
    return `/admin/accesos/usuarios?${qs.toString()}`;
  }

  function sinFiltroHref(param: FilterParam): string {
    const qs = new URLSearchParams();
    if (params.q && param !== "q") qs.set("q", params.q);
    if (estado && param !== "estado") qs.set("estado", estado);
    if (rol && param !== "rol") qs.set("rol", rol);
    const query = qs.toString();
    return query ? `/admin/accesos/usuarios?${query}` : "/admin/accesos/usuarios";
  }

  const chips: { key: FilterParam; label: string; value: string }[] = [];
  if (params.q) chips.push({ key: "q", label: "Búsqueda", value: params.q });
  if (estado) chips.push({ key: "estado", label: "Estado", value: ESTADO_USUARIO_LABELS[estado] });
  if (rol) chips.push({ key: "rol", label: "Rol", value: rolesOpciones.find((o) => o.codigo === rol)?.nombre ?? rol });
  const hayFiltros = chips.length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Usuarios y accesos" }, { label: "Usuarios" }]}
        title="Usuarios"
        description="Quiénes pueden entrar al sistema, con qué roles y en qué estado está su cuenta."
        actions={
          can(session, "usuarios.crear") ? (
            <Link href="/admin/accesos/usuarios/nuevo" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nuevo usuario
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de usuarios y accesos" links={accesosSections(session)} />

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de búsqueda de usuarios" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while the other filters change. */}
          <input type="hidden" name="q" value={params.q ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <BuscadorNavegable
              id="q-buscar"
              label="Buscar usuario"
              placeholder="Nombre, apellido, email o DNI"
              buscar={buscarUsuariosAction}
              detalleHref="/admin/accesos/usuarios/{id}"
              listaHref={sinFiltroHref("q")}
              busquedaActual={params.q}
              textoVerTodos="Ver todos los usuarios"
            />
          </div>
          <div className="field">
            <label htmlFor="estado" className="sr-only">
              Estado
            </label>
            <select id="estado" name="estado" defaultValue={estado ?? ""} className="input">
              <option value="">Todos los estados</option>
              {ESTADOS.map((value) => (
                <option key={value} value={value}>
                  {ESTADO_USUARIO_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rol" className="sr-only">
              Rol
            </label>
            <select id="rol" name="rol" defaultValue={rol ?? ""} className="input">
              <option value="">Todos los roles</option>
              {rolesOpciones.map((opcion) => (
                <option key={opcion.codigo} value={opcion.codigo}>
                  {opcion.nombre}
                </option>
              ))}
            </select>
          </div>
        </FilterForm>

        {hayFiltros ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}: <strong>{chip.value}</strong>
                <Link href={sinFiltroHref(chip.key)} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href="/admin/accesos/usuarios" scroll={false} className="btn btn-ghost btn-sm">
                Limpiar filtros
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "usuario" : "usuarios"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún usuario coincide con los filtros aplicados."
                action={
                  <Link href="/admin/accesos/usuarios" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<Users className="size-5" />} title="Todavía no hay usuarios" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Usuario
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      DNI
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Roles
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Estado
                    </th>
                    <th scope="col" className="hidden px-3 py-2 xl:table-cell">
                      Último acceso
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((usuario) => {
                    const nombre = `${usuario.apellido}, ${usuario.nombre}`;
                    return (
                      <tr key={usuario.id}>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <Avatar name={nombre} />
                            <span className="min-w-0">
                              <Link href={`/admin/accesos/usuarios/${usuario.id}`} className="block truncate font-medium text-zinc-900 underline-offset-2 hover:underline">
                                {nombre}
                              </Link>
                              <span className="block truncate text-xs text-zinc-500">{usuario.email}</span>
                            </span>
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono lg:table-cell">{usuario.dni}</td>
                        <td className="hidden px-3 py-2.5 md:table-cell">
                          <span className="flex flex-wrap gap-1">
                            {usuario.roles.map((asignado) => (
                              <span key={asignado.nombre} className="badge bg-zinc-100 text-zinc-700">
                                {asignado.nombre}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge estado={usuario.estado} />
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums text-zinc-600 xl:table-cell">
                          {usuario.ultimoAcceso ? new Date(usuario.ultimoAcceso).toLocaleString("es-AR") : <span className="font-sans text-zinc-400">Sin accesos</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link href={`/admin/accesos/usuarios/${usuario.id}`} aria-label={`Ver a ${nombre}`} className="btn btn-ghost btn-sm btn-icon">
                            <ChevronRight className="size-4" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de usuarios" />
        </div>
      </div>
    </>
  );
}
