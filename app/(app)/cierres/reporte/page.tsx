/** `/cierres/reporte` (FASE 10, M13a point 10.4). Reporte de cumplimiento de firma: fecha, fecha de firma, demora, fuera de término, motivo, DT. Filtros por rango de fechas; exportación CSV auditada. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { reporteCumplimiento } from "@/modules/cierres/application/reporte-cumplimiento";
import { MOTIVO_DEMORA_LABELS, type MotivoDemoraValue } from "@/modules/cierres/domain/motivo-demora";

interface ReporteCumplimientoPageProps {
  searchParams: Promise<{ fechaDesde?: string; fechaHasta?: string }>;
}

export default async function ReporteCumplimientoPage({ searchParams }: ReporteCumplimientoPageProps) {
  // Same session/permiso guard pattern other cierres pages use (e.g.
  // app/(app)/cierres/page.tsx) -- checked here BEFORE calling
  // `reporteCumplimiento` so a user without `cierres.reporte` gets a
  // friendly redirect instead of an uncaught AuthorizationError from the
  // underlying defineQuery.
  const session = await requireSession();
  if (!can(session, "cierres.reporte")) {
    redirect("/cierres");
  }

  const params = await searchParams;
  const items = await reporteCumplimiento({ fechaDesde: params.fechaDesde, fechaHasta: params.fechaHasta });

  function exportHref(): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    return `/api/cierres/reporte/csv?${qs.toString()}`;
  }

  return (
    <div className="page">
      <div className="mb-4">
        <Link href="/cierres" className="text-sm underline">
          ← Volver a cierres
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reporte de cumplimiento de firma</h1>
        <a href={exportHref()} className="btn btn-secondary">
          Exportar CSV
        </a>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros del reporte de cumplimiento">
        <div className="flex flex-col gap-1">
          <label htmlFor="fechaDesde" className="text-sm font-medium">
            Desde
          </label>
          <input id="fechaDesde" name="fechaDesde" type="date" defaultValue={params.fechaDesde ?? ""} className="input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fechaHasta" className="text-sm font-medium">
            Hasta
          </label>
          <input id="fechaHasta" name="fechaHasta" type="date" defaultValue={params.fechaHasta ?? ""} className="input" />
        </div>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
        <Link href="/cierres/reporte" className="text-sm underline">
          Limpiar filtros
        </Link>
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {items.length} cierre{items.length === 1 ? "" : "s"} encontrado{items.length === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Fecha de firma</th>
              <th scope="col" className="px-3 py-2 font-medium">Demora (días)</th>
              <th scope="col" className="px-3 py-2 font-medium">Fuera de término</th>
              <th scope="col" className="px-3 py-2 font-medium">Motivo</th>
              <th scope="col" className="px-3 py-2 font-medium">Director Técnico</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron cierres con estos filtros.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.fecha}>
                  <td className="px-3 py-2 font-medium">{item.fecha}</td>
                  <td className="px-3 py-2">{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(item.fechaFirma)}</td>
                  <td className="px-3 py-2">{item.demoraDias}</td>
                  <td className={`px-3 py-2 ${item.fueraDeTermino ? "text-amber-700 dark:text-amber-400" : ""}`}>{item.fueraDeTermino ? "Sí" : "No"}</td>
                  <td className="px-3 py-2">
                    {item.motivoDemora ? MOTIVO_DEMORA_LABELS[item.motivoDemora as MotivoDemoraValue] ?? item.motivoDemora : "—"}
                    {item.motivoDemoraDetalle ? ` (${item.motivoDemoraDetalle})` : ""}
                  </td>
                  <td className="px-3 py-2">{item.directorTecnicoApellido}, {item.directorTecnicoNombre}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
