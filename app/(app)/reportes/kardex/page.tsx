/** `/reportes/kardex` (FASE 13 point 13.2). Kardex de movimientos de stock, filtrable por droga/tipo/rango de fechas, con exportación CSV auditada. */
import Link from "next/link";
import { kardexMovimientos } from "@/modules/stock/application/kardex-movimientos";

const PAGE_SIZE = 30;

const TIPO_MOVIMIENTO_LABELS: Record<string, string> = {
  INGRESO_COMPRA: "Ingreso de compra",
  EGRESO_PREPARACION: "Egreso por preparación",
  AJUSTE: "Ajuste",
};

interface ReporteKardexPageProps {
  searchParams: Promise<{ drogaId?: string; tipo?: string; desde?: string; hasta?: string; page?: string }>;
}

export default async function ReporteKardexPage({ searchParams }: ReporteKardexPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const tipo = params.tipo === "INGRESO_COMPRA" || params.tipo === "EGRESO_PREPARACION" || params.tipo === "AJUSTE" ? params.tipo : undefined;

  const result = await kardexMovimientos({
    drogaId: params.drogaId || undefined,
    tipo,
    desde: params.desde || undefined,
    hasta: params.hasta || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
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

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de kardex">
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
          <input id="desde" name="desde" type="date" defaultValue={params.desde ?? ""} className="input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Hasta
          </label>
          <input id="hasta" name="hasta" type="date" defaultValue={params.hasta ?? ""} className="input" />
        </div>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
        <Link href="/reportes/kardex" className="text-sm underline">
          Limpiar filtros
        </Link>
      </form>

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
                  <td className="px-3 py-2">{TIPO_MOVIMIENTO_LABELS[mov.tipo] ?? mov.tipo}</td>
                  <td className="px-3 py-2">{mov.cantidad}</td>
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
