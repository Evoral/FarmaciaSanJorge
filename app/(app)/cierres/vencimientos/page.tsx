/**
 * `/cierres/vencimientos` -- "Gestión DT › Vencimientos": the DROGA
 * partidas with saldo that wait on the Director Técnico
 * (docs/specs/reanalisis-partida.md; insumos are excluded, as in the spec).
 * Two groups: "Vencidas -- requieren acción" (blocked until the DT registers
 * a reanálisis or marks them as vencidas) and "Por vencer" (within
 * `dias_alerta_vencimiento_partida`).
 *
 * Everyone who can open the tab (`cierres.ver` + `stock.ver`) sees the list
 * (so they can warn the DT); the actions render only for the DT vigente, exactly as on
 * `/partidas/[id]` (`sesionEsDtVigente` + `stock.ajuste.autorizar`;
 * the commands re-check it, and so does the DB). Guard: `./layout.tsx`.
 */
import Link from "next/link";
import { ChevronRight, CircleCheck, Info } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listVencimientosDrogas, type VencimientoDroga } from "@/modules/stock/application/vencimientos-drogas";
import { diasHastaVencimiento, textoPorVencer } from "@/modules/stock/domain/vencimiento-partida";
import { MarcarVencidaDialog, ReanalisisDialog } from "@/modules/stock/ui/acciones-dt-partida";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { formatCantidad } from "@/shared/format/cantidad";
import { formatFecha } from "@/shared/format/fecha";
import { Cantidad } from "@/shared/ui/cantidad";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToneBadge } from "@/shared/ui/status-badge";
import { Toaster } from "@/shared/ui/toast";
import { SectionTabs } from "../../section-tabs";
import { gestionDtSections } from "../../nav-sections";

type Catalogo = Awaited<ReturnType<typeof getCatalogoUnidades>>["catalogo"];

