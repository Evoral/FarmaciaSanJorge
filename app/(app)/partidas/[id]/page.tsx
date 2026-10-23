/**
 * `/partidas/[id]` (M07, FASE 5 points 5.2/5.4/5.5): partida detail + kardex + ajustar/corregir costo.
 *
 * Layout: the kardex (what happened) in the main column; the balance as the lead number, the partida's data and
 * the cost correction in the aside.
 *
 * Expiry (docs/specs/reanalisis-partida.md): the vencimiento VIGENTE with its estado, the original date when a
 * reanálisis moved it, and the reanálisis history under the kardex. A vencida DROGA partida with saldo is blocked
 * until the DT acts: everyone sees "requiere acción del DT"; only a DT vigente gets "Registrar reanálisis" /
 * "Marcar como vencida" (a por vencer or vigente droga partida: reanálisis only).
 *
 * "Historial" (lot tracing: which recetas consumed this partida) opens the droga's historial already filtered by
 * this partida (docs/specs/historial-droga.md) -- shown only when that page would open, never a redirect.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, FlaskConical, History, ScrollText, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getPartida } from "@/modules/stock/application/get-partida";
import { puedeVerHistorialDroga } from "@/modules/drogas/application/get-historial-droga";
import { hrefHistorialDroga } from "@/modules/drogas/domain/historial";
import { kardexMovimientos } from "@/modules/stock/application/kardex-movimientos";
import { NotFoundError } from "@/shared/errors";
import { CorregirCostoForm } from "@/modules/stock/ui/corregir-costo-form";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad, formatCantidadesFila } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { TIPO_MOVIMIENTO_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusBadge, ToneBadge } from "@/shared/ui/status-badge";
import { Pagination } from "@/shared/ui/pagination";
import { Toaster } from "@/shared/ui/toast";
import { dec } from "@/shared/decimal";
import { formatFecha as formatFechaCalendario } from "@/shared/format/fecha";
import { textoPorVencer } from "@/modules/stock/domain/vencimiento-partida";
import { MarcarVencidaDialog, ReanalisisDialog } from "@/modules/stock/ui/acciones-dt-partida";

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }).format(fecha);
}

function Vacio({ label }: { label: string }) {
  return (
    <span className="text-zinc-400">
      -<span className="sr-only">{label}</span>
    </span>
  );
}

const KARDEX_PAGE_SIZE = 20;

interface PartidaDetallePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PartidaDetallePage({ params, searchParams }: PartidaDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const pageParam = typeof query.page === "string" ? query.page : undefined;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  let partida: Awaited<ReturnType<typeof getPartida>>;
  try {
    partida = await getPartida(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [kardex, { catalogo }] = await Promise.all([kardexMovimientos({ partidaId: id, page, pageSize: KARDEX_PAGE_SIZE }), getCatalogoUnidades()]);
  const unidad = { id: partida.unidadBaseId, simbolo: partida.unidadBaseSimbolo };
  // Saldo and cantidad inicial side by side: one unit for both (and for the part reserved by preparaciones, migration 0071).
  const [disponible, inicial, reservada] = formatCantidadesFila([partida.cantidadDisponible, partida.cantidadInicial, partida.cantidadReservada], unidad, catalogo);
  const puedeCorregirCosto = can(session, "stock.partida.costo.corregir");
  const puedeAjustar = can(session, "stock.ajuste.registrar");
  // Same gates as /catalogos/drogas/[id]/historial (its section guard + its use case), so the link never redirects.
  const puedeVerHistorial = can(session, "drogas.editar") && puedeVerHistorialDroga(session);

  // Expiry: always on the vencimiento VIGENTE (latest reanálisis, else the original date).
  const vigenteIso = partida.fechaVencimientoVigente ? partida.fechaVencimientoVigente.toISOString().slice(0, 10) : null;
  const reanalizada = partida.reanalisis.length > 0;
  const esDroga = partida.drogaClase === "DROGA";
  const tieneSaldo = dec(partida.cantidadDisponible).greaterThan(0);
  const vencida = partida.estadoVencimiento === "VENCIDA";
  const porVencer = partida.estadoVencimiento === "POR_VENCER";
  // Only a DT vigente acts; only on a DROGA partida with saldo (saldo 0 is terminal).
  const dtPuedeActuar = partida.sesionEsDtVigente && can(session, "stock.ajuste.autorizar") && esDroga && tieneSaldo && vigenteIso !== null;
  const partidaNombre = `${partida.drogaNombre} · lote ${partida.lote}`;

  // Kardex page links keep any other query param of the page.
  function kardexPageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === "page" || value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
    }
    qs.set("page", String(targetPage));
    return `/partidas/${id}?${qs.toString()}`;
  }

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: `Lote ${partida.lote}` }]}
        title={partida.drogaNombre}
        description={
          <>
            Lote <span className="font-mono text-zinc-900">{partida.lote}</span>
            {partida.origen === "EXISTENCIA_INICIAL"
              ? `${partida.proveedorId ? ` de ${partida.proveedorRazonSocial}` : ""} · existencia inicial`
              : ` de ${partida.proveedorRazonSocial}`}
          </>
        }
        actions={
          puedeVerHistorial || puedeAjustar ? (
            <>
              {puedeVerHistorial ? (
                <Link
                  href={hrefHistorialDroga(`/catalogos/drogas/${partida.drogaId}/historial`, [partida.id])}
                  className="btn btn-secondary"
                  title="Recetas en las que se usó este lote"
                >
                  <ScrollText className="size-4" aria-hidden />
                  Historial
                </Link>
              ) : null}
              {puedeAjustar ? (
                <Link href={`/stock/ajustes/nuevo?partidaId=${partida.id}`} className="btn btn-secondary">
                  <SlidersHorizontal className="size-4" aria-hidden />
                  Registrar ajuste
                </Link>
              ) : null}
            </>
          ) : null
        }
      />

      {tieneSaldo && vencida ? (
        <div role="alert" className="alert alert-danger mb-4">
          <CircleAlert aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            {esDroga ? (
              <p>
                <strong>Partida vencida: requiere acción del DT.</strong> Está bloqueada: no se puede reservar ni descontar hasta que el Director Técnico registre un
                reanálisis o la marque como vencida.{dtPuedeActuar ? null : " Avisale al Director Técnico."}
              </p>
            ) : (
              <p>
                <strong>Partida vencida.</strong> No se puede usar en preparaciones; registrá un ajuste por vencimiento para descontar su saldo.
              </p>
            )}
            {dtPuedeActuar ? (
              <div className="flex flex-wrap gap-2">
                <ReanalisisDialog partidaId={partida.id} partidaNombre={partidaNombre} jornadaActual={partida.jornadaActual} destacado />
                <MarcarVencidaDialog partidaId={partida.id} partidaNombre={partidaNombre} saldoTexto={disponible!.texto} />
              </div>
            ) : null}
          </div>
        </div>
      ) : tieneSaldo && porVencer && vigenteIso ? (
        <div className="alert alert-warn mb-4">
          <TriangleAlert aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <p>
              <strong>{textoPorVencer(vigenteIso, partida.jornadaActual)}</strong> ({formatFechaCalendario(partida.fechaVencimientoVigente!)}).
              {esDroga ? " Al vencer queda bloqueada hasta que el Director Técnico registre un reanálisis o la marque como vencida." : null}
            </p>
            {dtPuedeActuar ? <ReanalisisDialog partidaId={partida.id} partidaNombre={partidaNombre} jornadaActual={partida.jornadaActual} destacado /> : null}
          </div>
        </div>
      ) : null}

      <div className="split-layout">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="kardex-heading" className="panel min-w-0">
            <div className="panel-header">
              <h2 id="kardex-heading">Kardex de movimientos</h2>
              <p>Cada ingreso, consumo y ajuste de esta partida.</p>
            </div>
            {kardex.items.length === 0 ? (
              <EmptyState icon={<History className="size-5" />} title="Sin movimientos registrados" />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="px-5 py-2">
                        Fecha
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Tipo
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Cantidad
                      </th>
                      <th scope="col" className="hidden px-3 py-2 md:table-cell">
                        Motivo
                      </th>
                      <th scope="col" className="hidden px-5 py-2 lg:table-cell">
                        Registrado / autorizado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {kardex.items.map((mov) => (
                      <tr key={mov.id}>
                        <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">{formatFecha(mov.registradoEn)}</td>
                        <td className="px-3 py-2.5">
                          <ToneBadge tone="neutral">{etiquetaDe(TIPO_MOVIMIENTO_LABELS, mov.tipo)}</ToneBadge>
                          {mov.motivoAjuste ?? mov.observacion ? (
                            <span className="mt-1 block max-w-[16rem] break-words text-xs text-zinc-500 md:hidden">{mov.motivoAjuste ?? mov.observacion}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">
                          <Cantidad valor={formatCantidad(mov.cantidad, { id: mov.unidadId, simbolo: mov.unidadSimbolo }, catalogo)} />
                        </td>
                        <td className="hidden max-w-[28ch] break-words px-3 py-2.5 text-zinc-700 md:table-cell">
                          {mov.motivoAjuste ?? mov.observacion ?? <Vacio label="Sin motivo" />}
                        </td>
                        <td className="hidden px-5 py-2.5 text-xs lg:table-cell">
                          <span className="block text-zinc-900">
                            {mov.registradoPorNombre} {mov.registradoPorApellido}
                          </span>
                          {mov.autorizadoPorNombre ? (
                            <span className="block text-zinc-500">
                              Autorizó {mov.autorizadoPorNombre} {mov.autorizadoPorApellido}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} pageSize={KARDEX_PAGE_SIZE} total={kardex.total} hrefFor={kardexPageHref} label="Paginación del kardex" />
          </section>

          {esDroga ? (
            <section aria-labelledby="reanalisis-heading" className="panel min-w-0">
              <div className="panel-header flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="reanalisis-heading">Reanálisis</h2>
                  <p>Cada reanálisis fija un nuevo vencimiento vigente; el vencimiento original no cambia.</p>
                </div>
                {dtPuedeActuar && !vencida && !porVencer ? (
                  <ReanalisisDialog partidaId={partida.id} partidaNombre={partidaNombre} jornadaActual={partida.jornadaActual} destacado={false} />
                ) : null}
              </div>
              {partida.reanalisis.length === 0 ? (
                <EmptyState icon={<FlaskConical className="size-5" />} title="Sin reanálisis registrados" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col" className="hidden px-5 py-2 md:table-cell">
                          Registrado
                        </th>
                        <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                          Vencimiento anterior
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Nuevo vencimiento
                        </th>
                        <th scope="col" className="px-3 py-2">
                          Respaldo / motivo
                        </th>
                        <th scope="col" className="hidden px-5 py-2 lg:table-cell">
                          Director Técnico
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {partida.reanalisis.map((r) => (
                        <tr key={r.id}>
                          <td className="hidden whitespace-nowrap px-5 py-2.5 tabular-nums md:table-cell">{formatFecha(r.registradoEn)}</td>
                          <td className="hidden whitespace-nowrap px-3 py-2.5 tabular-nums text-zinc-600 sm:table-cell">{formatFechaCalendario(r.fechaVencimientoAnterior)}</td>
                          <td className="px-3 py-2.5">
                            <span className="block whitespace-nowrap font-medium tabular-nums text-zinc-900">{formatFechaCalendario(r.fechaReanalisis)}</span>
                            <span className="block whitespace-nowrap text-xs tabular-nums text-zinc-500 sm:hidden">antes {formatFechaCalendario(r.fechaVencimientoAnterior)}</span>
                            <span className="block whitespace-nowrap text-xs tabular-nums text-zinc-500 md:hidden">{formatFecha(r.registradoEn)}</span>
                          </td>
                          <td className="max-w-[32ch] break-words px-3 py-2.5 text-zinc-700">
                            {r.respaldo ? <span className="block">{r.respaldo}</span> : null}
                            {r.motivo ? <span className="block text-xs text-zinc-500">{r.motivo}</span> : null}
                            {r.respaldo || r.motivo ? null : <Vacio label="Sin respaldo ni motivo" />}
                          </td>
                          <td className="hidden px-5 py-2.5 text-xs text-zinc-900 lg:table-cell">
                            {r.registradoPorNombre} {r.registradoPorApellido}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}
        </div>

        <aside className="split-aside flex flex-col gap-4" aria-label="Datos de la partida">
          <section className="panel" aria-labelledby="saldo-heading">
            <div className="p-5">
              <h2 id="saldo-heading" className="text-xs text-zinc-500">
                Saldo disponible
              </h2>
              <p className="mt-1 font-mono text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">
                <Cantidad valor={disponible!} />
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                de <Cantidad valor={inicial!} /> ingresados
              </p>
              {partida.cantidadReservada !== "0" ? (
                <p className="mt-2 text-xs text-zinc-600">
                  Reservado en preparación: <Cantidad valor={reservada!} />
                  {partida.recetasConReserva.length > 0 ? ` (receta ${partida.recetasConReserva.map((n) => `Nº ${n}`).join(", ")})` : null}
                </p>
              ) : null}
            </div>
            <div className="border-t border-zinc-100 p-5">
              <dl className="summary-dl">
                <dt>Costo unitario</dt>
                <dd className="font-mono tabular-nums">{partida.costoUnitario}</dd>
                <dt>Pureza</dt>
                <dd className="font-mono tabular-nums">{partida.potenciaDeclarada !== null ? `${partida.potenciaDeclarada} %` : "No declarada (100 %)"}</dd>
                <dt>{reanalizada ? "Vencimiento vigente" : "Vencimiento"}</dt>
                <dd className="flex flex-wrap items-center gap-1.5 tabular-nums">
                  {partida.fechaVencimientoVigente ? formatFechaCalendario(partida.fechaVencimientoVigente) : "No vence"}
                  {tieneSaldo && vencida ? <StatusBadge estado="VENCIDA" /> : null}
                  {tieneSaldo && porVencer ? <StatusBadge estado="POR_VENCER" /> : null}
                  {reanalizada ? <ToneBadge tone="neutral">Reanalizada</ToneBadge> : null}
                </dd>
                {reanalizada && partida.fechaVencimiento ? (
                  <>
                    <dt>Vencimiento original</dt>
                    <dd className="tabular-nums text-zinc-600">{formatFechaCalendario(partida.fechaVencimiento)}</dd>
                  </>
                ) : null}
                <dt>Ingreso</dt>
                <dd className="tabular-nums">{formatFecha(partida.fechaIngreso)}</dd>
                <dt>Estado</dt>
                <dd>{partida.fechaApertura ? `Abierta (${formatFecha(partida.fechaApertura)})` : "Cerrada"}</dd>
              </dl>
            </div>
          </section>

          {puedeCorregirCosto ? (
            <section className="panel" aria-labelledby="corregir-costo-heading">
              <div className="panel-header">
                <h2 id="corregir-costo-heading">Corregir costo</h2>
              </div>
              <div className="panel-body">
                <CorregirCostoForm partidaId={partida.id} costoUnitarioActual={partida.costoUnitario} />
              </div>
            </section>
          ) : null}
        </aside>
      </div>
      <Toaster />
    </div>
  );
}
