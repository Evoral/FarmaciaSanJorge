/**
 * `/pacientes` (M06, FASE 4 point 4.5). HEALTH-ADJACENT DATA
 * (DP-24, Ley 25.326): unlike proveedores/medicos, this page's GET
 * `searchParams` ONLY ever reads `estado` ("vigente"/"baja"/"todos", not
 * identifying), `page` (a plain integer) and `nuevo` (a flag) -- there is
 * DELIBERATELY no `q` GET param here. The identifying search term
 * (apellido or DNI) is handled entirely client-side by
 * `PacientesBuscador` (modules/pacientes/ui/pacientes-buscador.tsx), an
 * autocomplete that submits it as a POST'd Server Action call, never a
 * URL/query string -- see that file's doc comment for the full reasoning.
 * This page's own server-rendered listing (no search term) is what
 * `PacientesBuscador` starts from before anyone searches.
 */
import Link from "next/link";
import { Plus, Users, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listPacientes } from "@/modules/pacientes/application/list-pacientes";
import { PacienteForm } from "@/modules/pacientes/ui/paciente-form";
import { PacientesBuscador } from "@/modules/pacientes/ui/pacientes-buscador";
import { FilterForm } from "@/shared/ui/filter-form";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { PacientesTabs } from "./pacientes-tabs";

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
  const puedeCrear = can(session, "pacientes.gestionar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (estado) qs.set("estado", estado);
    qs.set("page", String(targetPage));
    return `/pacientes?${qs.toString()}`;
  }

  const etiquetaEstado = estado === "vigente" ? "Vigentes" : estado === "baja" ? "Dados de baja" : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Pacientes" }]}
        title="Pacientes"
        description="Datos de contacto de cada paciente y el recorrido de sus recetas."
        actions={
          puedeCrear ? (
            <Link href="/pacientes?nuevo=1" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nuevo paciente
            </Link>
          ) : null
        }
      />

      <PacientesTabs />

      {puedeCrear && params.nuevo ? (
        <section className="panel mb-6 max-w-3xl" aria-labelledby="nuevo-paciente-heading">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 id="nuevo-paciente-heading">Nuevo paciente</h2>
            <Link href="/pacientes" className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de paciente">
              <X className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="panel-body">
            <PacienteForm mode="crear" disabled={!puedeCrear} />
          </div>
        </section>
      ) : null}

      {/* Keyed by the GET filters: a new estado or page starts from that listing, not from a previous search. */}
      <PacientesBuscador
        key={`${estado}|${page}`}
        itemsIniciales={result.items}
        totalInicial={result.total}
        estado={estado}
        filtros={
          <FilterForm aria-label="Filtro de estado de pacientes" hasActiveFilters={false}>
            <div className="field">
              <label htmlFor="estado" className="sr-only">
                Estado
              </label>
              <select id="estado" name="estado" defaultValue={estado} className="input">
                <option value="">Todos los estados</option>
                <option value="vigente">Vigentes</option>
                <option value="baja">Dados de baja</option>
              </select>
            </div>
          </FilterForm>
        }
        filtrosActivos={
          etiquetaEstado ? (
            <div className="filter-chips" role="group" aria-label="Filtros activos">
              <span className="chip">
                <strong>{etiquetaEstado}</strong>
                <Link href="/pacientes" scroll={false} className="chip-remove" aria-label={`Quitar filtro ${etiquetaEstado}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            </div>
          ) : null
        }
        vacio={
          etiquetaEstado ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="Sin pacientes en este estado"
              action={
                <Link href="/pacientes" scroll={false} className="btn btn-secondary">
                  Ver todos
                </Link>
              }
            />
          ) : (
            <EmptyState icon={<Users className="size-5" />} title="Todavía no hay pacientes" description="También se pueden crear desde la carga de una receta." />
          )
        }
        paginacion={<Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de pacientes" />}
      />
    </>
  );
}
