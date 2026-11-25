/**
 * Form field names that carry "which empleado is acting" in a cuenta de
 * sector (openspec/specs/cuentas-de-sector/spec.md): added to the submitted
 * `FormData` by the form plumbing (shared/ui/use-form-submit.ts) and read
 * server-side by `conOperador` (./operador-context.ts). Pure, safe to import
 * from client code.
 *
 * The proof fields are derived from the method catalog
 * (modules/auth/domain/verificacion-identidad.ts): `operador` + the capitalized
 * proof key (`pin` -> `operadorPin`). A new method needs no entry here.
 */
import { METODOS, METODOS_VERIFICACION, type MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";

export const CAMPO_OPERADOR_METODO = "operadorMetodo";
export const CAMPO_OPERADOR_PIN = "operadorPin";

/** The form field that carries a proof key: `pin` -> `operadorPin`. */
export function campoDeOperador(clave: string): string {
  return `operador${clave.charAt(0).toUpperCase()}${clave.slice(1)}`;
}

function esMetodo(metodo: string): metodo is MetodoVerificacion {
  return (METODOS_VERIFICACION as readonly string[]).includes(metodo);
}

/** The form fields a method's proof travels in; every operador field when the method is unknown (rejection marker). */
export function camposDeOperador(metodo: string): readonly string[] {
  return esMetodo(metodo) ? METODOS[metodo].claves.map(campoDeOperador) : CAMPOS_DE_PRUEBA_OPERADOR;
}

/** Every method's proof fields. */
export const CAMPOS_DE_PRUEBA_OPERADOR: readonly string[] = METODOS_VERIFICACION.flatMap((metodo) => METODOS[metodo].claves.map(campoDeOperador));

/** Every proof key and its form field: all secret, so all redacted from logs. */
export const CLAVES_Y_CAMPOS_DE_PRUEBA: readonly string[] = [...new Set(METODOS_VERIFICACION.flatMap((metodo) => [...METODOS[metodo].claves, ...METODOS[metodo].claves.map(campoDeOperador)]))];

/** True for a field that names the acting empleado's proof: a rejected one reopens the dialog. */
export function esCampoDeOperador(campo: string): boolean {
  return CAMPOS_DE_PRUEBA_OPERADOR.includes(campo);
}
