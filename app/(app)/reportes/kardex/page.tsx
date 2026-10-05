/**
 * `/reportes/kardex` (FASE 13 point 13.2). Kardex de movimientos de stock,
 * filtrable por droga/tipo/rango de fechas, con exportación CSV auditada.
 * The droga is picked in an autocomplete (`KardexDrogaFiltro`) that writes its
 * uuid to `drogaId`; a hand-edited, incomplete id in the URL still shows a
 * prompt instead of querying (the use case only accepts a full UUID).
 */
import Link from "next/link";
import { ArrowLeftRight, CircleAlert, Download, SearchX, X } from "lucide-react";
import { kardexMovimientos } from "@/modules/stock/application/kardex-movimientos";
import { KardexDrogaFiltro } from "@/modules/stock/ui/kardex-droga-filtro";
import { MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad } from "@/shared/format/cantidad";
import { formatFechaIso } from "@/shared/format/fecha";
import { Cantidad } from "@/shared/ui/cantidad";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { TIPO_MOVIMIENTO_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";
import type { BadgeTone } from "@/shared/ui/status-badge";

const PAGE_SIZE = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FilterParam = "drogaId" | "tipo" | "desde" | "hasta";

const TONO_TIPO: Record<string, BadgeTone> = {
  INGRESO_COMPRA: "success",
  EGRESO_PREPARACION: "neutral",
  AJUSTE: "warn",
};

interface ReporteKardexPageProps {
  searchParams: Promise<{ drogaId?: string; tipo?: string; desde?: string; hasta?: string; page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function ReporteKardexPage({ searchParams }: ReporteKardexPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const tipo = params.tipo === "INGRESO_COMPRA" || params.tipo === "EGRESO_PREPARACION" || params.tipo === "AJUSTE" ? params.tipo : undefined;
  const drogaIdTexto = params.drogaId?.trim() ?? "";
  const drogaIdIncompleto = drogaIdTexto !== "" && !UUID_PATTERN.test(drogaIdTexto);
  const desde = params.desde && ISO_DATE_PATTERN.test(params.desde) ? params.desde : undefined;
  const hasta = params.hasta && ISO_DATE_PATTERN.test(params.hasta) ? params.hasta : undefined;

  const [result, { catalogo }] = await Promise.all([
    drogaIdIncompleto
      ? Promise.resolve({ items: [], total: 0, page, pageSize: PAGE_SIZE })
      : kardexMovimientos({ drogaId: drogaIdTexto || undefined, tipo, desde, hasta, page, pageSize: PAGE_SIZE }),
    getCatalogoUnidades(),
  ]);

  /** The kardex URL with some params replaced ("" removes one); `page` always resets. */
  function filtersHref(cambios: Partial<Record<FilterParam, string>> = {}): string {
    const actuales: Record<FilterParam, string> = { drogaId: params.drogaId ?? "", tipo: params.tipo ?? "", desde: params.desde ?? "", hasta: params.hasta ?? "" };
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...actuales, ...cambios })) if (value) qs.set(key, value);
    const query = qs.toString();
    return query ? `/reportes/kardex?${query}` : "/reportes/kardex";
  }

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.drogaId) qs.set("drogaId", params.drogaId);
    if (params.tipo) qs.set("tipo", params.tipo);
    if (params.desde) qs.set("desde", params.desde);
    if (params.hasta) qs.set("hasta", params.hasta);
    qs.set("page", String(targetPage));
    return `/reportes/kardex?${qs.toString()}`;
  }

  function exportHref(): string {
    const qs = new URLSearchParams();
    if (params.drogaId) qs.set("drogaId", params.drogaId);
    if (params.tipo) qs.set("tipo", params.tipo);
    if (params.desde) qs.set("desde", params.desde);
    if (params.hasta) qs.set("hasta", params.hasta);
    return `/api/stock/kardex/export/csv?${qs.toString()}`;
  }

  // The filtered droga's name comes from its own movements (every row is that droga); without rows it is unknown.
  const drogaFiltrada = drogaIdTexto && !drogaIdIncompleto ? { id: drogaIdTexto, nombre: result.items[0]?.drogaNombre ?? "Droga seleccionada" } : null;

  const chips: { key: FilterParam; label: string; value: string }[] = [];
  if (tipo) chips.push({ key: "tipo", label: "Tipo", value: etiquetaDe(TIPO_MOVIMIENTO_LABELS, tipo) });
  if (params.desde) chips.push({ key: "desde", label: "Desde", value: formatFechaIso(params.desde) });
  if (params.hasta) chips.push({ key: "hasta", label: "Hasta", value: formatFechaIso(params.hasta) });
  const hayFiltros = Boolean(drogaIdTexto) || chips.length > 0;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Reportes", href: "/reportes" }, { label: "Kardex de movimientos" }]}
        title="Kardex de movimientos"
        description="Ingresos, consumos y ajustes de stock, partida por partida."
        actions={
          <a href={exportHref()} className="btn btn-secondary">
            <Download className="size-4" aria-hidden />
            Exportar CSV
          </a>
        }
      />

      <section aria-label="Filtros" className="mb-4">
        <div className="filter-bar">
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <KardexDrogaFiltro href={filtersHref()} seleccion={drogaFiltrada} />
          </div>
          <FilterForm className="flex flex-wrap items-end gap-3" aria-label="Filtros de kardex" hasActiveFilters={false}>
            {/* The droga is chosen in the autocomplete; this keeps it while the other filters change. */}
            <input type="hidden" name="drogaId" value={params.drogaId ?? ""} />
            <div className="field">
              <label htmlFor="tipo" className="sr-only">
                Tipo
              </label>
              <select id="tipo" name="tipo" defaultValue={params.tipo ?? ""} className="input">
                <option value="">Todos los tipos</option>
                {Object.entries(TIPO_MOVIMIENTO_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="range-field" role="group" aria-label="Rango de fechas">
              <label htmlFor="desde" className="sr-only">
                Desde
              </label>
              <DateInput id="desde" name="desde" defaultValue={params.desde ?? ""} />
              <span className="range-field-sep" aria-hidden>
                a
              </span>
              <label htmlFor="hasta" className="sr-only">
                Hasta
              </label>
              <DateInput id="hasta" name="hasta" defaultValue={params.hasta ?? ""} />
            </div>
          </FilterForm>
        </div>

        {chips.length > 0 || drogaFiltrada ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}: <strong>{chip.value}</strong>
                <Link href={filtersHref({ [chip.key]: "" })} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length + (drogaFiltrada ? 1 : 0) > 1 ? (
              <Link href="/reportes/kardex" scroll={false} className="btn btn-ghost btn-sm">
                Limpiar filtros
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {drogaIdIncompleto ? (
        <p role="status" className="alert alert-warn mb-4">
          <CircleAlert aria-hidden />
          <span>
            El ID de droga del enlace está incompleto.{" "}
            <Link href={filtersHref({ drogaId: "" })} className="font-medium underline">
              Quitar ese filtro
            </Link>{" "}
            o elegí la droga en el buscador.
          </span>
        </p>
      ) : null}

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "movimiento" : "movimientos"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún movimiento coincide con los filtros aplicados."
                action={
                  <Link href="/reportes/kardex" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<ArrowLeftRight className="size-5" />} title="Todavía no hay movimientos de stock" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Fecha
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Droga
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Lote
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Tipo
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Cantidad
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Motivo
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Registrado por
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((mov) => (
                    <tr key={mov.id}>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums">{new Date(mov.registradoEn).toLocaleString("es-AR")}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-zinc-900">{mov.drogaNombre}</span>
                        <span className="block font-mono text-xs text-zinc-500 sm:hidden">Lote {mov.lote}</span>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono sm:table-cell">{mov.lote}</td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={TONO_TIPO[mov.tipo] ?? "neutral"}>{etiquetaDe(TIPO_MOVIMIENTO_LABELS, mov.tipo)}</ToneBadge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
                        <Cantidad valor={formatCantidad(mov.cantidad, { id: mov.unidadId, simbolo: mov.unidadSimbolo }, catalogo)} />
                      </td>
                      <td className="hidden px-3 py-2.5 lg:table-cell">{mov.motivoAjuste ? etiquetaDe(MOTIVO_AJUSTE_LABELS, mov.motivoAjuste) : (mov.observacion ?? <span className="text-zinc-400">-</span>)}</td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {mov.registradoPorNombre} {mov.registradoPorApellido}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de kardex" />
        </div>
      </div>
    </div>
  );
}
