/**
 * Removing the secret code of a verification method that lives in `fsj.credencial_operador` (the huella today)
 * (openspec/changes/metodos-verificacion-operador). Two callers, one write:
 *
 *   - `auth.credencialOperador.eliminar`: the empleado removes their OWN code from «Mi cuenta». Always allowed, even
 *     while the farmacia has the method disabled (removing only reduces access). No password: it never grants anything.
 *   - `eliminarCredencialDeOperadorEnTx`: what `usuarios.credencialOperador.eliminar` (the Administrador, from Usuarios ›
 *     detalle) calls, so the table is only touched from modules/auth.
 *
 * Only the code of the named method goes: the PIN (`usuario.pin_hash`) and the other methods stay. The audit row says
 * which method, never the code nor its hash.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { METODOS, METODOS_CON_CREDENCIAL_PROPIA, type MetodoVerificacion } from "../domain/verificacion-identidad";
import { deleteCredencialOperador } from "../infrastructure/credencial-operador-repository";
import { assertEmpleadoGestionaSuCredencial } from "./empleado-gestiona-su-credencial";

/** Deletes the credential and says whether there was one. */
export async function eliminarCredencialDeOperadorEnTx(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string, metodo: MetodoVerificacion): Promise<boolean> {
  return deleteCredencialOperador(tx, tenantId, usuarioId, metodo);
}

const eliminarCredencialOperadorInput = z.object({ metodo: z.enum(METODOS_CON_CREDENCIAL_PROPIA) });

export type EliminarCredencialOperadorInput = z.infer<typeof eliminarCredencialOperadorInput>;

export const eliminarCredencialOperadorCommand = defineCommand({
  name: "auth.credencialOperador.eliminar",
  permiso: "auth.password.cambiar",
  input: eliminarCredencialOperadorInput,
  audit: { entidad: "usuario", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const etiqueta = METODOS[input.metodo].etiqueta;
    await assertEmpleadoGestionaSuCredencial(tx, session, {
      noSePudo: `No se pudo eliminar el método ${etiqueta}.`,
      sector: `Las cuentas de sector no administran el método ${etiqueta}: lo hace cada empleado desde su cuenta.`,
    });
    if (!(await eliminarCredencialDeOperadorEnTx(tx, session.tenantId, session.usuario.id, input.metodo))) {
      throw new DomainError(`No tenés el método ${etiqueta} configurado.`);
    }

    return {
      output: {},
      audit: {
        entidadId: session.usuario.id,
        motivo: `Baja del código de ${etiqueta} por el propio usuario.`,
        valorAnterior: { credencial: input.metodo, enrolada: true },
        valorNuevo: { credencial: input.metodo, enrolada: false },
      },
    };
  },
});

export async function eliminarCredencialOperador(input: EliminarCredencialOperadorInput): Promise<void> {
  await eliminarCredencialOperadorCommand.execute(input);
}
