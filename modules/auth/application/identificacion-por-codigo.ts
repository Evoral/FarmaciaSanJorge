/**
 * The strategy shared by every method whose proof is a secret code the empleado types or scans (the PIN today): the
 * code alone says which empleado is acting from a cuenta de sector (openspec/specs/cuentas-de-sector/spec.md). Methods
 * differ only in where their hashes live (`FuenteDeCodigos`).
 *
 * Every candidate's hash is checked (argon2, in parallel), with no early exit: a match on two is `AMBIGUA`. A code shorter
 * than the method's minimum (`longitudMinima`) cannot be anyone's: it is `NO_RECONOCIDA` without scanning, so it is
 * rejected and audited like any other unknown code.
 * `assertCodigoDisponible` is the uniqueness check run before a code is stored: no two usuarios of a farmacia share one.
 */
import type { Prisma } from "@/generated/prisma/client";
import { ValidationError } from "@/shared/errors";
import { verifyPassword } from "../domain/password";
import type { ClaveDePrueba, IdentificadorDeEmpleado, MetodoVerificacion } from "../domain/verificacion-identidad";

export interface ContextoIdentificacion {
  tx: Prisma.TransactionClient;
  tenantId: string;
}

export interface FuenteDeCodigos {
  /** The hashes of the empleados eligible as operador (`OPERADOR_ELEGIBLE`) that hold this method. */
  candidatos(tx: Prisma.TransactionClient, tenantId: string): Promise<{ usuarioId: string; hash: string }[]>;
  /** The hashes of every OTHER usuario of the tenant, after taking the per-tenant advisory lock that serializes two usuarios choosing the same code. */
  hashesDeOtros(tx: Prisma.TransactionClient, tenantId: string, usuarioId: string): Promise<string[]>;
}

export interface OpcionesDeCodigo {
  /** Codes shorter than this identify nobody (and nothing is scanned). */
  longitudMinima?: number;
}

export function identificadorPorCodigo<M extends MetodoVerificacion>(
  metodo: M,
  clave: ClaveDePrueba<M>,
  fuente: FuenteDeCodigos,
  { longitudMinima = 0 }: OpcionesDeCodigo = {},
): IdentificadorDeEmpleado<M, ContextoIdentificacion> {
  return {
    metodo,
    async identificar({ tx, tenantId }, prueba) {
      const codigo = (prueba as unknown as Record<string, string>)[clave as string]!;
      if (codigo.length < longitudMinima) return { ok: false, motivo: "NO_RECONOCIDA" };
      const candidatos = await fuente.candidatos(tx, tenantId);
      const coincide = await Promise.all(candidatos.map((candidato) => verifyPassword(candidato.hash, codigo)));
      const encontrados = candidatos.filter((_, indice) => coincide[indice]);
      if (encontrados.length === 1) return { ok: true, usuarioId: encontrados[0]!.usuarioId };
      return { ok: false, motivo: encontrados.length === 0 ? "NO_RECONOCIDA" : "AMBIGUA" };
    },
  };
}

/** Verifies `codigo` against every other usuario's hash (in parallel -- a farmacia has few usuarios). The error never says the code belongs to someone. */
export async function assertCodigoDisponible(
  fuente: FuenteDeCodigos,
  tx: Prisma.TransactionClient,
  tenantId: string,
  usuarioId: string,
  codigo: string,
  { mensaje, campo }: { mensaje: string; campo: string },
): Promise<void> {
  const hashes = await fuente.hashesDeOtros(tx, tenantId, usuarioId);
  const coincidencias = await Promise.all(hashes.map((hash) => verifyPassword(hash, codigo)));
  if (coincidencias.some(Boolean)) throw new ValidationError(mensaje, { fields: [campo] });
}
