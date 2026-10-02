/**
 * `/recetas/[id]/items/[itemId]/ficha-tecnica` (M10, FASE 7 points 7.2/7.3).
 * Generate/view versions of an ítem's ficha técnica + print. The `/recetas/**`
 * layout only requires `recetas.crear` (ATP included); `fichas.*` is
 * FAR/DT-only (plan §7), so this page adds its OWN permission gate on top,
 * same discipline as modules/recetas/ui pages that check beyond the layout
 * (e.g. `puedeEditar` in `[id]/page.tsx`).
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { ESTADO_PREPARACION_LABELS, FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { listVersionesFicha } from "@/modules/elaboracion/application/list-versiones-ficha";
import { GenerarFichaForm } from "@/modules/elaboracion/ui/generar-ficha-form";
import { FichaVersionResumen } from "@/modules/elaboracion/ui/ficha-version-resumen";
import { IniciarPreparacionForm } from "@/modules/preparaciones/ui/iniciar-form";

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
  const puedeGenerar = can(session, "fichas.generar");
  const puedeImprimir = can(session, "fichas.imprimir");
  const puedeIniciarPreparacion = can(session, "preparaciones.iniciar");
  // One preparación per item at a time: while one is INICIADA (any version) it is continued, not started again; once one is
  // CONFIRMADA the item is done (an asiento later dejado "sin efecto" keeps its CONFIRMADA preparación, so it stays done); only a
  // DESCARTADA one lets it start again. Same rule as the /preparaciones "Pendientes" tab.
  const itemEnCurso = versiones.some((v) => v.preparacionActual?.estado === "INICIADA" || v.preparacionActual?.estado === "CONFIRMADA");

  return (
    <div className="page">
      <div className="mb-2">
        <Link href={`/recetas/${recetaId}`} className="text-sm underline">
          ← Volver a la receta
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Ficha técnica</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Receta Nº {receta.numeroInterno} — {item.descripcion ?? FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]} ({FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]}) — {item.cantidadUnidades} unidad
          {item.cantidadUnidades === 1 ? "" : "es"}
          {item.cantidadTotal ? `, total ${item.cantidadTotal} ${item.unidadTotalSimbolo ?? ""}` : ""}
        </p>
      </div>

      {puedeGenerar ? (
        <section className="mb-6">
          <GenerarFichaForm itemRecetaId={itemId} recetaId={recetaId} label={versiones.length === 0 ? "Generar ficha técnica" : "Generar nueva versión"} />
          <p className="mt-2 text-xs text-zinc-500">
            Generar una ficha técnica no descuenta stock ni asienta en el libro recetario: es solo el cálculo de las líneas de pesaje. Siempre
            crea una versión nueva; no modifica ni reemplaza las anteriores.
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-medium">Versiones</h2>
        {versiones.length === 0 ? (
          <p className="text-sm text-zinc-500">Todavía no se generó ninguna ficha técnica para este ítem.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {versiones.map((v) => (
              <div key={v.id} className="card p-4">
                <FichaVersionResumen
                  fichaTecnicaId={v.id}
                  version={v.version}
                  cantidadLineas={v.cantidadLineas}
                  generadaEnTexto={fechaHora(v.generadaEn)}
                  generadaPorNombre={v.generadaPorNombre}
                  puedeImprimir={puedeImprimir}
                  detalle={
                    v.preparacionActual ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Preparación asociada:{" "}
                        <Link href={`/preparaciones/${v.preparacionActual.id}`} className="underline">
                          {etiquetaDe(ESTADO_PREPARACION_LABELS, v.preparacionActual.estado)}
                        </Link>
                      </p>
                    ) : null
                  }
                  acciones={
                    puedeIniciarPreparacion && v.preparacionActual?.estado === "INICIADA" ? (
                      <Link href={`/preparaciones/${v.preparacionActual.id}`} className="btn btn-primary">
                        Continuar preparación
                      </Link>
                    ) : puedeIniciarPreparacion && !v.preparacionActual && !itemEnCurso ? (
                      <IniciarPreparacionForm fichaTecnicaId={v.id} />
                    ) : null
                  }
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
