/**
 * `guardarReglaPrecio` (M08, FASE 4 point 4.6, DP-09 RESUELTA). ADM, DT
 * (plan §7: `precios.reglas.editar`). Saves a new version of the price
 * rule set: precio mínimo + margin tramos by cost (2026-10-01 rule,
 * docs/specs/reglas-precio.md). The input is validated by the pure
 * `validarReglasPrecio` (the DB re-checks the tramo set at COMMIT,
 * INV-PR-002 -- migration 0052).
 *
 * INV-PR-001 (versioned + immutable): this command NEVER updates an
 * existing regla_precio or its tramos. If an OPEN row exists, it is CLOSED
 * (vigente_hasta = server "now") and a NEW row is INSERTed with
 * vigente_desde = that SAME instant, in this ONE transaction -- so a
 * cotizacion that already referenced the closed version keeps meaning
 * exactly what it meant. The very first regla for a tenant has nothing to
 * close: it is a plain insert. Either way, exactly one NEW row exists
 * after this command runs -- `accion: CREAR` always describes the
 * observable effect accurately (a fixed `TipoAccion` is declared once per
 * command, see shared/usecase.ts -- there is no way to vary it between
 * "first ever" and "new version" at the handler level).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { decimalString } from "@/shared/validation";
import { describirTramos, validarReglasPrecio } from "../domain/regla-precio";
import { lockReglaAbierta, ahoraServidor, cerrarReglaAbierta, insertReglaPrecio } from "../infrastructure/regla-precio-repository";
import type { TramoGuardado } from "../infrastructure/regla-precio-repository";

const tramoInput = z.object({
  /** `null` = no upper limit (only the last tramo). */
  costoHasta: decimalString.nullable(),
  margen: decimalString,
});

const guardarReglaPrecioInput = z
  .object({
    precioMinimo: decimalString,
    tramos: z.array(tramoInput),
  })
  .superRefine((input, ctx) => {
    for (const problema of validarReglasPrecio(input)) {
      const path =
        problema.campo === "precioMinimo" ? ["precioMinimo"] : problema.indiceTramo === undefined ? ["tramos"] : ["tramos", problema.indiceTramo, problema.campo];
      ctx.addIssue({ code: "custom", message: problema.mensaje, path });
    }
  });

export interface GuardarReglaPrecioInput {
  precioMinimo: string;
  /** In cost order; the last one with `costoHasta: null`. */
  tramos: { costoHasta: string | null; margen: string }[];
}

export interface GuardarReglaPrecioOutput {
  id: string;
  precioMinimo: string;
  tramos: TramoGuardado[];
  vigenteDesde: string;
}

export const guardarReglaPrecioCommand = defineCommand({
  name: "precios.reglas.editar",
  permiso: "precios.reglas.editar",
  input: guardarReglaPrecioInput,
  audit: { entidad: "regla_precio", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    const abierta = await lockReglaAbierta(tx, session.tenantId);
    const ahora = await ahoraServidor(tx);

    if (abierta) {
      await cerrarReglaAbierta(tx, session.tenantId, abierta.id, ahora);
    }

    const nueva = await insertReglaPrecio(tx, {
      tenantId: session.tenantId,
      precioMinimo: input.precioMinimo.toString(),
      tramos: input.tramos.map((t) => ({ costoHasta: t.costoHasta === null ? null : t.costoHasta.toString(), margen: t.margen.toString() })),
      vigenteDesde: ahora,
      creadoPorId: session.usuario.id,
    });

    return {
      output: { id: nueva.id, precioMinimo: nueva.precioMinimo, tramos: nueva.tramos, vigenteDesde: nueva.vigenteDesde.toISOString() },
      audit: {
        entidadId: nueva.id,
        valorAnterior: abierta
          ? { precioMinimo: abierta.precioMinimo, tramos: describirTramos(abierta.tramos), vigenteDesde: abierta.vigenteDesde.toISOString(), vigenteHasta: null }
          : null,
        valorNuevo: { precioMinimo: nueva.precioMinimo, tramos: describirTramos(nueva.tramos), vigenteDesde: nueva.vigenteDesde.toISOString() },
      },
    };
  },
});

export async function guardarReglaPrecio(input: GuardarReglaPrecioInput): Promise<GuardarReglaPrecioOutput> {
  return guardarReglaPrecioCommand.execute(input);
}
