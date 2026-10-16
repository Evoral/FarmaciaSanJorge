/**
 * How an empleado proves who they are when acting from a cuenta de sector
 * (docs/specs/cuentas-de-sector.md). Pure contract -- no I/O.
 *
 * Today the only method is the PIN (`./pin.ts`). The pipeline
 * (shared/usecase.ts), the audit trail and every command only know this
 * contract: a new method (WebAuthn, fingerprint, Face ID) is one more
 * variant of `PruebaDeIdentidad` plus one more `VerificadorDeIdentidad`
 * registered in ../application/verificar-operador.ts.
 */
export const METODOS_VERIFICACION = ["PIN"] as const;

export type MetodoVerificacion = (typeof METODOS_VERIFICACION)[number];

/** What the empleado presents, discriminated by `metodo`. */
export type PruebaDeIdentidad = { metodo: "PIN"; pin: string };

export type PruebaDe<M extends MetodoVerificacion> = Extract<PruebaDeIdentidad, { metodo: M }>;

/** Why a proof was rejected; `SIN_CREDENCIAL` = the usuario never enrolled this method. */
export type RechazoVerificacion = "SIN_CREDENCIAL" | "BLOQUEADA" | "INCORRECTA";

export type ResultadoVerificacion = { ok: true } | { ok: false; motivo: RechazoVerificacion; bloqueoAlcanzado?: boolean };

/**
 * One verification method. `TContexto` is whatever the implementation needs
 * to read and update the credential (the tenant transaction, for the PIN),
 * which keeps this file free of infrastructure types.
 *
 * `usuarioId` is `null` when the candidate is not eligible (unknown,
 * inactive...): the implementation must still spend the same work as a real
 * check, so the answer's timing never tells which case it was.
 */
export interface VerificadorDeIdentidad<M extends MetodoVerificacion, TContexto> {
  readonly metodo: M;
  verificar(contexto: TContexto, usuarioId: string | null, prueba: PruebaDe<M>): Promise<ResultadoVerificacion>;
}
