/**
 * `auth.credencialOperador.registrar` (openspec/changes/metodos-verificacion-operador): an empleado enrols or replaces
 * their OWN secret code for a verification method whose credential lives in `fsj.credencial_operador` (the huella
 * today). Generic over those methods (`METODOS_CON_CREDENCIAL_PROPIA`): a future code method reuses it as is, and only
 * its registry entry (`enrolamiento`, ./metodos-verificacion.ts) says how the code is validated. The PIN keeps its own
 * use cases (./configurar-pin.ts).
 *
 * Same shape as `configurarPin`: always has a session, goes through the normal `defineCommand` pipeline, requires the
 * CURRENT password in the same form (the inline check is the proof of identity), and reuses `auth.password.cambiar`
 * ("manage my own credential", granted to every role). Replacing is the same write as enrolling (upsert).
 *
 * Rejected: a cuenta de sector (it never holds a credential of its own, the empleado does), a usuario whose only role is
 * Administrador (it never acts as an operador), a method the farmacia has not enabled, a wrong password, a code that
 * does not meet the method's rules and a code another usuario of the farmacia already holds (the check runs under the
 * per-method advisory lock, before hashing, and never says whose it is).
 *
 * The code travels in the input under the method's proof key (`huella`), a key the logger redacts. The audit row never
 * holds the code nor its hash: only which method was enrolled.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, ValidationError } from "@/shared/errors";
import { hashPassword } from "../domain/password";
import { METODOS, METODOS_CON_CREDENCIAL_PROPIA, metodoHabilitado } from "../domain/verificacion-identidad";
import { loadMetodosHabilitados } from "../infrastructure/session-repository";
import { upsertCredencialOperador } from "../infrastructure/credencial-operador-repository";
import { assertEmpleadoGestionaSuCredencial } from "./empleado-gestiona-su-credencial";
import { assertCodigoDisponible } from "./identificacion-por-codigo";
import { entradaDe } from "./metodos-verificacion";

/** `looseObject`: the code arrives under the method's own proof key, which only the registry entry knows. */
const registrarCredencialOperadorInput = z.looseObject({
  metodo: z.enum(METODOS_CON_CREDENCIAL_PROPIA),
  passwordActual: z.string().min(1, "Ingresá tu contraseña actual."),
});

export type RegistrarCredencialOperadorInput = z.infer<typeof registrarCredencialOperadorInput>;

export const registrarCredencialOperadorCommand = defineCommand({
  name: "auth.credencialOperador.registrar",
  permiso: "auth.password.cambiar",
  input: registrarCredencialOperadorInput,
  audit: { entidad: "usuario", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const { metodo } = input;
    const etiqueta = METODOS[metodo].etiqueta;
    const enrolamiento = entradaDe(metodo).enrolamiento;
    if (!enrolamiento) throw new DomainError(`El método ${etiqueta} no se enrola con un código.`);

    const codigoValido = enrolamiento.codigo.safeParse(input[enrolamiento.clave]);
    if (!codigoValido.success) {
      throw new ValidationError(codigoValido.error.issues[0]?.message ?? "El código no es válido.", { fields: [enrolamiento.clave] });
    }
    const codigo = codigoValido.data;

    await assertEmpleadoGestionaSuCredencial(tx, session, {
      noSePudo: `No se pudo registrar el método ${etiqueta}.`,
      sector: `Las cuentas de sector no administran el método ${etiqueta}: lo hace cada empleado desde su cuenta.`,
      administrador: `El Administrador no usa el método ${etiqueta}.`,
      passwordActual: input.passwordActual,
    });
    if (!metodoHabilitado(metodo, await loadMetodosHabilitados(tx, session.tenantId))) {
      throw new DomainError(`El método ${etiqueta} no está habilitado en la farmacia.`);
    }

    await assertCodigoDisponible(enrolamiento.fuente, tx, session.tenantId, session.usuario.id, codigo, { mensaje: enrolamiento.noDisponible, campo: enrolamiento.clave });

    // Same argon2id setup as the password and the PIN: `hashPassword` is generic over the string it hashes.
    const { existia } = await upsertCredencialOperador(tx, session.tenantId, session.usuario.id, metodo, await hashPassword(codigo), new Date());

    return {
      output: {},
      audit: {
        entidadId: session.usuario.id,
        // Never the code nor its hash (shared/audit's module doc comment): only which method and whether it replaced one.
        motivo: existia ? `Reemplazo del código de ${etiqueta} por el propio usuario.` : `Alta del código de ${etiqueta} por el propio usuario.`,
        valorAnterior: { credencial: metodo, enrolada: existia },
        valorNuevo: { credencial: metodo, enrolada: true },
      },
    };
  },
});

export async function registrarCredencialOperador(input: RegistrarCredencialOperadorInput): Promise<void> {
  await registrarCredencialOperadorCommand.execute(input);
}
