/**
 * `/admin/accesos/directores-tecnicos` (M04, FASE 3 point 3.9). Server component:
 * "DT vigente hoy" banner, then the list of designations (current +
 * historical, filterable), each vigente row offering an inline cese form.
 * Filter/pagination are plain GET query params (`FilterForm`: a native
 * `<form method="get">` that auto-applies), same density/accessibility priorities as
 * `/admin/accesos/usuarios` (see that page's module doc comment). The
 * "Usuarios y accesos" tabs sit under the header.
 */
import Link from "next/link";
import { BadgeCheck, CircleAlert, Plus, UserCog } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDesignaciones } from "@/modules/directores-tecnicos/application/list-designaciones";
import { dtVigenteHoy } from "@/modules/directores-tecnicos/application/dt-vigente-hoy";
import { CARACTER_LABELS } from "@/modules/directores-tecnicos/domain/designacion";
import { FilterForm } from "@/shared/ui/filter-form";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { Avatar } from "@/shared/ui/avatar";
import { ToneBadge } from "@/shared/ui/status-badge";
import { accesosSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";
import { CeseForm } from "./cese-form";

const PAGE_SIZE = 20;

type VigenciaFiltro = "todas" | "vigentes" | "historicas";

interface DirectoresTecnicosPageProps {
  searchParams: Promise<{ vigencia?: string; page?: string }>;
}

function formatFecha(value: Date): string {
  return new Date(value).toLocaleDateString("es-AR");
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function DirectoresTecnicosPage({ searchParams }: DirectoresTecnicosPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const vigencia: VigenciaFiltro = params.vigencia === "vigentes" || params.vigencia === "historicas" ? params.vigencia : "todas";
  const soloVigentes = vigencia === "vigentes" ? true : vigencia === "historicas" ? false : undefined;

  const puedeDesignar = can(session, "dt.designar");
  const puedeCesar = can(session, "dt.cesar");

  const [vigenteHoy, listado] = await Promise.all([dtVigenteHoy(), listDesignaciones({ soloVigentes, page, pageSize: PAGE_SIZE })]);

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (vigencia !== "todas") qs.set("vigencia", vigencia);
    qs.set("page", String(targetPage));
    return `/admin/accesos/directores-tecnicos?${qs.toString()}`;
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Usuarios y accesos" }, { label: "Directores técnicos" }]}
        title="Directores técnicos"
        description="Quién es el Director Técnico titular y los suplentes, con el historial de designaciones y ceses."
        actions={
          puedeDesignar ? (
            <Link href="/admin/accesos/directores-tecnicos/nuevo" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nueva designación
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de usuarios y accesos" links={accesosSections(session)} />

      <section className="panel mb-6" aria-labelledby="vigente-hoy-heading" data-tone={vigenteHoy.titular ? undefined : "danger"}>
        <div className="panel-header">
          <h2 id="vigente-hoy-heading">DT vigente hoy</h2>
        </div>
        <div className="panel-body flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:gap-8">
          {vigenteHoy.titular ? (
            <div className="person-block">
              <Avatar name={`${vigenteHoy.titular.usuarioApellido}, ${vigenteHoy.titular.usuarioNombre}`} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-zinc-900">
                  {vigenteHoy.titular.usuarioApellido}, {vigenteHoy.titular.usuarioNombre}
                  <ToneBadge tone="success">Titular</ToneBadge>
                </p>
                <p className="text-xs text-zinc-500">
                  Matrícula <span className="font-mono text-zinc-700">{vigenteHoy.titular.matricula}</span>
                </p>
              </div>
            </div>
          ) : (
            <p role="alert" className="flex items-center gap-2 text-sm font-medium text-red-700">
              <CircleAlert className="size-4" aria-hidden />
              No hay un Director Técnico TITULAR vigente hoy.
            </p>
          )}
          {vigenteHoy.suplentes.map((s) => (
            <div key={`${s.usuarioApellido}-${s.matricula}`} className="person-block">
              <Avatar name={`${s.usuarioApellido}, ${s.usuarioNombre}`} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-zinc-900">
                  {s.usuarioApellido}, {s.usuarioNombre}
                  <ToneBadge tone="neutral">Suplente</ToneBadge>
                </p>
                <p className="text-xs text-zinc-500">
                  Matrícula <span className="font-mono text-zinc-700">{s.matricula}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtro de designaciones" hasActiveFilters={false}>
          <div className="field">
            <label htmlFor="vigencia" className="sr-only">
              Estado
            </label>
            <select id="vigencia" name="vigencia" defaultValue={vigencia === "todas" ? "" : vigencia} className="input">
              <option value="">Todas las designaciones</option>
              <option value="vigentes">Vigentes (sin cese)</option>
              <option value="historicas">Históricas (con cese)</option>
            </select>
          </div>
        </FilterForm>
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(listado.total)}</span> {listado.total === 1 ? "designación" : "designaciones"}
            </p>
            {vigencia === "vigentes" || vigencia === "todas" ? (
              <p className="hidden text-xs text-zinc-500 md:block">Puede haber varias designaciones SUPLENTE vigentes al mismo tiempo.</p>
            ) : null}
          </div>

          {listado.items.length === 0 ? (
            <EmptyState
              icon={<UserCog className="size-5" />}
              title={vigencia === "todas" ? "Todavía no hay designaciones" : "Sin designaciones en este estado"}
              action={
                vigencia !== "todas" ? (
                  <Link href="/admin/accesos/directores-tecnicos" scroll={false} className="btn btn-secondary">
                    Ver todas
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Usuario
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Carácter
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Matrícula
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Vigencia
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Motivo de cese
                    </th>
                    {puedeCesar ? (
                      <th scope="col" className="px-3 py-2">
                        <span className="sr-only">Acciones</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {listado.items.map((designacion) => {
                    const nombre = `${designacion.usuarioApellido}, ${designacion.usuarioNombre}`;
                    const vigente = designacion.vigenteHasta === null;
                    return (
                      <tr key={designacion.id} className="align-top">
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <Avatar name={nombre} />
                            <span className="min-w-0">
                              <span className="block font-medium text-zinc-900">{nombre}</span>
                              <span className="block font-mono text-xs text-zinc-500 md:hidden">
                                {formatFecha(designacion.vigenteDesde)} a {designacion.vigenteHasta ? formatFecha(designacion.vigenteHasta) : "sin cese"}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <ToneBadge tone={designacion.caracter === "TITULAR" ? "success" : "neutral"}>{CARACTER_LABELS[designacion.caracter]}</ToneBadge>
                            {vigente ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                                <BadgeCheck className="size-3.5" aria-hidden />
                                Sin cese
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono sm:table-cell">{designacion.matricula}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums md:table-cell">
                          {formatFecha(designacion.vigenteDesde)} <span className="text-zinc-400">a</span>{" "}
                          {designacion.vigenteHasta ? formatFecha(designacion.vigenteHasta) : <span className="font-sans text-zinc-500">sin cese</span>}
                        </td>
                        <td className="hidden max-w-xs px-3 py-2.5 lg:table-cell">{designacion.motivoCese ?? <span className="text-zinc-400">-</span>}</td>
                        {puedeCesar ? (
                          <td className="px-3 py-2.5 text-right">
                            {vigente ? <CeseForm designacionId={designacion.id} /> : <span className="text-xs text-zinc-500">Ya cesada</span>}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={listado.total} hrefFor={pageHref} label="Paginación de designaciones" />
        </div>
      </div>
    </>
  );
}
