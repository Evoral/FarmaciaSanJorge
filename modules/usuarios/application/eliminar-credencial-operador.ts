/**
 * `usuarios.credencialOperador.eliminar` (openspec/changes/metodos-verificacion-operador): the Administrador removes
 * the secret code of a verification method (the huella today) from an empleado, e.g. a lost reader. They can NOT enrol
 * one nor read anything about it: only whether it exists, and remove it. Only that method's code goes: the PIN and the
 * other methods stay, and resetting the PIN never touches a huella.
 *
 * Generic over the methods whose credential lives in `fsj.credencial_operador`. Same permiso, lock order and "not on
 * yourself" rule as `restablecerPin` (./restablecer-pin.ts): the target row is locked FIRST
 * (`lockUsuarioYAdministradoresActivos`, admin-guard.ts's LOCK ORDER), so a double click or two Administradores at once
 * yield one success and one "no tiene", never two audit rows. A usuario in any estado (a BAJA one included) can have
 * the code removed: removing only reduces access. The audit row never holds the code nor its hash.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { eliminarCredencialDeOperadorEnTx } from "@/modules/auth/application/eliminar-credencial-operador";
import { METODOS, METODOS_CON_CREDENCIAL_PROPIA } from "@/modules/auth/domain/verificacion-identidad";
import { esAccionSobreSiMismo } from "../domain/reglas-admin";
import { lockUsuarioYAdministradoresActivos } from "../infrastructure/admin-guard";
import { loadUsuarioParaAccion } from "../infrastructure/usuario-repository";

const eliminarCredencialOperadorInput = z.object({ usuarioId: uuid, metodo: z.enum(METODOS_CON_CREDENCIAL_PROPIA) });

export type EliminarCredencialOperadorDeUsuarioInput = z.infer<typeof eliminarCredencialOperadorInput>;

export const eliminarCredencialOperadorDeUsuarioCommand = defineCommand({
  name: "usuarios.credencialOperador.eliminar",
  permiso: "usuarios.credencial.restablecer",
  input: eliminarCredencialOperadorInput,
  audit: { entidad: "usuario", accion: "RESTABLECER_CREDENCIAL" },
  handler: async ({ tx, session, input }) => {
    const etiqueta = METODOS[input.metodo].etiqueta;
    if (esAccionSobreSiMismo(session.usuario.id, input.usuarioId)) {
      throw new DomainError(`No podés eliminar tu propio método ${etiqueta} desde Usuarios. Hacelo desde Mi cuenta.`);
    }

    // Lock the target row first -- see admin-guard.ts's LOCK ORDER doc comment. `idsAdminsActivos` is unused here.
    await lockUsuarioYAdministradoresActivos(tx, session.tenantId, input.usuarioId);

    const actual = await loadUsuarioParaAccion(tx, session.tenantId, input.usuarioId);
    if (!actual) throw new NotFoundError("Usuario no encontrado.");

    if (!(await eliminarCredencialDeOperadorEnTx(tx, session.tenantId, input.usuarioId, input.metodo))) {
      throw new DomainError(`El usuario no tiene el método ${etiqueta} configurado.`);
    }

    return {
      output: {},
      audit: {
        entidadId: input.usuarioId,
        motivo: `Baja del código de ${etiqueta} por el Administrador.`,
        // Never the code nor its hash.
        valorAnterior: { credencial: input.metodo, enrolada: true },
        valorNuevo: { credencial: input.metodo, enrolada: false },
      },
    };
  },
});

export async function eliminarCredencialOperadorDeUsuario(input: EliminarCredencialOperadorDeUsuarioInput): Promise<void> {
  await eliminarCredencialOperadorDeUsuarioCommand.execute(input);
}
