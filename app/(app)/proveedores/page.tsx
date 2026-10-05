/**
 * `/proveedores` (M06, FASE 4 point 4.3). Search + vigente/baja filter, plain GET query params (proveedores are NOT
 * health data -- no DP-24 URL restriction). The search is an autocomplete (suggestions open the proveedor; its last row
 * filters the list by the typed text).
 */
import Link from "next/link";
import { ChevronRight, Plus, SearchX, Truck, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listProveedores } from "@/modules/proveedores/application/list-proveedores";
import { ProveedorForm } from "@/modules/proveedores/ui/proveedor-form";
import { buscarProveedoresCatalogoAction } from "@/modules/proveedores/ui/buscar-proveedores-catalogo-action";
import { formatCuit } from "@/modules/proveedores/domain/proveedor";
import { FilterForm } from "@/shared/ui/filter-form";
import { BuscadorNavegable } from "@/shared/ui/buscador-navegable";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

interface ProveedoresPageProps {
  searchParams: Promise<{ q?: string; estado?: string; page?: string; nuevo?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function ProveedoresPage({ searchParams }: ProveedoresPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const soloVigentes = params.estado === "baja" ? false : params.estado === "vigente" ? true : undefined;

  const result = await listProveedores({ search: params.q, soloVigentes, page, pageSize: PAGE_SIZE });
  const puedeCrear = can(session, "proveedores.gestionar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `/proveedores?${qs.toString()}`;
  }

  function sinFiltroHref(param: "q" | "estado"): string {
    const qs = new URLSearchParams();
    if (params.q && param !== "q") qs.set("q", params.q);
    if (params.estado && param !== "estado") qs.set("estado", params.estado);
    const query = qs.toString();
    return query ? `/proveedores?${query}` : "/proveedores";
  }

  const chips: { key: "q" | "estado"; label: string; value?: string }[] = [];
  if (params.q) chips.push({ key: "q", label: "Búsqueda", value: params.q });
  if (params.estado === "vigente" || params.estado === "baja") chips.push({ key: "estado", label: params.estado === "vigente" ? "Vigentes" : "Dados de baja" });
  const hayFiltros = chips.length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Proveedores" }]}
        title="Proveedores"
        description="Quienes abastecen las materias primas, con su CUIT y las partidas que entregaron."
        actions={
          puedeCrear ? (
            <Link href="/proveedores?nuevo=1" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nuevo proveedor
            </Link>
          ) : null
        }
      />

      {puedeCrear && params.nuevo ? (
        <section className="panel mb-6 max-w-3xl" aria-labelledby="nuevo-proveedor-heading">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 id="nuevo-proveedor-heading">Nuevo proveedor</h2>
            <Link href="/proveedores" className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de proveedor">
              <X className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="panel-body">
            <ProveedorForm mode="crear" disabled={!puedeCrear} />
          </div>
        </section>
      ) : null}

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de búsqueda de proveedores" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="q" value={params.q ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <BuscadorNavegable
              id="q-buscar"
              label="Buscar proveedor"
              placeholder="Buscar por razón social o CUIT"
              buscar={buscarProveedoresCatalogoAction}
              detalleHref="/proveedores/{id}"
              listaHref={sinFiltroHref("q")}
              busquedaActual={params.q}
              textoVerTodos="Ver todos los proveedores"
            />
          </div>
          <div className="field">
            <label htmlFor="estado" className="sr-only">
              Estado
            </label>
            <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
              <option value="">Todos los estados</option>
              <option value="vigente">Vigentes</option>
              <option value="baja">Dados de baja</option>
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
              <Link href="/proveedores" scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "proveedor" : "proveedores"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún proveedor coincide con los filtros aplicados."
                action={
                  <Link href="/proveedores" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<Truck className="size-5" />} title="Todavía no hay proveedores" description="Cargá los proveedores para registrar el origen de cada partida." />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Razón social
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      CUIT
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
                  {result.items.map((proveedor) => (
                    <tr key={proveedor.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`/proveedores/${proveedor.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                          {proveedor.razonSocial}
                        </Link>
                        <span className="block font-mono text-xs text-zinc-500 sm:hidden">{formatCuit(proveedor.cuit)}</span>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono sm:table-cell">{formatCuit(proveedor.cuit)}</td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={proveedor.fechaBaja ? "neutral" : "success"}>{proveedor.fechaBaja ? "Baja" : "Vigente"}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center justify-end gap-1">
                          <Link href={`/proveedores/${proveedor.id}/historial`} className="btn btn-ghost btn-sm" aria-label={`Ver el historial de ${proveedor.razonSocial}`}>
                            <span className="hidden sm:inline">Historial</span>
                            <span className="sm:hidden">Ver</span>
                          </Link>
                          <Link href={`/proveedores/${proveedor.id}`} aria-label={`Ver los datos de ${proveedor.razonSocial}`} className="btn btn-ghost btn-sm btn-icon">
                            <ChevronRight className="size-4" aria-hidden />
                          </Link>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de proveedores" />
        </div>
      </div>
    </>
  );
}
