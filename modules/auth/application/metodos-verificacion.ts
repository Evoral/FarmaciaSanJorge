/**
 * The server registry of verification methods (openspec/specs/cuentas-de-sector/spec.md): one entry per
 * `MetodoVerificacion`, a mapped type, so a method missing here fails `npm run typecheck`. An entry holds how the proof
 * is validated, who it identifies and what the terminal is told when it identifies nobody. The domain catalog
 * (../domain/verificacion-identidad.ts) holds the pure facts; the client registry is
 * modules/operadores/ui/metodos-en-dialogo.tsx. Adding a method: "Adding a verification method" in shared/auth/README.md.
 */
import { z } from "zod";
import type { IdentificadorDeEmpleado, MetodoVerificacion, PruebaDe, RechazoIdentificacion } from "../domain/verificacion-identidad";
import { identificadorPin } from "./identificador-pin";
import type { ContextoIdentificacion } from "./identificacion-por-codigo";

export interface EntradaServidor<M extends MetodoVerificacion> {
  /** Validates the proof the request carried; a failure is a rejected credential (generic message, not audited). */
  prueba: z.ZodType<PruebaDe<M>>;
  identificador: IdentificadorDeEmpleado<M, ContextoIdentificacion>;
  /** What the terminal is told when the proof identified nobody. The audit row carries the internal reason instead. */
  rechazo: Record<RechazoIdentificacion, string>;
  /** Two-step methods (WebAuthn) only: issues the challenge the proof must answer. No caller yet. */
  iniciar?(contexto: ContextoIdentificacion): Promise<{ desafio: unknown }>;
}

export const REGISTRO: { [M in MetodoVerificacion]: EntradaServidor<M> } = {
  PIN: {
    prueba: z.object({ metodo: z.literal("PIN"), pin: z.string().min(1).max(64) }),
    identificador: identificadorPin,
    rechazo: {
      NO_RECONOCIDA: "El PIN no corresponde a ningún empleado habilitado.",
      AMBIGUA: "Ese PIN lo tiene más de un empleado. Cambialo desde «Mi cuenta» para poder identificarte.",
    },
  },
};

/** The entry of one method, typed for it (a union index would not let `identificar` accept the matching proof). */
export function entradaDe<M extends MetodoVerificacion>(metodo: M): EntradaServidor<M> {
  return REGISTRO[metodo];
}
