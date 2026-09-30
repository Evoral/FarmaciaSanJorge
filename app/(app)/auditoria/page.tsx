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
 * exactly as Next.js RSC search params intend -- no client component
 * needed for this screen.
 */
import Link from "next/link";
import { TipoAccion } from "@/generated/prisma/enums";
import { listRegistroAuditoria } from "@/modules/auditoria/application/list-registro-auditoria";
import { listUsuariosParaFiltro } from "@/modules/auditoria/application/list-usuarios-para-filtro";
import { AuditoriaDiff } from "@/modules/auditoria/ui/auditoria-diff";
import { ACCION_LABELS, ENTIDADES, describirRegistro, etiquetaEntidad, formatearFechaHora } from "@/modules/auditoria/domain/presentacion";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";

const PAGE_SIZE = 50;

const ACCION_VALUES = Object.values(TipoAccion);
const ENTIDAD_VALUES = Object.keys(ENTIDADES).sort((a, b) => etiquetaEntidad(a).localeCompare(etiquetaEntidad(b), "es"));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

  const hasFilters = Boolean(entidad || entidadId || usuarioId || accion || desde || hasta);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Auditoría</h1>

      <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de auditoría" hasActiveFilters={hasFilters || Boolean(params.entidadId)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="entidad" className="text-sm font-medium">
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

        <div className="flex flex-col gap-1">
          <label htmlFor="entidadId" className="text-sm font-medium">
            ID de entidad
          </label>
          <input
            id="entidadId"
            name="entidadId"
            type="text"
            defaultValue={params.entidadId ?? ""}
            placeholder="UUID"
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="usuarioId" className="text-sm font-medium">
            Usuario
          </label>
          <select
            id="usuarioId"
            name="usuarioId"
            defaultValue={usuarioId ?? ""}
            className="input"
          >
            <option value="">Todos</option>
            {usuariosFiltro.map((usuario) => (
              <option key={usuario.id} value={usuario.id}>
                {usuario.apellido}, {usuario.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="accion" className="text-sm font-medium">
            Acción
          </label>
          <select
            id="accion"
            name="accion"
            defaultValue={accion ?? ""}
            className="input"
          >
            <option value="">Todas</option>
            {ACCION_VALUES.map((codigo) => (
              <option key={codigo} value={codigo}>
                {ACCION_LABELS[codigo] ?? codigo}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className="text-sm font-medium">
            Desde
          </label>
          <DateInput
            id="desde"
            name="desde"
            defaultValue={params.desde ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Hasta
          </label>
          <DateInput
            id="hasta"
            name="hasta"
            defaultValue={params.hasta ?? ""}
          />
        </div>

      </FilterForm>

      {rangoInvalido ? (
        <p role="alert" className="mb-4 text-sm text-red-600">
          La fecha &quot;Desde&quot; no puede ser posterior a la fecha &quot;Hasta&quot;.
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Fecha
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Qué pasó
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Cambios
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron registros con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((registro) => (
                <tr key={registro.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900">
                  <td className="whitespace-nowrap px-3 py-2">{formatearFechaHora(registro.ocurridoEn, result.zonaHoraria)}</td>
                  <td className="min-w-[16rem] px-3 py-2">
                    <p className="font-medium">
                      {describirRegistro(`${registro.usuario.nombre} ${registro.usuario.apellido}`, registro.accion, registro.entidad)}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{ACCION_LABELS[registro.accion] ?? registro.accion}</p>
                    {registro.motivo ? (
                      <p className="mt-1 text-sm">
                        <span className="text-zinc-500 dark:text-zinc-400">Motivo:</span> {registro.motivo}
                      </p>
                    ) : null}
                    {registro.autorizadoPor ? (
                      <p className="mt-1 text-sm">
                        <span className="text-zinc-500 dark:text-zinc-400">Autorizó:</span> {registro.autorizadoPor.nombre}{" "}
                        {registro.autorizadoPor.apellido}
                      </p>
                    ) : null}
                  </td>
                  <td className="min-w-[20rem] px-3 py-2">
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {result.nextCursor ? (
        <div className="mt-4">
          <Link href={loadMoreHref(result.nextCursor)} className="btn btn-secondary">
            Cargar más
          </Link>
        </div>
      ) : null}
    </div>
  );
}
