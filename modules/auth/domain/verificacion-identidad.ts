/**
 * How an empleado proves who they are when acting from a cuenta de sector
 * (openspec/specs/cuentas-de-sector/spec.md). Pure contract -- no I/O, no zod.
 *
 * The method catalog (`METODOS`) is the single source every other layer derives from: the carrier field names
 * (shared/auth/operador-campos.ts), the logger redaction, the form plumbing and the audit label. The server registry
 * (../application/metodos-verificacion.ts) and the client one (modules/operadores/ui/metodos-en-dialogo.tsx) are
 * mapped types over `MetodoVerificacion`, so a method missing from any of them fails the typecheck. Adding a method:
 * "Adding a verification method" in shared/auth/README.md.
 */

/** What the empleado presents, discriminated by `metodo`. */
export type PruebaDeIdentidad = { metodo: "PIN"; pin: string };

export type MetodoVerificacion = PruebaDeIdentidad["metodo"];

/** The method used when a request names none (what a PIN-only form sends). */
export const METODO_POR_DEFECTO: MetodoVerificacion = "PIN";

export type PruebaDe<M extends MetodoVerificacion> = Extract<PruebaDeIdentidad, { metodo: M }>;

/** The keys of a method's proof (everything but `metodo`). */
export type ClaveDePrueba<M extends MetodoVerificacion> = Exclude<keyof PruebaDe<M>, "metodo">;

/** Where a method's enrolled secret lives: `usuario.pin_hash` or the generic per-method credential table. */
export type AlmacenDeMetodo = "USUARIO_PIN" | "CREDENCIAL_OPERADOR";

export interface DescripcionDeMetodo<M extends MetodoVerificacion> {
  readonly metodo: M;
  /** Shown in the dialog, the admin section and the audit trail. */
  readonly etiqueta: string;
  /** Every proof key is secret: each one is a form field and a redacted log key. */
  readonly claves: readonly ClaveDePrueba<M>[];
  /** An always-on method cannot be disabled by a farmacia. */
  readonly siempreHabilitado: boolean;
  readonly almacen: AlmacenDeMetodo;
}

export const METODOS: { [M in MetodoVerificacion]: DescripcionDeMetodo<M> } = {
  PIN: { metodo: "PIN", etiqueta: "PIN", claves: ["pin"], siempreHabilitado: true, almacen: "USUARIO_PIN" },
};

/** Every method, derived from the catalog keys: `METODOS` is a mapped type, so a method missing there fails the typecheck. */
export const METODOS_VERIFICACION = Object.keys(METODOS) as readonly MetodoVerificacion[];

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
