/**
 * `/recetas`: listado con filtros por estado/fecha/número, server-side.
 * After creating a receta the form lands here (`?registrada=<id>`, plus the
 * automatic ficha/cotización notices as codes -- modules/recetas/domain/avisos-generacion.ts).
 *
 * Layout: the per-estado summary doubles as the estado filter
 * (same `?estado=` param), the rest of the filters stay in `FilterForm`,
 * and the rows render through `RecetasTable`. Data, permisos and queries
 * are the same as before; `resumenRecetasPorEstado` is the existing
 * read-only count already used by the home dashboard.
 */
import Link from "next/link";
import { ChartColumn, ClipboardList, Plus, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRecetas, resumenRecetasPorEstado } from "@/modules/recetas/application/list-recetas";
import { ESTADOS_RECETA, esEstadoTerminal, puedeAnular } from "@/modules/recetas/domain/receta";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { PARAM_AVISO, PARAM_REGISTRADA, decodificarAvisos } from "@/modules/recetas/domain/avisos-generacion";
import { AvisosGeneracion } from "@/modules/recetas/ui/avisos-generacion";
import { RecetasTable, type RecetaRow } from "@/modules/recetas/ui/recetas-table";
import { ESTADO_RECETA_LABELS, ORIGEN_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { formatFecha } from "@/shared/format/fecha";
import { estadoTone } from "@/shared/ui/status-badge";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { SearchField } from "@/shared/ui/search-field";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusSummary } from "@/shared/ui/status-summary";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { Toaster } from "@/shared/ui/toast";

const PAGE_SIZE = 20;

