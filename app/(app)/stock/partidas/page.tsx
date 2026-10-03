/**
 * `/stock/partidas?drogaId=...` (M07, FASE 5 point 5.2): partidas of one
 * droga, with balances. By default only partidas with balance; "Incluir
 * agotadas" (`agotadas=1`) lists them all. `unidades=base` is the same
 * display option as `/stock`'s "Unificar unidades".
 */
import Link from "next/link";
import { ChevronRight, PackageSearch, SearchX } from "lucide-react";
import { listPartidasDroga } from "@/modules/stock/application/list-partidas-droga";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidadesFila, type ModoCantidad } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterMultiSelect } from "@/shared/ui/filter-multi-select";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PartidasPageProps {
  /** `soloConSaldo=0` is the legacy spelling of `agotadas=1`, still honored for old links. */
  searchParams: Promise<{ drogaId?: string; agotadas?: string; soloConSaldo?: string; vencidas?: string; unidades?: string; page?: string }>;
}

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(fecha);
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function PartidasPage({ searchParams }: PartidasPageProps) {
  const params = await searchParams;
  const drogaId = params.drogaId && UUID_PATTERN.test(params.drogaId) ? params.drogaId : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const incluirAgotadas = params.agotadas === "1" || params.soloConSaldo === "0";
  const soloVencidas = params.vencidas === "1";
  const modo: ModoCantidad = params.unidades === "base" ? "base" : "auto";

  if (!drogaId) {
    return (
      <div className="page">
        <PageHeader breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: "Partidas" }]} title="Partidas" />
        <div className="list-panel">
          <EmptyState
            icon={<PackageSearch className="size-5" />}
            title="Elegí una droga"
            description="Las partidas se ven por droga. Elegila desde el listado de stock."
            action={
              <Link href="/stock" className="btn btn-secondary">
                Ir a Stock
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const [result, { catalogo }] = await Promise.all([
    listPartidasDroga({ drogaId, soloConSaldo: !incluirAgotadas, soloVencidas, page, pageSize: PAGE_SIZE }),
    getCatalogoUnidades(),
  ]);
  const unidad = result.droga ? { id: result.droga.unidadBaseId, simbolo: result.droga.unidadBaseSimbolo } : null;

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams({ drogaId });
    if (incluirAgotadas) qs.set("agotadas", "1");
    if (soloVencidas) qs.set("vencidas", "1");
    if (modo === "base") qs.set("unidades", "base");
    qs.set("page", String(targetPage));
    return `/stock/partidas?${qs.toString()}`;
  }

  const hasActiveFilters = incluirAgotadas || soloVencidas;
  const nombre = result.droga?.nombre;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: nombre ?? "Partidas" }]}
        title={nombre ? `Partidas de ${nombre}` : "Partidas"}
        description={incluirAgotadas ? "Todas las partidas, incluidas las agotadas." : "Partidas con saldo disponible."}
      />

      <section aria-label="Filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de partidas" hasActiveFilters={hasActiveFilters}>
          <input type="hidden" name="drogaId" value={drogaId} />
          <FilterMultiSelect
            options={[
              { name: "agotadas", label: "Incluir agotadas (sin saldo)", checked: incluirAgotadas },
              { name: "vencidas", label: "Solo vencidas", checked: soloVencidas },
            ]}
          />
          <label className="toggle-switch">
            <input type="checkbox" role="switch" name="unidades" value="base" defaultChecked={modo === "base"} data-preserve-on-clear="" />
            Unificar unidades
          </label>
        </FilterForm>
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "partida" : "partidas"}
            </p>
          </div>

          {result.items.length === 0 ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title={hasActiveFilters ? "Sin resultados" : "No hay partidas con saldo"}
              description={hasActiveFilters ? "Ninguna partida coincide con los filtros aplicados." : "Incluí las agotadas para ver el historial de partidas de esta droga."}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Lote
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Proveedor
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Vencimiento
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Saldo
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">
                      Costo unitario
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Estado
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((partida) => {
                    const [disponible, inicial] = unidad ? formatCantidadesFila([partida.cantidadDisponible, partida.cantidadInicial], unidad, catalogo, modo) : [null, null];
                    return (
                      <tr key={partida.id}>
                        <td className="px-3 py-2.5">
                          <Link href={`/stock/partidas/${partida.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                            {partida.lote}
                          </Link>
                          <span className="block truncate text-xs text-zinc-500 md:hidden">{partida.proveedorRazonSocial}</span>
                        </td>
                        <td className="hidden px-3 py-2.5 md:table-cell">{partida.proveedorRazonSocial}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatFecha(partida.fechaVencimiento)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                          {disponible && inicial ? (
                            <>
                              <span className="font-medium text-zinc-900">
                                <Cantidad valor={disponible} />
                              </span>
                              <span className="text-zinc-400"> / </span>
                              <span className="text-zinc-500">
                                <Cantidad valor={inicial} />
                              </span>
                            </>
                          ) : (
                            `${partida.cantidadDisponible} / ${partida.cantidadInicial}`
                          )}
                        </td>
                        <td className="hidden px-3 py-2.5 text-right font-mono tabular-nums lg:table-cell">{partida.costoUnitario}</td>
                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          <ToneBadge tone="neutral">{partida.fechaApertura ? "Abierta" : "Cerrada"}</ToneBadge>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link href={`/stock/partidas/${partida.id}`} aria-label={`Ver la partida ${partida.lote}`} className="btn btn-ghost btn-sm btn-icon">
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

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de partidas" />
        </div>
      </div>
    </div>
  );
}
