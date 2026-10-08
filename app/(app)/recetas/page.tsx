/**
 * `/recetas`: listado con filtros por estado/pago/fechas (ingreso, prescripción)/número, server-side.
 * After creating a receta the form lands here (`?registrada=<id>`, plus the
 * automatic ficha/cotización notices as codes -- modules/recetas/domain/avisos-generacion.ts).
 *
 * Layout: the per-estado summary doubles as the estado filter
 * (same `?estado=` param) and counts only the recetas that entered within
 * `?periodo=` (default last 30 days; it never filters the list), the rest of the filters stay in `FilterForm`,
 * and the rows render through `RecetasTable`. Data, permisos and queries
 * are the same as before; `resumenRecetasPorEstado` is the existing
 * read-only count already used by the home dashboard.
 */
import Link from "next/link";
import { ClipboardList, Download, Plus, SearchX, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRecetas, resumenRecetasPorEstado } from "@/modules/recetas/application/list-recetas";
import { ESTADOS_RECETA, esEstadoTerminal, puedeAnular } from "@/modules/recetas/domain/receta";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { PARAM_AVISO, PARAM_REGISTRADA, decodificarAvisos } from "@/modules/recetas/domain/avisos-generacion";
import { AvisosGeneracion } from "@/modules/recetas/ui/avisos-generacion";
import { RecetasTable, type RecetaRow } from "@/modules/recetas/ui/recetas-table";
import { PeriodoResumenSelect } from "@/modules/recetas/ui/periodo-resumen-select";
import { FILTROS_PAGO_RECETA, FILTRO_PAGO_RECETA_LABELS, parseFiltroPagoReceta } from "@/modules/recetas/domain/pago";
import { PERIODO_RESUMEN_DEFAULT, PERIODO_RESUMEN_LABELS, parsePeriodoResumen } from "@/modules/recetas/domain/periodo-resumen";
import { ESTADO_RECETA_LABELS, ORIGEN_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { formatFecha } from "@/shared/format/fecha";
import { estadoTone } from "@/shared/ui/status-badge";
import { DateRangeField } from "@/shared/ui/date-range-field";
import { FilterForm } from "@/shared/ui/filter-form";
import { FilterDrawer } from "@/shared/ui/filter-drawer";
import { SearchField } from "@/shared/ui/search-field";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusSummary } from "@/shared/ui/status-summary";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { Toaster } from "@/shared/ui/toast";

const PAGE_SIZE = 20;

/**
 * Link to the receta form. It MUST be a plain `<a>` (a full page load), not a `<Link>`:
 * Permissions-Policy is fixed per document load, so a soft navigation from here would keep
 * this page's `camera=()` and the QR import could not use the camera
 * (next.config.ts, docs/specs/importacion-receta-qr.md). Any new link to this route needs the same.
 */
const HREF_NUEVA_RECETA = "/recetas/nuevo";

interface RecetasPageProps {
  searchParams: Promise<{ estado?: string; numero?: string; pago?: string; desde?: string; hasta?: string; ingresoDesde?: string; ingresoHasta?: string; periodo?: string; page?: string; registrada?: string; aviso?: string | string[] }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type FilterParam = "estado" | "numero" | "pago" | "ingresoDesde" | "ingresoHasta" | "desde" | "hasta";
const FILTER_PARAMS: readonly FilterParam[] = ["estado", "numero", "pago", "ingresoDesde", "ingresoHasta", "desde", "hasta"];

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
  const periodo = parsePeriodoResumen(params.periodo);
  const estadoValido = ESTADOS_RECETA.includes(estado as (typeof ESTADOS_RECETA)[number]) ? (estado as (typeof ESTADOS_RECETA)[number]) : undefined;
  const pago = parseFiltroPagoReceta(params.pago);

  const [result, resumen] = await Promise.all([
    listRecetas({
      estado: estadoValido,
      numeroInterno: params.numero,
      pago,
      desde: params.desde,
      hasta: params.hasta,
      ingresoDesde: params.ingresoDesde,
      ingresoHasta: params.ingresoHasta,
      page,
      pageSize: PAGE_SIZE,
    }),
    resumenRecetasPorEstado(periodo),
  ]);
  const puedeCrear = can(session, "recetas.crear");
  const puedeEditar = can(session, "recetas.editar");
  const puedeAnularPermiso = can(session, "recetas.anular");
  const puedeExportar = can(session, "reportes.ver");

