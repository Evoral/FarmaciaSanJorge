/**
 * `listPacientesRecurrentes` (docs/specs/pacientes-recurrentes.md): the
 * patients who periodically order the same preparation, when their next order
 * is expected, and a ready-to-open WhatsApp reminder link. Read-only, gated on
 * `pacientes.gestionar`; reads are not audited (project convention).
 *
 * HEALTH-ADJACENT DATA (DP-24, Ley 25.326): nothing here is logged, and the
 * only inputs (`ventana`, `page`) are non-identifying -- they are what the
 * page may put in OUR URL. The raw `telefono` never leaves this use case: the
 * rows carry only the resulting `wa.me` URL (phone + message by design, an
 * external link the person clicks; see `construirUrlWhatsapp`) or the reason
 * the button is not available.
 *
 * The farmacia name and time zone come from the tenant row, and "today" is the
 * server clock read in the tenant's zone, so the estados do not depend on the
 * server's own zone.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import {
  PAGE_MAX_RECURRENTES,
  PAGE_SIZE_RECURRENTES,
  VENTANAS_RECURRENTES,
  calcularRecurrentes,
  construirMensajeRecordatorio,
  construirUrlWhatsapp,
  evaluarWhatsapp,
  filtrarPorVentana,
} from "../domain/recurrentes";
import type { EstadoRecurrente, MotivoSinWhatsapp, VentanaRecurrentes } from "../domain/recurrentes";
import { calcularPaginacion } from "../domain/trayectoria";
import type { PaginacionTrayectoria } from "../domain/trayectoria";
import { getRecurrentesCrudos } from "../infrastructure/recurrentes-repository";

const listPacientesRecurrentesInput = z.object({
  ventana: z.enum(VENTANAS_RECURRENTES).default("proximos"),
  page: z.number().int().min(1).max(PAGE_MAX_RECURRENTES).default(1),
});

/** Pre-transform wire shape: both fields optional (defaults `proximos` / page 1). */
export type ListPacientesRecurrentesInput = z.input<typeof listPacientesRecurrentesInput>;

/** `disponible: true` carries the `wa.me` link; otherwise the reason (the UI links to the paciente's Datos tab to fix it). */
export type WhatsappRecurrente = { disponible: true; url: string } | { disponible: false; motivo: MotivoSinWhatsapp };

export interface PacienteRecurrenteVista {
  /** Stable React key. */
  clave: string;
  pacienteId: string;
  nombre: string;
  apellido: string;
  quePide: string;
  veces: number;
  intervaloDias: number;
  ultimoPedido: Date;
  /** Calendar day as UTC midnight (format with `formatFecha(d)`, no zone). */
  proximaFecha: Date;
  diasHastaProxima: number;
  estado: EstadoRecurrente;
  whatsapp: WhatsappRecurrente;
}

export interface ListaPacientesRecurrentes {
  ventana: VentanaRecurrentes;
  filas: PacienteRecurrenteVista[];
  paginacion: PaginacionTrayectoria;
  /** Rows per window (before pagination), so the UI can hint at what the other window holds. */
  conteo: { proximos: number; todos: number };
  /** The tenant's zona horaria, to show `ultimoPedido` as the farmacia's calendar day. */
  zonaHoraria: string;
}

export const listPacientesRecurrentesQuery = defineQuery({
  name: "pacientes.recurrentes",
  permiso: "pacientes.gestionar",
  input: listPacientesRecurrentesInput,
  handler: async ({ tx, session, input }): Promise<ListaPacientesRecurrentes> => {
    const ahora = new Date();
    const crudos = await getRecurrentesCrudos(tx, session.tenantId, ahora);
    const todas = calcularRecurrentes(crudos.items, crudos.zonaHoraria, ahora);
    const visibles = filtrarPorVentana(todas, input.ventana);
    const paginacion = calcularPaginacion(visibles.length, input.page, PAGE_SIZE_RECURRENTES);
    const pagina = visibles.slice((paginacion.page - 1) * paginacion.pageSize, paginacion.page * paginacion.pageSize);

    const filas = pagina.map((fila): PacienteRecurrenteVista => {
      const disponibilidad = evaluarWhatsapp(fila.paciente.aceptaRecordatoriosWhatsapp, fila.paciente.telefono);
      const whatsapp: WhatsappRecurrente = disponibilidad.disponible
        ? {
            disponible: true,
            url: construirUrlWhatsapp(
              disponibilidad.telefono,
              construirMensajeRecordatorio({ nombre: fila.paciente.nombre, farmacia: crudos.farmaciaNombre, formula: fila.quePideEnMensaje }),
            ),
          }
        : { disponible: false, motivo: disponibilidad.motivo };
      return {
        clave: fila.clave,
        pacienteId: fila.paciente.id,
        nombre: fila.paciente.nombre,
        apellido: fila.paciente.apellido,
        quePide: fila.quePide,
        veces: fila.veces,
        intervaloDias: fila.intervaloDias,
        ultimoPedido: fila.ultimoPedido,
        proximaFecha: fila.proximaFecha,
        diasHastaProxima: fila.diasHastaProxima,
        estado: fila.estado,
        whatsapp,
      };
    });

    return {
      ventana: input.ventana,
      filas,
      paginacion,
      conteo: { proximos: filtrarPorVentana(todas, "proximos").length, todos: todas.length },
      zonaHoraria: crudos.zonaHoraria,
    };
  },
});

export async function listPacientesRecurrentes(input: ListPacientesRecurrentesInput): Promise<ListaPacientesRecurrentes> {
  return listPacientesRecurrentesQuery.execute(input);
}
