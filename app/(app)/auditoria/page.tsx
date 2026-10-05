/**
 * `/auditoria` (M03, FASE 3 point 3.11). READ-ONLY, tenant-scoped audit log
 * viewer over `fsj.registro_auditoria`. Server component: filters are
 * plain GET query params, applied as they change by `FilterForm`
 * (shared/ui/filter-form.tsx; still a native `<form method="get">`
 * without JS) -- same convention as `/admin/accesos/usuarios`
 * (app/(app)/admin/accesos/usuarios/page.tsx). A filter change drops
 * `cursor` (back to the first page). Pagination is CURSOR-based
 * ("cargar más" driven by `nextCursor`), never numbered/offset pages --
 * the audit log grows forever and is never purged, so `OFFSET n` degrades
 * badly at scale (see
 * modules/auditoria/infrastructure/auditoria-repository.ts's doc comment).
 * A `<Link href="?cursor=...">` re-render is enough to advance a page,
 * exactly as Next.js RSC search params intend. The usuario filter is an
 * autocomplete over the same preloaded usuarios list (`FiltroOpciones`, which
 * writes the same `usuarioId` param and drops `cursor`); the rarely used
 * filters live behind "Más filtros".
 */
import Link from "next/link";
import { CircleAlert, ScrollText, SearchX, X } from "lucide-react";
import { TipoAccion } from "@/generated/prisma/enums";
import { listRegistroAuditoria } from "@/modules/auditoria/application/list-registro-auditoria";
import { listUsuariosParaFiltro } from "@/modules/auditoria/application/list-usuarios-para-filtro";
import { AuditoriaDiff } from "@/modules/auditoria/ui/auditoria-diff";
import { ACCION_LABELS, ENTIDADES, describirRegistro, etiquetaEntidad, formatearFechaHora } from "@/modules/auditoria/domain/presentacion";
import { formatFechaIso } from "@/shared/format/fecha";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterDrawer, FilterPopover } from "@/shared/ui/filter-drawer";
import { FiltroOpciones } from "@/shared/ui/filtro-opciones";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Avatar } from "@/shared/ui/avatar";
import { ToneBadge } from "@/shared/ui/status-badge";
import { tonoAccion } from "@/modules/auditoria/ui/tono-accion";

const PAGE_SIZE = 50;

const ACCION_VALUES = Object.values(TipoAccion);
const ENTIDAD_VALUES = Object.keys(ENTIDADES).sort((a, b) => etiquetaEntidad(a).localeCompare(etiquetaEntidad(b), "es"));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FilterParam = "entidad" | "entidadId" | "usuarioId" | "accion" | "desde" | "hasta";

interface AuditoriaPageProps {
  searchParams: Promise<{
    entidad?: string;
    entidadId?: string;
    usuarioId?: string;
    accion?: string;
    desde?: string;
    hasta?: string;
    cursor?: string;
  }>;
}

