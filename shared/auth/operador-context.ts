/**
 * Request-scoped carrier for "which empleado is acting" in a cuenta de
 * sector's shared session (openspec/specs/cuentas-de-sector/spec.md).
 *
 * A Server Action wraps its body in `conOperador(formData, ...)`. The
 * credential the form sent (`operadorPin`) then travels
 * ambiently -- same approach as shared/audit/request-context.ts -- to the
 * use-case pipeline (shared/usecase.ts), which is the only reader that acts
 * on it: no zod input schema and no use-case signature has to carry it, and
 * a command that needs it but did not get it is REJECTED there
 * (`OperadorRequeridoError`), never silently attributed to the shared account.
 *
 * Nothing here verifies anything: the store holds what the request claimed
 * (`credencial`) and, once the pipeline has verified it, who it turned out
 * to be (`operador`), which `shared/audit` reads to tag the audit rows
 * written on that empleado's behalf with the terminal they acted from.
 *
 * Server-only (`node:async_hooks`); never import it from a client component.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { CAMPO_OPERADOR_METODO, CAMPO_OPERADOR_PIN } from "./operador-campos";

/** What the request presented, untrusted and unparsed -- validated by the verifier (modules/auth/application/verificar-operador.ts). */
export interface CredencialDeOperador {
  /** The proof alone identifies the empleado: there is no "who" to pick. */
  prueba: { metodo: string; pin: string };
}

/** The empleado the pipeline verified in this request, and where they acted from. */
export interface OperadorDeLaSolicitud {
  usuarioId: string;
  terminal: { usuarioId: string; usuario: string; sesionId: string };
  verificacion: string;
}

export interface SolicitudDeOperador {
  credencial: CredencialDeOperador | null;
  /** The pipeline's verification, started once per request: an action that chains several commands verifies the PIN a single time. */
  verificacion?: Promise<unknown>;
  operador?: OperadorDeLaSolicitud;
  /** Set by the pipeline when it rejected a command for lack of a credential. */
  requerido: boolean;
}

const storage = new AsyncLocalStorage<SolicitudDeOperador>();

/** The current request's store; `undefined` outside `conOperador`. */
export function solicitudDeOperador(): SolicitudDeOperador | undefined {
  return storage.getStore();
}

function credencialDesde(formData: FormData): CredencialDeOperador | null {
  const pin = formData.get(CAMPO_OPERADOR_PIN);
  if (typeof pin !== "string" || pin.length === 0) return null;
  const metodo = formData.get(CAMPO_OPERADOR_METODO);
  return { prueba: { metodo: typeof metodo === "string" && metodo.length > 0 ? metodo : "PIN", pin } };
}

/** Runs `fn` with `credencial` as the request's operador credential. Server Actions use `conOperador`; this is its core (and what tests call). */
export function ejecutarConOperador<T>(credencial: CredencialDeOperador | null, fn: (solicitud: SolicitudDeOperador) => Promise<T>): Promise<T> {
  const solicitud: SolicitudDeOperador = { credencial, requerido: false };
  return storage.run(solicitud, () => fn(solicitud));
}

export interface OperadorRequeridoState {
  status: "operador-required";
}

/**
 * Wraps a Server Action body. When a command inside was rejected because it
 * needs an empleado and the form sent none, the action's own error result is
 * replaced by `{ status: "operador-required" }`: the form then asks for the
 * empleado's PIN and resubmits the SAME data with the credential
 * (shared/ui/use-form-submit.ts). Only an error result is replaced, so
 * nothing that succeeded is ever run twice.
 */
export async function conOperador<S extends { status: string }>(formData: FormData, fn: () => Promise<S>): Promise<S | OperadorRequeridoState> {
  return ejecutarConOperador(credencialDesde(formData), async (solicitud) => {
    const resultado = await fn();
    return solicitud.requerido && resultado.status === "error" ? { status: "operador-required" } : resultado;
  });
}
