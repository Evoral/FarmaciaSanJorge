/**
 * `configurarMetodosVerificacion` (openspec/specs/cuentas-de-sector/spec.md): replaces the farmacia's set of OPTIONAL
 * verification methods (the ones an empleado can use besides the PIN in a cuenta de sector). `metodos` is the COMPLETE
 * new set (the screen submits every switch that is on). The PIN is always on, so naming it is rejected.
 *
 * Same policy as `configurarAccionesConPin`: `config.editar`, no password re-authentication, audited with the set before
 * and after. Disabling a method deletes only its row here: the credentials already enrolled stay and work again when
 * it is switched back on. It takes effect on each cuenta de sector's next request (the set is read with the session).
 *
 * `entidadId` is the tenant id: the table has no surrogate id and the row describes the farmacia's whole
 * configuration.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { METODOS, METODOS_VERIFICACION, type MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";
import { diferenciaMetodos, ordenarMetodos } from "../domain/metodos-verificacion";
import { getMetodosHabilitados, replaceMetodosHabilitados } from "../infrastructure/operadores-repository";

const configurarMetodosVerificacionInput = z.object({
  metodos: z
    .array(z.enum(METODOS_VERIFICACION).refine((metodo) => !METODOS[metodo].siempreHabilitado, { message: "Ese método está siempre habilitado y no se puede cambiar." }))
    .max(METODOS_VERIFICACION.length),
});

export type ConfigurarMetodosVerificacionInput = z.infer<typeof configurarMetodosVerificacionInput>;

export const configurarMetodosVerificacionCommand = defineCommand({
  name: "operadores.metodosVerificacion.configurar",
  permiso: "config.editar",
  input: configurarMetodosVerificacionInput,
  audit: { entidad: "metodo_verificacion", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const antes = await getMetodosHabilitados(tx, session.tenantId);
    const despues = ordenarMetodos(input.metodos);
    const { activados, desactivados } = diferenciaMetodos(antes, despues);
    if (activados.length === 0 && desactivados.length === 0) {
      throw new DomainError("No hay cambios para guardar.");
    }

    await replaceMetodosHabilitados(tx, session.tenantId, despues);

    return {
      output: { metodos: despues },
      audit: {
        entidadId: session.tenantId,
        valorAnterior: { metodos: antes },
        valorNuevo: { metodos: despues, activados, desactivados },
      },
    };
  },
});

export async function configurarMetodosVerificacion(input: ConfigurarMetodosVerificacionInput): Promise<{ metodos: MetodoVerificacion[] }> {
  return configurarMetodosVerificacionCommand.execute(input);
}
