/** `/archivo/[id]` (FASE 12 points 12.1/12.3). Detalle del lote (recetas, timeline de estado) + acciones de destrucción. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { getLoteArchivoDetalle } from "@/modules/archivo/application/list-lotes";
import { ESTADO_LOTE_ARCHIVO_LABELS } from "@/modules/archivo/domain/lote-archivo";
import { SolicitarDestruccionForm, AutorizarDestruccionForm, RegistrarDestruccionForm } from "@/modules/archivo/ui/destruccion-forms";
import { StatusBadge } from "@/shared/ui/status-badge";

interface LoteDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function LoteDetallePage({ params }: LoteDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  let lote;
  try {
    lote = await getLoteArchivoDetalle(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const puedeDestruccion = can(session, "archivo.destruccion.gestionar");

  return (
    <div className="page">
      <div className="mb-4">
        <Link href="/archivo" className="text-sm underline">
          ← Volver al archivo
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Lote Nº {lote.numero}</h1>
        <span className="rounded bg-zinc-100 px-2 py-1 text-sm dark:bg-zinc-800">{ESTADO_LOTE_ARCHIVO_LABELS[lote.estado]}</span>
      </div>

      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Se destruyen solo las recetas en papel; los registros digitales se conservan siempre.
      </p>

      <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-zinc-500">Período</dt>
          <dd className="text-sm">{lote.periodoDesde} — {lote.periodoHasta}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Ubicación</dt>
          <dd className="text-sm">{lote.ubicacion}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Incluye controladas</dt>
          <dd className="text-sm">{lote.incluyeControladas ? "Sí" : "No"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Vencimiento del plazo</dt>
          <dd className={`text-sm ${lote.plazoCumplido ? "text-amber-700 dark:text-amber-400" : ""}`}>
            {lote.vencimiento}
            {lote.plazoCumplido && lote.estado === "EN_ARCHIVO" ? " — plazo cumplido" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Registrado por</dt>
          <dd className="text-sm">{lote.registradoPorApellido}, {lote.registradoPorNombre}</dd>
        </div>
        {lote.expedienteAutorizacion ? (
          <div>
            <dt className="text-xs text-zinc-500">Expediente de autorización</dt>
            <dd className="text-sm">{lote.expedienteAutorizacion}</dd>
          </div>
        ) : null}
        {lote.fechaAutorizacion ? (
          <div>
            <dt className="text-xs text-zinc-500">Fecha de autorización</dt>
            <dd className="text-sm">{lote.fechaAutorizacion}</dd>
          </div>
        ) : null}
        {lote.fechaDestruccion ? (
          <div>
            <dt className="text-xs text-zinc-500">Fecha de destrucción</dt>
            <dd className="text-sm">{lote.fechaDestruccion}</dd>
          </div>
        ) : null}
      </dl>

      {puedeDestruccion && lote.puedeSolicitarDestruccion ? <SolicitarDestruccionForm loteId={lote.id} /> : null}
      {puedeDestruccion && lote.puedeAutorizarDestruccion ? <AutorizarDestruccionForm loteId={lote.id} /> : null}
      {puedeDestruccion && lote.puedeRegistrarDestruccion ? <RegistrarDestruccionForm loteId={lote.id} /> : null}
      {lote.estaDestruido ? (
        <p className="card mb-6 p-4 text-sm">
          Este lote fue destruido el {lote.fechaDestruccion}. Solo se destruyeron las recetas en papel; los registros digitales se conservan.
        </p>
      ) : null}

      <h2 className="mb-2 mt-6 text-base font-semibold">Recetas ({lote.recetas.length})</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {lote.recetas.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-zinc-500">
                  Sin recetas asignadas.
                </td>
              </tr>
            ) : (
              lote.recetas.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium">{r.numeroInterno}</td>
                  <td className="px-3 py-2">{r.pacienteApellido}, {r.pacienteNombre}</td>
                  <td className="px-3 py-2"><StatusBadge estado={r.estado} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
