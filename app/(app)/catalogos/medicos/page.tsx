/**
 * `/catalogos/medicos` (M06, FASE 4 point 4.4). Search + vigente/baja filter, plain GET query params (médicos are NOT
 * health data -- no DP-24 URL restriction). The search is an autocomplete (suggestions open the médico; its last row
 * filters the list by the typed text).
 */
import Link from "next/link";
import { ChevronRight, Plus, SearchX, Stethoscope, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listMedicos } from "@/modules/medicos/application/list-medicos";
import { MedicoForm } from "@/modules/medicos/ui/medico-form";
import { buscarMedicosCatalogoAction } from "@/modules/medicos/ui/buscar-medicos-catalogo-action";
import { formatMatricula } from "@/modules/medicos/domain/medico";
import { FilterForm } from "@/shared/ui/filter-form";
import { BuscadorNavegable } from "@/shared/ui/buscador-navegable";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

interface MedicosPageProps {
  searchParams: Promise<{ q?: string; estado?: string; page?: string; nuevo?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function MedicosPage({ searchParams }: MedicosPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const soloVigentes = params.estado === "baja" ? false : params.estado === "vigente" ? true : undefined;

  const result = await listMedicos({ search: params.q, soloVigentes, page, pageSize: PAGE_SIZE });
  const puedeCrear = can(session, "medicos.gestionar");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `/catalogos/medicos?${qs.toString()}`;
  }

  function sinFiltroHref(param: "q" | "estado"): string {
    const qs = new URLSearchParams();
    if (params.q && param !== "q") qs.set("q", params.q);
    if (params.estado && param !== "estado") qs.set("estado", params.estado);
    const query = qs.toString();
    return query ? `/catalogos/medicos?${query}` : "/catalogos/medicos";
  }

  const chips: { key: "q" | "estado"; label: string; value?: string }[] = [];
  if (params.q) chips.push({ key: "q", label: "Búsqueda", value: params.q });
  if (params.estado === "vigente" || params.estado === "baja") chips.push({ key: "estado", label: params.estado === "vigente" ? "Vigentes" : "Dados de baja" });
  const hayFiltros = chips.length > 0;

  return (
    <>
      <PageHeader
        title="Médicos"
        description="Prescriptores con su matrícula y jurisdicción."
        actions={
          puedeCrear ? (
            <Link href="/catalogos/medicos?nuevo=1" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nuevo médico
            </Link>
          ) : null
        }
      />

      {puedeCrear && params.nuevo ? (
        <section className="panel mb-6 max-w-3xl" aria-labelledby="nuevo-medico-heading">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 id="nuevo-medico-heading">Nuevo médico</h2>
            <Link href="/catalogos/medicos" className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de médico">
              <X className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="panel-body">
            <MedicoForm mode="crear" disabled={!puedeCrear} />
          </div>
        </section>
      ) : null}

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de búsqueda de médicos" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="q" value={params.q ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <BuscadorNavegable
              id="q-buscar"
              label="Buscar médico"
              placeholder="Buscar por apellido o matrícula"
              buscar={buscarMedicosCatalogoAction}
              detalleHref="/catalogos/medicos/{id}"
              listaHref={sinFiltroHref("q")}
              busquedaActual={params.q}
              textoVerTodos="Ver todos los médicos"
            />
          </div>
          <div className="field">
            <label htmlFor="estado" className="sr-only">
              Estado
            </label>
            <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
              <option value="">Todos los estados</option>
              <option value="vigente">Vigentes</option>
              <option value="baja">Dados de baja</option>
            </select>
          </div>
        </FilterForm>

        {hayFiltros ? (
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
                <Link href={sinFiltroHref(chip.key)} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href="/catalogos/medicos" scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "médico" : "médicos"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ningún médico coincide con los filtros aplicados."
                action={
                  <Link href="/catalogos/medicos" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<Stethoscope className="size-5" />} title="Todavía no hay médicos" description="También se pueden crear desde la carga de una receta." />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Apellido y nombre
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Matrícula
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Especialidad
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Estado
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((medico) => (
                    <tr key={medico.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`/catalogos/medicos/${medico.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                          {medico.apellido}, {medico.nombre}
                        </Link>
                        {medico.especialidad ? <span className="block text-xs text-zinc-500 md:hidden">{medico.especialidad}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono">{formatMatricula(medico.matriculaJurisdiccion, medico.matricula)}</td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {medico.especialidad ?? (
                          <span className="text-zinc-400">
                            -<span className="sr-only">Sin especialidad</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={medico.fechaBaja ? "neutral" : "success"}>{medico.fechaBaja ? "Baja" : "Vigente"}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/catalogos/medicos/${medico.id}`} aria-label={`Ver ${medico.apellido}, ${medico.nombre}`} className="btn btn-ghost btn-sm btn-icon">
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de médicos" />
        </div>
      </div>
    </>
  );
}
