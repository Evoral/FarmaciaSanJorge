/**
 * `/cierres` (FASE 10, M13a point 10.1). Jornadas pendientes de firma
 * (oldest first, only the oldest can be signed -- chronological order,
 * INV-C19 is the real backstop) + historial paginado con filtros por rango
 * de fechas.
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listJornadasPendientes, getJornadaActualCierres } from "@/modules/cierres/application/list-jornadas-pendientes";
import { listPreparacionesIniciadas } from "@/modules/cierres/application/list-preparaciones-iniciadas";
import { listCierres } from "@/modules/cierres/application/list-cierres";
import { FirmarForm } from "@/modules/cierres/ui/firmar-form";

const PAGE_SIZE = 20;

interface CierresPageProps {
  searchParams: Promise<{ fechaDesde?: string; fechaHasta?: string; page?: string }>;
}

export default async function CierresPage({ searchParams }: CierresPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const puedeFirmar = can(session, "cierres.firmar");

  const [pendientes, historial] = await Promise.all([
    listJornadasPendientes(),
    listCierres({ fechaDesde: params.fechaDesde, fechaHasta: params.fechaHasta, page, pageSize: PAGE_SIZE }),
  ]);

  const laMasAntigua = pendientes.find((p) => p.esLaMasAntigua) ?? null;
  const jornadaActual = puedeFirmar && laMasAntigua ? await getJornadaActualCierres() : null;
  const esJornadaActual = jornadaActual !== null && laMasAntigua !== null && laMasAntigua.fecha === jornadaActual;
  const preparaciones = puedeFirmar && laMasAntigua ? await listPreparacionesIniciadas() : [];

  const totalPages = Math.max(1, Math.ceil(historial.total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.fechaDesde) qs.set("fechaDesde", params.fechaDesde);
    if (params.fechaHasta) qs.set("fechaHasta", params.fechaHasta);
    qs.set("page", String(targetPage));
    return `/cierres?${qs.toString()}`;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Cierres diarios</h1>
        <Link href="/cierres/reporte" className="text-sm underline">
          Reporte de cumplimiento
        </Link>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold">Pendientes de firma</h2>
        {pendientes.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No hay jornadas pendientes de firma.</p>
        ) : (
          <>
            <div className="mb-4 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                    <th scope="col" className="px-3 py-2 font-medium">Antigüedad</th>
                    <th scope="col" className="px-3 py-2 font-medium">Asientos recetario</th>
                    <th scope="col" className="px-3 py-2 font-medium">Asientos contralor</th>
                    <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map((p) => (
                    <tr key={p.fecha} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                      <td className="px-3 py-2 font-medium">{p.fecha}</td>
                      <td className="px-3 py-2">{p.antiguedadDias} día{p.antiguedadDias === 1 ? "" : "s"}</td>
                      <td className="px-3 py-2">{p.cantidadRecetario}</td>
                      <td className="px-3 py-2">{p.cantidadContralor}</td>
                      <td className={`px-3 py-2 ${p.fueraDeTermino ? "text-red-700 dark:text-red-400" : ""}`}>
                        {p.fueraDeTermino ? "Fuera de término" : "En término"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {puedeFirmar && laMasAntigua ? (
              <FirmarForm
                fecha={laMasAntigua.fecha}
                fueraDeTermino={laMasAntigua.fueraDeTermino}
                esJornadaActual={esJornadaActual}
                preparacionesIniciadas={preparaciones.map((p) => ({ id: p.id, descripcion: p.itemDescripcion ?? "Preparación sin descripción" }))}
              />
            ) : null}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Historial</h2>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros del historial de cierres">
          <div className="flex flex-col gap-1">
            <label htmlFor="fechaDesde" className="text-sm font-medium">
              Desde
            </label>
            <input id="fechaDesde" name="fechaDesde" type="date" defaultValue={params.fechaDesde ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="fechaHasta" className="text-sm font-medium">
              Hasta
            </label>
            <input id="fechaHasta" name="fechaHasta" type="date" defaultValue={params.fechaHasta ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </div>
          <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
            Filtrar
          </button>
          <Link href="/cierres" className="text-sm underline">
            Limpiar filtros
          </Link>
        </form>

        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
          {historial.total} cierre{historial.total === 1 ? "" : "s"} encontrado{historial.total === 1 ? "" : "s"}.
        </p>

        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                <th scope="col" className="px-3 py-2 font-medium">Director Técnico</th>
                <th scope="col" className="px-3 py-2 font-medium">Asientos</th>
                <th scope="col" className="px-3 py-2 font-medium">Firmado</th>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {historial.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                    No se encontraron cierres con estos filtros.
                  </td>
                </tr>
              ) : (
                historial.items.map((item) => (
                  <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="px-3 py-2">
                      <Link href={`/cierres/${item.id}`} className="font-medium underline-offset-2 hover:underline">
                        {item.fecha}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{item.directorTecnicoApellido}, {item.directorTecnicoNombre}</td>
                    <td className="px-3 py-2">{item.cantidadAsientos}</td>
                    <td className="px-3 py-2">{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(item.fechaFirma)}</td>
                    <td className={`px-3 py-2 ${item.fueraDeTermino ? "text-amber-700 dark:text-amber-400" : ""}`}>
                      {item.fueraDeTermino ? "Fuera de término" : "En término"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 ? (
          <nav aria-label="Paginación del historial de cierres" className="mt-4 flex items-center gap-2 text-sm">
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
      </section>
    </div>
  );
}
