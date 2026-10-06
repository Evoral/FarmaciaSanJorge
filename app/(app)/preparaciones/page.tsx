/**
 * `/preparaciones` (M11): the lab's screen. Tabs (`?estado=`): Pendientes
 * (the default) · En curso · Confirmadas · Descartadas, one paginated table
 * per tab; only the active tab's list is queried (so only the active tab
 * shows a count).
 *
 * Pendientes is the lab's queue, one row per receta: recetas loaded at the
 * front desk that nobody took yet and that still need a preparación, oldest
 * first so none is skipped (no re-sorting in the UI on purpose). "Ver"
 * previews what has to be prepared (every pending ítem: forma, cantidades
 * and componentes, read with the page) in a read-only dialog. "Tomar
 * receta" only records who took it and when
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
 *
 * Responsive: the tables keep their client forms (Ver, Tomar, Generar
 * etiqueta) in ONE place; on small screens secondary columns hide and
 * their data stacks under the receta Nº instead of duplicating the rows.
 */
import Link from "next/link";
import { CircleCheck, CircleOff, Eye, FlaskConical, Hourglass, Inbox, SearchX, X } from "lucide-react";
import type { ReactNode } from "react";
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
import type { EstadoEtiqueta, FiltrosPreparaciones } from "@/modules/preparaciones/domain/listado";
import { etiquetaProgreso, hrefToma, resumenItemsPendientes } from "@/modules/preparaciones/domain/toma";
import { listTamanosParaImprimir } from "@/modules/etiqueta-tamanos/application/list-tamanos-para-imprimir";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { generarEtiquetaAction } from "@/modules/preparaciones/ui/actions";
import { ImprimirEtiquetaDialog } from "@/modules/preparaciones/ui/imprimir-etiqueta-dialog";
import { TomarRecetaForm } from "@/modules/preparaciones/ui/tomar-receta-form";
import { VerRecetaPendienteDialog } from "@/modules/preparaciones/ui/ver-receta-pendiente-dialog";
import { FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { SearchField } from "@/shared/ui/search-field";
import { SimpleForm } from "@/shared/ui/simple-form";
import { PageHeader } from "@/shared/ui/page-header";
import { TabNav } from "@/shared/ui/tab-nav";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { Avatar } from "@/shared/ui/avatar";
import { ToneBadge, type BadgeTone } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

interface PreparacionesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Same colors as before (the StatusBadge tones). */
const TONO_ETIQUETA: Record<EstadoEtiqueta, BadgeTone> = {
  PENDIENTE: "warn",
  GENERADA: "neutral",
  IMPRESA: "success",
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

/** Empty state per tab when no filter narrows the list. */
const VACIO: Record<Lista["pestana"], { icon: ReactNode; title: string; description: string }> = {
  PENDIENTE: { icon: <Inbox className="size-5" />, title: "No hay recetas esperando", description: "Las recetas cargadas en mostrador aparecen acá para tomarlas, la más antigua primero." },
  INICIADA: { icon: <Hourglass className="size-5" />, title: "No hay recetas en curso", description: "Al tomar una receta pendiente, aparece acá hasta que se confirmen todos sus ítems." },
  CONFIRMADA: { icon: <CircleCheck className="size-5" />, title: "Todavía no hay preparaciones confirmadas", description: "Las preparaciones confirmadas aparecen acá para generar e imprimir su etiqueta." },
  DESCARTADA: { icon: <CircleOff className="size-5" />, title: "No hay preparaciones descartadas", description: "Las preparaciones descartadas quedan registradas acá." },
};

const numberFormat = new Intl.NumberFormat("es-AR");

/** `2026-09-01` -> `01/09/2026` (filters are already validated as ISO dates). */
function isoToDisplay(value: string): string {
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

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
  const esConfirmadas = filtros.estado === "CONFIRMADA";
  // The sizes of the "Seleccionar tamaño" dialog are read ONCE for the whole table (only when someone can print).
  const puedeImprimirEtiqueta = can(session, "etiquetas.imprimir");
  const tamanos: readonly EtiquetaTamano[] = esConfirmadas && puedeImprimirEtiqueta ? await listTamanosParaImprimir() : [];
  const etiquetaFechas = ETIQUETA_FECHAS[lista.pestana];
  const hasActiveFilters = Boolean(filtros.numero || filtros.desde || filtros.hasta || filtros.sinEtiquetaImpresa);

  const chips: { key: string; label: string; value?: string; remove: Partial<FiltrosPreparaciones> }[] = [];
  if (filtros.numero) chips.push({ key: "numero", label: "Nº de receta", value: filtros.numero, remove: { numero: undefined } });
  if (filtros.desde) chips.push({ key: "desde", label: `${etiquetaFechas} desde`, value: isoToDisplay(filtros.desde), remove: { desde: undefined } });
  if (filtros.hasta) chips.push({ key: "hasta", label: `${etiquetaFechas} hasta`, value: isoToDisplay(filtros.hasta), remove: { hasta: undefined } });
  if (filtros.sinEtiquetaImpresa) chips.push({ key: "sinEtiqueta", label: "Sin etiqueta impresa", remove: { sinEtiquetaImpresa: false } });
  const sinFiltrosHref = hrefPreparaciones(filtros, { numero: undefined, desde: undefined, hasta: undefined, sinEtiquetaImpresa: false, page: 1 });

  const resumen =
    lista.pestana === "PENDIENTE"
      ? total === 1
        ? "receta pendiente de preparación"
        : "recetas pendientes de preparación"
      : lista.pestana === "INICIADA"
        ? total === 1
          ? "receta en curso"
          : "recetas en curso"
        : total === 1
          ? "preparación encontrada"
          : "preparaciones encontradas";

  const vacio = VACIO[lista.pestana];
  const empty =
    total > 0 ? (
      <EmptyState
        icon={<SearchX className="size-5" />}
        title="Esta página no tiene resultados"
        description="Hay resultados, pero en páginas anteriores."
        action={
          <Link href={hrefPreparaciones(filtros, { page: 1 })} className="btn btn-secondary">
            Ir a la primera página
          </Link>
        }
      />
    ) : hasActiveFilters ? (
      <EmptyState
        icon={<SearchX className="size-5" />}
        title="Sin resultados"
        description="Nada coincide con los filtros aplicados en esta pestaña."
        action={
          <Link href={sinFiltrosHref} scroll={false} className="btn btn-secondary">
            Limpiar filtros
          </Link>
        }
      />
    ) : (
      <EmptyState icon={vacio.icon} title={vacio.title} description={vacio.description} />
    );

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Preparaciones" }]}
        title="Preparaciones"
        description="La cola del laboratorio: recetas por tomar, en curso y preparaciones terminadas."
      />

      <TabNav
        label="Estado de las preparaciones"
        items={PESTANAS_PREPARACIONES.map((p) => ({
          key: p.estado,
          label: p.titulo,
          href: hrefPreparaciones(filtros, { estado: p.estado }),
          active: p.estado === filtros.estado,
          // Only the active tab is queried, so only it has a count.
          count: p.estado === filtros.estado ? total : undefined,
        }))}
      />

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de preparaciones" hasActiveFilters={false}>
          {filtros.estado !== PESTANA_PREPARACIONES_POR_DEFECTO ? <input type="hidden" name="estado" value={filtros.estado} /> : null}
          <SearchField
            id="numero"
            name="numero"
            label="Nº de receta"
            hideLabel
            defaultValue={filtros.numero ?? ""}
            placeholder="Buscar por Nº de receta"
            inputMode="numeric"
            className="min-w-0 flex-1 md:w-64 md:flex-none"
          />
          <FilterDrawer activeCount={(filtros.desde ? 1 : 0) + (filtros.hasta ? 1 : 0) + (filtros.sinEtiquetaImpresa ? 1 : 0)}>
            <div className="field">
              <span id="fechas-label" className="field-label">
                {etiquetaFechas}
              </span>
              <div className="range-field" role="group" aria-labelledby="fechas-label">
                <label htmlFor="desde" className="sr-only">
                  {etiquetaFechas} desde
                </label>
                <DateInput id="desde" name="desde" defaultValue={filtros.desde ?? ""} />
                <span className="range-field-sep" aria-hidden>
                  a
                </span>
                <label htmlFor="hasta" className="sr-only">
                  {etiquetaFechas} hasta
                </label>
                <DateInput id="hasta" name="hasta" defaultValue={filtros.hasta ?? ""} />
              </div>
            </div>
            {esConfirmadas ? (
              <label className="toggle-switch">
                <input type="checkbox" role="switch" name="sinEtiqueta" value="1" defaultChecked={filtros.sinEtiquetaImpresa} />
                Sin etiqueta impresa
              </label>
            ) : null}
          </FilterDrawer>
        </FilterForm>

        {chips.length > 0 ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.value ? (
                  <>
                    {chip.label}: <strong>{chip.value}</strong>
                  </>
                ) : (
                  <strong>{chip.label}</strong>
                )}
                <Link href={hrefPreparaciones(filtros, { ...chip.remove, page: 1 })} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href={sinFiltrosHref} scroll={false} className="btn btn-ghost btn-sm">
                Limpiar filtros
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(total)}</span> {resumen}
            </p>
            {lista.pestana === "PENDIENTE" && lista.result.items.length > 0 ? <p className="text-xs">La más antigua primero</p> : null}
          </div>

          {lista.result.items.length === 0 ? (
            empty
          ) : lista.pestana === "PENDIENTE" ? (
            <TablaPendientes result={lista.result} puedeTomar={can(session, "preparaciones.iniciar")} />
          ) : lista.pestana === "INICIADA" ? (
            <TablaEnCurso result={lista.result} />
          ) : (
            <TablaPreparaciones
              result={lista.result}
              esConfirmadas={esConfirmadas}
              puedeGenerarEtiqueta={can(session, "etiquetas.generar")}
              puedeImprimirEtiqueta={puedeImprimirEtiqueta}
              tamanos={tamanos}
            />
          )}

          <Pagination page={filtros.page} pageSize={PAGE_SIZE} total={total} hrefFor={(page) => hrefPreparaciones(filtros, { page })} label="Paginación de preparaciones" />
        </div>
      </div>
    </div>
  );
}

