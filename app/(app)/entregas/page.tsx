/** `/entregas` (FASE 11 points 11.1/11.2): recetas PREPARADA (listas para entregar) y ENVIADA_PEND_FIRMA (esperando firma). Paciente search goes through `EntregasBuscador` (POST Server Action, DP-24 -- never a URL/query string); the other filters (Nº, estado, ingreso) identify no one, so they live in the URL through `FilterForm`, like `/recetas`. The page-number pagination carries no identifying data either, so a plain GET `?page=` is fine (same distinction `modules/pacientes/ui/pacientes-buscador.tsx` documents). */
import Link from "next/link";
import { X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { listEntregasPendientes } from "@/modules/entregas/application/list-entregas-pendientes";
import { EntregasBuscador } from "@/modules/entregas/ui/entregas-buscador";
import { ESTADO_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { DateRangeField } from "@/shared/ui/date-range-field";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { FilterForm } from "@/shared/ui/filter-form";
import { PageHeader } from "@/shared/ui/page-header";
import { Pagination } from "@/shared/ui/pagination";
import { SearchField } from "@/shared/ui/search-field";

const PAGE_SIZE = 20;

const ESTADOS_ENTREGA = ["PREPARADA", "ENVIADA_PEND_FIRMA"] as const;
type EstadoEntrega = (typeof ESTADOS_ENTREGA)[number];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type FilterParam = "numero" | "estado" | "ingresoDesde" | "ingresoHasta";
const FILTER_PARAMS: readonly FilterParam[] = ["numero", "estado", "ingresoDesde", "ingresoHasta"];

interface EntregasPageProps {
  searchParams: Promise<{ page?: string; numero?: string; estado?: string; ingresoDesde?: string; ingresoHasta?: string }>;
}

/** `2026-09-01` -> `01/09/2026` (display only; anything else is shown as typed). */
function isoToDisplay(value: string): string {
  const match = ISO_DATE.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Only well-formed dates reach the query (anything else is ignored, like an unknown estado). */
function validIso(value: string | undefined): string {
  return value && ISO_DATE.test(value) ? value : "";
}

export default async function EntregasPage({ searchParams }: EntregasPageProps) {
  await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const estado: EstadoEntrega | undefined = ESTADOS_ENTREGA.find((e) => e === params.estado);
  const numero = (params.numero ?? "").trim();
  const ingresoDesde = validIso(params.ingresoDesde);
  const ingresoHasta = validIso(params.ingresoHasta);
  const active: Record<FilterParam, string> = { numero, estado: estado ?? "", ingresoDesde, ingresoHasta };

  const result = await listEntregasPendientes({
    estado,
    numeroInterno: numero || undefined,
    ingresoDesde: ingresoDesde || undefined,
    ingresoHasta: ingresoHasta || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  /** The current filters with some replaced or removed (`""`); `page` set only when given. */
  function hrefFor(overrides: Partial<Record<FilterParam, string>>, targetPage?: number): string {
    const qs = new URLSearchParams();
    for (const key of FILTER_PARAMS) {
      const value = key in overrides ? overrides[key] : active[key];
      if (value) qs.set(key, value);
    }
    if (targetPage) qs.set("page", String(targetPage));
    const query = qs.toString();
    return query ? `/entregas?${query}` : "/entregas";
  }

  const chips: { key: FilterParam; label: string; value: string }[] = [];
  if (numero) chips.push({ key: "numero", label: "Nº interno", value: numero });
  if (estado) chips.push({ key: "estado", label: "Estado", value: ESTADO_RECETA_LABELS[estado] });
  if (ingresoDesde) chips.push({ key: "ingresoDesde", label: "Ingreso desde", value: isoToDisplay(ingresoDesde) });
  if (ingresoHasta) chips.push({ key: "ingresoHasta", label: "Ingreso hasta", value: isoToDisplay(ingresoHasta) });
  const activeDrawerFilters = (estado ? 1 : 0) + (ingresoDesde ? 1 : 0) + (ingresoHasta ? 1 : 0);

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Entregas" }]}
        title="Entregas"
        description="Recetas preparadas para entregar y envíos a la espera de su retorno."
      />

      <EntregasBuscador
        itemsIniciales={result.items}
        totalInicial={result.total}
        filtros={{ estado: active.estado, numero, ingresoDesde, ingresoHasta }}
        controles={
          <FilterForm className="contents" aria-label="Filtros de entregas" hasActiveFilters={false}>
            <SearchField
              id="numero"
              name="numero"
              label="Nº interno"
              hideLabel
              defaultValue={numero}
              placeholder="Buscar por Nº interno"
              inputMode="search"
              className="min-w-0 flex-1 md:w-64 md:flex-none"
            />
            <FilterDrawer activeCount={activeDrawerFilters}>
              <div className="field">
                <label htmlFor="estado" className="field-label">
                  Estado
                </label>
                <select id="estado" name="estado" defaultValue={estado ?? ""} className="input">
                  <option value="">Todos</option>
                  {ESTADOS_ENTREGA.map((valor) => (
                    <option key={valor} value={valor}>
                      {ESTADO_RECETA_LABELS[valor]}
                    </option>
                  ))}
                </select>
              </div>
              <DateRangeField id="ingreso" label="Ingreso" desdeName="ingresoDesde" hastaName="ingresoHasta" desdeDefault={ingresoDesde} hastaDefault={ingresoHasta} />
            </FilterDrawer>
          </FilterForm>
        }
        chips={
          chips.length > 0 ? (
            <div className="filter-chips" role="group" aria-label="Filtros activos">
              {chips.map((chip) => (
                <span key={chip.key} className="chip">
                  {chip.label}: <strong>{chip.value}</strong>
                  <Link href={hrefFor({ [chip.key]: "" })} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                    <X className="size-3" aria-hidden />
                  </Link>
                </span>
              ))}
              {chips.length > 1 ? (
                <Link href="/entregas" scroll={false} className="btn btn-ghost btn-sm">
                  Limpiar filtros
                </Link>
              ) : null}
            </div>
          ) : null
        }
        paginacion={<Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={(p) => hrefFor({}, p)} label="Paginación de entregas" />}
      />
    </div>
  );
}
