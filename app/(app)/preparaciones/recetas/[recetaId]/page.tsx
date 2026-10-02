/**
 * `/preparaciones/recetas/[recetaId]` (M11, /preparaciones design "B"): the
 * lab's workspace for a receta it took (modules/preparaciones/domain/toma.ts).
 * A static `recetas` segment, so it never collides with `/preparaciones/[id]`
 * (same as `/recetas/nuevo` next to `/recetas/[id]`).
 *
 * - The receta: while it is editable (`recetas.editar` and still
 *   PENDIENTE_PREPARACION), the SAME edit form as /recetas/[id]/editar,
 *   coming back here after saving (`volverA`, validated by the action);
 *   saving regenerates the fichas técnicas/cotizaciones as always and the
 *   generation notices show here. Otherwise read-only.
 * - Each ítem: where it stands (Pendiente / Confirmación en curso /
 *   Confirmada), its latest ficha técnica with its líneas de pesaje,
 *   "Generar ficha técnica" and the action -- "Confirmar terminación" starts
 *   the formal preparación (`preparaciones.iniciar`) and opens its
 *   confirmation screen; from then on the receta is EN_PREPARACION and can
 *   no longer be edited (existing rule).
 * - "Cancelar toma" sends the receta back to Pendientes (refused while a
 *   confirmation is in progress).
 *
 * Requires `preparaciones.iniciar` (the /preparaciones layout). A receta
 * nobody took goes back to the list; one that already left the lab, to its
 * detail page.
 */
