/**
 * `/preparaciones/recetas/[recetaId]` (M11, /preparaciones design "B"): the
 * lab's workspace for a receta it took (modules/preparaciones/domain/toma.ts).
 * A static `recetas` segment, so it never collides with `/preparaciones/[id]`
 * (same as `/recetas/nuevo` next to `/recetas/[id]`).
 *
 * - The receta's header (paciente, médico, origen, prescripción, ingreso,
 *   diagnóstico) is read-only here, in the "Resumen de la toma" panel next
 *   to the avance; it is corrected from /recetas/[id]/editar.
 * - Its ítems: while the receta is editable (`recetas.editar` and still
 *   PENDIENTE_PREPARACION), the SAME edit form as /recetas/[id]/editar with
 *   a fixed header (`RecetaFormToma`), coming back here after saving
 *   (`volverA`, validated by the action); saving regenerates the fichas
 *   técnicas/cotizaciones of the changed ítems as always and the generation
 *   notices show here. Otherwise read-only, inside each ítem's card.
 * - Each ítem: where it stands (Pendiente / Confirmación en curso /
 *   Confirmada), its latest ficha técnica with its líneas de pesaje (plus
 *   "Generar ficha técnica" only for an ítem that has none, e.g. when the
 *   automatic generation failed) and the action -- "Continuar" opens the
 *   confirmation in a dialog (modules/preparaciones/ui/continuar-preparacion-dialog.tsx:
 *   partidas, enrase, warnings, re-authentication) that persists nothing
 *   until "Confirmar y descontar stock", which creates and confirms the
 *   preparación in one transaction (`preparaciones.confirmarDeFicha`); from
 *   then on the receta can no longer be edited (existing rule). An ítem
 *   with a preparación INICIADA from before this flow (or from the ficha
 *   técnica screen's "Preparar") links to its `/preparaciones/[id]` screen
 *   instead, where it is confirmed or discarded.
 * - The fichas follow the form's unsaved draft, never a button
 *   (modules/preparaciones/ui/borrador-receta.tsx + fichas-borrador.tsx): a
 *   changed or new ítem shows a live preview of the ficha saving will
 *   generate, a removed one a warning, and while anything is unsaved no
 *   ítem can start its confirmation.
 * - "Cancelar toma" sends the receta back to Pendientes (the command
 *   refuses it while an ítem has a preparación INICIADA; its message shows
 *   in the form).
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
import { BorradorRecetaProvider, RecetaFormToma } from "@/modules/preparaciones/ui/borrador-receta";
import { CancelarTomaForm } from "@/modules/preparaciones/ui/cancelar-toma-form";
import { FichaTecnicaEnToma, FichasDeItemsNuevos, RequiereRecetaGuardada } from "@/modules/preparaciones/ui/fichas-borrador";
import { ContinuarPreparacionDialog } from "@/modules/preparaciones/ui/continuar-preparacion-dialog";
import { ItemDatos } from "@/modules/preparaciones/ui/item-datos";
import { LineasFichaTabla } from "@/modules/preparaciones/ui/lineas-ficha-tabla";
import { getReceta } from "@/modules/recetas/application/get-receta";
import { listUnidadesParaReceta } from "@/modules/recetas/application/list-unidades-para-receta";
import { PARAM_AVISO, PARAM_GUARDADA, decodificarAvisos } from "@/modules/recetas/domain/avisos-generacion";
import { ORIGEN_RECETA_LABELS, esEstadoEditable } from "@/modules/recetas/domain/receta";
import { AvisosGeneracion } from "@/modules/recetas/ui/avisos-generacion";
import { inicialDesdeReceta } from "@/modules/recetas/ui/receta-form-inicial";
import { FichaVersionResumen } from "@/modules/elaboracion/ui/ficha-version-resumen";
import { GenerarFichaForm } from "@/modules/elaboracion/ui/generar-ficha-form";
import { FORMA_FARMACEUTICA_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { StatusBadge, ToneBadge, type BadgeTone } from "@/shared/ui/status-badge";
import { PageHeader } from "@/shared/ui/page-header";
import { Avatar } from "@/shared/ui/avatar";
import { Toaster } from "@/shared/ui/toast";
import { CircleCheck, FlaskConical, Stethoscope } from "lucide-react";

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

  const estados = receta.items.map((item) => estadoItemToma(item.preparacion));
  const confirmados = estados.filter((estado) => estado === "CONFIRMADA").length;
  const paciente = `${receta.pacienteNombre} ${receta.pacienteApellido}`;
  const diagnostico = [receta.diagnosticoCodigo, receta.diagnosticoDescripcion].filter(Boolean).join(" - ");

  const fichas = (
    <section aria-labelledby="fichas-heading">
      <div className="section-heading">
        <h2 id="fichas-heading" className="flex items-center gap-2">
          {edicion ? "Fichas técnicas" : "Ítems"} <span className="tab-count">{receta.items.length}</span>
        </h2>
        <span className="text-xs text-zinc-500">Una vez confirmado un ítem, la receta ya no se puede editar.</span>
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
        {edicion ? <FichasDeItemsNuevos /> : null}
      </div>
    </section>
  );

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
        actions={<CancelarTomaForm recetaId={receta.id} />}
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
        <dl className="grid gap-x-8 gap-y-4 border-t border-zinc-100 px-5 py-4 text-sm sm:grid-cols-3">
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
      </section>

      {edicion ? (
        <BorradorRecetaProvider>
          <div className="mb-10">
            <RecetaFormToma key={edicion.version} recetaId={receta.id} unidades={edicion.unidades} inicial={edicion.inicial} volverA={hrefToma(receta.id)} />
          </div>
          {fichas}
        </BorradorRecetaProvider>
      ) : (
        fichas
      )}
      <Toaster />
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
  /** The ítem's data, when the edit form above is not already showing it. */
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
          {/* The saved ficha; replaced by the live preview while the form has unsaved changes to this ítem. */}
          <FichaTecnicaEnToma itemId={item.id}>
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
                <LineasFichaTabla lineas={ficha.lineas} />
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Todavía no se generó la ficha técnica de este ítem.</p>
            )}
            {/* Saving the receta regenerates the fichas by itself: by hand only when an ítem has none (e.g. the automatic generation failed). */}
            {puedeGenerarFicha && estado === "PENDIENTE" && !ficha ? (
              <RequiereRecetaGuardada nota={null}>
                <div className="mt-3">
                  <GenerarFichaForm itemRecetaId={item.id} recetaId={recetaId} label="Generar ficha técnica" />
                </div>
              </RequiereRecetaGuardada>
            ) : null}
          </FichaTecnicaEnToma>
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
          // A preparación INICIADA from the former two-step flow (or the ficha técnica screen's "Preparar"): confirmed or discarded on its own screen.
          <Link href={`/preparaciones/${item.preparacion.id}`} className="btn btn-primary">
            <FlaskConical className="size-4" aria-hidden />
            Continuar
          </Link>
        ) : (
          // Confirming locks the receta: never with unsaved edits in the form above.
          <RequiereRecetaGuardada>
            {ficha ? (
              <ContinuarPreparacionDialog fichaTecnicaId={ficha.id} itemNombre={`Ítem ${numero}: ${nombre}`} />
            ) : (
              <p className="mr-auto text-sm text-zinc-600">
                {puedeGenerarFicha ? "Generá la ficha técnica para poder confirmar la preparación." : "Falta generar la ficha técnica de este ítem para poder confirmar la preparación."}
              </p>
            )}
          </RequiereRecetaGuardada>
        )}
      </div>
    </article>
  );
}
