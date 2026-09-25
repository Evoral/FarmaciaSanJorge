/**
 * `/admin/usuarios` (M03, FASE 3 point 3.1). Server component: search,
 * estado/rol filters and pagination are all plain GET query params (a
 * native `<form method="get">`, no client JS needed) so the list is
 * bookmarkable, back-button-friendly, and works with JS disabled --
 * appropriate density/accessibility priorities for an internal tool (see
 * this task's frontend-design guidance).
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listUsuarios } from "@/modules/usuarios/application/list-usuarios";
import { ROLES_ASIGNABLES, ROL_LABELS } from "@/modules/usuarios/domain/roles";

const ESTADOS = ["PENDIENTE_ACTIVACION", "ACTIVO", "SUSPENDIDO", "BAJA"] as const;
type EstadoFiltro = (typeof ESTADOS)[number];

const ESTADO_LABELS: Record<EstadoFiltro, string> = {
  PENDIENTE_ACTIVACION: "Pendiente de activación",
  ACTIVO: "Activo",
  SUSPENDIDO: "Suspendido",
  BAJA: "Baja",
};

const PAGE_SIZE = 20;

interface UsuariosPageProps {
  searchParams: Promise<{ q?: string; estado?: string; rol?: string; page?: string }>;
}

export default async function UsuariosPage({ searchParams }: UsuariosPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const estado = params.estado && (ESTADOS as readonly string[]).includes(params.estado) ? (params.estado as EstadoFiltro) : undefined;
  const rol = params.rol && (ROLES_ASIGNABLES as readonly string[]).includes(params.rol) ? (params.rol as (typeof ROLES_ASIGNABLES)[number]) : undefined;

  const result = await listUsuarios({ search: params.q, estado, rolCodigo: rol, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (estado) qs.set("estado", estado);
    if (rol) qs.set("rol", rol);
    qs.set("page", String(targetPage));
    return `/admin/usuarios?${qs.toString()}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usuarios</h1>
        {can(session, "usuarios.crear") ? (
          <Link href="/admin/usuarios/nuevo" className="btn btn-primary">
            Nuevo usuario
          </Link>
        ) : null}
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de búsqueda de usuarios">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={params.q ?? ""}
            placeholder="Nombre, apellido, email o DNI"
            className="input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={estado ?? ""} className="input">
            <option value="">Todos</option>
            {Object.entries(ESTADO_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="rol" className="text-sm font-medium">
            Rol
          </label>
          <select id="rol" name="rol" defaultValue={rol ?? ""} className="input">
            <option value="">Todos</option>
            {ROLES_ASIGNABLES.map((codigo) => (
              <option key={codigo} value={codigo}>
                {ROL_LABELS[codigo]}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
        {(params.q || estado || rol) ? (
          <Link href="/admin/usuarios" className="text-sm underline">
            Limpiar filtros
          </Link>
        ) : null}
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} usuario{result.total === 1 ? "" : "s"} encontrado{result.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nombre</th>
              <th scope="col" className="px-3 py-2 font-medium">Email</th>
              <th scope="col" className="px-3 py-2 font-medium">DNI</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
              <th scope="col" className="px-3 py-2 font-medium">Roles</th>
              <th scope="col" className="px-3 py-2 font-medium">Último acceso</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron usuarios con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((usuario) => (
                <tr key={usuario.id}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/usuarios/${usuario.id}`} className="font-medium underline-offset-2 hover:underline">
                      {usuario.apellido}, {usuario.nombre}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{usuario.email}</td>
                  <td className="px-3 py-2">{usuario.dni}</td>
                  <td className="px-3 py-2">{ESTADO_LABELS[usuario.estado] ?? usuario.estado}</td>
                  <td className="px-3 py-2">
                    {usuario.roles.map((codigo) => ROL_LABELS[codigo as keyof typeof ROL_LABELS] ?? codigo).join(", ")}
                  </td>
                  <td className="px-3 py-2">{usuario.ultimoAcceso ? new Date(usuario.ultimoAcceso).toLocaleString("es-AR") : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de usuarios" className="mt-4 flex items-center gap-2 text-sm">
          <Link
            href={pageHref(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Anterior
          </Link>
          <span>
            Página {page} de {totalPages}
          </span>
          <Link
            href={pageHref(Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
