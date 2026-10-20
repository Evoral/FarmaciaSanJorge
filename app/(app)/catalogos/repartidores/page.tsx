/**
 * `/catalogos/repartidores` (docs/specs/envios-repartidores.md). Search + activo/inactivo filter, plain GET query
 * params (repartidores are not health data -- no DP-24 URL restriction). The search is an autocomplete (suggestions
 * open the repartidor; its last row filters the list by the typed text).
 */
import Link from "next/link";
import { Bike, ChevronRight, Plus, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRepartidores } from "@/modules/repartidores/application/list-repartidores";
import { RepartidorForm } from "@/modules/repartidores/ui/repartidor-form";
import { buscarRepartidoresCatalogoAction } from "@/modules/repartidores/ui/buscar-repartidores-catalogo-action";
import { FilterForm } from "@/shared/ui/filter-form";
import { BuscadorNavegable } from "@/shared/ui/buscador-navegable";
import { PageHeader } from "@/shared/ui/page-header";
import { SectionTabs } from "../../section-tabs";
import { catalogosSections } from "../../nav-sections";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;
const LISTA_HREF = "/catalogos/repartidores";

interface RepartidoresPageProps {
  searchParams: Promise<{ q?: string; estado?: string; page?: string; nuevo?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function RepartidoresPage({ searchParams }: RepartidoresPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const activo = params.estado === "inactivo" ? false : params.estado === "activo" ? true : undefined;

  const result = await listRepartidores({ search: params.q, activo, page, pageSize: PAGE_SIZE });
  const puedeGestionar = can(session, "repartidores.gestionar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `${LISTA_HREF}?${qs.toString()}`;
  }

  function sinFiltroHref(param: "q" | "estado"): string {
    const qs = new URLSearchParams();
    if (params.q && param !== "q") qs.set("q", params.q);
    if (params.estado && param !== "estado") qs.set("estado", params.estado);
    const query = qs.toString();
    return query ? `${LISTA_HREF}?${query}` : LISTA_HREF;
  }

  const chips: { key: "q" | "estado"; label: string; value?: string }[] = [];
  if (params.q) chips.push({ key: "q", label: "Búsqueda", value: params.q });
  if (params.estado === "activo" || params.estado === "inactivo") chips.push({ key: "estado", label: params.estado === "activo" ? "Activos" : "Inactivos" });
  const hayFiltros = chips.length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Catálogos" }, { label: "Repartidores" }]}
        title="Repartidores"
        description="Personas que llevan los envíos. Se elige uno al registrar un envío."
        actions={
          puedeGestionar ? (
            <Link href={`${LISTA_HREF}?nuevo=1`} className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nuevo repartidor
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de catálogos" links={catalogosSections(session)} />

      {puedeGestionar && params.nuevo ? (
        <section className="panel mb-6 max-w-3xl" aria-labelledby="nuevo-repartidor-heading">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 id="nuevo-repartidor-heading">Nuevo repartidor</h2>
            <Link href={LISTA_HREF} className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de repartidor">
              <X className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="panel-body">
            <RepartidorForm mode="crear" disabled={!puedeGestionar} volverA={LISTA_HREF} />
          </div>
        </section>
      ) : null}

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de búsqueda de repartidores" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="q" value={params.q ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <BuscadorNavegable
              id="q-buscar"
              label="Buscar repartidor"
              placeholder="Buscar por nombre, apellido o teléfono"
              buscar={buscarRepartidoresCatalogoAction}
              detalleHref={`${LISTA_HREF}/{id}`}
              listaHref={sinFiltroHref("q")}
              busquedaActual={params.q}
              textoVerTodos="Ver todos los repartidores"
            />
          </div>
          <div className="field">
            <label htmlFor="estado" className="sr-only">
              Estado
            </label>
            <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
              <option value="">Todos los estados</option>
              <option value="activo">Activos</option>
              <option value="inactivo">Inactivos</option>
            </select>
          </div>
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
              <Link href={LISTA_HREF} scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "repartidor" : "repartidores"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún repartidor coincide con los filtros aplicados."
                action={
                  <Link href={LISTA_HREF} scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<Bike className="size-5" />} title="Todavía no hay repartidores" description="Cargar al menos uno para poder registrar envíos." />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Apellido y nombre
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Teléfono
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
                  {result.items.map((repartidor) => (
                    <tr key={repartidor.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`${LISTA_HREF}/${repartidor.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                          {repartidor.apellido}, {repartidor.nombre}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono">{repartidor.telefono}</td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={repartidor.activo ? "success" : "neutral"}>{repartidor.activo ? "Activo" : "Inactivo"}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`${LISTA_HREF}/${repartidor.id}`} aria-label={`Ver ${repartidor.apellido}, ${repartidor.nombre}`} className="btn btn-ghost btn-sm btn-icon">
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de repartidores" />
        </div>
      </div>
    </>
  );
}
