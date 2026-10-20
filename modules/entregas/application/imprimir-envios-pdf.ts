/**
 * `imprimirEnviosPdf` -- "Exportar envíos" (docs/specs/envios-repartidores.md E8-E11): the PDF "Hoja de envíos" of one
 * repartidor. `app/api/entregas/envios/pdf/route.ts` is the ONLY entry point (eslint's `appBoundaryPatterns` forbids
 * `app/**` from importing this module's `infrastructure/` layer directly).
 *
 * Permiso `entregas.registrar` (whoever sees `/entregas`); the Importe column additionally needs `cotizaciones.ver`
 * (E10), decided here and passed to the renderer, never by the caller. The repartidor must exist in the tenant, active
 * or not (a deactivated one can still carry pending envíos, E3). The input is only `repartidorId` and an optional
 * `fecha` (E11): nothing identifying a paciente travels in the URL (DP-24).
 *
 * Audit: none, on purpose. Of the existing print paths, `etiquetas.imprimir` (also a PDF with patient data, behind a
 * route handler) leaves no audit row, and `cierres.imprimir` audits only because it also writes the "impreso" mark.
 * An audited `defineCommand` here would run under `entregas.registrar`, a PIN-configurable permiso: in a cuenta de
 * sector with that PIN on, `resolverActor` would demand an operador that a GET route never has, and the PDF would
 * stop working. The listing already exposes the same patient data without an audit trail.
 * See the spec's "Auditoría" table.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { jornadaDe } from "@/shared/time/jornada";
import { uuid } from "@/shared/validation";
import { nombreArchivoHojaEnvios } from "../domain/hoja-envios";
import {
  getFarmaciaParaHoja,
  getRepartidorDeEntrega,
  listEnviosDeRepartidor,
  zonaHorariaTenant,
} from "../infrastructure/entrega-repository";
import type { EnvioDeRepartidor, FarmaciaParaHoja, RepartidorDeEntrega } from "../infrastructure/entrega-repository";
import { buildEnviosPdf } from "../infrastructure/envios-pdf";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.")
  .refine((value) => {
    const [anio, mes, dia] = value.split("-").map(Number);
    const fecha = new Date(Date.UTC(anio!, mes! - 1, dia!));
    return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes! - 1 && fecha.getUTCDate() === dia;
  }, "Debe ser una fecha que exista en el calendario.");

export const imprimirEnviosPdfInput = z.object({
  repartidorId: uuid,
  fecha: isoDate.optional(),
});

export type ImprimirEnviosPdfInput = z.input<typeof imprimirEnviosPdfInput>;

export interface HojaEnviosDatos {
  farmacia: FarmaciaParaHoja;
  repartidor: RepartidorDeEntrega;
  envios: EnvioDeRepartidor[];
  conImporte: boolean;
  zonaHoraria: string;
  generadaPor: string;
}

export const getHojaEnviosQuery = defineQuery({
  name: "entregas.envios.hoja",
  permiso: "entregas.registrar",
  input: imprimirEnviosPdfInput,
  handler: async ({ tx, session, input }): Promise<HojaEnviosDatos> => {
    const repartidor = await getRepartidorDeEntrega(tx, session.tenantId, input.repartidorId);
    if (!repartidor) throw new NotFoundError("El repartidor no existe.");
    const conImporte = can(session, "cotizaciones.ver");
    return {
      farmacia: await getFarmaciaParaHoja(tx, session.tenantId),
      repartidor,
      envios: await listEnviosDeRepartidor(tx, { tenantId: session.tenantId, repartidorId: repartidor.id, fecha: input.fecha ?? null, conPrecio: conImporte }),
      conImporte,
      zonaHoraria: await zonaHorariaTenant(tx, session.tenantId),
      generadaPor: `${session.usuario.apellido}, ${session.usuario.nombre}`,
    };
  },
});

export interface EnviosPdfResult {
  pdf: Buffer;
  /** `envios-<apellido>-<fecha|pendientes>.pdf`: no patient data. */
  filename: string;
}

export async function imprimirEnviosPdf(input: ImprimirEnviosPdfInput): Promise<EnviosPdfResult> {
  const datos = await getHojaEnviosQuery.execute(input);
  const fecha = input.fecha ?? null;
  const pdf = await buildEnviosPdf({ ...datos, fecha, generadaEn: new Date() });
  return { pdf, filename: nombreArchivoHojaEnvios(datos.repartidor.apellido, fecha) };
}

/** The day the "Exportar envíos" dialog preselects: today in the farmacia's time zone (not the browser's, not UTC). */
export const getFechaHoyEnviosQuery = defineQuery({
  name: "entregas.envios.fechaHoy",
  permiso: "entregas.registrar",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<string> => jornadaDe(new Date(), await zonaHorariaTenant(tx, session.tenantId)),
});

export async function getFechaHoyEnvios(): Promise<string> {
  return getFechaHoyEnviosQuery.execute({});
}
