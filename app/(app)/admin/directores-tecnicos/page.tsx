/**
 * `/admin/directores-tecnicos` (M04, FASE 3 point 3.9). Server component:
 * "DT vigente hoy" banner, then the list of designations (current +
 * historical, filterable), each vigente row offering an inline cese form.
 * Filter/pagination are plain GET query params (native `<form
 * method="get">`), same density/accessibility priorities as
 * `/admin/usuarios` (see that page's module doc comment).
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDesignaciones } from "@/modules/directores-tecnicos/application/list-designaciones";
import { dtVigenteHoy } from "@/modules/directores-tecnicos/application/dt-vigente-hoy";
import { CARACTER_LABELS } from "@/modules/directores-tecnicos/domain/designacion";
import { CeseForm } from "./cese-form";

const PAGE_SIZE = 20;

type VigenciaFiltro = "todas" | "vigentes" | "historicas";

interface DirectoresTecnicosPageProps {
  searchParams: Promise<{ vigencia?: string; page?: string }>;
}

function formatFecha(value: Date): string {
  return new Date(value).toLocaleDateString("es-AR");
}

export default async function DirectoresTecnicosPage({ searchParams }: DirectoresTecnicosPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const vigencia: VigenciaFiltro = params.vigencia === "vigentes" || params.vigencia === "historicas" ? params.vigencia : "todas";
  const soloVigentes = vigencia === "vigentes" ? true : vigencia === "historicas" ? false : undefined;

  const puedeDesignar = can(session, "dt.designar");
  const puedeCesar = can(session, "dt.cesar");

  const [vigenteHoy, listado] = await Promise.all([
    dtVigenteHoy(),
    listDesignaciones({ soloVigentes, page, pageSize: PAGE_SIZE }),
  ]);
  const totalPages = Math.max(1, Math.ceil(listado.total / PAGE_SIZE));

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (vigencia !== "todas") qs.set("vigencia", vigencia);
    qs.set("page", String(targetPage));
    return `/admin/directores-tecnicos?${qs.toString()}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Directores técnicos</h1>
        {puedeDesignar ? (
          <Link href="/admin/directores-tecnicos/nuevo" className="btn btn-primary">
            Nueva designación
          </Link>
        ) : null}
      </div>

      <section className="mb-6 card p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">DT vigente hoy</h2>
        {vigenteHoy.titular ? (
          <p className="text-sm">
            <span className="font-medium">Titular:</span> {vigenteHoy.titular.usuarioApellido}, {vigenteHoy.titular.usuarioNombre} — matrícula{" "}
            {vigenteHoy.titular.matricula}
          </p>
        ) : (
          <p className="text-sm text-red-600 dark:text-red-400">No hay un Director Técnico TITULAR vigente hoy.</p>
        )}
        {vigenteHoy.suplentes.length > 0 ? (
          <p className="mt-1 text-sm">
            <span className="font-medium">Suplente{vigenteHoy.suplentes.length > 1 ? "s" : ""}:</span>{" "}
            {vigenteHoy.suplentes.map((s) => `${s.usuarioApellido}, ${s.usuarioNombre} (${s.matricula})`).join(" · ")}
          </p>
        ) : null}
      </section>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtro de designaciones">
        <div className="flex flex-col gap-1">
          <label htmlFor="vigencia" className="text-sm font-medium">
            Estado
          </label>
          <select id="vigencia" name="vigencia" defaultValue={vigencia} className="input">
            <option value="todas">Todas</option>
            <option value="vigentes">Vigentes (sin cese)</option>
            <option value="historicas">Históricas (con cese)</option>
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
      </form>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {listado.total} designación{listado.total === 1 ? "" : "es"} encontrada{listado.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Usuario</th>
              <th scope="col" className="px-3 py-2 font-medium">Carácter</th>
              <th scope="col" className="px-3 py-2 font-medium">Matrícula</th>
              <th scope="col" className="px-3 py-2 font-medium">Vigente desde</th>
              <th scope="col" className="px-3 py-2 font-medium">Vigente hasta</th>
              <th scope="col" className="px-3 py-2 font-medium">Motivo de cese</th>
              {puedeCesar ? <th scope="col" className="px-3 py-2 font-medium">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {listado.items.length === 0 ? (
              <tr>
                <td colSpan={puedeCesar ? 7 : 6} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron designaciones con estos filtros.
                </td>
              </tr>
            ) : (
              listado.items.map((designacion) => (
                <tr key={designacion.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">
                    {designacion.usuarioApellido}, {designacion.usuarioNombre}
                  </td>
                  <td className="px-3 py-2">{CARACTER_LABELS[designacion.caracter]}</td>
                  <td className="px-3 py-2">{designacion.matricula}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatFecha(designacion.vigenteDesde)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{designacion.vigenteHasta ? formatFecha(designacion.vigenteHasta) : "—"}</td>
                  <td className="px-3 py-2">{designacion.motivoCese ?? "—"}</td>
                  {puedeCesar ? (
                    <td className="px-3 py-2">
                      {designacion.vigenteHasta === null ? <CeseForm designacionId={designacion.id} /> : <span className="text-zinc-500">Ya cesada</span>}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {vigencia === "vigentes" || vigencia === "todas" ? (
        <p className="mt-3 text-xs text-zinc-500">
          Nota: la superposición de designaciones SUPLENTE no está restringida (DP-11 pendiente de definición) -- pueden existir varias vigentes al
          mismo tiempo.
        </p>
      ) : null}

      {totalPages > 1 ? (
        <nav aria-label="Paginación de designaciones" className="mt-4 flex items-center gap-2 text-sm">
          <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}>
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
