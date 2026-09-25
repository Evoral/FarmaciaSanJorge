/** `/reportes/recetas` (FASE 13 point 13.4). Recetas por estado: conteos + listado filtrado (estado, fecha de ingreso), con exportación CSV auditada. */
import Link from "next/link";
import { reporteRecetasPorEstado, listRecetasReporte } from "@/modules/recetas/application/reporte-recetas";
import { ESTADOS_RECETA } from "@/modules/recetas/domain/receta";

const PAGE_SIZE = 25;

const ESTADO_LABELS: Record<(typeof ESTADOS_RECETA)[number], string> = {
  PENDIENTE_PREPARACION: "Pendiente de preparación",
  EN_PREPARACION: "En preparación",
  PREPARADA: "Preparada",
  LISTA_PARA_RETIRAR: "Lista para retirar",
  ENVIADA_PEND_FIRMA: "Enviada, pendiente de firma",
  ENTREGADA: "Entregada",
  ANULADA: "Anulada",
};

interface ReporteRecetasPageProps {
  searchParams: Promise<{ estado?: string; ingresoDesde?: string; ingresoHasta?: string; page?: string }>;
}

export default async function ReporteRecetasPage({ searchParams }: ReporteRecetasPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const estado = params.estado && (ESTADOS_RECETA as readonly string[]).includes(params.estado) ? (params.estado as (typeof ESTADOS_RECETA)[number]) : undefined;

  const [conteos, result] = await Promise.all([
    reporteRecetasPorEstado(),
    listRecetasReporte({ estado, ingresoDesde: params.ingresoDesde || undefined, ingresoHasta: params.ingresoHasta || undefined, page, pageSize: PAGE_SIZE }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.estado) qs.set("estado", params.estado);
    if (params.ingresoDesde) qs.set("ingresoDesde", params.ingresoDesde);
    if (params.ingresoHasta) qs.set("ingresoHasta", params.ingresoHasta);
    qs.set("page", String(targetPage));
    return `/reportes/recetas?${qs.toString()}`;
  }

  function exportHref(): string {
    const qs = new URLSearchParams();
    if (params.estado) qs.set("estado", params.estado);
    if (params.ingresoDesde) qs.set("ingresoDesde", params.ingresoDesde);
    if (params.ingresoHasta) qs.set("ingresoHasta", params.ingresoHasta);
    return `/api/recetas/reporte/export/csv?${qs.toString()}`;
  }

  return (
    <div className="page">
      <div className="mb-2">
        <Link href="/reportes" className="text-sm underline">
          ← Volver a reportes
        </Link>
      </div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recetas por estado</h1>
        <a href={exportHref()} className="btn btn-secondary">
          Exportar CSV
        </a>
      </div>

      <section aria-label="Conteo por estado" className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {conteos.map((c) => (
          <div key={c.estado} className="card p-4 text-sm">
            <p className="text-zinc-500">{ESTADO_LABELS[c.estado] ?? c.estado}</p>
            <p className="text-lg font-semibold">{c.cantidad}</p>
          </div>
        ))}
      </section>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de recetas por estado">
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
            <option value="">Todos</option>
            {Object.entries(ESTADO_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ingresoDesde" className="text-sm font-medium">
            Ingreso desde
          </label>
          <input id="ingresoDesde" name="ingresoDesde" type="date" defaultValue={params.ingresoDesde ?? ""} className="input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ingresoHasta" className="text-sm font-medium">
            Ingreso hasta
          </label>
          <input id="ingresoHasta" name="ingresoHasta" type="date" defaultValue={params.ingresoHasta ?? ""} className="input" />
        </div>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
        <Link href="/reportes/recetas" className="text-sm underline">
          Limpiar filtros
        </Link>
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} receta{result.total === 1 ? "" : "s"} encontrada{result.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Ingreso</th>
              <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
              <th scope="col" className="px-3 py-2 font-medium">Médico</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
              <th scope="col" className="px-3 py-2 font-medium">Receta física</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron recetas con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{r.numeroInterno}</td>
                  <td className="px-3 py-2">{new Date(r.fechaIngreso).toLocaleDateString("es-AR")}</td>
                  <td className="px-3 py-2">
                    {r.pacienteApellido}, {r.pacienteNombre}
                  </td>
                  <td className="px-3 py-2">
                    {r.medicoApellido}, {r.medicoNombre}
                  </td>
                  <td className="px-3 py-2">{ESTADO_LABELS[r.estado] ?? r.estado}</td>
                  <td className="px-3 py-2">{r.recetaFisicaRecibida ? "Sí" : "No"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de recetas por estado" className="mt-4 flex items-center gap-2 text-sm">
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
