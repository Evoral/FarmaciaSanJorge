/**
 * `/catalogos/pacientes` (M06, FASE 4 point 4.5). HEALTH-ADJACENT DATA
 * (DP-24, Ley 25.326): unlike proveedores/medicos, this page's GET
 * `searchParams` ONLY ever reads `estado` ("vigente"/"baja"/"todos", not
 * identifying), `page` (a plain integer) and `nuevo` (a flag) -- there is
 * DELIBERATELY no `q` GET param here. The identifying search term
 * (apellido or DNI) is handled entirely client-side by
 * `PacientesBuscador` (modules/pacientes/ui/pacientes-buscador.tsx), which
 * submits it as a POST'd Server Action call, never a URL/query string --
 * see that file's doc comment for the full reasoning. This page's own
 * server-rendered listing (no search term) is what `PacientesBuscador`
 * starts from before anyone searches.
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listPacientes } from "@/modules/pacientes/application/list-pacientes";
import { PacienteForm } from "@/modules/pacientes/ui/paciente-form";
import { PacientesBuscador } from "@/modules/pacientes/ui/pacientes-buscador";

const PAGE_SIZE = 20;

interface PacientesPageProps {
  searchParams: Promise<{ estado?: string; page?: string; nuevo?: string }>;
}

export default async function PacientesPage({ searchParams }: PacientesPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const estado = params.estado ?? "";

  const soloVigentes = estado === "baja" ? false : estado === "vigente" ? true : undefined;

  const result = await listPacientes({ soloVigentes, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const puedeCrear = can(session, "pacientes.gestionar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (estado) qs.set("estado", estado);
    qs.set("page", String(targetPage));
    return `/catalogos/pacientes?${qs.toString()}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        {puedeCrear ? (
          <Link href="/catalogos/pacientes?nuevo=1" className="btn btn-primary">
            Nuevo paciente
          </Link>
        ) : null}
      </div>

      {puedeCrear && params.nuevo ? (
        <div className="mb-6">
          <PacienteForm mode="crear" disabled={!puedeCrear} />
        </div>
      ) : null}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtro de estado de pacientes">
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-medium">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={estado} className="input">
            <option value="">Todos</option>
            <option value="vigente">Vigentes</option>
            <option value="baja">Dados de baja</option>
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          Filtrar
        </button>
        {estado ? (
          <Link href="/catalogos/pacientes" className="text-sm underline">
            Limpiar filtro
          </Link>
        ) : null}
      </form>

      <PacientesBuscador itemsIniciales={result.items} totalInicial={result.total} estado={estado} />

      {totalPages > 1 ? (
        <nav aria-label="Paginación de pacientes" className="mt-4 flex items-center gap-2 text-sm">
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
