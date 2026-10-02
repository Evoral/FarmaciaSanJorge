/**
 * `/preparaciones` (M11): the lab's screen. Tabs (`?estado=`): Pendientes
 * (the default) · En curso · Confirmadas · Descartadas, one paginated table
 * per tab; only the active tab's list is queried.
 *
 * Pendientes is the lab's queue, one row per receta: recetas loaded at the
 * front desk that nobody took yet and that still need a preparación, oldest
 * first so none is skipped. "Ver" previews what has to be prepared (every
 * pending ítem: forma, cantidades and componentes, read with the page) in a
 * read-only dialog. "Tomar receta" only records who took it and when
 * (modules/preparaciones/domain/toma.ts) and opens the receta's toma
 * workspace (/preparaciones/recetas/[recetaId]), where the receta can still
 * be edited and each ítem's confirmation is started.
 *
 * En curso (URL key `estado=INICIADA`, kept so existing links work) lists
 * the taken recetas that still have ítems to confirm, with their progress
 * and who took them; "Abrir" goes back to the workspace -- also after the
 * browser tab was closed, since the toma is persisted.
 *
 * Confirmadas / Descartadas list preparaciones. Confirming is NOT offered
 * inline anywhere: it is irreversible and needs the partida review, the
 * manual enrase and a re-authentication, all on /preparaciones/[id].
 *
 * Filters (server-side, modules/preparaciones/domain/listado.ts): Nº de
 * receta and a date range on every tab -- the receta's ingreso on
 * Pendientes, the toma on En curso, the preparación's start on the others --
 * and "Sin etiqueta impresa" on Confirmadas. No paciente filter: DP-24
 * forbids personal data in URLs.
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listPreparaciones } from "@/modules/preparaciones/application/list-preparaciones";
import type { ListPreparacionesOutput, PreparacionListItem } from "@/modules/preparaciones/application/list-preparaciones";
import { listRecetasPendientes } from "@/modules/preparaciones/application/list-recetas-pendientes";
import type { ItemPendiente, ListRecetasPendientesOutput } from "@/modules/preparaciones/application/list-recetas-pendientes";
import { listRecetasEnCurso } from "@/modules/preparaciones/application/list-recetas-en-curso";
import type { ListRecetasEnCursoOutput } from "@/modules/preparaciones/application/list-recetas-en-curso";
import {
  ESTADO_ETIQUETA_LABELS,
  PESTANAS_PREPARACIONES,
  PESTANA_PREPARACIONES_POR_DEFECTO,
  estadoEtiqueta,
  hrefPreparaciones,
  parsearFiltrosPreparaciones,
} from "@/modules/preparaciones/domain/listado";
import type { EstadoEtiqueta } from "@/modules/preparaciones/domain/listado";
import { etiquetaProgreso, hrefToma, resumenItemsPendientes } from "@/modules/preparaciones/domain/toma";
import { generarEtiquetaAction } from "@/modules/preparaciones/ui/actions";
import { TomarRecetaForm } from "@/modules/preparaciones/ui/tomar-receta-form";
import { VerRecetaPendienteDialog } from "@/modules/preparaciones/ui/ver-receta-pendiente-dialog";
import { FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { SimpleForm } from "@/shared/ui/simple-form";

const PAGE_SIZE = 20;

interface PreparacionesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const TONO_ETIQUETA: Record<EstadoEtiqueta, string> = {
  PENDIENTE: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  GENERADA: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  IMPRESA: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

type Lista =
  | { pestana: "PENDIENTE"; result: ListRecetasPendientesOutput }
  | { pestana: "INICIADA"; result: ListRecetasEnCursoOutput }
  | { pestana: "CONFIRMADA" | "DESCARTADA"; result: ListPreparacionesOutput };

const ETIQUETA_FECHAS: Record<Lista["pestana"], string> = {
  PENDIENTE: "Ingresada",
  INICIADA: "Tomada",
  CONFIRMADA: "Iniciada",
  DESCARTADA: "Iniciada",
};

export default async function PreparacionesPage({ searchParams }: PreparacionesPageProps) {
  const session = await requireSession();
  const filtros = parsearFiltrosPreparaciones(await searchParams);
  const comunes = { numeroInterno: filtros.numero, desde: filtros.desde, hasta: filtros.hasta, page: filtros.page, pageSize: PAGE_SIZE };
  let lista: Lista;
  if (filtros.estado === "PENDIENTE") {
    lista = { pestana: "PENDIENTE", result: await listRecetasPendientes(comunes) };
  } else if (filtros.estado === "INICIADA") {
    lista = { pestana: "INICIADA", result: await listRecetasEnCurso(comunes) };
  } else {
    lista = { pestana: filtros.estado, result: await listPreparaciones({ ...comunes, estado: filtros.estado, sinEtiquetaImpresa: filtros.sinEtiquetaImpresa }) };
  }
  const total = lista.result.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const esConfirmadas = filtros.estado === "CONFIRMADA";
  const etiquetaFechas = ETIQUETA_FECHAS[lista.pestana];

  return (
    <div className="page">
      <h1 className="mb-4 text-2xl font-semibold">Preparaciones</h1>

      <nav aria-label="Estado de las preparaciones" className="mb-6 flex flex-wrap gap-x-5 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {PESTANAS_PREPARACIONES.map((p) => {
          const activa = p.estado === filtros.estado;
          return (
            <Link
              key={p.estado}
              href={hrefPreparaciones(filtros, { estado: p.estado })}
              aria-current={activa ? "page" : undefined}
              className={
                activa
                  ? "-mb-px border-b-2 border-emerald-600 pb-2.5 font-medium text-zinc-900 dark:border-emerald-400 dark:text-zinc-100"
                  : "-mb-px border-b-2 border-transparent pb-2.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }
            >
              {p.titulo}
            </Link>
          );
        })}
      </nav>

      <FilterForm
        className="mb-6 flex flex-wrap items-end gap-3"
        aria-label="Filtros de preparaciones"
        hasActiveFilters={Boolean(filtros.numero || filtros.desde || filtros.hasta || filtros.sinEtiquetaImpresa)}
      >
        {filtros.estado !== PESTANA_PREPARACIONES_POR_DEFECTO ? <input type="hidden" name="estado" value={filtros.estado} /> : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="numero" className="text-sm font-medium">
            Nº de receta
          </label>
          <input id="numero" name="numero" type="text" inputMode="numeric" defaultValue={filtros.numero ?? ""} className="w-28 input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className="text-sm font-medium">
            {etiquetaFechas} desde
          </label>
          <DateInput id="desde" name="desde" defaultValue={filtros.desde ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            {etiquetaFechas} hasta
          </label>
          <DateInput id="hasta" name="hasta" defaultValue={filtros.hasta ?? ""} />
        </div>
        {esConfirmadas ? (
          <label className="toggle-switch">
            <input type="checkbox" role="switch" name="sinEtiqueta" value="1" defaultChecked={filtros.sinEtiquetaImpresa} />
            Sin etiqueta impresa
          </label>
        ) : null}
      </FilterForm>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {lista.pestana === "PENDIENTE"
          ? `${total} receta${total === 1 ? " pendiente" : "s pendientes"} de preparación.`
          : lista.pestana === "INICIADA"
            ? `${total} receta${total === 1 ? "" : "s"} en curso.`
            : `${total} preparaci${total === 1 ? "ón encontrada" : "ones encontradas"}.`}
      </p>

      {lista.pestana === "PENDIENTE" ? (
        <TablaPendientes result={lista.result} puedeTomar={can(session, "preparaciones.iniciar")} />
      ) : lista.pestana === "INICIADA" ? (
        <TablaEnCurso result={lista.result} />
      ) : (
        <TablaPreparaciones
          result={lista.result}
          esConfirmadas={esConfirmadas}
          puedeGenerarEtiqueta={can(session, "etiquetas.generar")}
          puedeImprimirEtiqueta={can(session, "etiquetas.imprimir")}
        />
      )}

      {totalPages > 1 ? (
        <nav aria-label="Paginación de preparaciones" className="mt-4 flex items-center gap-2 text-sm">
          <Link
            href={hrefPreparaciones(filtros, { page: Math.max(1, filtros.page - 1) })}
            aria-disabled={filtros.page <= 1}
            className={filtros.page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Anterior
          </Link>
          <span>
            Página {filtros.page} de {totalPages}
          </span>
          <Link
            href={hrefPreparaciones(filtros, { page: Math.min(totalPages, filtros.page + 1) })}
            aria-disabled={filtros.page >= totalPages}
            className={filtros.page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}

/** The ítem as the other tabs name it. */
function nombreItem(item: Pick<ItemPendiente, "itemDescripcion" | "formaFarmaceutica">): string {
  return item.itemDescripcion ?? etiquetaDe(FORMA_FARMACEUTICA_LABELS, item.formaFarmaceutica);
}

