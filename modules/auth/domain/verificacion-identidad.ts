/**
 * How an empleado proves who they are when acting from a cuenta de sector
 * (openspec/specs/cuentas-de-sector/spec.md). Pure contract -- no I/O.
 *
 * Today the only method is the PIN (`./pin.ts`). The pipeline
 * (shared/usecase.ts), the audit trail and every command only know this
 * contract: a new method (WebAuthn, fingerprint, Face ID) is one more
 * variant of `PruebaDeIdentidad` plus one more `IdentificadorDeEmpleado`
 * registered in ../application/verificar-operador.ts.
 */
export const METODOS_VERIFICACION = ["PIN"] as const;

export type MetodoVerificacion = (typeof METODOS_VERIFICACION)[number];

/** What the empleado presents, discriminated by `metodo`. */
export type PruebaDeIdentidad = { metodo: "PIN"; pin: string };

export type PruebaDe<M extends MetodoVerificacion> = Extract<PruebaDeIdentidad, { metodo: M }>;

/**
 * Why a proof identified nobody: `NO_RECONOCIDA` = it matches no eligible empleado; `AMBIGUA` = it matches more than one
 * (two PINs set before PIN uniqueness was enforced) -- never attributed to either.
 */
export type RechazoIdentificacion = "NO_RECONOCIDA" | "AMBIGUA";

export type ResultadoIdentificacion = { ok: true; usuarioId: string } | { ok: false; motivo: RechazoIdentificacion };

/**
 * One identification method: the proof alone says WHO is acting (no "¿quién sos?" selector, user decision 2026-10-28),
 * as a fingerprint or a face would. `TContexto` is whatever the implementation needs to read the enrolled credentials
 * (the tenant transaction, for the PIN), which keeps this file free of infrastructure types. The candidates are the
 * empleados eligible as operador (`./operador-policy.ts`).
 */
export interface IdentificadorDeEmpleado<M extends MetodoVerificacion, TContexto> {
  readonly metodo: M;
  identificar(contexto: TContexto, prueba: PruebaDe<M>): Promise<ResultadoIdentificacion>;
}