/** The ítem as the other tabs name it. */
function nombreItem(item: Pick<ItemPendiente, "itemDescripcion" | "formaFarmaceutica">): string {
  return item.itemDescripcion ?? etiquetaDe(FORMA_FARMACEUTICA_LABELS, item.formaFarmaceutica);
}

/** Receta Nº cell: the number plus, on small screens, the data of the hidden columns. */
function CeldaReceta({ recetaId, numero, paciente, extra }: { recetaId: string; numero: string; paciente: string; extra?: ReactNode }) {
  return (
    <td className="px-3 py-2.5">
      <Link href={`/recetas/${recetaId}`} className="font-mono font-semibold underline-offset-2 hover:underline">
        {numero}
      </Link>
      <span className="block truncate text-xs text-zinc-600 md:hidden">{paciente}</span>
      {extra ? <span className="block text-xs text-zinc-500 tabular-nums lg:hidden">{extra}</span> : null}
    </td>
  );
}

function CeldaPaciente({ nombre }: { nombre: string }) {
  return (
    <td className="hidden px-3 py-2.5 md:table-cell">
      <span className="flex items-center gap-2.5">
        <Avatar name={nombre} />
        <span className="truncate font-medium text-zinc-900">{nombre}</span>
      </span>
    </td>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={`px-3 py-2 ${className ?? ""}`}>
      {children}
    </th>
  );
}

