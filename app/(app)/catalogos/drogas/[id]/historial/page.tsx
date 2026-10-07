/**
 * `/catalogos/drogas/[id]/historial` (docs/specs/historial-droga.md): read-only
 * view of every receta that CONSUMED the droga and from which partida(s), as a
 * `table.data-table` whose rows expand to the detail (`FilaDesplegable`).
 * `[id]` is an opaque UUID and `searchParams` ONLY ever reads `page` (a plain
 * integer) and `partida` (repeatable uuid filter, parsed by `parsearPartidaIds`
 * and re-checked against the droga's own partidas by the repository). Base
 * access is the parent layout's `drogas.editar` guard; the receta data needs
 * `recetas.crear` (`puedeVerHistorialDroga`): without it this page redirects to
 * the Datos tab BEFORE calling the use case, so no ACCESO_DENEGADO row is
 * written for a link the UI never showed. Paciente names and the partida links
 * are decided by the use case from the session's other permisos.
 */
import { notFound, redirect } from "next/navigation";
import { PackageSearch, SearchX } from "lucide-react";
import { getHistorialDroga, puedeVerHistorialDroga } from "@/modules/drogas/application/get-historial-droga";
import {
  PAGE_MAX_HISTORIAL_DROGA,
  hrefHistorialDroga,
  parsearPartidaIds,
  partidasRestantes,
  partidasSeleccionadas,
} from "@/modules/drogas/domain/historial";
import { HistorialEncabezado } from "@/modules/drogas/ui/historial-encabezado";
import { HistorialFiltroPartidas } from "@/modules/drogas/ui/historial-filtro-partidas";
import { COLUMNAS_TABLA_HISTORIAL, HistorialRecetaCeldas, HistorialRecetaDetalle, etiquetaReceta } from "@/modules/drogas/ui/historial-receta-fila";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { requireSession } from "@/shared/auth/session";
import { crearCatalogoUnidades } from "@/shared/format/cantidad";
import { EmptyState } from "@/shared/ui/empty-state";
import { FilaDesplegable } from "@/shared/ui/fila-desplegable";
import { Pagination } from "@/shared/ui/pagination";
import { uuid } from "@/shared/validation";
import { DrogaTabs } from "../../droga-tabs";

const numberFormat = new Intl.NumberFormat("es-AR");

interface HistorialDrogaPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; partida?: string | string[] }>;
}

export default async function HistorialDrogaPage({ params, searchParams }: HistorialDrogaPageProps) {
  const session = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  // Same rule as the use case's own input (zod uuid): anything else is a 404, never a ValidationError.
  if (!uuid.safeParse(id).success) notFound();
  // Decided here, before the use case: a session without the permiso is sent back to the Datos tab (and the tab was never shown to it).
  if (!puedeVerHistorialDroga(session)) redirect(`/catalogos/drogas/${id}`);

  // Clamped into the use case's accepted range (a huge digit string parses to Infinity); the repository then clamps to the last page.
  const parsedPage = Number.parseInt(query.page ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) ? Math.min(PAGE_MAX_HISTORIAL_DROGA, Math.max(1, parsedPage)) : 1;
  // Valid uuids only, deduplicated, capped: the repository then keeps just the ones that are this droga's own partidas.
  const historial = await getHistorialDroga({ drogaId: id, page: requestedPage, partidaIds: parsearPartidaIds(query.partida) });
  if (!historial) notFound();

  const { droga, acceso, zonaHoraria, partidasDisponibles, partidaIds, totalRecetas, recetas, paginacion } = historial;
  // The unit catalog is gated on `stock.ver`: without it (a denial would write an ACCESO_DENEGADO audit row) quantities show in the droga's own unidad base, unconverted.
  const catalogo = acceso.stock ? (await getCatalogoUnidades()).catalogo : crearCatalogoUnidades([]);

  const baseHref = `/catalogos/drogas/${id}/historial`;
  const filtrando = partidaIds.length > 0;
  // Pagination links keep EVERY selected partida (the effective filter, not the raw URL).
  const pageHref = (target: number) => hrefHistorialDroga(baseHref, partidaIds, target);

  return (
    <>
      <HistorialEncabezado droga={droga} />
      <DrogaTabs id={id} conHistorial />

      <section aria-labelledby="historial-recetas" className="list-panel">
        <div className="list-toolbar flex-wrap gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="historial-recetas" className="text-[0.9375rem] font-semibold text-zinc-900">
              Recetas
            </h2>
            <p role="status" className="text-xs">
              {filtrando ? (
                <>
                  <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(paginacion.total)}</span> de{" "}
                  <span className="tabular-nums">{numberFormat.format(totalRecetas)}</span> recetas
                </>
              ) : (
                <>
                  <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(paginacion.total)}</span> {paginacion.total === 1 ? "receta" : "recetas"}
                </>
              )}
              <span className="hidden sm:inline"> · tocá una fila para ver su detalle</span>
            </p>
          </div>
          {partidasDisponibles.length > 0 ? (
            <HistorialFiltroPartidas
              elegidas={partidasSeleccionadas(partidasDisponibles, partidaIds)}
              restantes={partidasRestantes(partidasDisponibles, partidaIds)}
              baseHref={baseHref}
            />
          ) : null}
        </div>

        {recetas.length === 0 ? (
          filtrando ? (
            <EmptyState icon={<SearchX className="size-5" />} title="Sin resultados" description="No hay recetas que hayan usado las partidas seleccionadas." />
          ) : (
            <EmptyState icon={<PackageSearch className="size-5" />} title="Sin recetas" description="Esta droga todavía no se usó en ninguna preparación." />
          )
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="w-8 px-3 py-2">
                    <span className="sr-only">Detalle</span>
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Nº
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Preparada
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Paciente
                  </th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">
                    Médico
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Consumido
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {recetas.map((receta) => (
                  <FilaDesplegable
                    key={receta.id}
                    id={receta.id}
                    etiqueta={etiquetaReceta(receta)}
                    colSpan={COLUMNAS_TABLA_HISTORIAL}
                    celdas={<HistorialRecetaCeldas receta={receta} droga={droga} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />}
                    detalle={<HistorialRecetaDetalle receta={receta} droga={droga} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={paginacion.page} pageSize={paginacion.pageSize} total={paginacion.total} hrefFor={pageHref} label="Paginación de recetas de la droga" />
      </section>
    </>
  );
}
