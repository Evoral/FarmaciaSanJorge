/**
 * `/catalogos/unidades` (M05, FASE 4 point 4.1). GLOBAL catalog (DP-39): the
 * list is the same for every tenant. Search + tipoMagnitud + vigente/baja
 * filters, plain GET query params (same bookmarkable/no-JS pattern as
 * app/(app)/admin/accesos/usuarios/page.tsx). The search is an autocomplete
 * (suggestions open the unidad; its last row filters the list by the typed text).
 */
import Link from "next/link";
import { ChevronRight, Globe, Plus, Ruler, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listUnidades } from "@/modules/unidades/application/list-unidades";
import { TIPOS_MAGNITUD, TIPO_MAGNITUD_LABELS, esTipoMagnitud } from "@/modules/unidades/domain/unidad";
import { UnidadForm } from "@/modules/unidades/ui/unidad-form";
import { buscarUnidadesCatalogoAction } from "@/modules/unidades/ui/buscar-unidades-catalogo-action";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { BuscadorNavegable } from "@/shared/ui/buscador-navegable";
import { PageHeader } from "@/shared/ui/page-header";
import { SectionTabs } from "../../section-tabs";
import { catalogosSections } from "../../nav-sections";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

type ParamUnidades = "q" | "magnitud" | "estado";

interface UnidadesPageProps {
  searchParams: Promise<{ q?: string; magnitud?: string; estado?: string; page?: string; nueva?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function UnidadesPage({ searchParams }: UnidadesPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const tipoMagnitud = params.magnitud && esTipoMagnitud(params.magnitud) ? params.magnitud : undefined;
  const soloVigentes = params.estado === "baja" ? false : params.estado === "vigente" ? true : undefined;

  const result = await listUnidades({ search: params.q, tipoMagnitud, soloVigentes, page, pageSize: PAGE_SIZE });
  const puedeCrear = can(session, "unidades.crear");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (tipoMagnitud) qs.set("magnitud", tipoMagnitud);
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `/catalogos/unidades?${qs.toString()}`;
  }

  function sinFiltroHref(param: ParamUnidades): string {
    const qs = new URLSearchParams();
    if (params.q && param !== "q") qs.set("q", params.q);
    if (tipoMagnitud && param !== "magnitud") qs.set("magnitud", tipoMagnitud);
    if (params.estado && param !== "estado") qs.set("estado", params.estado);
    const query = qs.toString();
    return query ? `/catalogos/unidades?${query}` : "/catalogos/unidades";
  }

  const chips: { key: ParamUnidades; label: string; value?: string }[] = [];
  if (params.q) chips.push({ key: "q", label: "Búsqueda", value: params.q });
  if (tipoMagnitud) chips.push({ key: "magnitud", label: "Magnitud", value: TIPO_MAGNITUD_LABELS[tipoMagnitud] });
  if (params.estado === "vigente" || params.estado === "baja") chips.push({ key: "estado", label: params.estado === "vigente" ? "Vigentes" : "Dadas de baja" });
  const hayFiltros = chips.length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Catálogos" }, { label: "Unidades de medida" }]}
        title="Unidades de medida"
        description={
          <span className="inline-flex items-center gap-1.5">
            <Globe className="size-3.5" aria-hidden />
            Catálogo global: compartido por todas las farmacias.
          </span>
        }
        actions={
          puedeCrear ? (
            <Link href="/catalogos/unidades?nueva=1" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nueva unidad
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de catálogos" links={catalogosSections(session)} />

      {puedeCrear && params.nueva ? (
        <section className="panel mb-6 max-w-3xl" aria-labelledby="nueva-unidad-heading">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 id="nueva-unidad-heading">Nueva unidad</h2>
            <Link href="/catalogos/unidades" className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de unidad">
              <X className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="panel-body">
            <UnidadForm mode="crear" disabled={!puedeCrear} />
          </div>
        </section>
      ) : null}

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de búsqueda de unidades" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="q" value={params.q ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <BuscadorNavegable
              id="q-buscar"
              label="Buscar unidad"
              placeholder="Buscar por código, nombre o símbolo"
              buscar={buscarUnidadesCatalogoAction}
              detalleHref="/catalogos/unidades/{id}"
              listaHref={sinFiltroHref("q")}
              busquedaActual={params.q}
              textoVerTodos="Ver todas las unidades"
            />
          </div>
          <FilterDrawer activeCount={(tipoMagnitud ? 1 : 0) + (params.estado ? 1 : 0)}>
            <div className="field">
              <label htmlFor="magnitud" className="field-label">
                Magnitud
              </label>
              <select id="magnitud" name="magnitud" defaultValue={tipoMagnitud ?? ""} className="input">
                <option value="">Todas</option>
                {TIPOS_MAGNITUD.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {TIPO_MAGNITUD_LABELS[tipo]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="estado" className="field-label">
                Estado
              </label>
              <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
                <option value="">Todas</option>
                <option value="vigente">Vigentes</option>
                <option value="baja">Dadas de baja</option>
              </select>
            </div>
          </FilterDrawer>
        </FilterForm>

        {hayFiltros ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.value ? (
                  <>
                    {chip.label}: <strong>{chip.value}</strong>
                  </>
                ) : (
                  <strong>{chip.label}</strong>
                )}
                <Link href={sinFiltroHref(chip.key)} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href="/catalogos/unidades" scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "unidad" : "unidades"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ninguna unidad coincide con los filtros aplicados."
                action={
                  <Link href="/catalogos/unidades" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<Ruler className="size-5" />} title="Todavía no hay unidades" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Nombre
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Símbolo
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Código
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Magnitud
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">
                      Factor
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Estado
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((unidad) => (
                    <tr key={unidad.id}>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href={`/catalogos/unidades/${unidad.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                            {unidad.nombre}
                          </Link>
                          {unidad.esBase ? <ToneBadge tone="neutral">Base</ToneBadge> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-zinc-900">{unidad.simbolo}</td>
                      <td className="hidden px-3 py-2.5 font-mono text-zinc-600 sm:table-cell">{unidad.codigo}</td>
                      <td className="hidden px-3 py-2.5 md:table-cell">{TIPO_MAGNITUD_LABELS[unidad.tipoMagnitud as keyof typeof TIPO_MAGNITUD_LABELS] ?? unidad.tipoMagnitud}</td>
                      <td className="hidden px-3 py-2.5 text-right font-mono tabular-nums lg:table-cell">{unidad.factorABase}</td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={unidad.fechaBaja ? "neutral" : "success"}>{unidad.fechaBaja ? "Baja" : "Vigente"}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/catalogos/unidades/${unidad.id}`} aria-label={`Ver ${unidad.nombre}`} className="btn btn-ghost btn-sm btn-icon">
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de unidades" />
        </div>
      </div>
    </>
  );
}
