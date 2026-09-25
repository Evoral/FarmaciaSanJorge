/** `/cierres/[id]` (FASE 10, M13a point 10.1/10.2). Detalle del cierre (comprobante) + botón de impresión. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { getCierreDetalle } from "@/modules/cierres/application/get-cierre-detalle";
import { MOTIVO_DEMORA_LABELS, type MotivoDemoraValue } from "@/modules/cierres/domain/motivo-demora";

interface CierreDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function CierreDetallePage({ params }: CierreDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  let cierre;
  try {
    cierre = await getCierreDetalle(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const puedeImprimir = can(session, "cierres.imprimir");
  const motivoLabel = cierre.motivoDemora ? MOTIVO_DEMORA_LABELS[cierre.motivoDemora as MotivoDemoraValue] ?? cierre.motivoDemora : null;

  return (
    <div className="page">
      <div className="mb-4">
        <Link href="/cierres" className="text-sm underline">
          ← Volver a cierres
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cierre de la jornada {cierre.fecha}</h1>
        {puedeImprimir ? (
          <a href={`/api/cierres/${cierre.id}/pdf`} className="btn btn-secondary">
            Imprimir comprobante
          </a>
        ) : null}
      </div>

      <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-zinc-500">Director Técnico</dt>
          <dd className="text-sm">{cierre.directorTecnicoApellido}, {cierre.directorTecnicoNombre} (matrícula {cierre.matriculaDt})</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Cantidad de asientos</dt>
          <dd className="text-sm">{cierre.cantidadAsientos}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Firmado</dt>
          <dd className="text-sm">{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium" }).format(cierre.fechaFirma)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Estado</dt>
          <dd className={`text-sm ${cierre.fueraDeTermino ? "text-amber-700 dark:text-amber-400" : ""}`}>
            {cierre.fueraDeTermino ? `Fuera de término${motivoLabel ? ` — ${motivoLabel}` : ""}` : "En término"}
            {cierre.fueraDeTermino && cierre.motivoDemoraDetalle ? ` (${cierre.motivoDemoraDetalle})` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Hash de lote</dt>
          <dd className="break-all text-xs">{cierre.hashLote}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Impreso</dt>
          <dd className="text-sm">{cierre.fechaImpresion ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(cierre.fechaImpresion) : "Todavía no"}</dd>
        </div>
      </dl>

      <h2 className="mb-2 text-base font-semibold">Libro recetario</h2>
      <div className="mb-6 table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
              <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
              <th scope="col" className="px-3 py-2 font-medium">Médico</th>
              <th scope="col" className="px-3 py-2 font-medium">Fórmula</th>
            </tr>
          </thead>
          <tbody>
            {cierre.asientosRecetario.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                  Sin asientos de recetario en esta jornada.
                </td>
              </tr>
            ) : (
              cierre.asientosRecetario.map((a) => (
                <tr key={a.numeroCorrelativo}>
                  <td className="px-3 py-2 font-medium">{a.numeroCorrelativo}</td>
                  <td className="px-3 py-2">{a.estadoVisual}</td>
                  <td className="px-3 py-2">{a.pacienteTexto}</td>
                  <td className="px-3 py-2">{a.medicoTexto}</td>
                  <td className="px-3 py-2">{a.formulaTexto}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-base font-semibold">Libros contralor</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Libro</th>
              <th scope="col" className="px-3 py-2 font-medium">Droga</th>
              <th scope="col" className="px-3 py-2 font-medium">Movimiento</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {cierre.asientosContralor.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-zinc-500">
                  Sin asientos de contralor en esta jornada.
                </td>
              </tr>
            ) : (
              cierre.asientosContralor.map((a, i) => (
                <tr key={`${a.tipoLibro}-${a.numeroCorrelativo}-${i}`}>
                  <td className="px-3 py-2 font-medium">{a.numeroCorrelativo}</td>
                  <td className="px-3 py-2">{a.tipoLibro}</td>
                  <td className="px-3 py-2">{a.drogaDescripcion}</td>
                  <td className="px-3 py-2">{a.tipoMovimiento}</td>
                  <td className="px-3 py-2">{a.cantidad}</td>
                  <td className="px-3 py-2">{a.saldoPosterior}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