function TablaPendientes({ result, puedeTomar }: { result: ListRecetasPendientesOutput; puedeTomar: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <Th>Receta Nº</Th>
            <Th>Ítems</Th>
            <Th className="hidden md:table-cell">Paciente</Th>
            <Th className="hidden lg:table-cell">Ingresada</Th>
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((receta) => {
            const totalItems = receta.items[0]?.totalItems ?? receta.items.length;
            const paciente = `${receta.pacienteNombre} ${receta.pacienteApellido}`;
            const ingresada = formatFecha(receta.recetaFechaIngreso, result.zonaHoraria);
            return (
              <tr key={receta.recetaId}>
                <CeldaReceta recetaId={receta.recetaId} numero={receta.recetaNumeroInterno} paciente={paciente} extra={`Ingresada ${ingresada}`} />
                <td className="max-w-[32ch] px-3 py-2.5 text-zinc-700">{resumenItemsPendientes(receta.items.map(nombreItem), totalItems)}</td>
                <CeldaPaciente nombre={paciente} />
                <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums lg:table-cell">{ingresada}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-end gap-2">
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
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One segment per ítem (when they fit) plus the textual progress. */
function Progreso({ confirmados, total }: { confirmados: number; total: number }) {
  return (
    <span className="flex flex-col gap-1.5">
      {total > 0 && total <= 12 ? (
        <span className="steps" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} data-done={i < confirmados || undefined} />
          ))}
        </span>
      ) : null}
      <span className="text-xs text-zinc-600">{etiquetaProgreso(confirmados, total)}</span>
    </span>
  );
}

function TablaEnCurso({ result }: { result: ListRecetasEnCursoOutput }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <Th>Receta Nº</Th>
            <Th>Progreso</Th>
            <Th className="hidden md:table-cell">Paciente</Th>
            <Th className="hidden lg:table-cell">Tomada por</Th>
            <Th className="hidden lg:table-cell">Tomada</Th>
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((receta) => {
            const paciente = `${receta.pacienteNombre} ${receta.pacienteApellido}`;
            const tomada = formatFechaHora(receta.tomadaEn, result.zonaHoraria);
            return (
              <tr key={receta.recetaId}>
                <CeldaReceta recetaId={receta.recetaId} numero={receta.recetaNumeroInterno} paciente={paciente} extra={`Tomada por ${receta.tomadaPorNombre}, ${tomada}`} />
                <td className="px-3 py-2.5">
                  <Progreso confirmados={receta.itemsConfirmados} total={receta.totalItems} />
                </td>
                <CeldaPaciente nombre={paciente} />
                <td className="hidden px-3 py-2.5 lg:table-cell">
                  <span className="flex items-center gap-2">
                    <Avatar name={receta.tomadaPorNombre} />
                    {receta.tomadaPorNombre}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums lg:table-cell">{tomada}</td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end">
                    <Link href={hrefToma(receta.recetaId)} className="btn btn-primary btn-sm">
                      <FlaskConical className="size-3.5" aria-hidden />
                      Abrir
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
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
  tamanos,
}: {
  result: ListPreparacionesOutput;
  esConfirmadas: boolean;
  puedeGenerarEtiqueta: boolean;
  puedeImprimirEtiqueta: boolean;
  tamanos: readonly EtiquetaTamano[];
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <Th>Receta Nº</Th>
            <Th>Ítem</Th>
            <Th className="hidden md:table-cell">Paciente</Th>
            <Th className="hidden lg:table-cell">Iniciada</Th>
            {esConfirmadas ? <Th className="hidden lg:table-cell">Confirmada</Th> : null}
            {esConfirmadas ? <Th>Etiqueta</Th> : null}
            <Th>
              <span className="sr-only">Acciones</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((p) => {
            const etiqueta = estadoEtiqueta(p.etiqueta);
            const paciente = `${p.pacienteNombre} ${p.pacienteApellido}`;
            const iniciada = formatFechaHora(p.iniciadaEn, result.zonaHoraria);
            const confirmada = p.confirmadaEn ? formatFechaHora(p.confirmadaEn, result.zonaHoraria) : null;
            return (
              <tr key={p.id}>
                <CeldaReceta
                  recetaId={p.recetaId}
                  numero={p.recetaNumeroInterno}
                  paciente={paciente}
                  extra={esConfirmadas && confirmada ? `Confirmada ${confirmada}` : `Iniciada ${iniciada}`}
                />
                <td className="max-w-[32ch] px-3 py-2.5 text-zinc-700">{p.itemDescripcion ?? etiquetaDe(FORMA_FARMACEUTICA_LABELS, p.formaFarmaceutica)}</td>
                <CeldaPaciente nombre={paciente} />
                <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums lg:table-cell">{iniciada}</td>
                {esConfirmadas ? (
                  <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums lg:table-cell">
                    {confirmada ?? (
                      <span className="text-zinc-400">
                        -<span className="sr-only">Sin fecha de confirmación</span>
                      </span>
                    )}
                  </td>
                ) : null}
                {esConfirmadas ? (
                  <td className="px-3 py-2.5">
                    <ToneBadge tone={TONO_ETIQUETA[etiqueta]}>{ESTADO_ETIQUETA_LABELS[etiqueta]}</ToneBadge>
                  </td>
                ) : null}
                <td className="px-3 py-2.5">
                  <div className="flex justify-end">
                    <AccionFila preparacion={p} puedeGenerarEtiqueta={puedeGenerarEtiqueta} puedeImprimirEtiqueta={puedeImprimirEtiqueta} tamanos={tamanos} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccionFila({
  preparacion,
  puedeGenerarEtiqueta,
  puedeImprimirEtiqueta,
  tamanos,
}: {
  preparacion: PreparacionListItem;
  puedeGenerarEtiqueta: boolean;
  puedeImprimirEtiqueta: boolean;
  tamanos: readonly EtiquetaTamano[];
}) {
  if (preparacion.estado !== "CONFIRMADA") {
    return (
      <Link href={`/preparaciones/${preparacion.id}`} className="btn btn-secondary btn-sm">
        <Eye className="size-3.5" aria-hidden />
        Ver
      </Link>
    );
  }
  if (preparacion.etiqueta) {
    return puedeImprimirEtiqueta ? <ImprimirEtiquetaDialog preparacionId={preparacion.id} tamanos={tamanos} /> : null;
  }
  return puedeGenerarEtiqueta ? (
    // SimpleForm refreshes the route on success, so the row switches to "Imprimir etiqueta".
    <SimpleForm action={generarEtiquetaAction} submitLabel="Generar etiqueta" pendingLabel="Generando…" layout="inline" submitSize="sm">
      <input type="hidden" name="preparacionId" value={preparacion.id} />
    </SimpleForm>
  ) : null;
}