function TablaPendientes({ result, puedeTomar }: { result: ListRecetasPendientesOutput; puedeTomar: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Receta Nº</th>
            <th scope="col" className="px-3 py-2 font-medium">Ítems</th>
            <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
            <th scope="col" className="px-3 py-2 font-medium">Ingresada</th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {result.items.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                No hay recetas pendientes de preparación con estos filtros.
              </td>
            </tr>
          ) : (
            result.items.map((receta) => {
              const totalItems = receta.items[0]?.totalItems ?? receta.items.length;
              return (
                <tr key={receta.recetaId}>
                  <td className="px-3 py-2">
                    <Link href={`/recetas/${receta.recetaId}`} className="font-medium underline-offset-2 hover:underline">
                      {receta.recetaNumeroInterno}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{resumenItemsPendientes(receta.items.map(nombreItem), totalItems)}</td>
                  <td className="px-3 py-2">
                    {receta.pacienteNombre} {receta.pacienteApellido}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{formatFecha(receta.recetaFechaIngreso, result.zonaHoraria)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-start justify-end gap-2">
                      <VerRecetaPendienteDialog
                        receta={{
                          recetaNumeroInterno: receta.recetaNumeroInterno,
                          items: receta.items.map((item) => ({
                            itemRecetaId: item.itemRecetaId,
                            nombre: item.totalItems > 1 ? `${nombreItem(item)} (ítem ${item.posicion} de ${item.totalItems})` : nombreItem(item),
                            formaFarmaceutica: item.formaFarmaceutica,
                            cantidadUnidades: item.cantidadUnidades,
                            cantidadTotal: item.cantidadTotal,
                            unidadTotalSimbolo: item.unidadTotalSimbolo,
                            posologia: item.posologia,
                            duracionTratamientoDias: item.duracionTratamientoDias,
                            componentes: item.componentes,
                          })),
                        }}
                      />
                      {puedeTomar ? <TomarRecetaForm recetaId={receta.recetaId} /> : null}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function TablaEnCurso({ result }: { result: ListRecetasEnCursoOutput }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Receta Nº</th>
            <th scope="col" className="px-3 py-2 font-medium">Progreso</th>
            <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
            <th scope="col" className="px-3 py-2 font-medium">Tomada por</th>
            <th scope="col" className="px-3 py-2 font-medium">Tomada</th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {result.items.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                No hay recetas en curso con estos filtros.
              </td>
            </tr>
          ) : (
            result.items.map((receta) => (
              <tr key={receta.recetaId}>
                <td className="px-3 py-2">
                  <Link href={`/recetas/${receta.recetaId}`} className="font-medium underline-offset-2 hover:underline">
                    {receta.recetaNumeroInterno}
                  </Link>
                </td>
                <td className="px-3 py-2">{etiquetaProgreso(receta.itemsConfirmados, receta.totalItems)}</td>
                <td className="px-3 py-2">
                  {receta.pacienteNombre} {receta.pacienteApellido}
                </td>
                <td className="px-3 py-2">{receta.tomadaPorNombre}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatFechaHora(receta.tomadaEn, result.zonaHoraria)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end">
                    <Link href={hrefToma(receta.recetaId)} className="btn btn-primary btn-sm">
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TablaPreparaciones({
  result,
  esConfirmadas,
  puedeGenerarEtiqueta,
  puedeImprimirEtiqueta,
}: {
  result: ListPreparacionesOutput;
  esConfirmadas: boolean;
  puedeGenerarEtiqueta: boolean;
  puedeImprimirEtiqueta: boolean;
}) {
  const columnas = 5 + (esConfirmadas ? 2 : 0);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Receta Nº</th>
            <th scope="col" className="px-3 py-2 font-medium">Ítem</th>
            <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
            <th scope="col" className="px-3 py-2 font-medium">Iniciada</th>
            {esConfirmadas ? <th scope="col" className="px-3 py-2 font-medium">Confirmada</th> : null}
            {esConfirmadas ? <th scope="col" className="px-3 py-2 font-medium">Etiqueta</th> : null}
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {result.items.length === 0 ? (
            <tr>
              <td colSpan={columnas} className="px-3 py-6 text-center text-zinc-500">
                No hay preparaciones con estos filtros.
              </td>
            </tr>
          ) : (
            result.items.map((p) => {
              const etiqueta = estadoEtiqueta(p.etiqueta);
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    <Link href={`/recetas/${p.recetaId}`} className="font-medium underline-offset-2 hover:underline">
                      {p.recetaNumeroInterno}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{p.itemDescripcion ?? etiquetaDe(FORMA_FARMACEUTICA_LABELS, p.formaFarmaceutica)}</td>
                  <td className="px-3 py-2">
                    {p.pacienteNombre} {p.pacienteApellido}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{formatFechaHora(p.iniciadaEn, result.zonaHoraria)}</td>
                  {esConfirmadas ? (
                    <td className="whitespace-nowrap px-3 py-2">{p.confirmadaEn ? formatFechaHora(p.confirmadaEn, result.zonaHoraria) : "—"}</td>
                  ) : null}
                  {esConfirmadas ? (
                    <td className="px-3 py-2">
                      <span className={`badge ${TONO_ETIQUETA[etiqueta]}`}>{ESTADO_ETIQUETA_LABELS[etiqueta]}</span>
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <AccionFila preparacion={p} puedeGenerarEtiqueta={puedeGenerarEtiqueta} puedeImprimirEtiqueta={puedeImprimirEtiqueta} />
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function AccionFila({
  preparacion,
  puedeGenerarEtiqueta,
  puedeImprimirEtiqueta,
}: {
  preparacion: PreparacionListItem;
  puedeGenerarEtiqueta: boolean;
  puedeImprimirEtiqueta: boolean;
}) {
  if (preparacion.estado !== "CONFIRMADA") {
    return (
      <Link href={`/preparaciones/${preparacion.id}`} className="btn btn-secondary btn-sm">
        Ver
      </Link>
    );
  }
  if (preparacion.etiqueta) {
    return puedeImprimirEtiqueta ? (
      <a href={`/api/preparaciones/${preparacion.id}/etiqueta/pdf`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
        Imprimir etiqueta
      </a>
    ) : null;
  }
  return puedeGenerarEtiqueta ? (
    // SimpleForm refreshes the route on success, so the row switches to "Imprimir etiqueta".
    <SimpleForm action={generarEtiquetaAction} submitLabel="Generar etiqueta" pendingLabel="Generando…" layout="inline" submitSize="sm">
      <input type="hidden" name="preparacionId" value={preparacion.id} />
    </SimpleForm>
  ) : null;
}
