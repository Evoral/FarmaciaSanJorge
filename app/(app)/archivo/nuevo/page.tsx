/**
 * `/archivo/nuevo` (FASE 12 point 12.1, user decision 4). Enter período +
 * ubicación (GET, only dates/ubicación ever travel through the URL) to
 * preview the eligible recetas, then confirm (POST) to conform the lote.
 */
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { redirect } from "next/navigation";
import { listRecetasElegiblesArchivo } from "@/modules/archivo/application/conformar-lote";
import { ConformarLoteForm } from "@/modules/archivo/ui/conformar-lote-form";

interface ArchivoNuevoPageProps {
  searchParams: Promise<{ periodoDesde?: string; periodoHasta?: string; ubicacion?: string }>;
}

export default async function ArchivoNuevoPage({ searchParams }: ArchivoNuevoPageProps) {
  const session = await requireSession();
  if (!can(session, "archivo.lotes.gestionar")) redirect("/archivo");

  const params = await searchParams;
  const periodoDesde = params.periodoDesde ?? "";
  const periodoHasta = params.periodoHasta ?? "";
  const ubicacion = params.ubicacion ?? "";
  const periodoCompleto = periodoDesde.length > 0 && periodoHasta.length > 0 && periodoHasta >= periodoDesde;

  let elegibles: Awaited<ReturnType<typeof listRecetasElegiblesArchivo>> = [];
  let error: string | null = null;
  if (periodoCompleto) {
    try {
      elegibles = await listRecetasElegiblesArchivo({ periodoDesde, periodoHasta });
    } catch {
      error = "No se pudo calcular las recetas elegibles para ese período.";
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">Conformar lote de archivo</h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Período y ubicación del lote">
        <div className="flex flex-col gap-1">
          <label htmlFor="periodoDesde" className="text-sm font-medium">
            Período desde
          </label>
          <input id="periodoDesde" name="periodoDesde" type="date" required defaultValue={periodoDesde} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="periodoHasta" className="text-sm font-medium">
            Período hasta
          </label>
          <input id="periodoHasta" name="periodoHasta" type="date" required defaultValue={periodoHasta} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ubicacion" className="text-sm font-medium">
            Ubicación
          </label>
          <input id="ubicacion" name="ubicacion" type="text" required defaultValue={ubicacion} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Buscar elegibles
        </button>
      </form>

      {!periodoCompleto ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Completá el período y la ubicación para ver las recetas elegibles.</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
            {elegibles.length} receta{elegibles.length === 1 ? "" : "s"} elegible{elegibles.length === 1 ? "" : "s"} en este período.
          </p>
          <p className="mb-4 text-xs text-zinc-500">
            Elegibles: ENTREGADA o ANULADA, con la receta física recibida, sin lote asignado. Las recetas ANULADAS sin receta física nunca son archivables.
          </p>

          <div className="mb-6 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Nº</th>
                  <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
                  <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                  <th scope="col" className="px-3 py-2 font-medium">Fecha de ingreso</th>
                </tr>
              </thead>
              <tbody>
                {elegibles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-zinc-500">
                      No hay recetas elegibles en este período.
                    </td>
                  </tr>
                ) : (
                  elegibles.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                      <td className="px-3 py-2 font-medium">{r.numeroInterno}</td>
                      <td className="px-3 py-2">{r.pacienteApellido}, {r.pacienteNombre}</td>
                      <td className="px-3 py-2">{r.estado}</td>
                      <td className="px-3 py-2">{r.fechaIngreso}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {ubicacion.trim().length > 0 ? (
            <ConformarLoteForm periodoDesde={periodoDesde} periodoHasta={periodoHasta} ubicacion={ubicacion} cantidadElegibles={elegibles.length} />
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Ingresá una ubicación para poder confirmar.</p>
          )}
        </>
      )}
    </div>
  );
}
