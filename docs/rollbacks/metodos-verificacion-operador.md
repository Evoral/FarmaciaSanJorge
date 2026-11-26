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
