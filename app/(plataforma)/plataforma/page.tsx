/** `/plataforma`: the pharmacies, 25 per page, with search, estado and saldo (openspec/changes/plataforma-superadmin P8). */
import Link from "next/link";
import { ChevronRight, Plus, SearchX, Store, X } from "lucide-react";
import { listarFarmacias } from "@/modules/plataforma/application/listar-farmacias";
import { ESTADO_FARMACIA_LABEL, PAGINA_FARMACIAS } from "@/modules/plataforma/domain/farmacia";
import { PageHeader } from "@/shared/ui/page-header";
import { FilterForm } from "@/shared/ui/filter-form";
import { SearchField } from "@/shared/ui/search-field";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";
import { formatearMonto } from "@/shared/format/monto";

const LISTA_HREF = "/plataforma";
const numberFormat = new Intl.NumberFormat("es-AR");

interface PlataformaPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function PlataformaPage({ searchParams }: PlataformaPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const busqueda = params.q?.trim() || null;
  const result = await listarFarmacias({ busqueda, pagina: page });

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (busqueda) qs.set("q", busqueda);
    qs.set("page", String(targetPage));
    return `${LISTA_HREF}?${qs.toString()}`;
  }

  return (
    <>
      <PageHeader
        title="Farmacias"
        description="Las farmacias que usan el sistema, su estado y su saldo (cargos menos pagos)."
        actions={
          <Link href="/plataforma/farmacias/nueva" className="btn btn-primary">
            <Plus className="size-4" aria-hidden />
            Nueva farmacia
          </Link>
        }
      />

      <section aria-label="Búsqueda" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Buscar farmacias" hasActiveFilters={busqueda !== null}>
          <SearchField id="q" name="q" label="Buscar farmacia" hideLabel defaultValue={busqueda ?? ""} placeholder="Razón social, nombre de fantasía o CUIT" className="min-w-0 flex-1 md:w-96 md:flex-none" />
        </FilterForm>
        {busqueda ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            <span className="chip">
              Búsqueda: <strong>{busqueda}</strong>
              <Link href={LISTA_HREF} scroll={false} className="chip-remove" aria-label="Quitar la búsqueda">
                <X className="size-3" aria-hidden />
              </Link>
            </span>
          </div>
        ) : null}
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "farmacia" : "farmacias"}
            </p>
          </div>

          {result.items.length === 0 ? (
            busqueda ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ninguna farmacia coincide con la búsqueda."
                action={
                  <Link href={LISTA_HREF} scroll={false} className="btn btn-secondary">
                    Ver todas
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<Store className="size-5" />} title="Todavía no hay farmacias" description="Dá de alta la primera con «Nueva farmacia»." />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Farmacia
                    </th>
                    <th scope="col" className="px-3 py-2">
                      CUIT
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Estado
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Saldo
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((farmacia) => (
                    <tr key={farmacia.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`/plataforma/farmacias/${farmacia.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                          {farmacia.razonSocial}
                        </Link>
                        {farmacia.nombreFantasia ? <span className="block text-[0.8125rem] text-zinc-500">{farmacia.nombreFantasia}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono">{farmacia.cuit}</td>
                      <td className="px-3 py-2.5">
                        {farmacia.dadaDeBaja ? (
                          <ToneBadge tone="neutral">Dada de baja</ToneBadge>
                        ) : (
                          <ToneBadge tone={farmacia.estado === "ACTIVO" ? "success" : "danger"}>{ESTADO_FARMACIA_LABEL[farmacia.estado]}</ToneBadge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatearMonto(farmacia.saldo)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/plataforma/farmacias/${farmacia.id}`} aria-label={`Ver ${farmacia.razonSocial}`} className="btn btn-ghost btn-sm btn-icon">
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGINA_FARMACIAS} total={result.total} hrefFor={pageHref} label="Paginación de farmacias" />
        </div>
      </div>
    </>
  );
}
