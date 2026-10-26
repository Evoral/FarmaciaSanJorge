# Rollback: PIN de 4 dígitos

The "clave rápida" PIN went from 6 to 4 digits on 2026-10-13
(`AUTH_POLICY.pinLength` in `shared/auth/policy.ts`; migration
`prisma/migrations/20261013180000_0078_pin_cuatro_digitos` cleared every
existing PIN). Specs that mention it: `openspec/specs/cuentas-de-sector/spec.md`,
DP-20 in `docs/plan-implementacion.md`.

## What cannot be undone

The PINs cleared by 0078 are gone: only their argon2 hashes existed. Going
back to 6 digits does not bring them back, and it makes every 4-digit PIN set
since then unusable in the same way.

## Order

1. Revert the code (`pinLength` back to 6, with the commit that introduced
   this change). Nothing else in the code depends on the length: the format
   check, every PIN input and the messages read `AUTH_POLICY.pinLength`.
2. Apply the down migration right after: copy
   `prisma/rollbacks/0078_pin_cuatro_digitos.down.sql` into a NEW migration
   folder (next free number, a timestamp later than every existing one) and
   apply it with `npm run db:migrate`. It clears the 4-digit PINs (audited
   per usuario, like 0078) and restores the column comment. Never edit or
   delete the applied 0078 migration.
3. Tell the staff: everyone sets a new PIN from «Mi cuenta». Until then they
   confirm with their password and cannot identify themselves on a cuenta de
   sector.
4. `npm run typecheck`, `npm run lint`, `npm test`.
