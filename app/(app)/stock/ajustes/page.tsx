/**
 * `/stock/ajustes` (M07): the registered ajustes/mermas (AJUSTE movements),
 * newest first, with search (droga or lote), motivo and jornada range
 * filters, all combined with AND and applied in SQL
 * (modules/stock/application/list-ajustes.ts). "Registrar ajuste" opens the
 * creation flow (`./nuevo`), which comes back here with `?registrado=1`;
 * that one-shot flag is never carried by the filter or pagination links.
 * Section guard: `app/(app)/stock/layout.tsx` (`stock.ver`).
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listAjustes } from "@/modules/stock/application/list-ajustes";
import { MOTIVOS_AJUSTE, MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { ajustesSearchParams, hayFiltrosAjustes, parseFiltrosAjustes, rangoAjustesInvalido, type ParamsAjustes } from "@/modules/stock/domain/ajustes-listado";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";

const PAGE_SIZE = 20;

interface AjustesPageProps {
  searchParams: Promise<ParamsAjustes & { page?: string; registrado?: string }>;
}

function formatFechaHora(fecha: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(fecha);
}

export default async function AjustesPage({ searchParams }: AjustesPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const filtros = parseFiltrosAjustes(params);
  // Checked here so an inverted range shows a message instead of the use case's ValidationError.
  const rangoInvalido = rangoAjustesInvalido(filtros);

  const [result, { catalogo }] = await Promise.all([
    rangoInvalido
      ? Promise.resolve({ items: [], total: 0, page, pageSize: PAGE_SIZE, zonaHoraria: "UTC" })
      : listAjustes({
          search: filtros.q,
          motivoAjuste: filtros.motivo,
          desde: filtros.desde,
          hasta: filtros.hasta,
          page,
          pageSize: PAGE_SIZE,
        }),
    getCatalogoUnidades(),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeRegistrar = can(session, "stock.ajuste.registrar");

  function pageHref(targetPage: number): string {
    return `/stock/ajustes?${ajustesSearchParams(filtros, targetPage).toString()}`;
  }

  return (
    <div className="page">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ajustes</h1>
        {puedeRegistrar ? (
          <Link href="/stock/ajustes/nuevo" className="btn btn-primary">
            Registrar ajuste
          </Link>
        ) : null}
      </div>

      {params.registrado === "1" ? (
        <p role="status" className="mb-4 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          Ajuste registrado.
        </p>
      ) : null}

      <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de ajustes" hasActiveFilters={hayFiltrosAjustes(filtros)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar droga o lote
          </label>
          <input id="q" name="q" type="search" defaultValue={filtros.q ?? ""} className="input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="motivo" className="text-sm font-medium">
            Motivo
          </label>
          <select id="motivo" name="motivo" defaultValue={filtros.motivo ?? ""} className="input">
            <option value="">Todos</option>
            {MOTIVOS_AJUSTE.map((motivo) => (
              <option key={motivo} value={motivo}>
                {MOTIVO_AJUSTE_LABELS[motivo]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className="text-sm font-medium">
            Desde
          </label>
          <DateInput id="desde" name="desde" defaultValue={filtros.desde ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Hasta
          </label>
          <DateInput id="hasta" name="hasta" defaultValue={filtros.hasta ?? ""} />
        </div>
      </FilterForm>

      {rangoInvalido ? (
        <p role="alert" className="mb-4 text-sm text-red-600">
          La fecha &quot;Desde&quot; no puede ser posterior a la fecha &quot;Hasta&quot;.
        </p>
      ) : null}

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} ajuste{result.total === 1 ? "" : "s"} encontrado{result.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Droga</th>
              <th scope="col" className="px-3 py-2 font-medium">Lote</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Motivo</th>
              <th scope="col" className="px-3 py-2 font-medium">Observación</th>
              <th scope="col" className="px-3 py-2 font-medium">Registrado por</th>
              <th scope="col" className="px-3 py-2 font-medium">Autorizado por (DT)</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-500">
                  {hayFiltrosAjustes(filtros) ? "No se encontraron ajustes con estos filtros." : "Todavía no hay ajustes registrados."}
                </td>
              </tr>
            ) : (
              result.items.map((ajuste) => (
                <tr key={ajuste.id}>
                  <td className="whitespace-nowrap px-3 py-2">{formatFechaHora(ajuste.registradoEn, result.zonaHoraria)}</td>
                  <td className="px-3 py-2 font-medium">{ajuste.drogaNombre}</td>
                  <td className="px-3 py-2">{ajuste.lote}</td>
                  <td className="px-3 py-2">
                    <Cantidad valor={formatCantidad(ajuste.cantidad, { id: ajuste.unidadId, simbolo: ajuste.unidadSimbolo }, catalogo)} />
                  </td>
                  <td className="px-3 py-2">{MOTIVO_AJUSTE_LABELS[ajuste.motivoAjuste] ?? ajuste.motivoAjuste}</td>
                  <td className="px-3 py-2">
                    {ajuste.observacion ? (
                      <span title={ajuste.observacion} className="block max-w-xs truncate">
                        {ajuste.observacion}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {ajuste.registradoPorNombre} {ajuste.registradoPorApellido}
                  </td>
                  <td className="px-3 py-2">
                    {ajuste.autorizadoPorNombre ? `${ajuste.autorizadoPorNombre} ${ajuste.autorizadoPorApellido}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/stock/partidas/${ajuste.partidaId}`}
                      aria-label={`Ver detalle de la partida ${ajuste.lote} de ${ajuste.drogaNombre}`}
                      className="whitespace-nowrap text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                      Ver detalle →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de ajustes" className="mt-4 flex items-center gap-2 text-sm">
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
