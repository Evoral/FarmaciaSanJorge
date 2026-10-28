# Restablecer el PIN de un usuario

## Why

The PIN is mandatory for every usuario that is not a cuenta de sector or an admin-only usuario, but only its
holder can change it (from «Mi cuenta», with their current password). «Restablecer credencial» deliberately
keeps the PIN (CT5). A usuario who forgot their PIN and cannot change it themselves had no way out from the
administración.

User decision (2026-10-28): the Administrador gets a button that clears a usuario's PIN; the next time that
person uses the system, the existing «Configurar PIN» step asks for a new one.

## What Changes

- New command `restablecerPin` (`usuarios.pin.restablecer`), same permiso as `restablecerCredencial`.
- It clears the PIN columns only; the mandatory «Configurar PIN» step follows by derivation (CT3), so the
  usuario's flow does not change.
- A «PIN» panel in the usuario detail shows the PIN state and offers «Restablecer PIN».

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `contrasena-temporal`: ADDED RP1, RP3, RP4, RP6, RP7, RP8 (RP2 and RP5 are stated inside RP1 and RP4).

## Impact

- `modules/usuarios/{application,infrastructure,ui,domain}`, `app/(app)/admin/accesos/usuarios/[id]/page.tsx`.
- No schema change: reuses the permiso `usuarios.credencial.restablecer` and the `tipo_accion`
  `RESTABLECER_CREDENCIAL`. Rollback is reverting the commit.

## Out of scope

- The Administrador choosing or seeing the new PIN.
- Notifying the usuario by email (the Administrador tells them in person).
- Changing «Restablecer credencial»: it still keeps the PIN.
