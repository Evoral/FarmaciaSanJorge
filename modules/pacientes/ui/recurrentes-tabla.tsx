/**
 * Table of `/pacientes/recurrentes` (docs/specs/pacientes-recurrentes.md).
 * Server component. HEALTH-ADJACENT DATA (DP-24): internal hrefs carry only the
 * opaque paciente id. The one external link, "WhatsApp" (`wa.me` with phone +
 * message), is built by the use case on purpose: it is the link the person
 * clicks to open WhatsApp, opened in a new tab and never logged or stored by
 * this system. When it is not available the reason is shown instead, linking to
 * the paciente's Datos tab so it can be fixed (consent, missing or invalid phone).
 */
import Link from "next/link";
import { formatFecha } from "@/shared/format/fecha";
import { ESTADO_RECURRENTE_LABELS, MOTIVO_SIN_WHATSAPP_LABELS } from "../domain/recurrentes";
import type { EstadoRecurrente } from "../domain/recurrentes";
import type { PacienteRecurrenteVista } from "../application/list-pacientes-recurrentes";

const TONE_CLASSES: Record<EstadoRecurrente, string> = {
  ATRASADO: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  ESTA_SEMANA: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  MAS_ADELANTE: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function EstadoRecurrenteBadge({ estado }: { estado: EstadoRecurrente }) {
  return <span className={`badge ${TONE_CLASSES[estado]}`}>{ESTADO_RECURRENTE_LABELS[estado]}</span>;
}

export interface RecurrentesTablaProps {
  filas: PacienteRecurrenteVista[];
  zonaHoraria: string;
  /** Message of the empty state (it depends on the window and on what the other window holds). */
  mensajeVacio: string;
}

export function RecurrentesTabla({ filas, zonaHoraria, mensajeVacio }: RecurrentesTablaProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
            <th scope="col" className="px-3 py-2 font-medium">Qué pide</th>
            <th scope="col" className="px-3 py-2 font-medium">Veces</th>
            <th scope="col" className="px-3 py-2 font-medium">Cada ~N días</th>
            <th scope="col" className="px-3 py-2 font-medium">Último pedido</th>
            <th scope="col" className="px-3 py-2 font-medium">Próximo (estimado)</th>
            <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                {mensajeVacio}
              </td>
            </tr>
          ) : (
            filas.map((fila) => (
              <tr key={fila.clave}>
                <td className="px-3 py-2">
                  <Link href={`/pacientes/${fila.pacienteId}`} className="font-medium underline-offset-2 hover:underline">
                    {fila.apellido}, {fila.nombre}
                  </Link>
                </td>
                <td className="px-3 py-2">{fila.quePide}</td>
                <td className="px-3 py-2">{fila.veces}</td>
                <td className="px-3 py-2 whitespace-nowrap">~{fila.intervaloDias} días</td>
                <td className="px-3 py-2 whitespace-nowrap">{formatFecha(fila.ultimoPedido, zonaHoraria)}</td>
                {/* `proximaFecha` is a calendar day stored as UTC midnight: format it in UTC (default), not in the farmacia's zone. */}
                <td className="px-3 py-2 whitespace-nowrap">{formatFecha(fila.proximaFecha)}</td>
                <td className="px-3 py-2">
                  <EstadoRecurrenteBadge estado={fila.estado} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {fila.whatsapp.disponible ? (
                      <a
                        href={fila.whatsapp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary btn-sm"
                        aria-label={`Enviar recordatorio por WhatsApp a ${fila.nombre} ${fila.apellido} (se abre en una pestaña nueva)`}
                      >
                        WhatsApp
                      </a>
                    ) : (
                      <Link
                        href={`/pacientes/${fila.pacienteId}`}
                        className="text-xs text-zinc-500 underline-offset-2 hover:underline"
                        title="Abrir los datos del paciente para corregirlo"
                      >
                        {MOTIVO_SIN_WHATSAPP_LABELS[fila.whatsapp.motivo]}
                      </Link>
                    )}
                    <Link
                      href={`/pacientes/${fila.pacienteId}/trayectoria`}
                      className="btn btn-secondary btn-sm"
                      aria-label={`Ver trayectoria de ${fila.nombre} ${fila.apellido}`}
                    >
                      Trayectoria
                    </Link>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