interface RecetasPageProps {
  searchParams: Promise<{ estado?: string; numero?: string; desde?: string; hasta?: string; page?: string; registrada?: string; aviso?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type FilterParam = "estado" | "numero" | "desde" | "hasta";

/** `2026-09-01` -> `01/09/2026` (display only; anything else is shown as typed). */
function isoToDisplay(value: string): string {
  const match = ISO_DATE.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export default async function RecetasPage({ searchParams }: RecetasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const estado = params.estado ?? "";
  const estadoValido = ESTADOS_RECETA.includes(estado as (typeof ESTADOS_RECETA)[number]) ? (estado as (typeof ESTADOS_RECETA)[number]) : undefined;

  const [result, resumen] = await Promise.all([
    listRecetas({
      estado: estadoValido,
      numeroInterno: params.numero,
      desde: params.desde,
      hasta: params.hasta,
      page,
      pageSize: PAGE_SIZE,
    }),
    resumenRecetasPorEstado(),
  ]);
  const puedeCrear = can(session, "recetas.crear");
  const puedeEditar = can(session, "recetas.editar");
  const puedeAnularPermiso = can(session, "recetas.anular");
  const puedeVerReporte = can(session, "reportes.ver");

  // The receta just created (read again: the URL only carries its id and the notice codes).
  const idRegistrada = params[PARAM_REGISTRADA];
  const registrada = idRegistrada && UUID.test(idRegistrada) ? await getReceta(idRegistrada) : null;
  const avisos = registrada ? decodificarAvisos(params[PARAM_AVISO], registrada.items.length) : [];

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (params.estado) qs.set("estado", params.estado);
    if (params.numero) qs.set("numero", params.numero);
    if (params.desde) qs.set("desde", params.desde);
    if (params.hasta) qs.set("hasta", params.hasta);
    qs.set("page", String(targetPage));
    return `/recetas?${qs.toString()}`;
  }

  /** The current filters with some replaced or removed (`""`), back on page 1. */
  function filtersHref(overrides: Partial<Record<FilterParam, string>>): string {
    const qs = new URLSearchParams();
    for (const key of ["estado", "numero", "desde", "hasta"] as const) {
      const value = key in overrides ? overrides[key] : params[key];
      if (value) qs.set(key, value);
    }
    const query = qs.toString();
    return query ? `/recetas?${query}` : "/recetas";
  }

  const hasActiveFilters = Boolean(params.estado || params.numero || params.desde || params.hasta);
  const hasNarrowingFilters = Boolean(params.numero || params.desde || params.hasta);

  // Status summary: global counts per estado; terminal estados are history, the rest is work in progress.
  const totalRegistradas = resumen.reduce((sum, r) => sum + r.cantidad, 0);
  const enCurso = resumen.filter((r) => !esEstadoTerminal(r.estado)).reduce((sum, r) => sum + r.cantidad, 0);

  const chips: { key: FilterParam; label: string; value: string }[] = [];
  if (estadoValido) chips.push({ key: "estado", label: "Estado", value: ESTADO_RECETA_LABELS[estadoValido] });
  if (params.numero) chips.push({ key: "numero", label: "Nº interno", value: params.numero });
  if (params.desde) chips.push({ key: "desde", label: "Prescripción desde", value: isoToDisplay(params.desde) });
  if (params.hasta) chips.push({ key: "hasta", label: "Prescripción hasta", value: isoToDisplay(params.hasta) });

  const rows: RecetaRow[] = result.items.map((r) => ({
    id: r.id,
    numero: r.numeroInterno,
    paciente: `${r.pacienteNombre} ${r.pacienteApellido}`,
    medico: `${r.medicoApellido}, ${r.medicoNombre}`,
    origen: r.origen,
    origenLabel: ORIGEN_RECETA_LABELS[r.origen],
    prescripcion: formatFecha(r.fechaPrescripcion),
    prescripcionKey: r.fechaPrescripcion.toISOString(),
    ingreso: formatFecha(r.fechaIngreso, result.zonaHoraria),
    ingresoKey: r.fechaIngreso.toISOString(),
    estado: r.estado,
    estadoOrden: ESTADOS_RECETA.indexOf(r.estado),
    editable: puedeEditar && r.editable,
    anulable: puedeAnularPermiso && puedeAnular(r.estado),
  }));

  const empty =
    result.total > 0 ? (
      <EmptyState
        icon={<SearchX className="size-5" />}
        title="Esta página no tiene recetas"
        description="Hay resultados, pero en páginas anteriores."
        action={
          <Link href={pageHref(1)} className="btn btn-secondary">
            Ir a la primera página
          </Link>
        }
      />
    ) : hasActiveFilters ? (
      <EmptyState
        icon={<SearchX className="size-5" />}
        title="Sin resultados"
        description="Ninguna receta coincide con los filtros aplicados."
        action={
          <Link href="/recetas" scroll={false} className="btn btn-secondary">
            Limpiar filtros
          </Link>
        }
      />
    ) : (
      <EmptyState
        icon={<ClipboardList className="size-5" />}
        title="Todavía no hay recetas"
        description="Las recetas registradas aparecen acá, con su estado de preparación."
        action={
          puedeCrear ? (
            <Link href="/recetas/nuevo" className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nueva receta
            </Link>
          ) : null
        }
      />
    );

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Recetas" }]}
        title="Recetas"
        description="Seguimiento de cada receta desde el ingreso hasta la entrega."
        actions={
          <>
            {puedeVerReporte ? (
              <Link href="/reportes/recetas" className="btn btn-secondary">
                <ChartColumn className="size-4" aria-hidden />
                Reporte
              </Link>
            ) : null}
            {puedeCrear ? (
              <Link href="/recetas/nuevo" className="btn btn-primary">
                <Plus className="size-4" aria-hidden />
                Nueva receta
              </Link>
            ) : null}
          </>
        }
      />

      {registrada ? (
        <AvisosGeneracion
          exito={`Receta Nº ${registrada.numeroInterno} registrada.`}
          avisos={avisos}
          accion={
            <Link href={`/recetas/${registrada.id}`} className="underline">
              Ir a la receta Nº {registrada.numeroInterno}
            </Link>
          }
        />
      ) : null}

      <StatusSummary
        label="Filtrar por estado"
        unit={["receta", "recetas"]}
        headline={{
          value: enCurso,
          label: enCurso === 1 ? "receta en curso" : "recetas en curso",
          caption: `de ${new Intl.NumberFormat("es-AR").format(totalRegistradas)} registradas`,
        }}
        note={hasNarrowingFilters ? "Los totales por estado no aplican la búsqueda ni las fechas." : undefined}
        all={{ label: "Todas", count: totalRegistradas, href: filtersHref({ estado: "" }), active: !estadoValido }}
        items={resumen.map((r) => ({
          key: r.estado,
          label: ESTADO_RECETA_LABELS[r.estado],
          count: r.cantidad,
          // Clicking the active estado again clears it.
          href: filtersHref({ estado: r.estado === estadoValido ? "" : r.estado }),
          active: r.estado === estadoValido,
          tone: estadoTone(r.estado),
          secondary: esEstadoTerminal(r.estado),
        }))}
      />

      <section aria-label="Búsqueda y filtros" className="mb-4">
        {/* The estado is chosen in the summary above; this hidden field keeps it while the other filters change. */}
        <FilterForm className="filter-bar" aria-label="Filtros de recetas" hasActiveFilters={false}>
          <input type="hidden" name="estado" value={estadoValido ?? ""} />
          <SearchField
            id="numero"
            name="numero"
            label="Nº interno"
            hideLabel
            defaultValue={params.numero ?? ""}
            placeholder="Buscar por Nº interno"
            inputMode="search"
            className="min-w-0 flex-1 md:w-64 md:flex-none"
          />
          <FilterDrawer activeCount={(params.desde ? 1 : 0) + (params.hasta ? 1 : 0)}>
            <div className="field">
              <span id="prescripcion-label" className="field-label">
                Prescripción
              </span>
              <div className="range-field" role="group" aria-labelledby="prescripcion-label">
                <label htmlFor="desde" className="sr-only">
                  Prescripción desde
                </label>
                <DateInput id="desde" name="desde" defaultValue={params.desde ?? ""} />
                <span className="range-field-sep" aria-hidden>
                  a
                </span>
                <label htmlFor="hasta" className="sr-only">
                  Prescripción hasta
                </label>
                <DateInput id="hasta" name="hasta" defaultValue={params.hasta ?? ""} />
              </div>
            </div>
          </FilterDrawer>
        </FilterForm>

        {chips.length > 0 ? (
          <div className="filter-chips" role="group" aria-label="Filtros activos">
            {chips.map((chip) => (
              <span key={chip.key} className="chip">
                {chip.label}: <strong>{chip.value}</strong>
                <Link href={filtersHref({ [chip.key]: "" } as Partial<Record<FilterParam, string>>)} scroll={false} className="chip-remove" aria-label={`Quitar filtro ${chip.label}`}>
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            ))}
            {chips.length > 1 ? (
              <Link href="/recetas" scroll={false} className="btn btn-ghost btn-sm">
                Limpiar filtros
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="list-region">
        <span className="link-pending" aria-hidden />
        <RecetasTable
          rows={rows}
          total={result.total}
          empty={empty}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de recetas" />}
        />
      </div>

      <Toaster />
    </div>
  );
}
