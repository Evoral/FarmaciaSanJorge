/**
 * Texts the terminal is told when a verification proof is rejected. Pure. The PIN's generic message is the historical
 * one and must stay byte-identical (tests/unit/cuentas-de-sector-verificar-operador.test.ts pins it). Every other
 * method's texts live in its registry entry (../application/metodos-verificacion.ts).
 */

/** The generic rejection of the PIN, also what a proof that names no known method gets (the PIN is the default method). */
export const MENSAJE_RECHAZO_PIN = "No se pudo identificar al empleado. Volvé a ingresar el PIN.";
