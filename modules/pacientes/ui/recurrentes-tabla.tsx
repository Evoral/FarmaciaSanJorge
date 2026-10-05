/**
 * Table of `/pacientes/recurrentes` (docs/specs/pacientes-recurrentes.md).
 * Server component. HEALTH-ADJACENT DATA (DP-24): internal hrefs carry only the
 * opaque paciente id. The one external link, "WhatsApp" (`wa.me` with phone +
 * message), is built by the use case on purpose: it is the link the person
 * clicks to open WhatsApp, opened in a new tab and never logged or stored by
 * this system. When it is not available the reason is shown instead, linking to
 * the paciente's Datos tab so it can be fixed (consent, missing or invalid phone).
 * The page renders the empty state; this table only renders rows.
 */
import Link from "next/link";
import { ChevronRight, MessageCircle } from "lucide-react";
import { formatFecha } from "@/shared/format/fecha";
import { Avatar } from "@/shared/ui/avatar";
import { ToneBadge } from "@/shared/ui/status-badge";
import type { BadgeTone } from "@/shared/ui/status-badge";
import { ESTADO_RECURRENTE_LABELS, MOTIVO_SIN_WHATSAPP_LABELS } from "../domain/recurrentes";
import type { EstadoRecurrente } from "../domain/recurrentes";
import type { PacienteRecurrenteVista } from "../application/list-pacientes-recurrentes";

const TONO_ESTADO: Record<EstadoRecurrente, BadgeTone> = {
  ATRASADO: "danger",
  ESTA_SEMANA: "warn",
  MAS_ADELANTE: "neutral",
};

export interface RecurrentesTablaProps {
  filas: PacienteRecurrenteVista[];
  zonaHoraria: string;
}

export function RecurrentesTabla({ filas, zonaHoraria }: RecurrentesTablaProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2">
              Paciente
            </th>
            <th scope="col" className="hidden px-3 py-2 md:table-cell">
              Qué pide
            </th>
            <th scope="col" className="hidden px-3 py-2 text-right lg:table-cell">
              Veces
            </th>
            <th scope="col" className="hidden px-3 py-2 lg:table-cell">
              Frecuencia
            </th>
            <th scope="col" className="hidden px-3 py-2 sm:table-cell">
              Último pedido
            </th>
            <th scope="col" className="px-3 py-2">
              Próximo <span className="font-normal">(estimado)</span>
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => {
            const nombre = `${fila.apellido}, ${fila.nombre}`;
            return (
              <tr key={fila.clave}>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={nombre} />
                    <span className="min-w-0">
                      <Link href={`/pacientes/${fila.pacienteId}`} className="block truncate font-medium text-zinc-900 underline-offset-2 hover:underline">
                        {nombre}
                      </Link>
                      <span className="block truncate text-xs text-zinc-500 md:hidden">{fila.quePide}</span>
                    </span>
                  </span>
                </td>
                <td className="hidden max-w-xs px-3 py-2.5 md:table-cell">
                  <span className="line-clamp-2">{fila.quePide}</span>
                </td>
                <td className="hidden px-3 py-2.5 text-right font-mono tabular-nums lg:table-cell">{fila.veces}</td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 lg:table-cell">
                  cada ~<span className="font-mono tabular-nums">{fila.intervaloDias}</span> días
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono tabular-nums sm:table-cell">{formatFecha(fila.ultimoPedido, zonaHoraria)}</td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-col items-start gap-1">
                    {/* `proximaFecha` is a calendar day stored as UTC midnight: format it in UTC (default), not in the farmacia's zone. */}
                    <span className="whitespace-nowrap font-mono tabular-nums text-zinc-900">{formatFecha(fila.proximaFecha)}</span>
                    <ToneBadge tone={TONO_ESTADO[fila.estado]}>{ESTADO_RECURRENTE_LABELS[fila.estado]}</ToneBadge>
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center justify-end gap-1">
                    {fila.whatsapp.disponible ? (
                      <a
                        href={fila.whatsapp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary btn-sm"
                        aria-label={`Enviar recordatorio por WhatsApp a ${fila.nombre} ${fila.apellido} (se abre en una pestaña nueva)`}
                      >
                        <MessageCircle className="size-3.5" aria-hidden />
                        <span className="hidden sm:inline">WhatsApp</span>
                      </a>
                    ) : (
                      <Link
                        href={`/pacientes/${fila.pacienteId}`}
                        className="whitespace-nowrap text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
                        title="Abrir los datos del paciente para corregirlo"
                      >
                        {MOTIVO_SIN_WHATSAPP_LABELS[fila.whatsapp.motivo]}
                      </Link>
                    )}
                    <Link
                      href={`/pacientes/${fila.pacienteId}/trayectoria`}
                      className="btn btn-ghost btn-sm btn-icon"
                      aria-label={`Ver la trayectoria de ${fila.nombre} ${fila.apellido}`}
                      title="Trayectoria"
                    >
                      <ChevronRight className="size-4" aria-hidden />
                    </Link>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
