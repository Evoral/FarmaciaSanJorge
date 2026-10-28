/**
 * `configurarAccionesConPin` (openspec/specs/cuentas-de-sector/spec.md): replaces the
 * farmacia's set of acciones that ask for an empleado's PIN in a cuenta de
 * sector. `acciones` is the COMPLETE new set (the screen submits every
 * switch that is on), limited to `PERMISOS_CON_PIN_CONFIGURABLES` by zod.
 *
 * Sensitive: switching an acción off means its acts are attributed to the
 * shared account from then on. `config.editar` (no password
 * re-authentication, user decision 2026-10-21); audited with the full set before and after. It takes
 * effect on each cuenta de sector's next request (the set is read with the
 * session, no cache).
 *
 * `entidadId` is the tenant id: `fsj.accion_con_pin` has no surrogate id and
 * the row describes the farmacia's whole configuration (same choice as
 * modules/parametros/application/editar-parametro.ts).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { PERMISOS_CON_PIN_CONFIGURABLES } from "@/modules/auth/domain/permisos";
import { diferenciaAccionesConPin, ordenarAccionesConPin } from "../domain/acciones-con-pin";
import { getCodigosConPin, replaceAccionesConPin } from "../infrastructure/operadores-repository";

const configurarAccionesConPinInput = z.object({
  acciones: z.array(z.enum(PERMISOS_CON_PIN_CONFIGURABLES)).max(PERMISOS_CON_PIN_CONFIGURABLES.length),
});

export type ConfigurarAccionesConPinInput = z.infer<typeof configurarAccionesConPinInput>;

export const configurarAccionesConPinCommand = defineCommand({
  name: "operadores.accionesConPin.configurar",
  permiso: "config.editar",
  input: configurarAccionesConPinInput,
  audit: { entidad: "accion_con_pin", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const antes = await getCodigosConPin(tx, session.tenantId);
    const despues = ordenarAccionesConPin(input.acciones);
    const { activadas, desactivadas } = diferenciaAccionesConPin(antes, despues);
    if (activadas.length === 0 && desactivadas.length === 0) {
      throw new DomainError("No hay cambios para guardar.");
    }

    await replaceAccionesConPin(tx, session.tenantId, despues);

    return {
      output: { acciones: despues },
      audit: {
        entidadId: session.tenantId,
        valorAnterior: { acciones: antes },
        valorNuevo: { acciones: despues, activadas, desactivadas },
      },
    };
  },
});

export async function configurarAccionesConPin(input: ConfigurarAccionesConPinInput): Promise<{ acciones: string[] }> {
  return configurarAccionesConPinCommand.execute(input);
}
