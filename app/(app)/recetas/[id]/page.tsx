/** `/recetas/[id]` (FASE 6 points 6.3/6.5): detalle, anulación, link a edición. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { ORIGEN_RECETA_LABELS, esEstadoEditable, esEstadoTerminal, puedeAnular } from "@/modules/recetas/domain/receta";
import { anularRecetaAction } from "@/modules/recetas/ui/actions";
import { PARAM_AVISO, decodificarAvisos } from "@/modules/recetas/domain/avisos-generacion";
import { AvisosGeneracion } from "@/modules/recetas/ui/avisos-generacion";
import { AYUDA_ANULACION_PERMITIDA, MENSAJE_ANULACION_BLOQUEADA_POR_LIBRO, decidirAnulacion, mensajePreparacionEnCurso } from "@/modules/recetas/domain/anulacion";
import { MotivoForm } from "@/shared/ui/motivo-form";
import { StatusBadge } from "@/shared/ui/status-badge";
import { ESTADO_RECETA_LABELS, FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { ComponentesTabla } from "@/modules/recetas/ui/componentes-tabla";

interface RecetaDetallePageProps {
  params: Promise<{ id: string }>;
  /** `aviso`: notices from the automatic ficha/cotización generation after confirming/editing (codes only -- modules/recetas/domain/avisos-generacion.ts). */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function fecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function RecetaDetallePage({ params, searchParams }: RecetaDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  const receta = await getReceta(id);
  if (!receta) notFound();

  const avisos = decodificarAvisos((await searchParams)[PARAM_AVISO], receta.items.length);

  const puedeEditar = can(session, "recetas.editar") && esEstadoEditable(receta.estado);
  const puedeAnularReceta = can(session, "recetas.anular") && puedeAnular(receta.estado);
  // Same decision the anular command enforces (domain/anulacion.ts): the libro may forbid a direct anulación.
  const anulacion = decidirAnulacion({
    estado: receta.estado,
    itemIds: receta.items.map((i) => i.id),
    asientosEnEfecto: receta.asientosEnEfecto,
    itemsConPreparacionIniciada: receta.itemsConPreparacionIniciada,
  });
  const puedeVerLibro = can(session, "libro.ver");
  const puedeVerFichas = can(session, "fichas.generar") || can(session, "fichas.imprimir");
  const puedeVerCotizacion = can(session, "cotizaciones.calcular") || can(session, "cotizaciones.ver");

  return (
    <div className="page">
      <div className="mb-2">
        <Link href="/recetas" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Receta Nº {receta.numeroInterno}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {receta.pacienteNombre} {receta.pacienteApellido} — Dr./Dra. {receta.medicoApellido}, {receta.medicoNombre} (matrícula {receta.medicoMatricula})
          </p>
        </div>
        {puedeEditar ? (
          <Link href={`/recetas/${receta.id}/editar`} className="btn btn-secondary">
            Editar
          </Link>
        ) : null}
      </div>

      <AvisosGeneracion avisos={avisos} />

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-zinc-500">Estado</dt>
          <dd><StatusBadge estado={receta.estado} /></dd>
        </div>
        <div>
          <dt className="text-zinc-500">Origen</dt>
          <dd>{ORIGEN_RECETA_LABELS[receta.origen]}</dd>
        </div>
        {receta.emisor ? (
          <div>
            <dt className="text-zinc-500">Receta del emisor</dt>
            <dd>
              {receta.emisor} Nº {receta.nroRecetaEmisor}
              {receta.urlVerificacion && /^https?:\/\//i.test(receta.urlVerificacion) ? (
                <>
                  {" "}
                  (
                  <a href={receta.urlVerificacion} target="_blank" rel="noopener noreferrer" className="underline">
                    verificar
                  </a>
                  )
                </>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-zinc-500">Fecha de prescripción</dt>
          <dd>{fecha(receta.fechaPrescripcion)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Fecha de ingreso</dt>
          <dd>{fecha(receta.fechaIngreso)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Registrada por</dt>
          <dd>{receta.registradaPorNombre}</dd>
        </div>
        {receta.diagnosticoCodigo || receta.diagnosticoDescripcion ? (
          <div className="col-span-full">
            <dt className="text-zinc-500">Diagnóstico</dt>
            <dd>{[receta.diagnosticoCodigo, receta.diagnosticoDescripcion].filter(Boolean).join(" - ")}</dd>
          </div>
        ) : null}
        {receta.motivoAnulacion ? (
          <div className="col-span-full">
            <dt className="text-zinc-500">Motivo de anulación</dt>
            <dd>{receta.motivoAnulacion}</dd>
          </div>
        ) : null}
      </dl>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-medium">Ítems</h2>
        <div className="flex flex-col gap-4">
          {receta.items.map((item, idx) => (
            <div key={item.id} className="card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Ítem {idx + 1}: {item.descripcion ?? FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]} ({FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]}) — {item.cantidadUnidades} unidad
                  {item.cantidadUnidades === 1 ? "" : "es"}
                  {item.cantidadTotal ? `, total ${item.cantidadTotal} ${item.unidadTotalSimbolo ?? ""}` : ""}
                  {item.estadoAsiento === "SIN_EFECTO" ? (
                    <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Sin efecto
                    </span>
                  ) : null}
                </p>
                <div className="flex gap-3">
                  {puedeVerFichas ? (
                    <Link href={`/recetas/${receta.id}/items/${item.id}/ficha-tecnica`} className="text-sm underline">
                      Ficha técnica
                    </Link>
                  ) : null}
                  {puedeVerCotizacion ? (
                    <Link href={`/recetas/${receta.id}/items/${item.id}/cotizacion`} className="text-sm underline">
                      Cotización
                    </Link>
                  ) : null}
                </div>
              </div>
              {item.posologia || item.duracionTratamientoDias ? (
                <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {item.posologia ? `Posología: ${item.posologia}` : ""}
                  {item.posologia && item.duracionTratamientoDias ? " · " : ""}
                  {item.duracionTratamientoDias ? `Tratamiento por ${item.duracionTratamientoDias} día${item.duracionTratamientoDias === 1 ? "" : "s"}` : ""}
                </p>
              ) : null}
              <ComponentesTabla componentes={item.componentes} />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        {puedeAnularReceta ? (
          <div>
            <h2 className="mb-2 text-lg font-medium">Anulación</h2>
            {anulacion.tipo === "bloqueada-libro" ? (
              <div className="text-sm">
                <p className="mb-2">{MENSAJE_ANULACION_BLOQUEADA_POR_LIBRO}</p>
                <ul className="list-disc pl-5">
                  {anulacion.asientos.map((a) => (
                    <li key={a.asientoId}>
                      {puedeVerLibro ? (
                        <Link href={`/libro/${a.asientoId}`} className="underline">
                          Asiento Nº {a.numeroCorrelativo} (ítem {a.item})
                        </Link>
                      ) : (
                        <>
                          Asiento Nº {a.numeroCorrelativo} (ítem {a.item})
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : anulacion.tipo === "bloqueada-preparacion" ? (
              <p className="text-sm">{mensajePreparacionEnCurso(anulacion.item)}</p>
            ) : (
              <MotivoForm
                action={anularRecetaAction}
                id={receta.id}
                label="Anular receta"
                pendingLabel="Anulando…"
                helpText={AYUDA_ANULACION_PERMITIDA}
                variant="danger"
              />
            )}
          </div>
        ) : null}

        {esEstadoTerminal(receta.estado) && !puedeAnularReceta ? <p className="text-sm text-zinc-500">La receta está {ESTADO_RECETA_LABELS[receta.estado].toLowerCase()}; no admite más cambios.</p> : null}
      </section>
    </div>
  );
}
