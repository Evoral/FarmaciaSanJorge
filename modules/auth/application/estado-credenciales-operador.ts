/**
 * `auth.credencialOperador.estado` (openspec/changes/metodos-verificacion-operador): for «Mi cuenta», every verification
 * method whose code the empleado enrols themselves (the huella today), with whether the farmacia has it enabled and
 * whether THIS usuario already holds one. Read-only and about the session's own usuario: the booleans only, never the
 * code nor its hash. `auth.password.cambiar`, like the use cases that write the same credentials.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { METODOS, METODOS_CON_CREDENCIAL_PROPIA, metodoHabilitado, type MetodoVerificacion } from "../domain/verificacion-identidad";
import { loadMetodosConCredencial } from "../infrastructure/credencial-operador-repository";
import { loadMetodosHabilitados } from "../infrastructure/session-repository";

export interface EstadoCredencialOperador {
  metodo: MetodoVerificacion;
  etiqueta: string;
  /** The farmacia has the method switched on: only then can the empleado enrol or replace (removing is always allowed). */
  habilitado: boolean;
  enrolada: boolean;
}

export const estadoCredencialesOperadorQuery = defineQuery({
  name: "auth.credencialOperador.estado",
  permiso: "auth.password.cambiar",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<EstadoCredencialOperador[]> => {
    const [habilitados, propias] = await Promise.all([loadMetodosHabilitados(tx, session.tenantId), loadMetodosConCredencial(tx, session.tenantId, session.usuario.id)]);
    return METODOS_CON_CREDENCIAL_PROPIA.map((metodo) => ({
      metodo,
      etiqueta: METODOS[metodo].etiqueta,
      habilitado: metodoHabilitado(metodo, habilitados),
      enrolada: propias.includes(metodo),
    }));
  },
});

export async function estadoCredencialesOperador(): Promise<EstadoCredencialOperador[]> {
  return estadoCredencialesOperadorQuery.execute({});
}
