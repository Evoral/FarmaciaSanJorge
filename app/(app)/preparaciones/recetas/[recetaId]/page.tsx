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
import { ESTADOS_RECETA_EN_LABORATORIO, ESTADO_ITEM_TOMA_LABELS, HREF_EN_CURSO, estadoItemToma, etiquetaProgreso, hrefToma } from "@/modules/preparaciones/domain/toma";
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
import { StatusBadge, ToneBadge, type BadgeTone } from "@/shared/ui/status-badge";
import { PageHeader } from "@/shared/ui/page-header";
import { Avatar } from "@/shared/ui/avatar";
import { CircleCheck, FlaskConical, Lock, Stethoscope } from "lucide-react";

interface TomaRecetaPageProps {
  params: Promise<{ recetaId: string }>;
  /** `aviso`/`guardada`: after saving the embedded edit form (codes only -- modules/recetas/domain/avisos-generacion.ts). */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const TONO_ESTADO_ITEM: Record<EstadoItemToma, BadgeTone> = {
  PENDIENTE: "neutral",
  EN_CONFIRMACION: "warn",
  CONFIRMADA: "success",
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

  const estados = receta.items.map((item) => estadoItemToma(item.preparacion));
  const confirmados = estados.filter((estado) => estado === "CONFIRMADA").length;
  const paciente = `${receta.pacienteNombre} ${receta.pacienteApellido}`;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Preparaciones", href: HREF_EN_CURSO }, { label: `Receta Nº ${receta.numeroInterno}` }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Receta Nº <span className="font-mono">{receta.numeroInterno}</span>
            <StatusBadge estado={receta.estado} />
          </span>
        }
        description={
          <>
            Tomada por <strong className="font-medium text-zinc-900">{receta.tomadaPorNombre}</strong>
            {receta.tomadaEn ? <> el {formatFechaHora(receta.tomadaEn, receta.zonaHoraria)}</> : null}
          </>
        }
        actions={
          confirmacionEnCurso >= 0 ? (
            <p className="flex max-w-xs items-start gap-2 text-xs text-zinc-500">
              <Lock className="mt-0.5 size-3.5 flex-none" aria-hidden />
              Para cancelar la toma, primero hay que descartar la preparación en curso del ítem {confirmacionEnCurso + 1}.
            </p>
          ) : (
            <CancelarTomaForm recetaId={receta.id} />
          )
        }
      />

      <AvisosGeneracion exito={guardada ? "Receta actualizada." : undefined} avisos={avisos} />

      <section aria-label="Resumen de la toma" className="panel mb-8">
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="person-block">
            <Avatar name={paciente} />
            <div className="min-w-0">
              <p className="text-xs text-zinc-500">Paciente</p>
              <p className="truncate font-medium text-zinc-900">{paciente}</p>
            </div>
          </div>
          <div className="person-block">
            <span className="tone-tile" aria-hidden>
              <Stethoscope />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-zinc-500">Médico</p>
              <p className="truncate font-medium text-zinc-900">
                {receta.medicoApellido}, {receta.medicoNombre}
              </p>
              <p className="text-xs text-zinc-500">
                Matrícula <span className="font-mono">{receta.medicoMatricula}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-2">
            <p className="text-xs text-zinc-500">Avance</p>
            {receta.items.length <= 12 ? (
              <span className="steps" aria-hidden>
                {estados.map((estado, i) => (
                  <span key={i} data-done={estado === "CONFIRMADA" || undefined} />
                ))}
              </span>
            ) : null}
            <p className="text-sm font-medium text-zinc-900">{etiquetaProgreso(confirmados, receta.items.length)}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="receta-heading" className="mb-10">
        <div className="section-heading">
          <h2 id="receta-heading">Receta</h2>
          {edicion ? <span className="text-xs text-zinc-500">Todavía se puede corregir. Al guardar, las fichas técnicas se recalculan.</span> : null}
        </div>
        {edicion ? (
          <RecetaForm key={edicion.version} mode="editar" unidades={edicion.unidades} disabled={false} recetaId={receta.id} inicial={edicion.inicial} volverA={hrefToma(receta.id)} />
        ) : (
          <RecetaSoloLectura receta={receta} />
        )}
      </section>

