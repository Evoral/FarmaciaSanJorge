/**
 * `/stock/partidas/[id]` (M07, FASE 5 points 5.2/5.4/5.5): partida detail + kardex + ajustar/corregir costo.
 *
 * Layout: the kardex (what happened) in the main column; the balance as the lead number, the partida's data and
 * the cost correction in the aside.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, SlidersHorizontal } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getPartida } from "@/modules/stock/application/get-partida";
import { kardexMovimientos } from "@/modules/stock/application/kardex-movimientos";
import { NotFoundError } from "@/shared/errors";
import { CorregirCostoForm } from "@/modules/stock/ui/corregir-costo-form";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad, formatCantidadesFila } from "@/shared/format/cantidad";
import { Cantidad } from "@/shared/ui/cantidad";
import { TIPO_MOVIMIENTO_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToneBadge } from "@/shared/ui/status-badge";

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

interface PartidaDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function PartidaDetallePage({ params }: PartidaDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  let partida;
  try {
    partida = await getPartida(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [kardex, { catalogo }] = await Promise.all([kardexMovimientos({ partidaId: id, page: 1, pageSize: 50 }), getCatalogoUnidades()]);
  const unidad = { id: partida.unidadBaseId, simbolo: partida.unidadBaseSimbolo };
  // Saldo and cantidad inicial side by side: one unit for both.
  const [disponible, inicial] = formatCantidadesFila([partida.cantidadDisponible, partida.cantidadInicial], unidad, catalogo);
  const puedeCorregirCosto = can(session, "stock.partida.costo.corregir");
  const puedeAjustar = can(session, "stock.ajuste.registrar");

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Stock", href: "/stock" }, { label: `Lote ${partida.lote}` }]}
        title={partida.drogaNombre}
        description={
          <>
            Lote <span className="font-mono text-zinc-900">{partida.lote}</span> de {partida.proveedorRazonSocial}
          </>
        }
        actions={
          puedeAjustar ? (
            <Link href={`/stock/ajustes/nuevo?partidaId=${partida.id}`} className="btn btn-secondary">
              <SlidersHorizontal className="size-4" aria-hidden />
              Registrar ajuste
            </Link>
          ) : null
        }
      />

      <div className="split-layout">
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
                    <th scope="col" className="px-3 py-2">
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
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">
                        <Cantidad valor={formatCantidad(mov.cantidad, { id: mov.unidadId, simbolo: mov.unidadSimbolo }, catalogo)} />
                      </td>
                      <td className="max-w-[28ch] px-3 py-2.5 text-zinc-700">
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
        </section>

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
            </div>
            <div className="border-t border-zinc-100 p-5">
              <dl className="summary-dl">
                <dt>Costo unitario</dt>
                <dd className="font-mono tabular-nums">{partida.costoUnitario}</dd>
                <dt>Pureza</dt>
                <dd className="font-mono tabular-nums">{partida.potenciaDeclarada !== null ? `${partida.potenciaDeclarada} %` : "No declarada (100 %)"}</dd>
                <dt>Vencimiento</dt>
                <dd className="tabular-nums">{partida.fechaVencimiento ? formatFecha(partida.fechaVencimiento) : "No vence"}</dd>
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
    </div>
  );
}
