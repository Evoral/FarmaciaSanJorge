/**
 * Form field names that carry "which empleado is acting" in a cuenta de
 * sector (openspec/specs/cuentas-de-sector/spec.md): added to the submitted
 * `FormData` by the form plumbing (shared/ui/use-form-submit.ts) and read
 * server-side by `conOperador` (./operador-context.ts). Pure constants, safe
 * to import from client code.
 */
export const CAMPO_OPERADOR_METODO = "operadorMetodo";
export const CAMPO_OPERADOR_PIN = "operadorPin";
