/** `/libro/[id]` (FASE 9, M12 points 9.1/9.2). Detalle del asiento -- snapshots, detalle, anulación/rectificativo, cierre, y el formulario de anulación cuando corresponde. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { getAsientoRecetario } from "@/modules/libro/application/get-asiento-recetario";
import { listDtParaCoFirmaLibro } from "@/modules/libro/application/list-dt-para-co-firma";
import { resolverEstadoVisualAsiento, etiquetaEstadoVisual } from "@/modules/libro/domain/estado-visual";
import { AnularAsientoForm } from "@/modules/libro/ui/anular-asiento-form";
import { RectificarAsientoForm } from "@/modules/libro/ui/rectificar-asiento-form";

interface AsientoPageProps {
  params: Promise<{ id: string }>;
}

export default async function AsientoPage({ params }: AsientoPageProps) {
  const session = await requireSession();
  const { id } = await params;

  let asiento;
  try {
    asiento = await getAsientoRecetario(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const estadoVisual = resolverEstadoVisualAsiento({
    estado: asiento.estado,
    anulacion: asiento.anulacion,
    rectificativoNumeroCorrelativo: asiento.rectificativoNumeroCorrelativo,
  });

  const puedeAnular = can(session, "libro.anulacion.solicitar") && estadoVisual.kind === "VIGENTE" && !asiento.cierreFirmado;
  // D1 (2026-09-23): "Rectificar" shows when the asiento is SISTEMA, VIGENTE,
  // jornada SIGNED, and has no rectificativo yet (the anular form is instead
  // shown only while the jornada is open -- see the `puedeAnular` condition above).
  const puedeRectificar =
    can(session, "libro.anulacion.solicitar") &&
    asiento.origen === "SISTEMA" &&
    estadoVisual.kind === "VIGENTE" &&
    asiento.cierreFirmado &&
    asiento.rectificativoNumeroCorrelativo === null;
  const dts = puedeAnular || puedeRectificar ? await listDtParaCoFirmaLibro() : [];

  return (
    <div className="p-6">
      <div className="mb-4">
        <Link href="/libro" className="text-sm underline">
          ← Volver al libro recetario
        </Link>
      </div>

      <h1 className="mb-1 text-xl font-semibold">Asiento Nº {asiento.numeroCorrelativo}</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        {asiento.fechaAsiento} · {asiento.origen === "RECTIFICATIVO" ? `Rectifica asiento Nº ${asiento.asientoOriginalNumeroCorrelativo}` : "Origen sistema"} · Jornada {asiento.cierreFirmado ? "firmada" : "abierta"}
      </p>

      <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-zinc-500">Estado</dt>
          <dd className="text-sm">{etiquetaEstadoVisual(estadoVisual)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">Ítem de la receta</dt>
          <dd className="text-sm">{asiento.itemLabel ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">Paciente</dt>
          <dd className="text-sm">{asiento.pacienteTexto}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-zinc-500">Médico</dt>
          <dd className="text-sm">{asiento.medicoTexto}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-zinc-500">Fórmula</dt>
          <dd className="text-sm whitespace-pre-wrap">{asiento.formulaTexto}</dd>
        </div>
      </dl>

      <h2 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">Detalle</h2>
      <div className="mb-6 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Descripción</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Unidad</th>
            </tr>
          </thead>
          <tbody>
            {asiento.detalles.map((d) => (
              <tr key={d.orden} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                <td className="px-3 py-2">{d.descripcion}</td>
                <td className="px-3 py-2">{d.cantidad}</td>
                <td className="px-3 py-2">{d.unidadTexto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {estadoVisual.kind === "ANULADO" ? (
        <div className="mb-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">Anulación</p>
          <p>Motivo: {estadoVisual.motivo}</p>
          <p>Anulado por {estadoVisual.anuladoPorNombre} · Autorizado por {estadoVisual.autorizadoPorNombre}</p>
          <p>{estadoVisual.anuladoEn.toLocaleString("es-AR")}</p>
        </div>
      ) : null}

      {asiento.origen === "RECTIFICATIVO" && asiento.rectificacion ? (
        <div className="mb-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">Rectificativo del asiento Nº {asiento.asientoOriginalNumeroCorrelativo}</p>
          <p>Motivo: {asiento.rectificacion.motivo}</p>
          <p>Autorizado por {asiento.rectificacion.autorizadoPorNombre}</p>
        </div>
      ) : null}

      {puedeAnular ? <AnularAsientoForm asientoId={asiento.id} numeroCorrelativo={asiento.numeroCorrelativo} dts={dts.map((dt) => ({ id: dt.usuarioId, label: `${dt.nombre} ${dt.apellido}` }))} /> : null}
      {puedeRectificar ? <RectificarAsientoForm asientoOriginalId={asiento.id} numeroCorrelativo={asiento.numeroCorrelativo} dts={dts.map((dt) => ({ id: dt.usuarioId, label: `${dt.nombre} ${dt.apellido}` }))} /> : null}
    </div>
  );
}