import { createHash } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { ValidationError } from "@/shared/errors";
import { getTomaReceta } from "@/modules/preparaciones/application/get-toma-receta";
import type { ItemDeToma, RecetaDeToma } from "@/modules/preparaciones/application/get-toma-receta";
import { ESTADOS_RECETA_EN_LABORATORIO, ESTADO_ITEM_TOMA_LABELS, HREF_EN_CURSO, estadoItemToma, hrefToma } from "@/modules/preparaciones/domain/toma";
import type { EstadoItemToma } from "@/modules/preparaciones/domain/toma";
import { CancelarTomaForm } from "@/modules/preparaciones/ui/cancelar-toma-form";
import { IniciarPreparacionForm } from "@/modules/preparaciones/ui/iniciar-form";
import { ItemDatos } from "@/modules/preparaciones/ui/item-datos";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { listUnidadesParaReceta } from "@/modules/recetas/application/list-unidades-para-receta";
import { PARAM_AVISO, PARAM_GUARDADA, decodificarAvisos } from "@/modules/recetas/domain/avisos-generacion";
import { ORIGEN_RECETA_LABELS, esEstadoEditable } from "@/modules/recetas/domain/receta";
import { AvisosGeneracion } from "@/modules/recetas/ui/avisos-generacion";
import { RecetaForm } from "@/modules/recetas/ui/receta-form";
import { inicialDesdeReceta } from "@/modules/recetas/ui/receta-form-inicial";
import { FichaVersionResumen } from "@/modules/elaboracion/ui/ficha-version-resumen";
import { GenerarFichaForm } from "@/modules/elaboracion/ui/generar-ficha-form";
import { FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { StatusBadge } from "@/shared/ui/status-badge";

interface TomaRecetaPageProps {
  params: Promise<{ recetaId: string }>;
  /** `aviso`/`guardada`: after saving the embedded edit form (codes only -- modules/recetas/domain/avisos-generacion.ts). */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const TONO_ESTADO_ITEM: Record<EstadoItemToma, string> = {
  PENDIENTE: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  EN_CONFIRMACION: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  CONFIRMADA: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

async function leerReceta(recetaId: string): Promise<RecetaDeToma> {
  let receta: RecetaDeToma | null;
  try {
    receta = await getTomaReceta(recetaId);
  } catch (error) {
    // A malformed id in the URL.
    if (error instanceof ValidationError) notFound();
    throw error;
  }
  if (!receta) notFound();
  return receta;
}

export default async function TomaRecetaPage({ params, searchParams }: TomaRecetaPageProps) {
  const session = await requireSession();
  const { recetaId } = await params;
  const receta = await leerReceta(recetaId);

  if (!ESTADOS_RECETA_EN_LABORATORIO.has(receta.estado)) redirect(`/recetas/${receta.id}`);
  if (!receta.tomadaPorId) redirect("/preparaciones");

  const sp = await searchParams;
  const avisos = decodificarAvisos(sp[PARAM_AVISO], receta.items.length);
  const guardada = sp[PARAM_GUARDADA] === "1";

  // /recetas/[id]/editar's own gates: the /recetas layout and getReceta need `recetas.crear`.
  const puedeEditar = can(session, "recetas.editar") && can(session, "recetas.crear") && esEstadoEditable(receta.estado);
  const edicion = puedeEditar ? await datosEdicion(receta.id) : null;
  const puedeGenerarFicha = can(session, "fichas.generar");
  const puedeImprimirFicha = can(session, "fichas.imprimir");
  const confirmacionEnCurso = receta.items.findIndex((item) => item.preparacion?.estado === "INICIADA");

  return (
    <div className="page">
      <div className="mb-2">
        <Link href={HREF_EN_CURSO} className="text-sm underline">
          ← Volver a preparaciones
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Receta Nº {receta.numeroInterno}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {receta.pacienteNombre} {receta.pacienteApellido} — Dr./Dra. {receta.medicoApellido}, {receta.medicoNombre} (matrícula {receta.medicoMatricula})
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge estado={receta.estado} />
            <span>
              Tomada por {receta.tomadaPorNombre} el {receta.tomadaEn ? formatFechaHora(receta.tomadaEn, receta.zonaHoraria) : "—"}
            </span>
          </p>
        </div>
        <div className="max-w-sm">
          {confirmacionEnCurso >= 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Para cancelar la toma, primero hay que descartar la preparación en curso del ítem {confirmacionEnCurso + 1}.
            </p>
          ) : (
            <CancelarTomaForm recetaId={receta.id} />
          )}
        </div>
      </div>

      <AvisosGeneracion exito={guardada ? "Receta actualizada." : undefined} avisos={avisos} />

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium">Receta</h2>
        {edicion ? (
          <>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Todavía se puede corregir. Al guardar, las fichas técnicas se recalculan con los datos nuevos.
            </p>
            <RecetaForm
              key={edicion.version}
              mode="editar"
              unidades={edicion.unidades}
              disabled={false}
              recetaId={receta.id}
              inicial={edicion.inicial}
              volverA={hrefToma(receta.id)}
            />
          </>
        ) : (
          <RecetaSoloLectura receta={receta} />
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-medium">Ítems</h2>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Una vez que empieza la confirmación de un ítem, la receta ya no se puede editar.
        </p>
        <div className="flex flex-col gap-4">
          {receta.items.map((item, idx) => (
            <ItemToma
              key={item.id}
              item={item}
              numero={idx + 1}
              recetaId={receta.id}
              zonaHoraria={receta.zonaHoraria}
              mostrarDatos={!edicion}
              puedeGenerarFicha={puedeGenerarFicha}
              puedeImprimirFicha={puedeImprimirFicha}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/** What the embedded edit form needs; `version` remounts it whenever the saved receta changes (the form keeps its own state). */
async function datosEdicion(recetaId: string) {
  const [detalle, unidades] = await Promise.all([getReceta(recetaId), listUnidadesParaReceta()]);
  if (!detalle) return null;
  const inicial = inicialDesdeReceta(detalle);
  return { inicial, unidades, version: createHash("sha256").update(JSON.stringify(inicial)).digest("hex") };
}

function RecetaSoloLectura({ receta }: { receta: RecetaDeToma }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-zinc-500">Origen</dt>
        <dd>{etiquetaDe(ORIGEN_RECETA_LABELS, receta.origen)}</dd>
      </div>
      <div>
        <dt className="text-zinc-500">Fecha de prescripción</dt>
        <dd>{formatFecha(receta.fechaPrescripcion)}</dd>
      </div>
      <div>
        <dt className="text-zinc-500">Fecha de ingreso</dt>
        <dd>{formatFecha(receta.fechaIngreso, receta.zonaHoraria)}</dd>
      </div>
      {receta.diagnosticoCodigo || receta.diagnosticoDescripcion ? (
        <div className="col-span-full">
          <dt className="text-zinc-500">Diagnóstico</dt>
          <dd>{[receta.diagnosticoCodigo, receta.diagnosticoDescripcion].filter(Boolean).join(" - ")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function ItemToma({
  item,
  numero,
  recetaId,
  zonaHoraria,
  mostrarDatos,
  puedeGenerarFicha,
  puedeImprimirFicha,
}: {
  item: ItemDeToma;
  numero: number;
  recetaId: string;
  zonaHoraria: string;
  /** The receta's data, when the edit form above is not already showing it. */
  mostrarDatos: boolean;
  puedeGenerarFicha: boolean;
  puedeImprimirFicha: boolean;
}) {
  const estado = estadoItemToma(item.preparacion);
  const ficha = item.ultimaFicha;
  const nombre = item.descripcion ?? etiquetaDe(FORMA_FARMACEUTICA_LABELS, item.formaFarmaceutica);

  return (
    <article className="card p-4" aria-label={`Ítem ${numero}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Ítem {numero}: {nombre}
        </h3>
        <span className={`badge ${TONO_ESTADO_ITEM[estado]}`}>{ESTADO_ITEM_TOMA_LABELS[estado]}</span>
      </div>

      {mostrarDatos ? (
        <div className="mb-4">
          <ItemDatos item={item} />
        </div>
      ) : null}

      <div className="mb-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <h4 className="mb-2 text-sm font-medium">Ficha técnica</h4>
        {ficha ? (
          <>
            <FichaVersionResumen
              fichaTecnicaId={ficha.id}
              version={ficha.version}
              cantidadLineas={ficha.lineas.length}
              generadaEnTexto={formatFechaHora(ficha.generadaEn, zonaHoraria)}
              generadaPorNombre={ficha.generadaPorNombre}
              puedeImprimir={puedeImprimirFicha}
            />
            <div className="table-wrap mt-2">
              <table className="data-table">
                <thead className="border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th scope="col" className="py-1 font-medium">Droga</th>
                    <th scope="col" className="py-1 font-medium">Teórica</th>
                    <th scope="col" className="py-1 font-medium">Exceso %</th>
                    <th scope="col" className="py-1 font-medium">A pesar</th>
                  </tr>
                </thead>
                <tbody>
                  {ficha.lineas.map((linea) => (
                    <tr key={linea.orden}>
                      <td className="py-1">{linea.drogaNombre}</td>
                      <td className="py-1">{linea.cantidadTeorica ? `${linea.cantidadTeorica} ${linea.unidadSimbolo}` : "—"}</td>
                      <td className="py-1">{linea.excesoAplicado}</td>
                      <td className="py-1">
                        {linea.esEnraseManual ? "Enrase manual (se registra al confirmar)" : linea.cantidadAPesar ? `${linea.cantidadAPesar} ${linea.unidadSimbolo}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Todavía no se generó la ficha técnica de este ítem.</p>
        )}
        {puedeGenerarFicha && estado === "PENDIENTE" ? (
          <div className="mt-3">
            <GenerarFichaForm itemRecetaId={item.id} recetaId={recetaId} label={ficha ? "Generar nueva versión" : "Generar ficha técnica"} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {estado === "CONFIRMADA" && item.preparacion ? (
          <>
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Confirmada</span>
            <Link href={`/preparaciones/${item.preparacion.id}`} className="text-sm underline">
              Ver preparación
            </Link>
          </>
        ) : estado === "EN_CONFIRMACION" && item.preparacion ? (
          <Link href={`/preparaciones/${item.preparacion.id}`} className="btn btn-primary">
            Continuar confirmación
          </Link>
        ) : ficha ? (
          <IniciarPreparacionForm fichaTecnicaId={ficha.id} label="Confirmar terminación" pendingLabel="Iniciando…" />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {puedeGenerarFicha ? "Generá la ficha técnica para poder confirmar la terminación." : "Falta generar la ficha técnica de este ítem para poder confirmar la terminación."}
          </p>
        )}
      </div>
    </article>
  );
}
