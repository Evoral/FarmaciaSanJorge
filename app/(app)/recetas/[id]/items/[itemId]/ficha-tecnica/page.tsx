/**
 * `/recetas/[id]/items/[itemId]/ficha-tecnica` (M10, FASE 7 points 7.2/7.3).
 * Generate/view versions of an ítem's ficha técnica + print. The `/recetas/**`
 * layout only requires `recetas.crear` (ATP included); `fichas.*` is
 * FAR/DT-only (plan §7), so this page adds its OWN permission gate on top,
 * same discipline as modules/recetas/ui pages that check beyond the layout
 * (e.g. `puedeEditar` in `[id]/page.tsx`).
 *
 * Layout: the versions (in the order the query returns them) in the main column;
 * the ítem and the "generar" action in the aside.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Calculator, FileText, FlaskConical } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { listVersionesFicha } from "@/modules/elaboracion/application/list-versiones-ficha";
import { GenerarFichaForm } from "@/modules/elaboracion/ui/generar-ficha-form";
import { FichaVersionResumen } from "@/modules/elaboracion/ui/ficha-version-resumen";
import { IniciarPreparacionForm } from "@/modules/preparaciones/ui/iniciar-form";
import { ItemContexto } from "@/modules/recetas/ui/item-contexto";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusBadge } from "@/shared/ui/status-badge";

interface FichaTecnicaPageProps {
  params: Promise<{ id: string; itemId: string }>;
}

function fechaHora(d: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

export default async function FichaTecnicaPage({ params }: FichaTecnicaPageProps) {
  const session = await requireSession();
  const { id: recetaId, itemId } = await params;

  if (!can(session, "fichas.generar") && !can(session, "fichas.imprimir")) {
    redirect(`/recetas/${recetaId}`);
  }

  const receta = await getReceta(recetaId);
  if (!receta) notFound();
  const item = receta.items.find((i) => i.id === itemId);
  if (!item) notFound();

  const versiones = await listVersionesFicha(itemId);
  const puedeImprimir = can(session, "fichas.imprimir");
  const puedeIniciarPreparacion = can(session, "preparaciones.iniciar");
  const puedeVerCotizacion = can(session, "cotizaciones.calcular") || can(session, "cotizaciones.ver");
  // One preparación per item at a time: while one is INICIADA (any version) it is continued, not started again; once one is
  // CONFIRMADA the item is done (an asiento later dejado "sin efecto" keeps its CONFIRMADA preparación, so it stays done); only a
  // DESCARTADA one lets it start again. Same rule as the /preparaciones "Pendientes" tab.
  const itemEnCurso = versiones.some((v) => v.preparacionActual?.estado === "INICIADA" || v.preparacionActual?.estado === "CONFIRMADA");
  // Once the item's preparación is CONFIRMADA no new version can ever be prepared, so generating is closed (also refused by generarFichaTecnica).
  const itemConfirmado = versiones.some((v) => v.preparacionActual?.estado === "CONFIRMADA");
  const puedeGenerar = can(session, "fichas.generar") && !itemConfirmado;
  const posicion = receta.items.findIndex((i) => i.id === itemId) + 1;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "Inicio", href: "/" },
          { label: "Recetas", href: "/recetas" },
          { label: `Nº ${receta.numeroInterno}`, href: `/recetas/${recetaId}` },
          { label: "Ficha técnica" },
        ]}
        title="Ficha técnica"
        description={
          itemConfirmado
            ? "Líneas de pesaje calculadas para este ítem. Ya tiene una preparación confirmada: no se generan versiones nuevas."
            : "Líneas de pesaje calculadas para este ítem. Cada generación crea una versión nueva."
        }
        actions={
          puedeVerCotizacion ? (
            <Link href={`/recetas/${recetaId}/items/${itemId}/cotizacion`} className="btn btn-secondary">
              <Calculator className="size-4" aria-hidden />
              Cotización
            </Link>
          ) : null
        }
      />

      <div className="split-layout">
        <section aria-labelledby="versiones-heading" className="panel min-w-0">
          <div className="panel-header flex items-center justify-between gap-2">
            <h2 id="versiones-heading" className="flex items-center gap-2">
              Versiones <span className="tab-count">{versiones.length}</span>
            </h2>
          </div>
          {versiones.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-5" />}
              title="Todavía no hay fichas técnicas"
              description={puedeGenerar ? "Generá la primera versión desde el panel de la derecha." : "Todavía no se generó ninguna ficha técnica para este ítem."}
            />
          ) : (
            <ul>
              {versiones.map((v) => (
                <li key={v.id} className="border-b border-zinc-100 px-5 py-4 last:border-b-0">
                  <FichaVersionResumen
                    fichaTecnicaId={v.id}
                    version={v.version}
                    cantidadLineas={v.cantidadLineas}
                    generadaEnTexto={fechaHora(v.generadaEn)}
                    generadaPorNombre={v.generadaPorNombre}
                    puedeImprimir={puedeImprimir}
                    detalle={
                      v.preparacionActual ? (
                        <p className="mt-1.5 flex items-center gap-2 text-xs text-zinc-600">
                          Preparación asociada:
                          <Link href={`/preparaciones/${v.preparacionActual.id}`} className="rounded-sm hover:opacity-80">
                            <StatusBadge estado={v.preparacionActual.estado} />
                          </Link>
                        </p>
                      ) : null
                    }
                    acciones={
                      puedeIniciarPreparacion && v.preparacionActual?.estado === "INICIADA" ? (
                        <Link href={`/preparaciones/${v.preparacionActual.id}`} className="btn btn-primary btn-sm">
                          <FlaskConical className="size-3.5" aria-hidden />
                          Continuar preparación
                        </Link>
                      ) : puedeIniciarPreparacion && !v.preparacionActual && !itemEnCurso ? (
                        <IniciarPreparacionForm fichaTecnicaId={v.id} />
                      ) : null
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="split-aside flex flex-col gap-4" aria-label="Ítem y acciones">
          <ItemContexto item={item} posicion={posicion} />

          {puedeGenerar ? (
            <section className="panel" aria-labelledby="generar-heading">
              <div className="panel-header">
                <h2 id="generar-heading">{versiones.length === 0 ? "Generar ficha técnica" : "Nueva versión"}</h2>
              </div>
              <div className="panel-body flex flex-col gap-3">
                <p className="text-[0.8125rem] leading-relaxed text-zinc-600">
                  Generar una ficha técnica no descuenta stock ni asienta en el libro recetario: es solo el cálculo de las líneas de pesaje. Siempre crea
                  una versión nueva; no modifica ni reemplaza las anteriores.
                </p>
                <GenerarFichaForm itemRecetaId={itemId} recetaId={recetaId} label={versiones.length === 0 ? "Generar ficha técnica" : "Generar nueva versión"} />
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