export default async function AuditoriaPage({ searchParams }: AuditoriaPageProps) {
  const params = await searchParams;

  const entidad = params.entidad && params.entidad in ENTIDADES ? params.entidad : undefined;
  const entidadId = params.entidadId && UUID_PATTERN.test(params.entidadId) ? params.entidadId : undefined;
  const usuarioId = params.usuarioId && UUID_PATTERN.test(params.usuarioId) ? params.usuarioId : undefined;
  const accion = params.accion && (ACCION_VALUES as readonly string[]).includes(params.accion) ? (params.accion as TipoAccion) : undefined;
  const desde = params.desde && ISO_DATE_PATTERN.test(params.desde) ? params.desde : undefined;
  const hasta = params.hasta && ISO_DATE_PATTERN.test(params.hasta) ? params.hasta : undefined;
  const cursor = params.cursor || undefined;

  // ISO dates compare correctly as strings. Checked here so an inverted range shows a message instead of the use case's ValidationError.
  const rangoInvalido = Boolean(desde && hasta && desde > hasta);

  const [result, usuariosFiltro] = await Promise.all([
    rangoInvalido
      ? Promise.resolve({ items: [], nextCursor: null, zonaHoraria: "America/Argentina/Mendoza" })
      : listRegistroAuditoria({ entidad, entidadId, usuarioId, accion, desde, hasta, cursor, pageSize: PAGE_SIZE }),
    listUsuariosParaFiltro(),
  ]);

  function loadMoreHref(nextCursor: string): string {
    const qs = new URLSearchParams();
    if (entidad) qs.set("entidad", entidad);
    if (entidadId) qs.set("entidadId", entidadId);
    if (usuarioId) qs.set("usuarioId", usuarioId);
    if (accion) qs.set("accion", accion);
    if (desde) qs.set("desde", desde);
    if (hasta) qs.set("hasta", hasta);
    qs.set("cursor", nextCursor);
    return `/auditoria?${qs.toString()}`;
  }

  /** The log's URL (first page: no cursor) with some filters replaced ("" removes one). */
  function filtersHref(cambios: Partial<Record<FilterParam, string>> = {}): string {
    const actuales: Record<FilterParam, string> = {
      entidad: entidad ?? "",
      entidadId: params.entidadId ?? "",
      usuarioId: usuarioId ?? "",
      accion: accion ?? "",
      desde: params.desde ?? "",
      hasta: params.hasta ?? "",
    };
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...actuales, ...cambios })) if (value) qs.set(key, value);
    const query = qs.toString();
    return query ? `/auditoria?${query}` : "/auditoria";
  }

  const opcionesUsuario = usuariosFiltro.map((u) => ({ value: u.id, label: `${u.apellido}, ${u.nombre}` }));
  const usuarioElegido = opcionesUsuario.find((o) => o.value === usuarioId);

  const chips: { key: FilterParam; label: string; value: string }[] = [];
  if (accion) chips.push({ key: "accion", label: "Acción", value: ACCION_LABELS[accion] ?? accion });
  if (entidad) chips.push({ key: "entidad", label: "Entidad", value: etiquetaEntidad(entidad) });
  if (params.entidadId) chips.push({ key: "entidadId", label: "ID", value: `${params.entidadId.slice(0, 8)}…` });
  if (params.desde) chips.push({ key: "desde", label: "Desde", value: formatFechaIso(params.desde) });
  if (params.hasta) chips.push({ key: "hasta", label: "Hasta", value: formatFechaIso(params.hasta) });
  const hasFilters = Boolean(usuarioId) || chips.length > 0;
  const masFiltros = (entidad ? 1 : 0) + (params.entidadId ? 1 : 0) + (params.desde ? 1 : 0) + (params.hasta ? 1 : 0);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Auditoría" }]}
        title="Auditoría"
        description="Quién hizo qué y cuándo en la farmacia. El registro es de solo lectura."
      />

      <section aria-label="Filtros" className="mb-4">
        <div className="filter-bar">
          <div className="min-w-0 flex-1 md:w-72 md:flex-none">
            <FiltroOpciones
              id="auditoria-usuario"
              label="Usuario"
              placeholder="Filtrar por usuario"
              opciones={opcionesUsuario}
              param="usuarioId"
              href={filtersHref()}
              valor={usuarioId}
              resetParams={["cursor"]}
            />
          </div>
          <FilterForm className="flex flex-wrap items-end gap-3" aria-label="Filtros de auditoría" hasActiveFilters={false}>
            {/* The usuario is chosen in the autocomplete; this keeps it while the other filters change. */}
            <input type="hidden" name="usuarioId" value={usuarioId ?? ""} />
            <div className="field">
              <label htmlFor="accion" className="sr-only">
                Acción
              </label>
              <select id="accion" name="accion" defaultValue={accion ?? ""} className="input">
                <option value="">Todas las acciones</option>
                {ACCION_VALUES.map((codigo) => (
                  <option key={codigo} value={codigo}>
                    {ACCION_LABELS[codigo] ?? codigo}
                  </option>
                ))}
              </select>
            </div>
            <FilterDrawer activeCount={masFiltros}>
              <FilterPopover label="Más filtros" activeCount={masFiltros}>
                <div className="field">
                  <label htmlFor="entidad" className="field-label">
                    Entidad
                  </label>
                  <select id="entidad" name="entidad" defaultValue={entidad ?? ""} className="input">
                    <option value="">Todas</option>
                    {ENTIDAD_VALUES.map((codigo) => (
                      <option key={codigo} value={codigo}>
                        {etiquetaEntidad(codigo)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="entidadId" className="field-label">
                    ID de entidad
                  </label>
                  <input id="entidadId" name="entidadId" type="text" defaultValue={params.entidadId ?? ""} placeholder="UUID" className="input font-mono" />
                </div>
                <div className="field">
                  <span id="fechas-label" className="field-label">
                    Fecha
                  </span>
                  <div className="range-field" role="group" aria-labelledby="fechas-label">
                    <label htmlFor="desde" className="sr-only">
                      Desde
                    </label>
                    <DateInput id="desde" name="desde" defaultValue={params.desde ?? ""} />
                    <span className="range-field-sep" aria-hidden>
                      a
                    </span>
                    <label htmlFor="hasta" className="sr-only">
                      Hasta
                    </label>
                    <DateInput id="hasta" name="hasta" defaultValue={params.hasta ?? ""} />
                  </div>
                </div>
              </FilterPopover>
            </FilterDrawer>
          </FilterForm>
        </div>

        {chips.length > 0 ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}: <strong>{chip.value}</strong>
                <Link href={filtersHref({ [chip.key]: "" })} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length + (usuarioElegido ? 1 : 0) > 1 ? (
              <Link href="/auditoria" scroll={false} className="btn btn-ghost btn-sm">
                Limpiar filtros
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {rangoInvalido ? (
        <p role="alert" className="alert alert-danger mb-4">
          <CircleAlert aria-hidden />
          <span>La fecha «Desde» no puede ser posterior a la fecha «Hasta».</span>
        </p>
      ) : null}

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <div className="list-panel">
          <div className="list-toolbar">
            <p role="status">
              {cursor ? "Registros anteriores" : "Registros más recientes"}
              <span className="text-zinc-500"> · de a {PAGE_SIZE}</span>
            </p>
            {cursor ? (
              <Link href={filtersHref()} className="btn btn-ghost btn-sm">
                Volver a los más recientes
              </Link>
            ) : null}
          </div>

          {result.items.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún registro coincide con los filtros aplicados."
                action={
                  <Link href="/auditoria" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<ScrollText className="size-5" />} title="Todavía no hay registros de auditoría" />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Fecha
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Qué pasó
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Cambios
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((registro) => {
                    const actor = `${registro.usuario.nombre} ${registro.usuario.apellido}`;
                    return (
                      <tr key={registro.id} className="align-top">
                        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs tabular-nums text-zinc-600">{formatearFechaHora(registro.ocurridoEn, result.zonaHoraria)}</td>
                        <td className="min-w-[16rem] px-3 py-3">
                          <div className="flex gap-2.5">
                            <Avatar name={actor} />
                            <div className="min-w-0">
                              <p className="font-medium text-zinc-900">{describirRegistro(actor, registro.accion, registro.entidad)}</p>
                              <p className="mt-1">
                                <ToneBadge tone={tonoAccion(registro.accion)}>{ACCION_LABELS[registro.accion] ?? registro.accion}</ToneBadge>
                              </p>
                              {registro.motivo ? (
                                <p className="mt-1.5 text-[0.8125rem]">
                                  <span className="text-zinc-500">Motivo:</span> {registro.motivo}
                                </p>
                              ) : null}
                              {registro.autorizadoPor ? (
                                <p className="mt-1 text-[0.8125rem]">
                                  <span className="text-zinc-500">Autorizó:</span> {registro.autorizadoPor.nombre} {registro.autorizadoPor.apellido}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="min-w-[20rem] px-3 py-3">
                          <AuditoriaDiff
                            entidad={registro.entidad}
                            entidadId={registro.entidadId}
                            valorAnterior={registro.valorAnterior}
                            valorNuevo={registro.valorNuevo}
                            zonaHoraria={result.zonaHoraria}
                            ip={registro.ip}
                            contexto={registro.contexto}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {result.nextCursor ? (
            <div className="flex justify-center border-t border-zinc-100 px-4 py-3">
              <Link href={loadMoreHref(result.nextCursor)} className="btn btn-secondary btn-sm">
                Ver registros anteriores
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
