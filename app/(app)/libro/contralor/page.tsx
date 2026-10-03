/** `/libro/contralor` (FASE 9, M12 point 9.4, DP-33; export buttons added FASE 13 point 13.3). Consulta de los libros contralor (psicotrópicos / estupefacientes). */
import Link from "next/link";
import { BookOpen, Download, SearchX, TriangleAlert, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listContralor } from "@/modules/libro/application/list-contralor";
import { LibroNav } from "@/modules/libro/ui/libro-nav";
import { DrogaContralorBuscador } from "@/modules/libro/ui/droga-contralor-buscador";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { formatCantidadExacta } from "@/shared/format/cantidad";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 25;

type ParamContralor = "tipoLibro" | "drogaId" | "fechaDesde" | "fechaHasta";

interface ContralorPageProps {
  searchParams: Promise<{ tipoLibro?: string; drogaId?: string; fechaDesde?: string; fechaHasta?: string; page?: string }>;
}

const TIPO_MOVIMIENTO_LABELS: Record<string, string> = {
  APERTURA: "Apertura",
  INGRESO: "Ingreso",
  EGRESO: "Egreso",
  AJUSTE: "Ajuste",
};

const TIPO_LIBRO_LABELS: Record<string, string> = {
  PSICOTROPICO: "Psicotrópicos",
  ESTUPEFACIENTE: "Estupefacientes",
};

const numberFormat = new Intl.NumberFormat("es-AR");

function Vacio({ label }: { label: string }) {
  return (
    <span className="text-zinc-400">
      -<span className="sr-only">{label}</span>
    </span>
  );
}

