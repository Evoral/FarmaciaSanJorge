/** `/stock/partidas/[id]` (M07, FASE 5 points 5.2/5.4/5.5): partida detail + kardex + ajustar/corregir costo. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getPartida } from "@/modules/stock/application/get-partida";
import { kardexMovimientos } from "@/modules/stock/application/kardex-movimientos";
import { NotFoundError } from "@/shared/errors";
import { CorregirCostoForm } from "@/modules/stock/ui/corregir-costo-form";

function formatFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", dateStyle: "short", timeStyle: "short" }).format(fecha);
}

const TIPO_MOVIMIENTO_LABELS: Record<string, string> = {
  INGRESO_COMPRA: "Ingreso de compra",
  EGRESO_PREPARACION: "Egreso por preparación",
  AJUSTE: "Ajuste",
};

interface PartidaDetallePageProps {
  params: Promise<{ id: string }>;
}

export default async function PartidaDetallePage({ params }: PartidaDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;

  let partida;
  try {
    partida = await getPartida(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const kardex = await kardexMovimientos({ partidaId: id, page: 1, pageSize: 50 });
  const puedeCorregirCosto = can(session, "stock.partida.costo.corregir");
  const puedeAjustar = can(session, "stock.ajuste.registrar");

  return (
    <div className="page">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{partida.drogaNombre}</h1>
        {puedeAjustar ? (
          <Link href={`/stock/ajustes/nuevo?partidaId=${partida.id}`} className="btn btn-secondary">
            Registrar ajuste
          </Link>
        ) : null}
      </div>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">Lote {partida.lote} · {partida.proveedorRazonSocial}</p>

      <dl className="card mb-6 grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500">Saldo disponible</dt>
          <dd className="font-medium">{partida.cantidadDisponible}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Cantidad inicial</dt>
          <dd className="font-medium">{partida.cantidadInicial}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Costo unitario</dt>
          <dd className="font-medium">{partida.costoUnitario}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Vencimiento</dt>
          <dd className="font-medium">{formatFecha(partida.fechaVencimiento)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Fecha de ingreso</dt>
          <dd className="font-medium">{formatFecha(partida.fechaIngreso)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Estado</dt>
          <dd className="font-medium">{partida.fechaApertura ? `Abierta (${formatFecha(partida.fechaApertura)})` : "Cerrada"}</dd>
        </div>
      </dl>

      {puedeCorregirCosto ? (
        <div className="mb-6">
          <CorregirCostoForm partidaId={partida.id} costoUnitarioActual={partida.costoUnitario} />
        </div>
      ) : null}

      <h2 className="mb-3 text-base font-semibold">Kardex de movimientos</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Tipo</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Motivo</th>
              <th scope="col" className="px-3 py-2 font-medium">Registrado por</th>
              <th scope="col" className="px-3 py-2 font-medium">Autorizado por</th>
            </tr>
          </thead>
          <tbody>
            {kardex.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  Sin movimientos registrados.
                </td>
              </tr>
            ) : (
              kardex.items.map((mov) => (
                <tr key={mov.id}>
                  <td className="px-3 py-2">{formatFecha(mov.registradoEn)}</td>
                  <td className="px-3 py-2">{TIPO_MOVIMIENTO_LABELS[mov.tipo] ?? mov.tipo}</td>
                  <td className="px-3 py-2">{mov.cantidad}</td>
                  <td className="px-3 py-2">{mov.motivoAjuste ?? mov.observacion ?? "—"}</td>
                  <td className="px-3 py-2">
                    {mov.registradoPorNombre} {mov.registradoPorApellido}
                  </td>
                  <td className="px-3 py-2">
                    {mov.autorizadoPorNombre ? `${mov.autorizadoPorNombre} ${mov.autorizadoPorApellido}` : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
