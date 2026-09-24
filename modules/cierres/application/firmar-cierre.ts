/**
 * `firmarCierre` -- FASE 10, M13a point 10.1 (firma en término y fuera de
 * término). User decision 6 (2026-09-24): the DT signs with THEIR OWN full
 * password (never a PIN, never a co-firma of a different DT -- the signer
 * IS the session's own usuario). Same "verify credentials in their own
 * transaction, then call a NON-exported internal command" shape
 * `modules/libro/application/anular-asiento.ts` establishes for DT
 * co-firma -- see that file's doc comment for the full rationale (an
 * exported command that trusted a pre-verified identity could be called by
 * ANY other caller, bypassing the password check entirely).
 *
 * `director_tecnico_id`/`designacion_id`/`fecha_firma` are NEVER taken from
 * client input (task's explicit rule): `director_tecnico_id` is always
 * `session.usuario.id`, and `designacion_id` is resolved HERE from the
 * session's own vigente designación AT `fecha` (server-side; the DB
 * function's own INV-U04 check is the real backstop regardless).
 * `fecha_firma` is entirely DB-set (INV-C20, migration 0015) -- this module
 * never even reads it before the call.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { ExecuteOptions } from "@/shared/usecase";
import { DomainError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { fechaIso } from "../domain/filtros";
import { mensajeParaInvarianteFirma } from "../domain/mensajes-invariantes";
import { MOTIVO_DEMORA_VALUES, validarMotivoDemoraParaFirma } from "../domain/motivo-demora";
import { calcularFueraDeTermino } from "../domain/demora";
import { getDesignacionVigenteEnFecha, firmarCierreDb, jornadaActualTenant, getPlazoFirmaDias } from "../infrastructure/cierre-repository";
import { verificarPasswordFirmaCommand } from "./verificar-password-firma";

const firmarCierreInternalInput = z.object({
  fecha: fechaIso,
  motivoDemora: z.enum(MOTIVO_DEMORA_VALUES).optional(),
  motivoDemoraDetalle: z.string().trim().max(2000).optional(),
});

export interface FirmarCierreInput {
  fecha: string;
  /** The DT's OWN full password -- never a PIN. Verified by `verificarPasswordFirmaCommand` before anything else runs. */
  password: string;
  motivoDemora?: (typeof MOTIVO_DEMORA_VALUES)[number];
  motivoDemoraDetalle?: string;
}

export interface CierreFirmadoOutput {
  id: string;
  fecha: string;
  cantidadAsientos: number;
  fueraDeTermino: boolean;
}

/** NOT exported -- see this module's doc comment. Reachable only through `firmarCierre`, below. */
const firmarCierreInternalCommand = defineCommand({
  name: "cierres.jornada.firmar",
  permiso: "cierres.firmar",
  input: firmarCierreInternalInput,
  audit: { entidad: "cierre_diario", accion: TipoAccion.FIRMAR },
  handler: async ({ tx, session, input }) => {
    const designacion = await getDesignacionVigenteEnFecha(tx, session.tenantId, session.usuario.id, input.fecha);
    if (!designacion) {
      throw new DomainError("No tenés una designación de Director Técnico vigente para esa fecha.");
    }

    // Friendly app-level pre-check (INV-C18 / the OTRO+detalle CHECK
    // constraint are the real backstop, migrations 0015/0039).
    const jornadaActual = await jornadaActualTenant(tx, session.tenantId);
    const plazoFirmaDias = await getPlazoFirmaDias(tx, session.tenantId);
    const fueraDeTermino = calcularFueraDeTermino({ jornadaActual, fecha: input.fecha, plazoFirmaDias });
    const validacionMotivo = validarMotivoDemoraParaFirma({
      fueraDeTermino,
      motivoDemora: input.motivoDemora ?? null,
      motivoDemoraDetalle: input.motivoDemoraDetalle ?? null,
    });
    if (!validacionMotivo.ok) {
      throw new DomainError(validacionMotivo.error);
    }

    try {
      const cierre = await firmarCierreDb(tx, {
        tenantId: session.tenantId,
        fecha: input.fecha,
        directorTecnicoId: session.usuario.id,
        designacionId: designacion.id,
        motivoDemora: input.motivoDemora ?? null,
        motivoDemoraDetalle: input.motivoDemoraDetalle ?? null,
      });

      const output: CierreFirmadoOutput = {
        id: cierre.id,
        fecha: cierre.fecha,
        cantidadAsientos: cierre.cantidadAsientos,
        fueraDeTermino: cierre.fueraDeTermino,
      };
      return {
        output,
        audit: {
          entidadId: cierre.id,
          motivo: input.motivoDemora ? `Motivo de demora: ${input.motivoDemora}${input.motivoDemoraDetalle ? ` — ${input.motivoDemoraDetalle}` : ""}` : undefined,
          valorNuevo: { fecha: input.fecha, cantidadAsientos: cierre.cantidadAsientos, fueraDeTermino: cierre.fueraDeTermino, motivoDemora: input.motivoDemora ?? null },
        },
      };
    } catch (e) {
      // Same discipline as anular-asiento.ts: withTenantTransaction only
      // maps errors escaping the WHOLE handler, too late for this catch,
      // so the DB rejection (a race that slips past the pre-check above)
      // is mapped explicitly here into a clear Spanish DomainError.
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvarianteFirma(mapped.invariantCode));
      }
      throw mapped;
    }
  },
});

/**
 * The ONLY exported entry point for firming a cierre diario -- see this
 * module's doc comment. Verifies the DT's OWN password FIRST (its own
 * transaction, rate-limited, audits only on lockout), and ONLY on success
 * calls the internal firming command. `options` exists solely so unit
 * tests can inject a session (production callers never pass it).
 */
export async function firmarCierre(input: FirmarCierreInput, options?: ExecuteOptions): Promise<CierreFirmadoOutput> {
  const passwordOk = await verificarPasswordFirmaCommand.execute({ password: input.password }, options);
  if (!passwordOk.ok) {
    throw new DomainError(passwordOk.message);
  }
  return firmarCierreInternalCommand.execute(
    { fecha: input.fecha, motivoDemora: input.motivoDemora, motivoDemoraDetalle: input.motivoDemoraDetalle },
    options,
  );
}
