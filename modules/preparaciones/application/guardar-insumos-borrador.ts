/**
 * `guardarInsumosBorrador` (migration 0110, openspec/specs/insumos-preparacion/spec.md): the toma workspace saves the
 * material and the insumos adicionales of a ficha técnica as they are chosen/typed -- the whole list each time
 * (`fsj.insumo_borrador`, replaced), like the excipiente's draft (./guardar-excipiente-borrador.ts). A draft: nothing
 * is reserved; the reserva re-validates it (`reservarInsumosEnTx`). The Material may hold a quantity without a droga
 * (the cápsulas' count pre-filled, no cápsula chosen yet). Refused once the ítem has a live preparación, or when a
 * droga repeats across the excipiente's draft + material + adicionales. Permiso `preparaciones.confirmar`, no
 * re-authentication -- like the excipiente.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { decimalString, uuid } from "@/shared/validation";
import { TIPOS_INSUMO } from "../domain/insumo";
import { validarInsumosEnTx } from "./insumos-preparacion";
import { getExcipienteBorrador, getFichaParaIniciar, getPreparacionActivaDeFicha, reemplazarInsumosBorrador } from "../infrastructure/preparacion-repository";

/** Generous cap: a ficha holds a handful of insumos. */
export const INSUMOS_MAX = 30;

const guardarInsumosBorradorInput = z.object({
  fichaTecnicaId: uuid,
  insumos: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_INSUMO),
        /** `null` = none chosen yet. */
        drogaId: uuid.nullable(),
        cantidad: decimalString.optional(),
      }),
    )
    .max(INSUMOS_MAX),
});

export const guardarInsumosBorradorCommand = defineCommand({
  name: "preparaciones.insumosBorrador.guardar",
  permiso: "preparaciones.confirmar",
  input: guardarInsumosBorradorInput,
  audit: { entidad: "ficha_tecnica", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    if (!(await getFichaParaIniciar(tx, session.tenantId, input.fichaTecnicaId))) throw new NotFoundError("Ficha técnica no encontrada.");
    if (await getPreparacionActivaDeFicha(tx, session.tenantId, input.fichaTecnicaId)) {
      throw new DomainError("El ítem ya tiene el stock reservado: recargá la página.");
    }
    // An adicional row without droga carries nothing: only the Material keeps a quantity alone (the cápsulas' count).
    const filas = input.insumos.filter((i) => i.drogaId || (i.tipo === "MATERIAL" && i.cantidad));
    const excipiente = await getExcipienteBorrador(tx, session.tenantId, input.fichaTecnicaId);
    await validarInsumosEnTx(tx, session.tenantId, filas, excipiente?.drogaId ?? null);

    const nuevo = filas.map((i) => ({ tipo: i.tipo, drogaId: i.drogaId, cantidad: i.cantidad?.toString() ?? null }));
    const anterior = await reemplazarInsumosBorrador(tx, { tenantId: session.tenantId, fichaTecnicaId: input.fichaTecnicaId, insumos: nuevo, actualizadoPorId: session.usuario.id });
    return {
      output: { insumos: nuevo },
      audit: { entidadId: input.fichaTecnicaId, valorAnterior: anterior.length > 0 ? { insumosBorrador: anterior } : null, valorNuevo: { insumosBorrador: nuevo } },
    };
  },
});

export async function guardarInsumosBorrador(input: z.input<typeof guardarInsumosBorradorInput>): Promise<{ insumos: { tipo: string; drogaId: string | null; cantidad: string | null }[] }> {
  return guardarInsumosBorradorCommand.execute(input);
}
