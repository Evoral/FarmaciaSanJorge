/**
 * `guardarReglaPrecio` (M08, FASE 4 point 4.6, DP-09 RESUELTA). ADM, DT
 * (plan §7: `precios.reglas.editar`). Sets a new margin.
 *
 * INV-PR-001 (versioned + immutable): this command NEVER updates an
 * existing regla_precio's margen. If an OPEN row exists, it is CLOSED
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
import { lockReglaAbierta, ahoraServidor, cerrarReglaAbierta, insertReglaPrecio } from "../infrastructure/regla-precio-repository";

const margenInput = decimalString.refine((v) => v.greaterThanOrEqualTo(0), {
  message: "El margen debe ser mayor o igual a 0.",
});

const guardarReglaPrecioInput = z.object({ margen: margenInput });

export interface GuardarReglaPrecioInput {
  margen: string;
}

export interface GuardarReglaPrecioOutput {
  id: string;
  margen: string;
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
      margen: input.margen.toString(),
      vigenteDesde: ahora,
      creadoPorId: session.usuario.id,
    });

    return {
      output: { id: nueva.id, margen: nueva.margen, vigenteDesde: nueva.vigenteDesde.toISOString() },
      audit: {
        entidadId: nueva.id,
        valorAnterior: abierta ? { margen: abierta.margen, vigenteDesde: abierta.vigenteDesde.toISOString(), vigenteHasta: null } : null,
        valorNuevo: { margen: nueva.margen, vigenteDesde: nueva.vigenteDesde.toISOString() },
      },
    };
  },
});

export async function guardarReglaPrecio(input: GuardarReglaPrecioInput): Promise<GuardarReglaPrecioOutput> {
  return guardarReglaPrecioCommand.execute(input);
}
