/**
 * `/reportes/kardex` (FASE 13 point 13.2). Kardex de movimientos de stock,
 * filtrable por droga/tipo/rango de fechas, con exportación CSV auditada.
 * The filters auto-apply while typing, so a half-typed droga ID is expected:
 * it shows a prompt instead of querying (the use case only accepts a full
 * UUID).
 */
import Link from "next/link";
import { kardexMovimientos } from "@/modules/stock/application/kardex-movimientos";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { TIPO_MOVIMIENTO_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";

const PAGE_SIZE = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;


interface ReporteKardexPageProps {
  searchParams: Promise<{ drogaId?: string; tipo?: string; desde?: string; hasta?: string; page?: string }>;
}

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
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

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

  return (
    <div className="page">
      <div className="mb-2">
        <Link href="/reportes" className="text-sm underline">
          ← Volver a reportes
        </Link>
      </div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Kardex de movimientos</h1>
        <a href={exportHref()} className="btn btn-secondary">
          Exportar CSV
        </a>
      </div>

      <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de kardex" hasActiveFilters={Boolean(drogaIdTexto || params.tipo || params.desde || params.hasta)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="drogaId" className="text-sm font-medium">
            Droga (ID)
          </label>
          <input id="drogaId" name="drogaId" type="text" defaultValue={params.drogaId ?? ""} className="input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="tipo" className="text-sm font-medium">
            Tipo
          </label>
          <select id="tipo" name="tipo" defaultValue={params.tipo ?? ""} className="input">
            <option value="">Todos</option>
            {Object.entries(TIPO_MOVIMIENTO_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className="text-sm font-medium">
            Desde
          </label>
          <DateInput id="desde" name="desde" defaultValue={params.desde ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Hasta
          </label>
          <DateInput id="hasta" name="hasta" defaultValue={params.hasta ?? ""} />
        </div>
      </FilterForm>

      {drogaIdIncompleto ? (
        <p role="status" className="mb-4 text-sm text-amber-700 dark:text-amber-400">
          Ingresá el ID completo de la droga para filtrar por ella.
        </p>
      ) : null}

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} movimiento{result.total === 1 ? "" : "s"} encontrado{result.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Droga</th>
              <th scope="col" className="px-3 py-2 font-medium">Lote</th>
              <th scope="col" className="px-3 py-2 font-medium">Tipo</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Motivo</th>
              <th scope="col" className="px-3 py-2 font-medium">Registrado por</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron movimientos con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((mov) => (
                <tr key={mov.id}>
                  <td className="px-3 py-2">{new Date(mov.registradoEn).toLocaleString("es-AR")}</td>
                  <td className="px-3 py-2">{mov.drogaNombre}</td>
                  <td className="px-3 py-2">{mov.lote}</td>
                  <td className="px-3 py-2">{etiquetaDe(TIPO_MOVIMIENTO_LABELS, mov.tipo)}</td>
                  <td className="px-3 py-2">
                    <Cantidad valor={formatCantidad(mov.cantidad, { id: mov.unidadId, simbolo: mov.unidadSimbolo }, catalogo)} />
                  </td>
                  <td className="px-3 py-2">{mov.motivoAjuste ?? mov.observacion ?? "—"}</td>
                  <td className="px-3 py-2">
                    {mov.registradoPorNombre} {mov.registradoPorApellido}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de kardex" className="mt-4 flex items-center gap-2 text-sm">
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
