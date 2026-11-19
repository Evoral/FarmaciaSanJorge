/**
 * `/costos-proveedor/sin-precio` -- "Sin precio" (openspec/specs/costos-proveedor/spec.md R38):
 * lists drogas, excipientes and materiales of the tenant without any vigente costo de proveedor.
 *
 * Gated on `stock.valorizado.ver` (layout guard).
 * When the user has `costos.proveedor.gestionar`, each row links to `/costos-proveedor/nuevo?droga=<id>`.
 */
import Link from "next/link";
import { CheckCircle2, Plus, SearchX } from "lucide-react";
import { listarSinCosto, PAGE_SIZE_SIN_COSTO, TIPOS_ITEM_SIN_COSTO, type TipoItemSinCosto } from "@/modules/costos-proveedor/application/listar-sin-costo";
import { CostosTabs } from "@/modules/costos-proveedor/ui/costos-tabs";
import { SinPrecioFiltros } from "@/modules/costos-proveedor/ui/sin-precio-filtros";
import { CLASE_DROGA_LABELS, type ClaseDroga } from "@/modules/drogas/domain/droga";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

interface SinPrecioPageProps {
  searchParams: Promise<{ q?: string | string[]; tipo?: string | string[]; page?: string | string[] }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");
const PAGE_MAX = 10_000;

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function CostosSinPrecioPage({ searchParams }: SinPrecioPageProps) {
  const query = await searchParams;
  const search = primerValor(query.q)?.trim() || undefined;
  const tipoParam = primerValor(query.tipo);
  const tipo: TipoItemSinCosto = TIPOS_ITEM_SIN_COSTO.find((t) => t === tipoParam) ?? "todos";

  const parsedPage = Number.parseInt(primerValor(query.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) ? Math.min(PAGE_MAX, Math.max(1, parsedPage)) : 1;

  const resultado = await listarSinCosto({ search, tipo, page, pageSize: PAGE_SIZE_SIN_COSTO });
  const { items, total, puedeGestionar } = resultado;
  const hayFiltros = search !== undefined || tipo !== "todos";

  function pageHref(destino: number): string {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (tipo !== "todos") params.set("tipo", tipo);
    params.set("page", String(destino));
    return `/costos-proveedor/sin-precio?${params.toString()}`;
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Costos de proveedores", href: "/costos-proveedor" }, { label: "Sin precio" }]}
        title="Costos de proveedores"
        description="Drogas, excipientes y materiales que no tienen ningún precio de referencia vigente cargado."
        actions={
          puedeGestionar ? (
            <Link href="/costos-proveedor/nuevo" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Agregar costo
            </Link>
          ) : null
        }
      />

      <CostosTabs activa="sin-precio" puedeGestionar={puedeGestionar} />

      <section aria-label="Filtros" className="mb-4">
        <SinPrecioFiltros busqueda={search} tipo={tipo} hayFiltros={hayFiltros} />
      </section>

      <div className="list-region @container">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(total)}</span>{" "}
              {total === 1 ? "ítem sin precio" : "ítems sin precio"}
            </p>
          </div>

          {total === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún ítem sin precio coincide con los filtros aplicados."
                action={
                  <Link href="/costos-proveedor/sin-precio" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<CheckCircle2 className="size-5 text-emerald-600" />}
                title="Todos los ítems tienen precio."
                description="Todas las drogas, excipientes y materiales del catálogo tienen al menos un costo de proveedor vigente."
              />
            )
          ) : items.length === 0 ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title="Esa página no existe"
              description="Hay menos páginas con estos filtros."
              action={
                <Link href={pageHref(1)} scroll={false} className="btn btn-secondary">
                  Ir a la primera página
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-2 py-2 sm:px-3">
                      Nombre
                    </th>
                    <th scope="col" className="px-2 py-2 sm:px-3">
                      Tipo
                    </th>
                    <th scope="col" className="px-2 py-2 sm:px-3">
                      Unidad
                    </th>
                    {puedeGestionar ? (
                      <th scope="col" className="px-2 py-2 text-right sm:px-3">
                        <span className="sr-only">Acciones</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const tipoLabel = CLASE_DROGA_LABELS[item.clase as ClaseDroga] ?? item.clase;
                    return (
                      <tr key={item.id}>
                        <td className="px-2 py-2.5 font-medium text-zinc-900 sm:px-3">
                          {puedeGestionar ? (
                            <Link
                              href={`/costos-proveedor/nuevo?droga=${item.id}`}
                              className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                            >
                              {item.nombre}
                            </Link>
                          ) : (
                            item.nombre
                          )}
                        </td>
                        <td className="px-2 py-2.5 sm:px-3">
                          <ToneBadge tone="neutral">{tipoLabel}</ToneBadge>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-zinc-700 sm:px-3">
                          {item.unidadBaseSimbolo}
                        </td>
                        {puedeGestionar ? (
                          <td className="px-2 py-2.5 text-right sm:px-3">
                            <Link
                              href={`/costos-proveedor/nuevo?droga=${item.id}`}
                              className="btn btn-ghost btn-sm"
                            >
                              Agregar costo
                            </Link>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE_SIN_COSTO} total={total} hrefFor={pageHref} label="Paginación de ítems sin precio" />
        </div>
      </div>
    </>
  );
}
