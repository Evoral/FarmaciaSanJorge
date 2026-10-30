/**
 * `/costos-proveedor` -- "Vigentes" (openspec/specs/costos-proveedor/spec.md, "Interface" 1): the
 * reference price each proveedor quotes for each droga, one vigente price per pair, to
 * consult, change by hand (Editar, Agregar costo) or give de baja. These prices are only
 * used to quote cotizaciones; the real cost of every partida is untouched.
 *
 * `searchParams` is untrusted and ONLY ever reads `droga` and `proveedor` (opaque uuids,
 * parsed with `uuid.safeParse`) and `page` (a plain integer). Access is the layout's
 * `stock.valorizado.ver` guard; the write actions are shown with `puedeGestionar`
 * (`costos.proveedor.gestionar`) and enforced again by the use cases.
 */
import Link from "next/link";
import { CircleDollarSign, Plus, SearchX } from "lucide-react";
import { listarCostosVigentes, PAGE_SIZE_COSTOS_VIGENTES } from "@/modules/costos-proveedor/application/listar-costos-vigentes";
import { antiguedadDias, etiquetaAntiguedad, etiquetaPrecio } from "@/modules/costos-proveedor/domain/presentacion";
import { CostoAcciones } from "@/modules/costos-proveedor/ui/costo-acciones";
import { CostosFiltros } from "@/modules/costos-proveedor/ui/costos-filtros";
import { CostosTabs } from "@/modules/costos-proveedor/ui/costos-tabs";
import { formatNumero } from "@/shared/format/cantidad";
import { formatFechaIso } from "@/shared/format/fecha";
import { formatearCostoUnitario } from "@/shared/format/monto";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";
import { uuid } from "@/shared/validation";

interface CostosProveedorPageProps {
  searchParams: Promise<{ droga?: string | string[]; proveedor?: string | string[]; page?: string | string[] }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");
const PAGE_MAX = 10_000;

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

function idValido(valor: string | string[] | undefined): string | undefined {
  const candidato = primerValor(valor);
  return candidato !== undefined && uuid.safeParse(candidato).success ? candidato : undefined;
}

export default async function CostosProveedorPage({ searchParams }: CostosProveedorPageProps) {
  const query = await searchParams;
  const drogaId = idValido(query.droga);
  const proveedorId = idValido(query.proveedor);
  // Clamped into the use case's accepted range (a huge digit string parses to Infinity).
  const parsedPage = Number.parseInt(primerValor(query.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) ? Math.min(PAGE_MAX, Math.max(1, parsedPage)) : 1;

  const resultado = await listarCostosVigentes({ drogaId, proveedorId, page, pageSize: PAGE_SIZE_COSTOS_VIGENTES });
  const { items, total, jornadaActual, puedeGestionar, drogaFiltro, proveedorFiltro } = resultado;
  const hayFiltros = drogaId !== undefined || proveedorId !== undefined;

  function pageHref(destino: number): string {
    const params = new URLSearchParams();
    if (drogaId) params.set("droga", drogaId);
    if (proveedorId) params.set("proveedor", proveedorId);
    params.set("page", String(destino));
    return `/costos-proveedor?${params.toString()}`;
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Costos de proveedores" }]}
        title="Costos de proveedores"
        description="Los precios de referencia de las listas de cada proveedor, sin IVA. Se usan solo para cotizar: el costo real de cada partida no cambia."
        actions={
          puedeGestionar ? (
            <Link href="/costos-proveedor/nuevo" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Agregar costo
            </Link>
          ) : null
        }
      />

      <CostosTabs activa="vigentes" puedeGestionar={puedeGestionar} />

      <section aria-label="Filtros" className="mb-4">
        <CostosFiltros key={`${drogaFiltro?.id ?? ""}|${proveedorFiltro?.id ?? ""}`} droga={drogaFiltro} proveedor={proveedorFiltro} hayFiltros={hayFiltros} />
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(total)}</span> {total === 1 ? "costo vigente" : "costos vigentes"}
            </p>
          </div>

          {total === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún costo vigente coincide con los filtros aplicados."
                action={
                  <Link href="/costos-proveedor" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<CircleDollarSign className="size-5" />}
                title="Todavía no hay costos de proveedores"
                description="Mientras no haya ninguno, las cotizaciones se calculan con el costo de las partidas en stock."
                action={
                  puedeGestionar ? (
                    <Link href="/costos-proveedor/nuevo" className="btn btn-primary">
                      <Plus className="size-4" aria-hidden />
                      Agregar costo
                    </Link>
                  ) : undefined
                }
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
                      Droga
                    </th>
                    <th scope="col" className="hidden px-2 py-2 sm:table-cell sm:px-3">
                      Proveedor
                    </th>
                    <th scope="col" className="px-2 py-2 text-right sm:px-3">
                      Precio con IVA
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">
                      Costo por unidad base con IVA
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Fecha del precio
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Origen
                    </th>
                    <th scope="col" className="px-2 py-2 sm:px-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((costo) => {
                    const etiqueta = `${costo.drogaNombre} · ${costo.proveedorRazonSocial}`;
                    return (
                      <tr key={costo.id}>
                        <td className="px-2 py-2.5 font-medium text-zinc-900 sm:px-3">
                          {costo.drogaNombre}
                          <span className="block text-xs font-normal text-zinc-600 sm:hidden">
                            {costo.proveedorRazonSocial}
                            {costo.proveedorDeBaja ? " (de baja)" : ""}
                          </span>
                          {costo.descripcionProveedor ? <span className="block text-xs font-normal text-zinc-500">{costo.descripcionProveedor}</span> : null}
                        </td>
                        <td className="hidden px-2 py-2.5 sm:table-cell sm:px-3">
                          {costo.proveedorRazonSocial}
                          {costo.proveedorDeBaja ? (
                            <>
                              {" "}
                              <ToneBadge tone="neutral" title="El proveedor está dado de baja: este costo no se usa para cotizar.">
                                Proveedor de baja
                              </ToneBadge>
                            </>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums sm:px-3">
                          {etiquetaPrecio(costo.precioInformadoConIva, costo.unidadPrecioSimbolo)}
                          <span className="block text-xs text-zinc-500">
                            sin IVA {etiquetaPrecio(costo.precioInformado, costo.unidadPrecioSimbolo)} · IVA {formatNumero(costo.alicuotaIva, 2)}%
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums md:table-cell">
                          $ {formatearCostoUnitario(costo.costoUnitarioConIva)} / {costo.drogaUnidadBaseSimbolo}
                          <span className="block text-xs text-zinc-500">
                            sin IVA $ {formatearCostoUnitario(costo.costoUnitario)} / {costo.drogaUnidadBaseSimbolo}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 sm:table-cell">
                          {formatFechaIso(costo.fechaPrecio)}
                          <span className="block text-xs text-zinc-500">{etiquetaAntiguedad(antiguedadDias(costo.fechaPrecio, jornadaActual))}</span>
                        </td>
                        <td className="hidden px-3 py-2.5 lg:table-cell">
                          {costo.listaNombreArchivo ? <span className="break-all">{costo.listaNombreArchivo}</span> : <span className="text-zinc-500">Manual</span>}
                        </td>
                        <td className="px-2 py-2.5 sm:px-3">
                          <span className="flex items-center justify-end">
                            <CostoAcciones costoId={costo.id} drogaId={costo.drogaId} proveedorId={costo.proveedorId} etiqueta={etiqueta} puedeGestionar={puedeGestionar} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE_COSTOS_VIGENTES} total={total} hrefFor={pageHref} label="Paginación de costos de proveedores" />
        </div>
      </div>
    </>
  );
}
