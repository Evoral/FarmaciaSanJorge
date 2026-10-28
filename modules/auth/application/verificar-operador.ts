/**
 * `verificarOperadorEnTx` (openspec/specs/cuentas-de-sector/spec.md): in a cuenta de
 * sector's shared session, identifies WHICH empleado is acting from their PIN
 * alone -- no "¿quién sos?" selector (user decision 2026-10-28): no two
 * usuarios of a farmacia share a PIN. Called by the use-case pipeline
 * (shared/usecase.ts) for the acciones the farmacia asks a PIN for, in a short
 * transaction of its own that commits BEFORE the command's transaction opens.
 *
 * Like the DT's co-firma (modules/stock/application/verificar-co-firma-dt.ts)
 * this names a DIFFERENT usuario than the session's, who has no session here:
 * it never creates one, it only says who they are. It never throws for a
 * rejected proof -- it returns `{ ok: false }` -- so the audit row of the
 * rejection is committed.
 *
 * The candidates are the empleados eligible as operador (ACTIVO, not a cuenta
 * de sector nor the technical usuario, with a PIN and no pending password
 * change, openspec/specs/contrasena-temporal/spec.md). The PIN is an
 * identifier, not a secret guarded by attempts: no failed-attempt counter and
 * no block (the user's call; a fingerprint or face reader is meant to replace it).
 *
 * NOT a use case: the pipeline is its only caller, with the session it
 * already authorized. Whether the empleado HOLDS the permiso of the act is
 * the pipeline's next check, not this function's.
 *
 * The method is pluggable (`IDENTIFICADORES`, ../domain/verificacion-identidad.ts):
 * the PIN today. `usuario.pin_hash` is still compared only inside
 * modules/auth (here and in ./reautenticar.ts).
 *
 * AUDIT: every rejected attempt is audited (as the co-firma does), authored
 * by and targeting the cuenta de sector -- the only identity actually proven
 * at that point. A successful one is not: the act it enables carries the
 * empleado as its author and the terminal in its `contexto`.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { record as auditRecord, TipoAccion } from "@/shared/audit";
import type { AuthenticatedSession } from "../domain/session";
import type { Permiso } from "../domain/permisos";
import { decideCandidatoOperador } from "../domain/operador-policy";
import type { IdentificadorDeEmpleado, MetodoVerificacion, RechazoIdentificacion } from "../domain/verificacion-identidad";
import { loadUsuarioConPermisos } from "../infrastructure/session-repository";
import { identificadorPin, type ContextoIdentificacion } from "./identificador-pin";

/** One identifier per method. Adding a method = one more `PruebaDeIdentidad` variant, one more entry here and in `pruebaDeIdentidadInput`. */
const IDENTIFICADORES: { [M in MetodoVerificacion]: IdentificadorDeEmpleado<M, ContextoIdentificacion> } = {
  PIN: identificadorPin,
};

const pruebaDeIdentidadInput = z.discriminatedUnion("metodo", [z.object({ metodo: z.literal("PIN"), pin: z.string().min(1).max(64) })]);

const credencialOperadorInput = z.object({ prueba: pruebaDeIdentidadInput });

export interface OperadorVerificado {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  /** The empleado's OWN effective permisos (the pipeline intersects them with the cuenta de sector's). */
  permisos: ReadonlySet<Permiso>;
}

export type VerificacionDeOperador = { ok: true; operador: OperadorVerificado; metodo: MetodoVerificacion } | { ok: false; message: string };

export const MENSAJE_OPERADOR_RECHAZADO = "No se pudo identificar al empleado. Volvé a ingresar el PIN.";

const MENSAJES_RECHAZO: Record<RechazoIdentificacion, string> = {
  NO_RECONOCIDA: "El PIN no corresponde a ningún empleado habilitado.",
  AMBIGUA: "Ese PIN lo tiene más de un empleado. Cambialo desde «Mi cuenta» para poder identificarte.",
};

/** `credencial` is what the request carried, untrusted (`conOperador`, shared/auth/operador-context.ts); `session.tenantId` scopes the lookup. */
export async function verificarOperadorEnTx(tx: Prisma.TransactionClient, session: AuthenticatedSession, credencial: unknown): Promise<VerificacionDeOperador> {
  const parsed = credencialOperadorInput.safeParse(credencial);
  if (!parsed.success) return { ok: false, message: MENSAJE_OPERADOR_RECHAZADO };
  const { prueba } = parsed.data;

  const identificacion = await IDENTIFICADORES[prueba.metodo].identificar({ tx, tenantId: session.tenantId }, prueba);
  const candidato = identificacion.ok ? await loadUsuarioConPermisos(tx, identificacion.usuarioId) : null;
  // The identifier only offers eligible empleados; re-checked on the loaded row so the rule has one source.
  const candidatura =
    candidato && candidato.tenantId === session.tenantId
      ? decideCandidatoOperador({
          encontrado: true,
          estado: candidato.estado,
          esSector: candidato.esSector,
          esTecnico: candidato.esTecnico,
          debeCambiarPassword: candidato.debeCambiarPassword,
        })
      : "NO_ENCONTRADO";

  if (candidatura === "OK" && candidato) {
    return {
      ok: true,
      metodo: prueba.metodo,
      operador: { id: candidato.id, email: candidato.email, nombre: candidato.nombre, apellido: candidato.apellido, permisos: candidato.permisos },
    };
  }

  const motivoInterno = identificacion.ok ? candidatura : identificacion.motivo;
  await auditRecord(tx, {
    tenantId: session.tenantId,
    usuarioId: session.usuario.id,
    entidad: "operador",
    entidadId: session.usuario.id,
    accion: TipoAccion.AUTORIZAR,
    // Internal detail for auditoria.ver -- the terminal only ever sees the messages below. Never the PIN.
    motivo: `Identificación de empleado rechazada (método ${prueba.metodo}, motivo interno: ${motivoInterno}).`,
    contexto: { sesionId: session.sesionId },
  });

  return { ok: false, message: identificacion.ok ? MENSAJE_OPERADOR_RECHAZADO : MENSAJES_RECHAZO[identificacion.motivo] };
}
