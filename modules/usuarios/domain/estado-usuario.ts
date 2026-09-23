/**
 * Pure mirror of the `usuario.estado` state machine (M03, plan §9 M03 /
 * migration 0002's `fsj.usuario_validar_transicion_estado`). Kept in sync
 * BY HAND with that trigger -- the DB remains the final, authoritative
 * guard (INV-USR-006); this exists so the application layer can reject an
 * illegal transition with a clear Spanish message BEFORE opening a
 * transaction, and so the rule has a DB-free unit test (see
 * tests/unit/usuarios-estado.test.ts).
 *
 * BAJA is terminal for now (DP-02 unresolved) -- no BAJA -> anything
 * transition exists here or in the DB trigger. Do not add one without
 * resolving DP-02 in the plan first.
 */
export type EstadoUsuario = "PENDIENTE_ACTIVACION" | "ACTIVO" | "SUSPENDIDO" | "BAJA";

/** Legal next states for each current state (excluding the no-op `estado -> same estado`, which the DB trigger always allows). */
const TRANSICIONES_VALIDAS: Record<EstadoUsuario, readonly EstadoUsuario[]> = {
  PENDIENTE_ACTIVACION: ["ACTIVO", "BAJA"],
  ACTIVO: ["SUSPENDIDO", "PENDIENTE_ACTIVACION", "BAJA"],
  SUSPENDIDO: ["ACTIVO", "PENDIENTE_ACTIVACION", "BAJA"],
  BAJA: [],
};

/** `true` for a no-op (same state) or a transition present in `TRANSICIONES_VALIDAS`. Mirrors the DB trigger's `IF NEW.estado = OLD.estado THEN RETURN NEW` short-circuit. */
export function esTransicionValida(actual: EstadoUsuario, nuevo: EstadoUsuario): boolean {
  if (actual === nuevo) return true;
  return TRANSICIONES_VALIDAS[actual].includes(nuevo);
}

/** Human, Spanish explanation for why a transition was rejected -- used to fail fast with a clear message instead of surfacing the DB's raw `INV-USR-006` text. `null` when the transition is actually valid (caller error to call this then). */
export function explicarTransicionInvalida(actual: EstadoUsuario, nuevo: EstadoUsuario): string | null {
  if (esTransicionValida(actual, nuevo)) return null;
  if (actual === "BAJA") {
    return "El usuario está dado de baja. La baja es definitiva y no admite reactivación.";
  }
  return `No se puede pasar de ${actual} a ${nuevo}.`;
}
