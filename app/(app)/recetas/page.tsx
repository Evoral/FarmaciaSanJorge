/**
 * `/recetas`: listado con filtros por estado/fecha/número, server-side.
 * After creating a receta the form lands here (`?registrada=<id>`, plus the
 * automatic ficha/cotización notices as codes -- modules/recetas/domain/avisos-generacion.ts).
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRecetas } from "@/modules/recetas/application/list-recetas";
import type { ListRecetasResult } from "@/modules/recetas/application/list-recetas";
import { ESTADOS_RECETA } from "@/modules/recetas/domain/receta";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { PARAM_AVISO, PARAM_REGISTRADA, decodificarAvisos } from "@/modules/recetas/domain/avisos-generacion";
import { AvisosGeneracion } from "@/modules/recetas/ui/avisos-generacion";
import { decidirAccionPreparacion } from "@/modules/recetas/domain/accion-preparacion";
import { IniciarPreparacionForm } from "@/modules/preparaciones/ui/iniciar-form";
import { ESTADO_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { formatFecha } from "@/shared/format/fecha";
import { StatusBadge } from "@/shared/ui/status-badge";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";

const PAGE_SIZE = 20;

interface RecetasPageProps {
  searchParams: Promise<{ estado?: string; numero?: string; desde?: string; hasta?: string; page?: string; registrada?: string; aviso?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RecetasPage({ searchParams }: RecetasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const estado = params.estado ?? "";

  const result = await listRecetas({
    estado: ESTADOS_RECETA.includes(estado as (typeof ESTADOS_RECETA)[number]) ? (estado as (typeof ESTADOS_RECETA)[number]) : undefined,
    numeroInterno: params.numero,
    desde: params.desde,
    hasta: params.hasta,
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeCrear = can(session, "recetas.crear");
  const puedeFisica = can(session, "recetas.fisica.registrar");
  const puedeEditar = can(session, "recetas.editar");
  const puedeIniciar = can(session, "preparaciones.iniciar");

  // The receta just created (read again: the URL only carries its id and the notice codes).
  const idRegistrada = params[PARAM_REGISTRADA];
  const registrada = idRegistrada && UUID.test(idRegistrada) ? await getReceta(idRegistrada) : null;
  const avisos = registrada ? decodificarAvisos(params[PARAM_AVISO], registrada.items.length) : [];

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.estado) qs.set("estado", params.estado);
    if (params.numero) qs.set("numero", params.numero);
    if (params.desde) qs.set("desde", params.desde);
    if (params.hasta) qs.set("hasta", params.hasta);
    qs.set("page", String(targetPage));
    return `/recetas?${qs.toString()}`;
  }

  return (
    <div className="page">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recetas</h1>
        <div className="flex gap-3">
          {puedeFisica ? (
            <Link href="/recetas/pendientes-fisica" className="btn btn-secondary">
              Pendientes de receta física
            </Link>
          ) : null}
          {puedeCrear ? (
            <Link href="/recetas/nuevo" className="btn btn-primary">
              Nueva receta
            </Link>
          ) : null}
        </div>
      </div>

      {registrada ? (
        <AvisosGeneracion
          exito={`Receta Nº ${registrada.numeroInterno} registrada.`}
          avisos={avisos}
          accion={
            <Link href={`/recetas/${registrada.id}`} className="underline">
              Ir a la receta Nº {registrada.numeroInterno}
            </Link>
          }
        />
      ) : null}

      <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de recetas" hasActiveFilters={Boolean(params.estado || params.numero || params.desde || params.hasta)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={estado} className="input">
            <option value="">Todos</option>
            {ESTADOS_RECETA.map((e) => (
              <option key={e} value={e}>
                {ESTADO_RECETA_LABELS[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="numero" className="text-sm font-medium">
            Nº interno
          </label>
          <input id="numero" name="numero" type="text" defaultValue={params.numero ?? ""} className="w-28 input" />
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

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
        {result.total} receta{result.total === 1 ? "" : "s"} encontrada{result.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Nº
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Paciente
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Prescripción
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Ingreso
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Estado
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
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
                  <td className="px-3 py-2">
                    <Link href={`/recetas/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                      {r.numeroInterno}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.pacienteNombre} {r.pacienteApellido}
                  </td>
                  <td className="px-3 py-2">{formatFecha(r.fechaPrescripcion)}</td>
                  <td className="px-3 py-2">{formatFecha(r.fechaIngreso, result.zonaHoraria)}</td>
                  <td className="px-3 py-2"><StatusBadge estado={r.estado} /></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <AccionPreparar receta={r} puedeIniciar={puedeIniciar} />
                      {puedeEditar && r.editable ? (
                        <Link href={`/recetas/${r.id}/editar`} className="btn btn-secondary btn-sm" aria-label={`Editar receta Nº ${r.numeroInterno}`}>
                          Editar
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de recetas" className="mt-4 flex items-center gap-2 text-sm">
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

/** "Preparar" / "Continuar" for the receta's first pending item (modules/recetas/domain/accion-preparacion.ts); the start itself is the existing `preparaciones.iniciar` form, whose errors show inline. */
function AccionPreparar({ receta, puedeIniciar }: { receta: ListRecetasResult["items"][number]; puedeIniciar: boolean }) {
  const accion = decidirAccionPreparacion({ estado: receta.estado, items: receta.itemsParaPreparar, puedeIniciar });
  switch (accion.tipo) {
    case "preparar":
      return <IniciarPreparacionForm fichaTecnicaId={accion.fichaTecnicaId} label={accion.etiqueta} size="sm" />;
    case "continuar":
      return (
        <Link href={`/preparaciones/${accion.preparacionId}`} className="btn btn-primary btn-sm">
          {accion.etiqueta}
        </Link>
      );
    case "generar-ficha":
      return (
        <Link href={`/recetas/${receta.id}`} className="text-xs text-zinc-500 underline">
          {accion.etiqueta}
        </Link>
      );
    default:
      return null;
  }
}
