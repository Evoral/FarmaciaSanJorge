/**
 * `/auditoria` (M03, FASE 3 point 3.11). READ-ONLY, tenant-scoped audit log
 * viewer over `fsj.registro_auditoria`. Server component: filters are
 * plain GET query params (a native `<form method="get">`, no client JS
 * needed) -- same convention as `/admin/usuarios`
 * (app/(app)/admin/usuarios/page.tsx). Pagination is CURSOR-based
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

const PAGE_SIZE = 50;

const ACCION_VALUES = Object.values(TipoAccion);

/** Neutral, professional Spanish labels (UI copy) -- no established mapping exists elsewhere for TipoAccion, this is local to the auditoria screen. */
const ACCION_LABELS: Record<string, string> = {
  CREAR: "Creación",
  MODIFICAR: "Modificación",
  BAJA: "Baja",
  REACTIVAR: "Reactivación",
  ANULAR: "Anulación",
  AUTORIZAR: "Autorización",
  FIRMAR: "Firma",
  CONFIRMAR: "Confirmación",
  DESCARTAR: "Descarte",
  CAMBIAR_ESTADO: "Cambio de estado",
  ASIGNAR_ROL: "Asignación de rol",
  QUITAR_ROL: "Quitar rol",
  SUSPENDER: "Suspensión",
  RESTABLECER_CREDENCIAL: "Restablecimiento de credencial",
  ACTIVAR_CUENTA: "Activación de cuenta",
  LOGIN_FALLIDO_BLOQUEO: "Bloqueo por intentos fallidos",
  CORREGIR_FOLIO: "Corrección de folio",
  INUTILIZAR_FOJAS: "Inutilización de fojas",
  DESTRUIR: "Destrucción",
  IMPRIMIR_CIERRE: "Impresión de cierre",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const entidad = params.entidad?.trim() || undefined;
  const entidadId = params.entidadId && UUID_PATTERN.test(params.entidadId) ? params.entidadId : undefined;
  const usuarioId = params.usuarioId && UUID_PATTERN.test(params.usuarioId) ? params.usuarioId : undefined;
  const accion = params.accion && (ACCION_VALUES as readonly string[]).includes(params.accion) ? (params.accion as TipoAccion) : undefined;
  const desde = params.desde || undefined;
  const hasta = params.hasta || undefined;
  const cursor = params.cursor || undefined;

  const [result, usuariosFiltro] = await Promise.all([
    listRegistroAuditoria({ entidad, entidadId, usuarioId, accion, desde, hasta, cursor, pageSize: PAGE_SIZE }),
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
      <h1 className="mb-6 text-xl font-semibold">Auditoría</h1>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de auditoría">
        <div className="flex flex-col gap-1">
          <label htmlFor="entidad" className="text-sm font-medium">
            Entidad
          </label>
          <input
            id="entidad"
            name="entidad"
            type="text"
            defaultValue={params.entidad ?? ""}
            placeholder="usuario, receta, ..."
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
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
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
          <input
            id="desde"
            name="desde"
            type="date"
            defaultValue={params.desde ?? ""}
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Hasta
          </label>
          <input
            id="hasta"
            name="hasta"
            type="date"
            defaultValue={params.hasta ?? ""}
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filtrar
        </button>
        {hasFilters ? (
          <Link href="/auditoria" className="text-sm underline">
            Limpiar filtros
          </Link>
        ) : null}
      </form>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Fecha
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Usuario
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Entidad
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Acción
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Detalle
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron registros con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((registro) => (
                <tr key={registro.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900">
                  <td className="whitespace-nowrap px-3 py-2">{new Date(registro.ocurridoEn).toLocaleString("es-AR")}</td>
                  <td className="px-3 py-2">
                    {registro.usuario.apellido}, {registro.usuario.nombre}
                  </td>
                  <td className="px-3 py-2">
                    <div>{registro.entidad}</div>
                    <div className="text-xs text-zinc-500">{registro.entidadId}</div>
                  </td>
                  <td className="px-3 py-2">{ACCION_LABELS[registro.accion] ?? registro.accion}</td>
                  <td className="min-w-[20rem] px-3 py-2">
                    {registro.motivo ? <p className="mb-2 text-sm">{registro.motivo}</p> : null}
                    <AuditoriaDiff valorAnterior={registro.valorAnterior} valorNuevo={registro.valorNuevo} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {result.nextCursor ? (
        <div className="mt-4">
          <Link href={loadMoreHref(result.nextCursor)} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
            Cargar más
          </Link>
        </div>
      ) : null}
    </div>
  );
}