function isoDe(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** "Venció hoy" / "Venció ayer" / "Venció hace N días" -- the vencida counterpart of `textoPorVencer`. */
function textoVencida(vigenteIso: string, jornadaActual: string): string {
  const dias = -diasHastaVencimiento(vigenteIso, jornadaActual);
  if (dias <= 0) return "Venció hoy";
  if (dias === 1) return "Venció ayer";
  return `Venció hace ${dias} días`;
}

export default async function VencimientosPage() {
  const session = await requireSession();
  const [vencimientos, { catalogo }] = await Promise.all([listVencimientosDrogas(), getCatalogoUnidades()]);
  const dtPuedeActuar = vencimientos.sesionEsDtVigente && can(session, "stock.ajuste.autorizar");
  const hayPendientes = vencimientos.vencidas.length + vencimientos.porVencer.length > 0;

  return (
    <div className="page list-view">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Gestión DT" }, { label: "Vencimientos" }]}
        title="Vencimientos"
        description={`Partidas de drogas con saldo vencidas o que vencen en los próximos ${vencimientos.diasAlertaVencimiento} días. Los insumos no se incluyen.`}
      />

      <SectionTabs ariaLabel="Secciones de gestión DT" links={gestionDtSections(session)} />

      {hayPendientes && !dtPuedeActuar ? (
        <div className="alert alert-info mb-6">
          <Info aria-hidden />
          <p>Solo el Director Técnico vigente puede registrar un reanálisis o marcar una partida como vencida. Avisale al Director Técnico.</p>
        </div>
      ) : null}

      <section aria-labelledby="vencidas-heading" className="mb-10">
        <div className="section-heading">
          <h2 id="vencidas-heading" className="flex items-center gap-2">
            Vencidas — requieren acción <span className="tab-count">{vencimientos.vencidas.length}</span>
          </h2>
        </div>
        <div className="list-panel">
          {vencimientos.vencidas.length === 0 ? (
            <EmptyState icon={<CircleCheck className="size-5" />} title="Sin partidas vencidas" description="Ninguna partida de droga vencida tiene saldo." />
          ) : (
            <TablaVencimientos
              filas={vencimientos.vencidas}
              vencida
              catalogo={catalogo}
              jornadaActual={vencimientos.jornadaActual}
              dtPuedeActuar={dtPuedeActuar}
              label="Partidas vencidas con saldo"
            />
          )}
        </div>
      </section>

      <section aria-labelledby="por-vencer-heading">
        <div className="section-heading">
          <h2 id="por-vencer-heading" className="flex items-center gap-2">
            Por vencer <span className="tab-count">{vencimientos.porVencer.length}</span>
          </h2>
        </div>
        <div className="list-panel">
          {vencimientos.porVencer.length === 0 ? (
            <EmptyState
              icon={<CircleCheck className="size-5" />}
              title="Sin partidas por vencer"
              description={`Ninguna partida de droga con saldo vence en los próximos ${vencimientos.diasAlertaVencimiento} días.`}
            />
          ) : (
            <TablaVencimientos
              filas={vencimientos.porVencer}
              vencida={false}
              catalogo={catalogo}
              jornadaActual={vencimientos.jornadaActual}
              dtPuedeActuar={dtPuedeActuar}
              label="Partidas por vencer"
            />
          )}
        </div>
      </section>

      <Toaster />
    </div>
  );
}

interface TablaVencimientosProps {
  filas: VencimientoDroga[];
  vencida: boolean;
  catalogo: Catalogo;
  jornadaActual: string;
  dtPuedeActuar: boolean;
  label: string;
}

function TablaVencimientos({ filas, vencida, catalogo, jornadaActual, dtPuedeActuar, label }: TablaVencimientosProps) {
  return (
    <div className="table-wrap">
      <table className="data-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2">
              Droga
            </th>
            <th scope="col" className="hidden px-3 py-2 lg:table-cell">
              Proveedor
            </th>
            <th scope="col" className="px-3 py-2">
              Vencimiento
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Saldo
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => {
            const vigenteIso = isoDe(fila.fechaVencimiento);
            const saldo = formatCantidad(fila.cantidadDisponible, { id: fila.unidadBaseId, simbolo: fila.unidadBaseSimbolo }, catalogo);
            const partidaNombre = `${fila.drogaNombre} · lote ${fila.lote}`;
            return (
              <tr key={fila.partidaId}>
                <td className="px-3 py-2.5">
                  <span className="block break-words font-medium text-zinc-900">{fila.drogaNombre}</span>
                  <span className="block max-w-[16rem] break-words text-xs text-zinc-500">
                    Lote <span className="font-mono">{fila.lote}</span>
                    <span className="lg:hidden"> · {fila.proveedorRazonSocial}</span>
                  </span>
                </td>
                <td className="hidden px-3 py-2.5 text-zinc-700 lg:table-cell">{fila.proveedorRazonSocial}</td>
                <td className="px-3 py-2.5">
                  <span className="block whitespace-nowrap font-medium tabular-nums text-zinc-900">{formatFecha(fila.fechaVencimiento)}</span>
                  {fila.reanalizada ? (
                    <span className="block whitespace-nowrap text-xs text-zinc-500">
                      Reanalizada · original <span className="tabular-nums">{formatFecha(fila.fechaVencimientoOriginal)}</span>
                    </span>
                  ) : null}
                  <span className="mt-1 block">
                    <ToneBadge tone={vencida ? "danger" : "warn"}>{vencida ? textoVencida(vigenteIso, jornadaActual) : textoPorVencer(vigenteIso, jornadaActual)}</ToneBadge>
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">
                  <Cantidad valor={saldo} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1.5 md:flex-wrap md:gap-2">
                    {dtPuedeActuar ? (
                      <>
                        <ReanalisisDialog partidaId={fila.partidaId} partidaNombre={partidaNombre} jornadaActual={jornadaActual} destacado={vencida} compacto />
                        {vencida ? <MarcarVencidaDialog partidaId={fila.partidaId} partidaNombre={partidaNombre} saldoTexto={saldo.texto} compacto /> : null}
                      </>
                    ) : null}
                    <Link href={`/partidas/${fila.partidaId}`} aria-label={`Ver detalle de la partida ${fila.lote} de ${fila.drogaNombre}`} className="btn btn-ghost btn-sm">
                      <span className="hidden sm:inline">Partida</span>
                      <ChevronRight className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
