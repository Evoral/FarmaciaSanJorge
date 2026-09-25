/**
 * `/admin/unidades` (M05, FASE 4 point 4.1). GLOBAL catalog (DP-39): the
 * list is the same for every tenant. Search + tipoMagnitud + vigente/baja
 * filters, plain GET query params (same bookmarkable/no-JS pattern as
 * app/(app)/admin/usuarios/page.tsx).
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listUnidades } from "@/modules/unidades/application/list-unidades";
import { TIPOS_MAGNITUD, TIPO_MAGNITUD_LABELS, esTipoMagnitud } from "@/modules/unidades/domain/unidad";
import { UnidadForm } from "@/modules/unidades/ui/unidad-form";

const PAGE_SIZE = 20;

interface UnidadesPageProps {
  searchParams: Promise<{ q?: string; magnitud?: string; estado?: string; page?: string; nueva?: string }>;
}

export default async function UnidadesPage({ searchParams }: UnidadesPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const tipoMagnitud = params.magnitud && esTipoMagnitud(params.magnitud) ? params.magnitud : undefined;
  const soloVigentes = params.estado === "baja" ? false : params.estado === "vigente" ? true : undefined;

  const result = await listUnidades({ search: params.q, tipoMagnitud, soloVigentes, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeCrear = can(session, "unidades.crear");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (tipoMagnitud) qs.set("magnitud", tipoMagnitud);
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `/admin/unidades?${qs.toString()}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Unidades de medida</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Catálogo global: compartido por todas las farmacias.</p>
        </div>
        {puedeCrear ? (
          <Link href="/admin/unidades?nueva=1" className="btn btn-primary">
            Nueva unidad
          </Link>
        ) : null}
      </div>

      {puedeCrear && params.nueva ? (
        <div className="mb-6">
          <UnidadForm mode="crear" disabled={!puedeCrear} />
        </div>
      ) : null}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de búsqueda de unidades">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar
          </label>
          <input id="q" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Código, nombre o símbolo" className="input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="magnitud" className="text-sm font-medium">
            Magnitud
          </label>
          <select id="magnitud" name="magnitud" defaultValue={tipoMagnitud ?? ""} className="input">
            <option value="">Todas</option>
            {TIPOS_MAGNITUD.map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_MAGNITUD_LABELS[tipo]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
            <option value="">Todas</option>
            <option value="vigente">Vigentes</option>
            <option value="baja">Dadas de baja</option>
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
        {params.q || tipoMagnitud || params.estado ? (
          <Link href="/admin/unidades" className="text-sm underline">
            Limpiar filtros
          </Link>
        ) : null}
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} unidad{result.total === 1 ? "" : "es"} encontrada{result.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Código</th>
              <th scope="col" className="px-3 py-2 font-medium">Nombre</th>
              <th scope="col" className="px-3 py-2 font-medium">Símbolo</th>
              <th scope="col" className="px-3 py-2 font-medium">Magnitud</th>
              <th scope="col" className="px-3 py-2 font-medium">Factor</th>
              <th scope="col" className="px-3 py-2 font-medium">Base</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron unidades con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((unidad) => (
                <tr key={unidad.id}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/unidades/${unidad.id}`} className="font-medium underline-offset-2 hover:underline">
                      {unidad.codigo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{unidad.nombre}</td>
                  <td className="px-3 py-2">{unidad.simbolo}</td>
                  <td className="px-3 py-2">{TIPO_MAGNITUD_LABELS[unidad.tipoMagnitud as keyof typeof TIPO_MAGNITUD_LABELS] ?? unidad.tipoMagnitud}</td>
                  <td className="px-3 py-2">{unidad.factorABase}</td>
                  <td className="px-3 py-2">{unidad.esBase ? "Sí" : "—"}</td>
                  <td className="px-3 py-2">{unidad.fechaBaja ? "Baja" : "Vigente"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de unidades" className="mt-4 flex items-center gap-2 text-sm">
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
