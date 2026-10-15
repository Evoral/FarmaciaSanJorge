/**
 * `/costos-proveedor/listas` -- "Listas importadas" (docs/specs/costos-proveedor.md, "Interface" 3): every
 * supplier price list imported, newest first, with its proveedor, the date of the list, the file, how many rows
 * were read and how many became a new price, and who registered it and when. Lists are append-only: nothing is
 * edited or deleted here.
 *
 * `searchParams` is untrusted and ONLY ever reads `proveedor` (an opaque uuid, parsed with `uuid.safeParse`) and
 * `page` (a plain integer). Access is the layout's `stock.valorizado.ver` guard (R35); the "Importar lista" tab
 * is shown with `costos.proveedor.gestionar`.
 */
import Link from "next/link";
import { FileSpreadsheet, SearchX } from "lucide-react";
import { listarListasPrecio, PAGE_SIZE_LISTAS_PRECIO } from "@/modules/costos-proveedor/application/listar-listas-precio";
import { CostosTabs } from "@/modules/costos-proveedor/ui/costos-tabs";
import { ListasFiltros } from "@/modules/costos-proveedor/ui/listas-filtros";
import { can } from "@/shared/auth/authorize";
import { requireSession } from "@/shared/auth/session";
import { formatFechaHora, formatFechaIso } from "@/shared/format/fecha";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { Pagination } from "@/shared/ui/pagination";
import { uuid } from "@/shared/validation";

interface ListasPageProps {
  searchParams: Promise<{ proveedor?: string | string[]; page?: string | string[] }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");
const PAGE_MAX = 10_000;

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function ListasImportadasPage({ searchParams }: ListasPageProps) {
  const session = await requireSession();
  const puedeGestionar = can(session, "costos.proveedor.gestionar");

  const query = await searchParams;
  const candidato = primerValor(query.proveedor);
  const proveedorId = candidato !== undefined && uuid.safeParse(candidato).success ? candidato : undefined;
  // Clamped into the use case's accepted range (a huge digit string parses to Infinity).
  const parsedPage = Number.parseInt(primerValor(query.page) ?? "1", 10);
  const page = Number.isFinite(parsedPage) ? Math.min(PAGE_MAX, Math.max(1, parsedPage)) : 1;

  const { items, total, zonaHoraria, proveedorFiltro } = await listarListasPrecio({ proveedorId, page, pageSize: PAGE_SIZE_LISTAS_PRECIO });
  const hayFiltros = proveedorId !== undefined;

  function pageHref(destino: number): string {
    const params = new URLSearchParams();
    if (proveedorId) params.set("proveedor", proveedorId);
    params.set("page", String(destino));
    return `/costos-proveedor/listas?${params.toString()}`;
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Costos de proveedores", href: "/costos-proveedor" }, { label: "Listas importadas" }]}
        title="Listas importadas"
        description="Las listas de precios que se cargaron desde un archivo. Cada lista queda registrada tal como se importó y no se puede modificar."
      />

      <CostosTabs activa="listas" puedeGestionar={puedeGestionar} />

      <section aria-label="Filtros" className="mb-4">
        <ListasFiltros key={proveedorFiltro?.id ?? ""} proveedor={proveedorFiltro} hayFiltros={hayFiltros} />
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(total)}</span> {total === 1 ? "lista importada" : "listas importadas"}
            </p>
          </div>

          {total === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ese proveedor no tiene listas importadas."
                action={
                  <Link href="/costos-proveedor/listas" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<FileSpreadsheet className="size-5" />}
                title="Todavía no se importó ninguna lista"
                description="Cuando importes la lista de precios de un proveedor, queda registrada acá."
                action={
                  puedeGestionar ? (
                    <Link href="/costos-proveedor/importar" className="btn btn-primary">
                      Importar lista
                    </Link>
                  ) : undefined
                }
              />
            )
          ) : items.length === 0 ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title="Esa página no existe"
              description="Hay menos páginas con este filtro."
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
                    <th scope="col" className="px-3 py-2">
                      Proveedor
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Fecha de la lista
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Archivo
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Filas leídas
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Filas aplicadas
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Registrada por
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((lista) => (
                    <tr key={lista.id}>
                      <td className="px-3 py-2.5 font-medium text-zinc-900">{lista.proveedorRazonSocial}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{formatFechaIso(lista.fechaLista)}</td>
                      <td className="hidden px-3 py-2.5 sm:table-cell">
                        <span className="break-all">{lista.nombreArchivo}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{numberFormat.format(lista.filasLeidas)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{numberFormat.format(lista.filasAplicadas)}</td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {lista.registradoPorNombre} {lista.registradoPorApellido}
                        <span className="block text-xs text-zinc-500">{formatFechaHora(lista.registradoEn, zonaHoraria)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE_LISTAS_PRECIO} total={total} hrefFor={pageHref} label="Paginación de listas importadas" />
        </div>
      </div>
    </>
  );
}
