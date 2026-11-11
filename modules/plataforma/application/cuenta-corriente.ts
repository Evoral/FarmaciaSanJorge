/**
 * Cuenta corriente of a pharmacy (openspec/specs/plataforma/spec.md P13-P15): register a cargo, register a pago,
 * anular either. Money is a Decimal from `positiveDecimalString` (decimal.js, never JS numbers), sent to SQL as a
 * 2-decimal string. The SQL functions re-check everything (fecha futura, duplicate cargo, anulado once) and audit.
 */
import { z } from "zod";
import { fechaIso, nonEmptyString, positiveDecimalString, uuid } from "@/shared/validation";
import { jornadaDe } from "@/shared/time/jornada";
import { InvariantViolationError, ValidationError, mapDbError } from "@/shared/errors";
import { definePlataforma } from "./define-plataforma";
import { CONCEPTO_MAX, MEDIOS_PAGO, MOTIVO_MAX, NOTA_MAX, ZONA_PLATAFORMA } from "../domain/farmacia";
import { anularMovimiento as anularMovimientoDb, registrarCargo as registrarCargoDb, registrarPago as registrarPagoDb } from "../infrastructure/plataforma-repository";

const MONTO_MAXIMO = "999999999999.99";

const monto = positiveDecimalString
  .refine((valor) => valor.decimalPlaces() <= 2, "El monto admite hasta dos decimales.")
  .refine((valor) => valor.lessThanOrEqualTo(MONTO_MAXIMO), "El monto es demasiado grande.")
  .transform((valor) => valor.toFixed(2));

/** `YYYY-MM` from `<input type="month">`. */
const periodo = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Elegí el mes y el año del período.")
  .transform((valor) => `${valor}-01`);

export const registrarCargoCommand = definePlataforma({
  name: "plataforma.cuenta.cargo",
  input: z.object({ tenantId: uuid, periodo, monto, concepto: nonEmptyString.max(CONCEPTO_MAX) }),
  handler: async ({ tx, actor, input, meta }) => {
    try {
      return await registrarCargoDb(tx, actor.tokenHash, input, meta);
    } catch (error) {
      // Inside the transaction the error is still the raw driver one; withPlatformTransaction maps it only on the way out.
      const mapeado = mapDbError(error);
      if (mapeado instanceof InvariantViolationError && mapeado.invariantCode === "INV-PLAT-CARGO-DUPLICADO") {
        throw new ValidationError("Ya hay un cargo con ese período y concepto.", { cause: error, fields: ["periodo", "concepto"] });
      }
      throw mapeado;
    }
  },
});

export const registrarPagoCommand = definePlataforma({
  name: "plataforma.cuenta.pago",
  input: z.object({
    tenantId: uuid,
    // The DB refuses it too (INV-PLAT-FECHA-FUTURA); checked here so the fecha field is marked.
    fecha: fechaIso.refine((valor) => valor <= jornadaDe(new Date(), ZONA_PLATAFORMA), "La fecha del pago no puede ser posterior a hoy."),
    monto,
    medio: z.enum(MEDIOS_PAGO, { message: "Elegí el medio de pago." }),
    nota: z
      .string()
      .trim()
      .max(NOTA_MAX)
      .nullish()
      .transform((valor) => valor || null),
    envioId: uuid,
  }),
  handler: ({ tx, actor, input, meta }) => registrarPagoDb(tx, actor.tokenHash, input, meta),
});

export const anularMovimientoCommand = definePlataforma({
  name: "plataforma.cuenta.anular",
  input: z.object({ tipo: z.enum(["CARGO", "PAGO"]), id: uuid, motivo: nonEmptyString.max(MOTIVO_MAX) }),
  handler: ({ tx, actor, input, meta }) => anularMovimientoDb(tx, actor.tokenHash, input.tipo, input.id, input.motivo, meta),
});

export function registrarCargo(raw: Record<string, unknown>) {
  return registrarCargoCommand.execute(raw);
}

export function registrarPago(raw: Record<string, unknown>) {
  return registrarPagoCommand.execute(raw);
}

export function anularMovimiento(raw: Record<string, unknown>) {
  return anularMovimientoCommand.execute(raw);
}
