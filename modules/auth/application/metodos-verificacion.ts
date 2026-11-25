/**
 * The server registry of verification methods (openspec/specs/cuentas-de-sector/spec.md): one entry per
 * `MetodoVerificacion`, a mapped type, so a method missing here fails `npm run typecheck`. An entry holds how the proof
 * is validated, who it identifies and what the terminal is told when it identifies nobody. The domain catalog
 * (../domain/verificacion-identidad.ts) holds the pure facts; the client registry is
 * modules/operadores/ui/metodos-en-dialogo.tsx. Adding a method: "Adding a verification method" in shared/auth/README.md.
 */
import { z } from "zod";
import {
  HUELLA_LONGITUD_MAXIMA,
  HUELLA_LONGITUD_MINIMA,
  type IdentificadorDeEmpleado,
  type MetodoVerificacion,
  type PruebaDe,
  type RechazoIdentificacion,
} from "../domain/verificacion-identidad";
import { MENSAJE_RECHAZO_PIN } from "../domain/mensajes-verificacion";
import { fuenteDeCredencial } from "./identificador-credencial";
import { identificadorPin } from "./identificador-pin";
import { identificadorPorCodigo, type ContextoIdentificacion, type FuenteDeCodigos } from "./identificacion-por-codigo";

/** How an empleado enrols the secret code of a method that lives in `fsj.credencial_operador` (the generic credential use cases read this). */
export interface EnrolamientoPorCodigo {
  /** The proof key that carries the code (also the form field and the error field of the enrolment). */
  clave: string;
  /** The rules a code must meet to be enrolled; a failure is a field error on `clave`. */
  codigo: z.ZodString;
  /** Where the other usuarios' hashes live (uniqueness per farmacia). */
  fuente: FuenteDeCodigos;
  /** Said when another usuario already holds the code; never says whose. */
  noDisponible: string;
}

export interface EntradaServidor<M extends MetodoVerificacion> {
  /** Validates the proof the request carried; a failure is a rejected credential (generic message, not audited). */
  prueba: z.ZodType<PruebaDe<M>>;
  identificador: IdentificadorDeEmpleado<M, ContextoIdentificacion>;
  /** What the terminal is told when the proof identified nobody. The audit row carries the internal reason instead. */
  rechazo: Record<RechazoIdentificacion, string>;
  /** What the terminal is told for every other rejection of this method (disabled, malformed, identified but not eligible). */
  rechazoGenerico: string;
  /** Present only for a code method stored in `fsj.credencial_operador`: how it is enrolled. */
  enrolamiento?: EnrolamientoPorCodigo;
  /** Two-step methods (WebAuthn) only: issues the challenge the proof must answer. No caller yet. */
  iniciar?(contexto: ContextoIdentificacion): Promise<{ desafio: unknown }>;
}

const fuenteHuella = fuenteDeCredencial("HUELLA");

export const REGISTRO: { [M in MetodoVerificacion]: EntradaServidor<M> } = {
  PIN: {
    prueba: z.object({ metodo: z.literal("PIN"), pin: z.string().min(1).max(64) }),
    identificador: identificadorPin,
    rechazo: {
      NO_RECONOCIDA: "El PIN no corresponde a ningún empleado habilitado.",
      AMBIGUA: "Ese PIN lo tiene más de un empleado. Cambialo desde «Mi cuenta» para poder identificarte.",
    },
    rechazoGenerico: MENSAJE_RECHAZO_PIN,
  },
  HUELLA: {
    // Length is not enforced here: a code shorter than the minimum is a failed (audited) identification, not a malformed proof.
    prueba: z.object({ metodo: z.literal("HUELLA"), huella: z.string().min(1).max(HUELLA_LONGITUD_MAXIMA) }),
    identificador: identificadorPorCodigo("HUELLA", "huella", fuenteHuella, { longitudMinima: HUELLA_LONGITUD_MINIMA }),
    rechazo: {
      NO_RECONOCIDA: "La huella no corresponde a ningún empleado habilitado.",
      AMBIGUA: "Esa huella la tiene más de un empleado. Volvé a enrolarla desde «Mi cuenta» para poder identificarte.",
    },
    rechazoGenerico: "No se pudo identificar al empleado. Volvé a pasar la huella.",
    enrolamiento: {
      clave: "huella",
      codigo: z.string().min(HUELLA_LONGITUD_MINIMA, `El código de la huella debe tener al menos ${HUELLA_LONGITUD_MINIMA} caracteres.`).max(HUELLA_LONGITUD_MAXIMA, `El código de la huella no puede superar los ${HUELLA_LONGITUD_MAXIMA} caracteres.`),
      fuente: fuenteHuella,
      noDisponible: "Ese código no se puede usar. Probá con otro.",
    },
  },
};

/** The entry of one method, typed for it (a union index would not let `identificar` accept the matching proof). */
export function entradaDe<M extends MetodoVerificacion>(metodo: M): EntradaServidor<M> {
  return REGISTRO[metodo];
}
