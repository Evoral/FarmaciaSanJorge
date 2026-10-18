/**
 * `/libro/dias`: the libro recetario per day, for a quick look at what is signed and what is owed
 * (docs/specs/libro-recetario-y-contralor.md, "Libro por día"). Only days with asientos are listed: a day without
 * recetas is not a debt. Signing stays in `/cierres` (one place for the DT's firma); a signed day prints its sheet.
 */
import Link from "next/link";
import { BookOpen, ChevronRight, PenLine, Printer } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listJornadasLibro } from "@/modules/libro/application/list-jornadas-libro";
import { ESTADO_JORNADA_LIBRO_LABELS, type EstadoJornadaLibro } from "@/modules/libro/domain/jornadas";
import { LibroNav } from "@/modules/libro/ui/libro-nav";
import { mensajeImpresionFueraDeOrden, puedeImprimirJornada } from "@/modules/cierres/domain/impresion";
import { ImprimirHojaLink } from "@/modules/cierres/ui/imprimir-hoja-link";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { ToneBadge, type BadgeTone } from "@/shared/ui/status-badge";

const PAGE_SIZE = 31;

const TONO: Record<EstadoJornadaLibro, BadgeTone> = {
  FIRMADA: "success",
  SIN_FIRMAR: "danger",
  EN_CURSO: "neutral",
  SIN_VIGENTES: "neutral",
};

interface LibroDiasPageProps {
  searchParams: Promise<{ page?: string; estado?: string }>;
}

export default async function LibroDiasPage({ searchParams }: LibroDiasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const soloSinFirmar = params.estado === "sin-firmar";

  const result = await listJornadasLibro({ soloSinFirmar, page, pageSize: PAGE_SIZE });
  const puedeImprimir = can(session, "cierres.imprimir");
  const puedeFirmar = can(session, "cierres.firmar");

  function pageHref(targetPage: number): string {
    return `/libro/dias?${soloSinFirmar ? "estado=sin-firmar&" : ""}page=${targetPage}`;
  }

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Libro", href: "/libro" }, { label: "Por día" }]}
        title="Libro recetario por día"
        description="Cada día con recetas registradas y su firma. Los días sin recetas no figuran ni cuentan como deuda."
      />

      <LibroNav actual="dias" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {result.sinFirmar > 0 ? (
          <ToneBadge tone="danger">
            {result.sinFirmar} {result.sinFirmar === 1 ? "día sin firmar" : "días sin firmar"}
          </ToneBadge>
        ) : (
          <ToneBadge tone="success">Todo firmado</ToneBadge>
        )}
        <Link href={soloSinFirmar ? "/libro/dias" : "/libro/dias?estado=sin-firmar"} scroll={false} className="btn btn-ghost btn-sm">
          {soloSinFirmar ? "Ver todos los días" : "Ver solo los días sin firmar"}
        </Link>
        {result.primerSinImprimir ? <ToneBadge tone="warn">Hoja sin imprimir desde el {formatFechaIso(result.primerSinImprimir)}</ToneBadge> : null}
        {result.sinFirmar > 0 && puedeFirmar ? (
          <Link href="/cierres" className="btn btn-secondary btn-sm">
            <PenLine className="size-4" aria-hidden />
            Firmar en Cierres
          </Link>
        ) : null}
      </div>

      <div className="list-panel">
        {result.items.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title={soloSinFirmar ? "No hay días sin firmar" : "Todavía no hay días con asientos"}
            description={soloSinFirmar ? "Todos los días con recetas están firmados." : "Los días aparecen al registrarse su primer asiento."}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Fecha
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Asientos
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Firma
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Impresión
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((dia) => (
                  <tr key={dia.fecha}>
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium tabular-nums">{formatFechaIso(dia.fecha)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{dia.asientos}</td>
                    <td className="px-3 py-2.5">
                      <ToneBadge tone={TONO[dia.estado]}>{ESTADO_JORNADA_LIBRO_LABELS[dia.estado]}</ToneBadge>
                    </td>
                    <td className="px-3 py-2.5">{dia.cierreId ? <ToneBadge tone={dia.impresa ? "success" : "warn"}>{dia.impresa ? "Impresa" : "Sin imprimir"}</ToneBadge> : <span className="text-zinc-400">—</span>}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {dia.cierreId && puedeImprimir ? (
                          puedeImprimirJornada(dia.fecha, result.primerSinImprimir) ? (
                            <ImprimirHojaLink cierreId={dia.cierreId} className="btn btn-secondary btn-sm">
                              <Printer className="size-4" aria-hidden />
                              {dia.impresa ? "Reimprimir hoja" : "Imprimir hoja"}
                            </ImprimirHojaLink>
                          ) : (
                            <button type="button" disabled title={mensajeImpresionFueraDeOrden(result.primerSinImprimir!)} className="btn btn-secondary btn-sm">
                              <Printer className="size-4" aria-hidden />
                              Imprimir hoja
                            </button>
                          )
                        ) : null}
                        {dia.estado === "SIN_FIRMAR" && puedeFirmar ? (
                          <Link href="/cierres" className="btn btn-secondary btn-sm">
                            <PenLine className="size-4" aria-hidden />
                            Firmar
                          </Link>
                        ) : null}
                        <Link href={`/libro?fechaDesde=${dia.fecha}&fechaHasta=${dia.fecha}`} aria-label={`Ver los asientos del ${formatFechaIso(dia.fecha)}`} className="btn btn-ghost btn-sm btn-icon">
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación de los días del libro" />
      </div>
    </div>
  );
}
