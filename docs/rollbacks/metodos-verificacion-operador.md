# Rollback: verification methods of the operador (registry, per-farmacia enablement, huella)

Change: `openspec/changes/metodos-verificacion-operador/` (spec: `openspec/specs/cuentas-de-sector/spec.md`). It ships
as chained slices; each slice appends its section here. Revert in the reverse order of the slices.

## Slice 0: one registry, PIN as an entry (no schema)

No behavior, copy or audit change: the PIN flows through the method catalog, the server and client registries and a
generic secret-code strategy, and the form field names, the logger redaction and the audit label derive from the
catalog.

- No migration, no `prisma/rollbacks/*.down.sql`.
- Revert the slice's commits (the four commits of PR 1) with `git revert`. Nothing reads or writes new data, so there is
  nothing to undo in the database and no ordering constraint with the rest of the code.
- Exported names that callers and tests rely on (`CAMPO_OPERADOR_PIN`, `MENSAJE_OPERADOR_RECHAZADO`,
  `loadPinHashesDeOperadores`, `loadPinHashesDeOtros`, `assertPinDisponible`) are unchanged, so a partial revert does
  not break an import.

## Slice 1: per-farmacia enablement (migration 0136)

An Administrador can switch OPTIONAL verification methods on and off; the server rejects a method the farmacia has not
enabled. No optional method exists yet, so production behavior is unchanged: the admin section is hidden and the PIN
(always on, code) never needs a row.

- Schema: `fsj.metodo_verificacion_habilitado (tenant_id, metodo)`, migration
  `20261125150000_0136_metodo_verificacion_habilitado`, down script
  `prisma/rollbacks/20261125150000_0136_metodo_verificacion_habilitado.down.sql` (drops the table). The number was
  planned as 0132; `origin/master` took 0132-0135 first, so recheck it before applying anywhere.
- Order: revert the code of the slice first (the session loader, the verifier gate, the use cases and the admin section
  read the table), then apply the down script as a NEW forward migration.
- What is lost: which optional methods each farmacia had on. Nothing else: the PIN and every audit row stay.
- Reverting only the code leaves an unused table that nothing reads, which is harmless.