      <section aria-labelledby="items-heading">
        <div className="section-heading">
          <h2 id="items-heading" className="flex items-center gap-2">
            Ítems <span className="tab-count">{receta.items.length}</span>
          </h2>
          <span className="text-xs text-zinc-500">Una vez que empieza la confirmación de un ítem, la receta ya no se puede editar.</span>
        </div>
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
  const diagnostico = [receta.diagnosticoCodigo, receta.diagnosticoDescripcion].filter(Boolean).join(" - ");
  return (
    <div className="panel">
      <dl className="grid gap-x-8 gap-y-4 p-5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500">Origen</dt>
          <dd className="text-zinc-900">{etiquetaDe(ORIGEN_RECETA_LABELS, receta.origen)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Prescripción</dt>
          <dd className="text-zinc-900 tabular-nums">{formatFecha(receta.fechaPrescripcion)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Ingreso</dt>
          <dd className="text-zinc-900 tabular-nums">{formatFecha(receta.fechaIngreso, receta.zonaHoraria)}</dd>
        </div>
        {diagnostico ? (
          <div className="sm:col-span-3">
            <dt className="text-xs text-zinc-500">Diagnóstico</dt>
            <dd className="text-zinc-900">{diagnostico}</dd>
          </div>
        ) : null}
      </dl>
    </div>
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
    <article className="group-card" aria-labelledby={`item-toma-${item.id}`}>
      <div className="group-card-header">
        <span className="index-badge" aria-hidden>
          {numero}
        </span>
        <h3 id={`item-toma-${item.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
          <span className="sr-only">Ítem {numero}: </span>
          {nombre}
        </h3>
        <ToneBadge tone={TONO_ESTADO_ITEM[estado]}>{ESTADO_ITEM_TOMA_LABELS[estado]}</ToneBadge>
      </div>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {mostrarDatos ? <ItemDatos item={item} /> : null}

        <div className={mostrarDatos ? "border-t border-zinc-100 pt-4" : undefined}>
          <h4 className="mb-3 text-sm font-semibold text-zinc-900">Ficha técnica</h4>
          {ficha ? (
            <div className="flex flex-col gap-3">
              <FichaVersionResumen
                fichaTecnicaId={ficha.id}
                version={ficha.version}
                cantidadLineas={ficha.lineas.length}
                generadaEnTexto={formatFechaHora(ficha.generadaEn, zonaHoraria)}
                generadaPorNombre={ficha.generadaPorNombre}
                puedeImprimir={puedeImprimirFicha}
              />
              <div className="table-wrap">
                <table className="data-table">
                  <caption className="sr-only">Líneas de pesaje</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 py-2">
                        Droga
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Teórica
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        Exceso %
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        A pesar
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ficha.lineas.map((linea) => (
                      <tr key={linea.orden}>
                        <td className="px-3 py-2 font-medium text-zinc-900">{linea.drogaNombre}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                          {linea.cantidadTeorica ? (
                            <>
                              {linea.cantidadTeorica} <span className="text-zinc-500">{linea.unidadSimbolo}</span>
                            </>
                          ) : (
                            <Vacio />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{linea.excesoAplicado}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-zinc-900 tabular-nums">
                          {linea.esEnraseManual ? (
                            <span className="font-sans font-normal text-zinc-500">Enrase manual (se registra al confirmar)</span>
                          ) : linea.cantidadAPesar ? (
                            <>
                              {linea.cantidadAPesar} <span className="font-normal text-zinc-500">{linea.unidadSimbolo}</span>
                            </>
                          ) : (
                            <Vacio />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Todavía no se generó la ficha técnica de este ítem.</p>
          )}
          {puedeGenerarFicha && estado === "PENDIENTE" ? (
            <div className="mt-3">
              <GenerarFichaForm itemRecetaId={item.id} recetaId={recetaId} label={ficha ? "Generar nueva versión" : "Generar ficha técnica"} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 sm:px-5">
        {estado === "CONFIRMADA" && item.preparacion ? (
          <>
            <span className="mr-auto flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <CircleCheck className="size-4" aria-hidden />
              Confirmada
            </span>
            <Link href={`/preparaciones/${item.preparacion.id}`} className="btn btn-secondary btn-sm">
              Ver preparación
            </Link>
          </>
        ) : estado === "EN_CONFIRMACION" && item.preparacion ? (
          <Link href={`/preparaciones/${item.preparacion.id}`} className="btn btn-primary">
            <FlaskConical className="size-4" aria-hidden />
            Continuar confirmación
          </Link>
        ) : ficha ? (
          <IniciarPreparacionForm fichaTecnicaId={ficha.id} label="Confirmar terminación" pendingLabel="Iniciando…" />
        ) : (
          <p className="mr-auto text-sm text-zinc-600">
            {puedeGenerarFicha ? "Generá la ficha técnica para poder confirmar la terminación." : "Falta generar la ficha técnica de este ítem para poder confirmar la terminación."}
          </p>
        )}
      </div>
    </article>
  );
}

function Vacio() {
  return (
    <span className="text-zinc-400">
      -<span className="sr-only">Sin dato</span>
    </span>
  );
}
