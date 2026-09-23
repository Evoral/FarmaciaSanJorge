/**
 * `/catalogos/drogas` (M06, FASE 4 point 4.2). Search + soloControladas +
 * bajoMinimo + vigente/baja filters, plain GET query params (same pattern
 * as app/(app)/admin/usuarios/page.tsx). Stock shown from
 * `fsj.v_stock_droga` (INV-S01: never a stored column).
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDrogas } from "@/modules/drogas/application/list-drogas";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { TIPO_CONTROL_LABELS } from "@/modules/drogas/domain/droga";
import { DrogaForm } from "@/modules/drogas/ui/droga-form";

const PAGE_SIZE = 20;

interface DrogasPageProps {
  searchParams: Promise<{ q?: string; controladas?: string; bajoMinimo?: string; estado?: string; page?: string; nueva?: string }>;
}

export default async function DrogasPage({ searchParams }: DrogasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const soloControladas = params.controladas === "1" ? true : undefined;
  const bajoMinimo = params.bajoMinimo === "1" ? true : undefined;
  const soloVigentes = params.estado === "baja" ? false : params.estado === "vigente" ? true : undefined;

  const result = await listDrogas({ search: params.q, soloControladas, bajoMinimo, soloVigentes, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeCrear = can(session, "drogas.crear");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (soloControladas) qs.set("controladas", "1");
    if (bajoMinimo) qs.set("bajoMinimo", "1");
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `/catalogos/drogas?${qs.toString()}`;
  }

  const unidades = puedeCrear && params.nueva ? await listUnidadesVigentesParaDroga() : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Drogas</h1>
        {puedeCrear ? (
          <Link href="/catalogos/drogas?nueva=1" className="rounded bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
            Nueva droga
          </Link>
        ) : null}
      </div>

      {puedeCrear && params.nueva ? (
        <div className="mb-6">
          <DrogaForm mode="crear" unidades={unidades} disabled={!puedeCrear} />
        </div>
      ) : null}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtros de búsqueda de drogas">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar
          </label>
          <input id="q" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Nombre" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todas</option>
            <option value="vigente">Vigentes</option>
            <option value="baja">Dadas de baja</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="controladas" value="1" defaultChecked={soloControladas} />
          Solo controladas
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="bajoMinimo" value="1" defaultChecked={bajoMinimo} />
          Bajo mínimo
        </label>
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Filtrar
        </button>
        {params.q || soloControladas || bajoMinimo || params.estado ? (
          <Link href="/catalogos/drogas" className="text-sm underline">
            Limpiar filtros
          </Link>
        ) : null}
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} droga{result.total === 1 ? "" : "s"} encontrada{result.total === 1 ? "" : "s"}.
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nombre</th>
              <th scope="col" className="px-3 py-2 font-medium">Unidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Control</th>
              <th scope="col" className="px-3 py-2 font-medium">Stock disponible</th>
              <th scope="col" className="px-3 py-2 font-medium">Stock mínimo</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron drogas con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((droga) => {
                const bajoElMinimo = Number(droga.stockDisponible) < Number(droga.stockMinimo);
                return (
                  <tr key={droga.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="px-3 py-2">
                      <Link href={`/catalogos/drogas/${droga.id}`} className="font-medium underline-offset-2 hover:underline">
                        {droga.nombre}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{droga.unidadBaseSimbolo}</td>
                    <td className="px-3 py-2">{TIPO_CONTROL_LABELS[droga.tipoControl as keyof typeof TIPO_CONTROL_LABELS] ?? droga.tipoControl}</td>
                    <td className={`px-3 py-2 ${bajoElMinimo ? "font-medium text-red-600 dark:text-red-400" : ""}`}>{droga.stockDisponible}</td>
                    <td className="px-3 py-2">{droga.stockMinimo}</td>
                    <td className="px-3 py-2">{droga.fechaBaja ? "Baja" : "Vigente"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de drogas" className="mt-4 flex items-center gap-2 text-sm">
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