  // The receta just created (read again: the URL only carries its id and the notice codes).
  const idRegistrada = params[PARAM_REGISTRADA];
  const registrada = idRegistrada && UUID.test(idRegistrada) ? await getReceta(idRegistrada) : null;
  const avisos = registrada ? decodificarAvisos(params[PARAM_AVISO], registrada.items.length) : [];

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    for (const key of FILTER_PARAMS) {
      const value = params[key];
      if (value) qs.set(key, value);
    }
    if (periodo !== PERIODO_RESUMEN_DEFAULT) qs.set("periodo", periodo);
    qs.set("page", String(targetPage));
    return `/recetas?${qs.toString()}`;
  }

  /** The current filters with some replaced or removed (`""`), back on page 1. */
  function filtersHref(overrides: Partial<Record<FilterParam, string>>): string {
    const qs = new URLSearchParams();
    for (const key of FILTER_PARAMS) {
      const value = key in overrides ? overrides[key] : params[key];
      if (value) qs.set(key, value);
    }
    if (periodo !== PERIODO_RESUMEN_DEFAULT) qs.set("periodo", periodo);
    const query = qs.toString();
    return query ? `/recetas?${query}` : "/recetas";
  }

  /** CSV of every receta the current filters select (not just this page); the summary's periodo does not apply. */
  function exportHref(): string {
    const qs = new URLSearchParams();
    for (const key of FILTER_PARAMS) {
      const value = params[key];
      if (value) qs.set(key, value);
    }
    const query = qs.toString();
    return query ? `/api/recetas/reporte/export/csv?${query}` : "/api/recetas/reporte/export/csv";
  }

  /** No filters, same summary window. */
  const clearFiltersHref = periodo === PERIODO_RESUMEN_DEFAULT ? "/recetas" : `/recetas?periodo=${periodo}`;
  const hasActiveFilters = FILTER_PARAMS.some((key) => params[key]);
  const hasNarrowingFilters = FILTER_PARAMS.some((key) => key !== "estado" && params[key]);
  const activeDrawerFilters = (["ingresoDesde", "ingresoHasta", "desde", "hasta"] as const).filter((key) => params[key]).length + (pago ? 1 : 0);

  // Status summary: global counts per estado; terminal estados are history, the rest is work in progress.
  const totalRegistradas = resumen.reduce((sum, r) => sum + r.cantidad, 0);
  const enCurso = resumen.filter((r) => !esEstadoTerminal(r.estado)).reduce((sum, r) => sum + r.cantidad, 0);

  const chips: { key: FilterParam; label: string; value: string }[] = [];
  if (estadoValido) chips.push({ key: "estado", label: "Estado", value: ESTADO_RECETA_LABELS[estadoValido] });
  if (params.numero) chips.push({ key: "numero", label: "Nº interno", value: params.numero });
  if (pago) chips.push({ key: "pago", label: "Pago", value: FILTRO_PAGO_RECETA_LABELS[pago] });
  if (params.ingresoDesde) chips.push({ key: "ingresoDesde", label: "Ingreso desde", value: isoToDisplay(params.ingresoDesde) });
  if (params.ingresoHasta) chips.push({ key: "ingresoHasta", label: "Ingreso hasta", value: isoToDisplay(params.ingresoHasta) });
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
    pagada: r.pagada,
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
          <Link href={clearFiltersHref} scroll={false} className="btn btn-secondary">
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
            <a href={HREF_NUEVA_RECETA} className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nueva receta
            </a>
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
            {puedeExportar ? (
              <a href={exportHref()} className="btn btn-secondary">
                <Download className="size-4" aria-hidden />
                Exportar CSV
              </a>
            ) : null}
            {puedeCrear ? (
              <a href={HREF_NUEVA_RECETA} className="btn btn-primary">
                <Plus className="size-4" aria-hidden />
                Nueva receta
              </a>
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
        control={<PeriodoResumenSelect value={periodo} />}
        unit={["receta", "recetas"]}
        headline={{
          value: enCurso,
          label: enCurso === 1 ? "receta en curso" : "recetas en curso",
          caption: `de ${new Intl.NumberFormat("es-AR").format(totalRegistradas)} ${periodo === "todos" ? "registradas en total" : `ingresadas en los ${PERIODO_RESUMEN_LABELS[periodo].toLowerCase()}`}`,
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
        {/* The estado and the summary's periodo are chosen above; these hidden fields keep them while the other filters change. */}
        <FilterForm className="filter-bar" aria-label="Filtros de recetas" hasActiveFilters={false}>
          <input type="hidden" name="estado" value={estadoValido ?? ""} />
          {periodo !== PERIODO_RESUMEN_DEFAULT ? <input type="hidden" name="periodo" value={periodo} /> : null}
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
          <FilterDrawer activeCount={activeDrawerFilters}>
            <div className="field">
              <label htmlFor="pago" className="field-label">
                Pago
              </label>
              <select id="pago" name="pago" defaultValue={pago ?? ""} className="input">
                <option value="">Todas</option>
                {FILTROS_PAGO_RECETA.map((valor) => (
                  <option key={valor} value={valor}>
                    {FILTRO_PAGO_RECETA_LABELS[valor]}
                  </option>
                ))}
              </select>
            </div>
            <DateRangeField id="ingreso" label="Ingreso" desdeName="ingresoDesde" hastaName="ingresoHasta" desdeDefault={params.ingresoDesde ?? ""} hastaDefault={params.ingresoHasta ?? ""} />
            <DateRangeField id="prescripcion" label="Prescripción" desdeName="desde" hastaName="hasta" desdeDefault={params.desde ?? ""} hastaDefault={params.hasta ?? ""} />
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
              <Link href={clearFiltersHref} scroll={false} className="btn btn-ghost btn-sm">
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
