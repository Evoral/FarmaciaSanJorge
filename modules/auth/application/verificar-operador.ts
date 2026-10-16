/**
 * `verificarOperadorEnTx` (docs/specs/cuentas-de-sector.md): in a cuenta de
 * sector's shared session, proves WHICH empleado is acting. Called by the
 * use-case pipeline (shared/usecase.ts) for the acciones the farmacia asks a
 * PIN for, in a short transaction of its own that commits BEFORE the
 * command's transaction opens.
 *
 * Like the DT's co-firma (modules/stock/application/verificar-co-firma-dt.ts)
 * this authenticates a DIFFERENT usuario than the session's, who has no
 * session here: it never creates one, it only says who they are. It never
 * throws for a rejected proof -- it returns `{ ok: false }` -- because the
 * failed-attempt counter written by the verifier must be committed: a throw
 * would roll it back and defeat the block.
 *
 * NOT a use case: the pipeline is its only caller, with the session it
 * already authorized. Whether the empleado HOLDS the permiso of the act is
 * the pipeline's next check, not this function's.
 *
 * The method is pluggable (`VERIFICADORES`, ../domain/verificacion-identidad.ts):
 * the PIN today. `usuario.pin_hash` is still compared only inside
 * modules/auth (here and in ./reautenticar.ts).
 *
 * AUDIT: every rejected attempt is audited (as the co-firma does), authored
 * by the cuenta de sector -- the only identity actually proven at that
 * point -- and targeting the usuario the proof was presented for. A
 * successful one is not: the act it enables carries the empleado as its
 * author and the terminal in its `contexto`.
 *
 * A PIN can be blocked from the shared terminal by someone guessing a
 * colleague's (accepted, same tradeoff as the co-firma's lockout): it never
 * locks the account itself, and the empleado unblocks it by re-authenticating
 * with their password or setting a new PIN from /cuenta.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { record as auditRecord, TipoAccion } from "@/shared/audit";
import { uuid } from "@/shared/validation";
import type { AuthenticatedSession } from "../domain/session";
import type { Permiso } from "../domain/permisos";
import { decideCandidatoOperador } from "../domain/operador-policy";
import type { MetodoVerificacion, RechazoVerificacion, VerificadorDeIdentidad } from "../domain/verificacion-identidad";
import { loadUsuarioConPermisos } from "../infrastructure/session-repository";
import { verificadorPin } from "./verificador-pin";

/** One verifier per method. Adding a method = one more `PruebaDeIdentidad` variant, one more entry here and in `pruebaDeIdentidadInput`. */
const VERIFICADORES: { [M in MetodoVerificacion]: VerificadorDeIdentidad<M, Prisma.TransactionClient> } = {
  PIN: verificadorPin,
};

const pruebaDeIdentidadInput = z.discriminatedUnion("metodo", [z.object({ metodo: z.literal("PIN"), pin: z.string().min(1).max(64) })]);

const credencialOperadorInput = z.object({ usuarioId: uuid, prueba: pruebaDeIdentidadInput });

export interface OperadorVerificado {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  /** The empleado's OWN effective permisos (the pipeline intersects them with the cuenta de sector's). */
  permisos: ReadonlySet<Permiso>;
}

export type VerificacionDeOperador = { ok: true; operador: OperadorVerificado; metodo: MetodoVerificacion } | { ok: false; message: string };

export const MENSAJE_OPERADOR_RECHAZADO = "No se pudo verificar al empleado. Revisá quién está elegido y volvé a ingresar el PIN.";

const MENSAJES_RECHAZO: Record<RechazoVerificacion, string> = {
  INCORRECTA: "El PIN no es correcto.",
  BLOQUEADA: "Ese PIN está bloqueado. Su titular lo desbloquea desde «Mi cuenta», con su contraseña.",
  SIN_CREDENCIAL: "Ese empleado no tiene un PIN configurado. Lo configura desde «Mi cuenta».",
};

/**
 * `credencial` is what the request carried, untrusted (`conOperador`,
 * shared/auth/operador-context.ts): the id only selects WHO must prove their
 * identity; `session.tenantId` scopes the lookup.
 */
export async function verificarOperadorEnTx(tx: Prisma.TransactionClient, session: AuthenticatedSession, credencial: unknown): Promise<VerificacionDeOperador> {
  const parsed = credencialOperadorInput.safeParse(credencial);
  if (!parsed.success) return { ok: false, message: MENSAJE_OPERADOR_RECHAZADO };
  const { usuarioId, prueba } = parsed.data;

  const candidato = await loadUsuarioConPermisos(tx, usuarioId);
  const encontrado = candidato !== null && candidato.tenantId === session.tenantId;
  const candidatura = decideCandidatoOperador({
    encontrado,
    estado: encontrado ? candidato.estado : null,
    esSector: encontrado ? candidato.esSector : false,
    esTecnico: encontrado ? candidato.esTecnico : false,
  });

  // The verifier always runs, with no usuario when the candidate is not eligible (constant work, see ./verificador-pin.ts).
  const verificacion = await VERIFICADORES[prueba.metodo].verificar(tx, candidatura === "OK" ? usuarioId : null, prueba);

  if (candidatura === "OK" && verificacion.ok && candidato) {
    return {
      ok: true,
      metodo: prueba.metodo,
      operador: { id: candidato.id, email: candidato.email, nombre: candidato.nombre, apellido: candidato.apellido, permisos: candidato.permisos },
    };
  }

  const motivoInterno = candidatura !== "OK" ? candidatura : verificacion.ok ? "OK" : verificacion.motivo;
  const bloqueoAlcanzado = !verificacion.ok && verificacion.bloqueoAlcanzado === true;
  await auditRecord(tx, {
    tenantId: session.tenantId,
    usuarioId: session.usuario.id,
    entidad: "operador",
    entidadId: usuarioId,
    accion: TipoAccion.AUTORIZAR,
    // Internal detail for auditoria.ver -- the terminal only ever sees the messages below.
    motivo: `Identificación de empleado rechazada (método ${prueba.metodo}, motivo interno: ${motivoInterno})${bloqueoAlcanzado ? ". PIN bloqueado por intentos fallidos consecutivos." : "."}`,
    contexto: { sesionId: session.sesionId },
  });

  // A non-eligible candidate gets the generic message; the selector only offers eligible empleados anyway.
  const message = candidatura === "OK" && !verificacion.ok ? MENSAJES_RECHAZO[verificacion.motivo] : MENSAJE_OPERADOR_RECHAZADO;
  return { ok: false, message };
}
