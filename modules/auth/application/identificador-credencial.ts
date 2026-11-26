/**
 * The `FuenteDeCodigos` of every method whose secret lives in `fsj.credencial_operador` (the huella today), generic over
 * the method: a new code method stored there reuses it as is (./identificacion-por-codigo.ts holds the strategy). The
 * PIN has its own source (./identificador-pin.ts) because its hash lives in `usuario.pin_hash`.
 *
 * Arrow functions on purpose: the repository functions are read when called, not when this module loads, so a test that
 * mocks the repository partially stays valid.
 */
import type { MetodoVerificacion } from "../domain/verificacion-identidad";
import { loadCredencialHashesDeOtros, loadCredencialesDeOperadores } from "../infrastructure/credencial-operador-repository";
import type { FuenteDeCodigos } from "./identificacion-por-codigo";

export function fuenteDeCredencial(metodo: MetodoVerificacion): FuenteDeCodigos {
  return {
    candidatos: (tx, tenantId) => loadCredencialesDeOperadores(tx, tenantId, metodo),
    hashesDeOtros: (tx, tenantId, usuarioId) => loadCredencialHashesDeOtros(tx, tenantId, usuarioId, metodo),
  };
}
