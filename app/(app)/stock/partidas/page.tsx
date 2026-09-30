/**
 * `/stock/partidas?drogaId=...` (M07, FASE 5 point 5.2): partidas of one
 * droga, with balances. By default only partidas with balance; "Incluir
 * agotadas" (`agotadas=1`) lists them all. `unidades=base` is the same
 * display option as `/stock`'s "Unificar unidades".
 */
import Link from "next/link";
import { listPartidasDroga } from "@/modules/stock/application/list-partidas-droga";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidadesFila, type ModoCantidad } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterMultiSelect } from "@/shared/ui/filter-multi-select";

const PAGE_SIZE = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PartidasPageProps {
  /** `soloConSaldo=0` is the legacy spelling of `agotadas=1`, still honored for old links. */
  searchParams: Promise<{ drogaId?: string; agotadas?: string; soloConSaldo?: string; vencidas?: string; unidades?: string; page?: string }>;
}

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC" }).format(fecha);
}

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
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Elegí una droga desde <Link href="/stock" className="underline">Stock</Link> para ver sus partidas.
        </p>
      </div>
    );
  }

  const [result, { catalogo }] = await Promise.all([
    listPartidasDroga({ drogaId, soloConSaldo: !incluirAgotadas, soloVencidas, page, pageSize: PAGE_SIZE }),
    getCatalogoUnidades(),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const unidad = result.droga ? { id: result.droga.unidadBaseId, simbolo: result.droga.unidadBaseSimbolo } : null;

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams({ drogaId });
    if (incluirAgotadas) qs.set("agotadas", "1");
    if (soloVencidas) qs.set("vencidas", "1");
    if (modo === "base") qs.set("unidades", "base");
    qs.set("page", String(targetPage));
    return `/stock/partidas?${qs.toString()}`;
  }

  return (
    <div className="page">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Partidas{result.droga ? ` de ${result.droga.nombre}` : ""}</h1>
        <Link href="/stock" className="text-sm underline">
          Volver a stock
        </Link>
      </div>

      <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de partidas" hasActiveFilters={incluirAgotadas || soloVencidas}>
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

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} partida{result.total === 1 ? "" : "s"} encontrada{result.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Lote</th>
              <th scope="col" className="px-3 py-2 font-medium">Proveedor</th>
              <th scope="col" className="px-3 py-2 font-medium">Vencimiento</th>
              <th scope="col" className="px-3 py-2 font-medium">Saldo / inicial</th>
              <th scope="col" className="px-3 py-2 font-medium">Costo unitario</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron partidas con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((partida) => {
                const [disponible, inicial] = unidad
                  ? formatCantidadesFila([partida.cantidadDisponible, partida.cantidadInicial], unidad, catalogo, modo)
                  : [null, null];
                return (
                  <tr key={partida.id}>
                    <td className="px-3 py-2">
                      <Link href={`/stock/partidas/${partida.id}`} className="font-medium underline-offset-2 hover:underline">
                        {partida.lote}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{partida.proveedorRazonSocial}</td>
                    <td className="px-3 py-2">{formatFecha(partida.fechaVencimiento)}</td>
                    <td className="px-3 py-2">
                      {disponible && inicial ? (
                        <>
                          <Cantidad valor={disponible} /> / <Cantidad valor={inicial} />
                        </>
                      ) : (
                        `${partida.cantidadDisponible} / ${partida.cantidadInicial}`
                      )}
                    </td>
                    <td className="px-3 py-2">{partida.costoUnitario}</td>
                    <td className="px-3 py-2">{partida.fechaApertura ? "Abierta" : "Cerrada"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de partidas" className="mt-4 flex items-center gap-2 text-sm">
          <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}>
            Anterior
          </Link>
          <span>
            Página {page} de {totalPages}
          </span>
          <Link href={pageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}>
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
