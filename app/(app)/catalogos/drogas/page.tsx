/**
 * `/catalogos/drogas` (M06, FASE 4 point 4.2). Search + soloControladas +
 * bajoMinimo + vigente/baja filters, plain GET query params (same pattern
 * as app/(app)/admin/accesos/usuarios/page.tsx). Stock shown from
 * `fsj.v_stock_droga` (INV-S01: never a stored column).
 *
 * The search is an autocomplete (suggestions open the droga; its last row filters the list by the typed text).
 */
import Link from "next/link";
import { ChevronRight, FlaskConical, Plus, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listDrogas } from "@/modules/drogas/application/list-drogas";
import { listUnidadesVigentesParaDroga } from "@/modules/drogas/application/list-unidades-vigentes";
import { CLASES_DROGA, CLASE_DROGA_LABELS, TIPO_CONTROL_LABELS, type ClaseDroga } from "@/modules/drogas/domain/droga";
import { DrogaForm } from "@/modules/drogas/ui/droga-form";
import { buscarDrogasCatalogoAction } from "@/modules/drogas/ui/buscar-drogas-catalogo-action";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterMultiSelect } from "@/shared/ui/filter-multi-select";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { BuscadorNavegable } from "@/shared/ui/buscador-navegable";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidadesFila } from "@/shared/format/cantidad";
import { Decimal } from "@/shared/decimal";
import { Cantidad } from "@/shared/ui/cantidad";
import { PageHeader } from "@/shared/ui/page-header";
import { SectionTabs } from "../../section-tabs";
import { catalogosSections } from "../../nav-sections";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge } from "@/shared/ui/status-badge";

const PAGE_SIZE = 20;

type ParamDrogas = "q" | "clase" | "controladas" | "bajoMinimo" | "estado";

