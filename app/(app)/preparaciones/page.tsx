/**
 * `/preparaciones` (M11): one tab per estado (En curso · Confirmadas ·
 * Descartadas, `?estado=`, default En curso), and one
 * paginated table per tab. Filters (server-side, modules/preparaciones/domain/listado.ts):
 * Nº de receta and start date range on every tab, "Sin etiqueta impresa"
 * on Confirmadas. No paciente filter: DP-24 forbids personal data in URLs.
 *
 * Confirming is NOT offered inline: it is irreversible and needs the
 * partida review, the manual enrase and a re-authentication, all on
 * /preparaciones/[id] -- the row only links there ("Confirmar →").
 */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listPreparaciones } from "@/modules/preparaciones/application/list-preparaciones";
import type { PreparacionListItem } from "@/modules/preparaciones/application/list-preparaciones";
import {
  ESTADO_ETIQUETA_LABELS,
  PESTANAS_PREPARACIONES,
  estadoEtiqueta,
  hrefPreparaciones,
  parsearFiltrosPreparaciones,
} from "@/modules/preparaciones/domain/listado";
import type { EstadoEtiqueta } from "@/modules/preparaciones/domain/listado";
import { generarEtiquetaAction } from "@/modules/preparaciones/ui/actions";
import { FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { formatFechaHora } from "@/shared/format/fecha";
import { DateInput } from "@/shared/ui/date-input";
import { FilterForm } from "@/shared/ui/filter-form";
import { SimpleForm } from "@/shared/ui/simple-form";

const PAGE_SIZE = 20;

interface PreparacionesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const TONO_ETIQUETA: Record<EstadoEtiqueta, string> = {
  PENDIENTE: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  GENERADA: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  IMPRESA: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

export default async function PreparacionesPage({ searchParams }: PreparacionesPageProps) {
  const session = await requireSession();
  const filtros = parsearFiltrosPreparaciones(await searchParams);
  const result = await listPreparaciones({
    estado: filtros.estado,
    numeroInterno: filtros.numero,
    desde: filtros.desde,
    hasta: filtros.hasta,
    sinEtiquetaImpresa: filtros.sinEtiquetaImpresa,
    page: filtros.page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const esConfirmadas = filtros.estado === "CONFIRMADA";
  const puedeGenerarEtiqueta = can(session, "etiquetas.generar");
  const puedeImprimirEtiqueta = can(session, "etiquetas.imprimir");
  const columnas = esConfirmadas ? 7 : 5;

  return (
    <div className="page">
      <h1 className="mb-4 text-2xl font-semibold">Preparaciones</h1>

      <nav aria-label="Estado de las preparaciones" className="mb-6 flex flex-wrap gap-x-5 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {PESTANAS_PREPARACIONES.map((p) => {
          const activa = p.estado === filtros.estado;
          return (
            <Link
              key={p.estado}
              href={hrefPreparaciones(filtros, { estado: p.estado })}
              aria-current={activa ? "page" : undefined}
              className={
                activa
                  ? "-mb-px border-b-2 border-emerald-600 pb-2.5 font-medium text-zinc-900 dark:border-emerald-400 dark:text-zinc-100"
                  : "-mb-px border-b-2 border-transparent pb-2.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }
            >
              {p.titulo}
            </Link>
          );
        })}
      </nav>

      <FilterForm
        className="mb-6 flex flex-wrap items-end gap-3"
        aria-label="Filtros de preparaciones"
        hasActiveFilters={Boolean(filtros.numero || filtros.desde || filtros.hasta || filtros.sinEtiquetaImpresa)}
      >
        {filtros.estado !== "INICIADA" ? <input type="hidden" name="estado" value={filtros.estado} /> : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="numero" className="text-sm font-medium">
            Nº de receta
          </label>
          <input id="numero" name="numero" type="text" inputMode="numeric" defaultValue={filtros.numero ?? ""} className="w-28 input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className="text-sm font-medium">
            Iniciada desde
          </label>
          <DateInput id="desde" name="desde" defaultValue={filtros.desde ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Iniciada hasta
          </label>
          <DateInput id="hasta" name="hasta" defaultValue={filtros.hasta ?? ""} />
        </div>
        {esConfirmadas ? (
          <label className="toggle-switch">
            <input type="checkbox" role="switch" name="sinEtiqueta" value="1" defaultChecked={filtros.sinEtiquetaImpresa} />
            Sin etiqueta impresa
          </label>
        ) : null}
      </FilterForm>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {result.total} preparaci{result.total === 1 ? "ón encontrada" : "ones encontradas"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Receta Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Ítem</th>
              <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
              <th scope="col" className="px-3 py-2 font-medium">Iniciada</th>
              {esConfirmadas ? <th scope="col" className="px-3 py-2 font-medium">Confirmada</th> : null}
              {esConfirmadas ? <th scope="col" className="px-3 py-2 font-medium">Etiqueta</th> : null}
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={columnas} className="px-3 py-6 text-center text-zinc-500">
                  No hay preparaciones con estos filtros.
                </td>
              </tr>
            ) : (
              result.items.map((p) => {
                const etiqueta = estadoEtiqueta(p.etiqueta);
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2">
                      <Link href={`/recetas/${p.recetaId}`} className="font-medium underline-offset-2 hover:underline">
                        {p.recetaNumeroInterno}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{p.itemDescripcion ?? etiquetaDe(FORMA_FARMACEUTICA_LABELS, p.formaFarmaceutica)}</td>
                    <td className="px-3 py-2">
                      {p.pacienteNombre} {p.pacienteApellido}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatFechaHora(p.iniciadaEn, result.zonaHoraria)}</td>
                    {esConfirmadas ? (
                      <td className="whitespace-nowrap px-3 py-2">{p.confirmadaEn ? formatFechaHora(p.confirmadaEn, result.zonaHoraria) : "—"}</td>
                    ) : null}
                    {esConfirmadas ? (
                      <td className="px-3 py-2">
                        <span className={`badge ${TONO_ETIQUETA[etiqueta]}`}>{ESTADO_ETIQUETA_LABELS[etiqueta]}</span>
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <div className="flex justify-end">
                        <AccionFila preparacion={p} puedeGenerarEtiqueta={puedeGenerarEtiqueta} puedeImprimirEtiqueta={puedeImprimirEtiqueta} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Paginación de preparaciones" className="mt-4 flex items-center gap-2 text-sm">
          <Link
            href={hrefPreparaciones(filtros, { page: Math.max(1, filtros.page - 1) })}
            aria-disabled={filtros.page <= 1}
            className={filtros.page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Anterior
          </Link>
          <span>
            Página {filtros.page} de {totalPages}
          </span>
          <Link
            href={hrefPreparaciones(filtros, { page: Math.min(totalPages, filtros.page + 1) })}
            aria-disabled={filtros.page >= totalPages}
            className={filtros.page >= totalPages ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}

function AccionFila({
  preparacion,
  puedeGenerarEtiqueta,
  puedeImprimirEtiqueta,
}: {
  preparacion: PreparacionListItem;
  puedeGenerarEtiqueta: boolean;
  puedeImprimirEtiqueta: boolean;
}) {
  if (preparacion.estado === "INICIADA") {
    return (
      <Link href={`/preparaciones/${preparacion.id}`} className="btn btn-primary btn-sm">
        Confirmar →
      </Link>
    );
  }
  if (preparacion.estado === "DESCARTADA") {
    return (
      <Link href={`/preparaciones/${preparacion.id}`} className="btn btn-secondary btn-sm">
        Ver
      </Link>
    );
  }
  if (preparacion.etiqueta) {
    return puedeImprimirEtiqueta ? (
      <a href={`/api/preparaciones/${preparacion.id}/etiqueta/pdf`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
        Imprimir etiqueta
      </a>
    ) : null;
  }
  return puedeGenerarEtiqueta ? (
    // SimpleForm refreshes the route on success, so the row switches to "Imprimir etiqueta".
    <SimpleForm action={generarEtiquetaAction} submitLabel="Generar etiqueta" pendingLabel="Generando…" layout="inline" submitSize="sm">
      <input type="hidden" name="preparacionId" value={preparacion.id} />
    </SimpleForm>
  ) : null;
}
