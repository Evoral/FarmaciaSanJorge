/**
 * `/recetas/[id]/items/[itemId]/cotizacion` (M10, FASE 7 point 7.4).
 * Calculate/view an ítem's cotización + history. Same permission-gate
 * discipline as the sibling `ficha-tecnica` page: the `/recetas/**` layout
 * only requires `recetas.crear`, so this page adds its OWN gate on top.
 *
 * Layout: the vigente cotización (precio final first) and the history in
 * the main column; the ítem and the "calcular" action in the aside.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Calculator, FileText } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { getCotizacionItem } from "@/modules/precios/application/get-cotizacion-item";
import { CalcularCotizacionForm } from "@/modules/precios/ui/calcular-cotizacion-form";
import { CotizacionDetalleView } from "@/modules/precios/ui/cotizacion-detalle";
import { ItemContexto } from "@/modules/recetas/ui/item-contexto";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToneBadge } from "@/shared/ui/status-badge";

interface CotizacionPageProps {
  params: Promise<{ id: string; itemId: string }>;
}

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default async function CotizacionPage({ params }: CotizacionPageProps) {
  const session = await requireSession();
  const { id: recetaId, itemId } = await params;

  if (!can(session, "cotizaciones.calcular") && !can(session, "cotizaciones.ver")) {
    redirect(`/recetas/${recetaId}`);
  }

  const receta = await getReceta(recetaId);
  if (!receta) notFound();
  const item = receta.items.find((i) => i.id === itemId);
  if (!item) notFound();

  const puedeCalcular = can(session, "cotizaciones.calcular");
  const puedeVerFichas = can(session, "fichas.generar") || can(session, "fichas.imprimir");
  const { vigente, historial } = await getCotizacionItem({ itemRecetaId: itemId });
  const anteriores = historial.slice(1);
  const posicion = receta.items.findIndex((i) => i.id === itemId) + 1;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "Inicio", href: "/" },
          { label: "Recetas", href: "/recetas" },
          { label: `Nº ${receta.numeroInterno}`, href: `/recetas/${recetaId}` },
          { label: "Cotización" },
        ]}
        title="Cotización"
        description="Costo estimado del ítem con la ficha técnica vigente y el margen de su tramo."
        actions={
          puedeVerFichas ? (
            <Link href={`/recetas/${recetaId}/items/${itemId}/ficha-tecnica`} className="btn btn-secondary">
              <FileText className="size-4" aria-hidden />
              Ficha técnica
            </Link>
          ) : null
        }
      />

      <div className="split-layout">
        <div className="flex min-w-0 flex-col gap-6">
          {vigente ? (
            <CotizacionDetalleView cotizacion={vigente} />
          ) : (
            <section className="panel" aria-label="Cotización vigente">
              <EmptyState
                icon={<Calculator className="size-5" />}
                title="Este ítem todavía no fue cotizado"
                description={puedeCalcular ? "Calculá la cotización desde el panel de la derecha. Necesita una ficha técnica generada." : undefined}
              />
            </section>
          )}

          {anteriores.length > 0 ? (
            <section aria-labelledby="historial-heading" className="panel">
              <div className="panel-header">
                <h2 id="historial-heading" className="flex items-center gap-2">
                  Historial <span className="tab-count">{anteriores.length}</span>
                </h2>
                <p>Cotizaciones anteriores, de la más reciente a la más antigua.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="px-5 py-2">
                        Calculada
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Costo insumos
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Margen
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Precio final
                      </th>
                      <th scope="col" className="px-5 py-2">
                        <span className="sr-only">Observaciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {anteriores.map((c) => (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">{fechaHora(c.calculadaEn)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">${c.costoInsumos}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{c.margenAplicado}%</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium text-zinc-900 tabular-nums">${c.precioFinal}</td>
                        <td className="px-5 py-2.5">
                          <span className="flex flex-wrap gap-1.5">
                            {c.precioMinimoAplicado ? <ToneBadge tone="neutral">Precio mínimo aplicado</ToneBadge> : null}
                            {c.esParcial ? <ToneBadge tone="warn">Parcial</ToneBadge> : null}
                            {c.esIncompleta ? <ToneBadge tone="danger">Incompleta</ToneBadge> : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="split-aside flex flex-col gap-4" aria-label="Ítem y acciones">
          <ItemContexto item={item} posicion={posicion} />

          {puedeCalcular ? (
            <section className="panel" aria-labelledby="calcular-heading">
              <div className="panel-header">
                <h2 id="calcular-heading">{vigente ? "Recalcular" : "Calcular cotización"}</h2>
              </div>
              <div className="panel-body flex flex-col gap-3">
                <p className="text-[0.8125rem] leading-relaxed text-zinc-600">
                  Calcular una cotización no descuenta stock, no asienta en el libro recetario ni reserva nada: solo estima el costo con la ficha técnica
                  vigente. Requiere que el ítem tenga una ficha técnica generada.
                </p>
                <CalcularCotizacionForm itemRecetaId={itemId} recetaId={recetaId} label={vigente ? "Recalcular cotización" : "Calcular cotización"} />
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
