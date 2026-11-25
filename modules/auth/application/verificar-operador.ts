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
 * The method is pluggable (`REGISTRO`, ./metodos-verificacion.ts): the PIN and the huella. Each entry says its own
 * generic rejection message (`rechazoGenerico`; the PIN's text is the historical one). A farmacia accepts only the methods in
 * `session.sector.metodosHabilitados` (the always-on ones when absent); a disabled method is rejected BEFORE anything
 * is scanned, with the generic message and an audit row whose internal reason is `DESHABILITADO`. `usuario.pin_hash` is still compared only inside
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
import { MENSAJE_RECHAZO_PIN } from "../domain/mensajes-verificacion";
import { METODOS_VERIFICACION, metodoHabilitado, type MetodoVerificacion } from "../domain/verificacion-identidad";
import { loadUsuarioConPermisos } from "../infrastructure/session-repository";
import { entradaDe } from "./metodos-verificacion";

/** The envelope only names the method; the method's registry entry (./metodos-verificacion.ts) validates the proof itself. */
const credencialOperadorInput = z.object({ prueba: z.looseObject({ metodo: z.enum(METODOS_VERIFICACION) }) });

export interface OperadorVerificado {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  /** The empleado's OWN effective permisos (the pipeline intersects them with the cuenta de sector's). */
  permisos: ReadonlySet<Permiso>;
}

export type VerificacionDeOperador = { ok: true; operador: OperadorVerificado; metodo: MetodoVerificacion } | { ok: false; message: string };

/** What a request that names no known method gets (the PIN is the default method); every known method says its own, from its registry entry. */
export const MENSAJE_OPERADOR_RECHAZADO = MENSAJE_RECHAZO_PIN;

/** `credencial` is what the request carried, untrusted (`conOperador`, shared/auth/operador-context.ts); `session.tenantId` scopes the lookup. */
export async function verificarOperadorEnTx(tx: Prisma.TransactionClient, session: AuthenticatedSession, credencial: unknown): Promise<VerificacionDeOperador> {
  const envoltura = credencialOperadorInput.safeParse(credencial);
  if (!envoltura.success) return { ok: false, message: MENSAJE_OPERADOR_RECHAZADO };
  const metodoPedido = envoltura.data.prueba.metodo;
  const entrada = entradaDe(metodoPedido);
  if (!metodoHabilitado(metodoPedido, session.sector?.metodosHabilitados)) {
    await auditarRechazo(tx, session, metodoPedido, "DESHABILITADO");
    return { ok: false, message: entrada.rechazoGenerico };
  }
  const parsed = entrada.prueba.safeParse(envoltura.data.prueba);
  if (!parsed.success) return { ok: false, message: entrada.rechazoGenerico };
  const prueba = parsed.data;

  const identificacion = await entrada.identificador.identificar({ tx, tenantId: session.tenantId }, prueba);
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
  await auditarRechazo(tx, session, prueba.metodo, motivoInterno);

  return { ok: false, message: identificacion.ok ? entrada.rechazoGenerico : entrada.rechazo[identificacion.motivo] };
}

/** Internal detail for auditoria.ver -- the terminal only ever sees the generic messages. Never the proof. */
async function auditarRechazo(tx: Prisma.TransactionClient, session: AuthenticatedSession, metodo: MetodoVerificacion, motivoInterno: string): Promise<void> {
  await auditRecord(tx, {
    tenantId: session.tenantId,
    usuarioId: session.usuario.id,
    entidad: "operador",
    entidadId: session.usuario.id,
    accion: TipoAccion.AUTORIZAR,
    motivo: `Identificación de empleado rechazada (método ${metodo}, motivo interno: ${motivoInterno}).`,
    contexto: { sesionId: session.sesionId },
  });
}