interface DrogasPageProps {
  searchParams: Promise<{ q?: string; clase?: string; controladas?: string; bajoMinimo?: string; estado?: string; page?: string; nueva?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

export default async function DrogasPage({ searchParams }: DrogasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const soloControladas = params.controladas === "1" ? true : undefined;
  const clase = (CLASES_DROGA as readonly string[]).includes(params.clase ?? "") ? (params.clase as ClaseDroga) : undefined;
  const bajoMinimo = params.bajoMinimo === "1" ? true : undefined;
  const soloVigentes = params.estado === "baja" ? false : params.estado === "vigente" ? true : undefined;

  const [result, { catalogo }] = await Promise.all([
    listDrogas({ search: params.q, clase, soloControladas, bajoMinimo, soloVigentes, page, pageSize: PAGE_SIZE }),
    getCatalogoUnidades(),
  ]);
  const puedeCrear = can(session, "drogas.crear");

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (clase) qs.set("clase", clase);
    if (soloControladas) qs.set("controladas", "1");
    if (bajoMinimo) qs.set("bajoMinimo", "1");
    if (params.estado) qs.set("estado", params.estado);
    qs.set("page", String(targetPage));
    return `/catalogos/drogas?${qs.toString()}`;
  }

  function sinFiltroHref(param: ParamDrogas): string {
    const qs = new URLSearchParams();
    if (params.q && param !== "q") qs.set("q", params.q);
    if (clase && param !== "clase") qs.set("clase", clase);
    if (soloControladas && param !== "controladas") qs.set("controladas", "1");
    if (bajoMinimo && param !== "bajoMinimo") qs.set("bajoMinimo", "1");
    if (params.estado && param !== "estado") qs.set("estado", params.estado);
    const query = qs.toString();
    return query ? `/catalogos/drogas?${query}` : "/catalogos/drogas";
  }

  const unidades = puedeCrear && params.nueva ? await listUnidadesVigentesParaDroga() : [];

  const chips: { key: ParamDrogas; label: string; value?: string }[] = [];
  if (params.q) chips.push({ key: "q", label: "Búsqueda", value: params.q });
  if (params.estado === "vigente" || params.estado === "baja") chips.push({ key: "estado", label: params.estado === "vigente" ? "Vigentes" : "Dadas de baja" });
  if (clase) chips.push({ key: "clase", label: "Clase", value: CLASE_DROGA_LABELS[clase] });
  if (soloControladas) chips.push({ key: "controladas", label: "Solo controladas" });
  if (bajoMinimo) chips.push({ key: "bajoMinimo", label: "Bajo mínimo" });
  const hayFiltros = chips.length > 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Catálogos" }, { label: "Drogas" }]}
        title="Drogas"
        description="Materias primas e insumos del laboratorio (excipientes, materiales), su unidad base, su control y su stock."
        actions={
          puedeCrear ? (
            <Link href="/catalogos/drogas?nueva=1" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nueva droga
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de catálogos" links={catalogosSections(session)} />

      {puedeCrear && params.nueva ? (
        <section className="panel mb-6 max-w-3xl" aria-labelledby="nueva-droga-heading">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 id="nueva-droga-heading">Nueva droga</h2>
            <Link href="/catalogos/drogas" className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de droga">
              <X className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="panel-body">
            <DrogaForm mode="crear" unidades={unidades} disabled={!puedeCrear} />
          </div>
        </section>
      ) : null}

      <section aria-label="Búsqueda y filtros" className="mb-4">
        <FilterForm className="filter-bar" aria-label="Filtros de búsqueda de drogas" hasActiveFilters={false}>
          {/* The search lives in the autocomplete (outside the form's own fields): keep it while other filters change. */}
          <input type="hidden" name="q" value={params.q ?? ""} />
          <div className="min-w-0 flex-1 md:w-80 md:flex-none">
            <BuscadorNavegable
              id="q-buscar"
              label="Buscar droga"
              placeholder="Buscar droga por nombre"
              buscar={buscarDrogasCatalogoAction}
              detalleHref="/catalogos/drogas/{id}"
              listaHref={sinFiltroHref("q")}
              busquedaActual={params.q}
              textoVerTodos="Ver todas las drogas"
            />
          </div>
          <FilterDrawer activeCount={(params.estado ? 1 : 0) + (clase ? 1 : 0) + (soloControladas ? 1 : 0) + (bajoMinimo ? 1 : 0)}>
            <div className="field">
              <label htmlFor="estado" className="field-label">
                Estado
              </label>
              <select id="estado" name="estado" defaultValue={params.estado ?? ""} className="input">
                <option value="">Todas</option>
                <option value="vigente">Vigentes</option>
                <option value="baja">Dadas de baja</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="clase" className="field-label">
                Clase
              </label>
              <select id="clase" name="clase" defaultValue={clase ?? ""} className="input">
                <option value="">Todas</option>
                {CLASES_DROGA.map((c) => (
                  <option key={c} value={c}>
                    {CLASE_DROGA_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <FilterMultiSelect
              options={[
                { name: "controladas", label: "Solo controladas", checked: Boolean(soloControladas) },
                { name: "bajoMinimo", label: "Bajo mínimo", checked: Boolean(bajoMinimo) },
              ]}
            />
          </FilterDrawer>
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
              <Link href="/catalogos/drogas" scroll={false} className="btn btn-ghost btn-sm">
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
              <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(result.total)}</span> {result.total === 1 ? "droga" : "drogas"}
            </p>
          </div>

          {result.items.length === 0 ? (
            hayFiltros ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="Sin resultados"
                description="Ninguna droga coincide con los filtros aplicados."
                action={
                  <Link href="/catalogos/drogas" scroll={false} className="btn btn-secondary">
                    Limpiar filtros
                  </Link>
                }
              />
            ) : (
              <EmptyState icon={<FlaskConical className="size-5" />} title="Todavía no hay drogas" description="Cargá las materias primas que usa el laboratorio." />
            )
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Nombre
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Unidad
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Control
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Disponible
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">
                      Mínimo
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
                  {result.items.map((droga) => {
                    const bajoElMinimo = new Decimal(droga.stockDisponible).lessThan(droga.stockMinimo);
                    const [disponible, minimo] = formatCantidadesFila([droga.stockDisponible, droga.stockMinimo], { id: droga.unidadBaseId, simbolo: droga.unidadBaseSimbolo }, catalogo);
                    const control = TIPO_CONTROL_LABELS[droga.tipoControl as keyof typeof TIPO_CONTROL_LABELS] ?? droga.tipoControl;
                    return (
                      <tr key={droga.id}>
                        <td className="px-3 py-2.5">
                          <Link href={`/catalogos/drogas/${droga.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                            {droga.nombre}
                          </Link>
                          {droga.clase !== "DROGA" ? (
                            <>
                              {" "}
                              <ToneBadge tone="neutral">{CLASE_DROGA_LABELS[droga.clase]}</ToneBadge>
                            </>
                          ) : null}
                          {droga.tipoControl !== "NINGUNO" ? <span className="block text-xs text-zinc-500 md:hidden">{control}</span> : null}
                        </td>
                        <td className="hidden px-3 py-2.5 font-mono sm:table-cell">{droga.unidadBaseSimbolo}</td>
                        <td className="hidden px-3 py-2.5 md:table-cell">{droga.tipoControl !== "NINGUNO" ? <ToneBadge tone="neutral">{control}</ToneBadge> : <span className="text-zinc-500">{control}</span>}</td>
                        <td className={`whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums ${bajoElMinimo ? "font-semibold text-red-700" : "text-zinc-900"}`}>
                          <Cantidad valor={disponible!} />
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono text-zinc-500 tabular-nums lg:table-cell">
                          <Cantidad valor={minimo!} />
                        </td>
                        <td className="px-3 py-2.5">
                          <ToneBadge tone={droga.fechaBaja ? "neutral" : "success"}>{droga.fechaBaja ? "Baja" : "Vigente"}</ToneBadge>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Link href={`/catalogos/drogas/${droga.id}`} aria-label={`Ver ${droga.nombre}`} className="btn btn-ghost btn-sm btn-icon">
                            <ChevronRight className="size-4" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de drogas" />
        </div>
      </div>
    </>
  );
}