export default async function ContralorPage({ searchParams }: ContralorPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const tipoLibro = params.tipoLibro === "PSICOTROPICO" || params.tipoLibro === "ESTUPEFACIENTE" ? params.tipoLibro : undefined;

  const result = await listContralor({
    tipoLibro,
    drogaId: params.drogaId || undefined,
    fechaDesde: params.fechaDesde || undefined,
    fechaHasta: params.fechaHasta || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const puedeExportar = can(session, "libro.exportar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.tipoLibro) qs.set("tipoLibro", params.tipoLibro);
    if (params.drogaId) qs.set("drogaId", params.drogaId);
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    qs.set("page", String(targetPage));
    return `/libro/contralor?${qs.toString()}`;
  }

  function exportHref(kind: "csv" | "pdf"): string {
    const qs = new URLSearchParams();
    if (params.tipoLibro) qs.set("tipoLibro", params.tipoLibro);
    if (params.drogaId) qs.set("drogaId", params.drogaId);
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    return `/api/libro/export/contralor/${kind}?${qs.toString()}`;
  }

  function sinFiltroHref(param: ParamContralor): string {
    const qs = new URLSearchParams();
    for (const key of ["tipoLibro", "drogaId", "fechaDesde", "fechaHasta"] as const) if (key !== param && params[key]) qs.set(key, params[key]!);
    const query = qs.toString();
    return query ? `/libro/contralor?${query}` : "/libro/contralor";
  }

  // The filtered droga's name is the one printed in its own rows (the autocomplete shows it; no chip needed).
  const drogaActualNombre = result.items[0]?.drogaDescripcion ?? "Droga seleccionada";
  const chips: { key: ParamContralor; label: string; value: string }[] = [];
  if (params.tipoLibro) chips.push({ key: "tipoLibro", label: "Libro", value: TIPO_LIBRO_LABELS[params.tipoLibro] ?? params.tipoLibro });
  if (params.fechaDesde) chips.push({ key: "fechaDesde", label: "Desde", value: formatFechaIso(params.fechaDesde) });
  if (params.fechaHasta) chips.push({ key: "fechaHasta", label: "Hasta", value: formatFechaIso(params.fechaHasta) });
  const hayFiltros = chips.length > 0 || Boolean(params.drogaId);

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Libro", href: "/libro" }, { label: "Libros contralor" }]}
        title="Libros contralor"
        description="Psicotrópicos y estupefacientes. Cantidades exactas, en la unidad registrada."
        actions={
          puedeExportar ? (
            <>
              <a href={exportHref("csv")} className="btn btn-secondary">
                <Download className="size-4" aria-hidden />
                CSV
              </a>
              <a href={exportHref("pdf")} className="btn btn-secondary">
                <Download className="size-4" aria-hidden />
                PDF
              </a>
            </>
          ) : null
        }
      />

      <LibroNav actual="contralor" />

      {result.fechaActivacionContralor === null ? (
        <div role="note" className="alert alert-warn mb-4">
          <TriangleAlert aria-hidden />
          <p>Libros contralor llevados en forma manual: esta farmacia no activó el contralor digital, así que el sistema no genera asientos.</p>
        </div>
      ) : null}

      <section aria-label="Filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de libros contralor" hasActiveFilters={false}>
          {/* The droga lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="drogaId" value={params.drogaId ?? ""} />
          <div className="min-w-0 flex-1 md:w-72 md:flex-none">
            <DrogaContralorBuscador listaHref={sinFiltroHref("drogaId")} drogaActual={params.drogaId ? { id: params.drogaId, nombre: drogaActualNombre } : undefined} />
          </div>
          <div className="field">
            <label htmlFor="tipoLibro" className="field-label">
              Libro
            </label>
            <select id="tipoLibro" name="tipoLibro" defaultValue={params.tipoLibro ?? ""} className="input">
              <option value="">Todos</option>
              <option value="PSICOTROPICO">Psicotrópicos</option>
              <option value="ESTUPEFACIENTE">Estupefacientes</option>
            </select>
          </div>
          <div className="field">
            <span id="contralor-fecha-label" className="field-label">
              Fecha
            </span>
            <div className="range-field" role="group" aria-labelledby="contralor-fecha-label">
              <label htmlFor="fechaDesde" className="sr-only">
                Desde
              </label>
              <DateInput id="fechaDesde" name="fechaDesde" defaultValue={params.fechaDesde ?? ""} />
              <span className="range-field-sep" aria-hidden>
                a
              </span>
              <label htmlFor="fechaHasta" className="sr-only">
                Hasta
              </label>
              <DateInput id="fechaHasta" name="fechaHasta" defaultValue={params.fechaHasta ?? ""} />
            </div>
          </div>
        </FilterForm>

        {chips.length > 0 ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}: <strong>{chip.value}</strong>
                <Link href={sinFiltroHref(chip.key)} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href="/libro/contralor" scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "asiento" : "asientos"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState icon={<SearchX className="size-5" />} title="Sin resultados" description="Ningún asiento coincide con los filtros aplicados." />
            ) : (
              <EmptyState icon={<BookOpen className="size-5" />} title="Todavía no hay asientos de contralor" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Nº
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Fecha
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Movimiento
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Droga
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Cantidad
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">
                      Saldo anterior
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Saldo
                    </th>
                    <th scope="col" className="hidden px-3 py-2 xl:table-cell">
                      Vale
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Asiento recetario
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2.5 font-mono font-semibold text-zinc-900 tabular-nums">{item.numeroCorrelativo}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatFechaIso(item.fechaAsiento)}</td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone="neutral">{TIPO_MOVIMIENTO_LABELS[item.tipoMovimiento] ?? item.tipoMovimiento}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5 text-zinc-900">{item.drogaDescripcion}</td>
                      {/* Legal record: exact quantities in the recorded unit (only trailing zeros stripped), never converted or rounded. */}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{formatCantidadExacta(item.cantidad, item.unidadSimbolo)}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono text-zinc-500 tabular-nums lg:table-cell">{formatCantidadExacta(item.saldoAnterior, "")}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">{formatCantidadExacta(item.saldoPosterior, "")}</td>
                      <td className="hidden px-3 py-2.5 font-mono xl:table-cell">{item.numeroValeAdquisicion ?? <Vacio label="Sin vale" />}</td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {item.asientoRecetarioId ? (
                          <Link href={`/libro/${item.asientoRecetarioId}`} className="font-mono underline-offset-2 hover:underline">
                            Nº {item.asientoRecetarioNumero}
                          </Link>
                        ) : (
                          <Vacio label="Sin asiento de recetario" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de libros contralor" />
        </div>
      </div>
    </div>
  );
}
