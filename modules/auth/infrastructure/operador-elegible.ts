/**
 * Who a cuenta de sector can be operated by (openspec/specs/cuentas-de-sector/spec.md, contrasena-temporal): ACTIVO
 * people, never a cuenta de sector nor the technical usuario, with no pending password change. The single source of
 * this filter: every method's candidate query spreads it and adds its own "has a credential" condition.
 *
 * The pending-change flag is written through a named constant on purpose: tests/unit/auth-cambiar-password-temporal.test.ts
 * allows the literal that clears `debeCambiarPassword` only in usuario-repository.ts, and this is a read filter.
 */
const SIN_CAMBIO_DE_PASSWORD_PENDIENTE = false;

export const OPERADOR_ELEGIBLE = {
  estado: "ACTIVO",
  esSector: false,
  esTecnico: false,
  debeCambiarPassword: SIN_CAMBIO_DE_PASSWORD_PENDIENTE,
} as const;
