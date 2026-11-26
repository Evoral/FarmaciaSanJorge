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

## Slice 2a: huella on the server (migration 0137)

HUELLA exists in the method catalog and the server registry, the credential table exists and three use cases manage
the codes (own register/replace, own remove, Administrador remove). There is no UI yet and the method is off in every
farmacia, so production behavior is unchanged until an Administrador enables it and the UI of slice 2b ships.

- Schema: `fsj.credencial_operador (tenant_id, usuario_id, metodo, hash, creado_en, actualizado_en)`, migration
  `20261125160000_0137_credencial_operador`, down script
  `prisma/rollbacks/20261125160000_0137_credencial_operador.down.sql` (drops the table). Recheck the number before
  applying anywhere: `origin/master` already took 0132-0135 once.
- Order: revert the code of the slice first (the verifier registry, the three use cases and the repository read the
  table), then apply the 0137 down script as a NEW forward migration, then the 0136 one (slice 1). No FK between the
  two tables.
- What is lost: every enrolled huella. The empleados must enrol again if the feature comes back. The PIN
  (`usuario.pin_hash`) and every audit row stay.
- Reverting only the code leaves an unused table that nothing reads, which is harmless. Reverting the code but leaving
  the HUELLA row of `fsj.metodo_verificacion_habilitado` is also harmless: with no HUELLA in the catalog,
  `loadMetodosHabilitados` ignores a method it does not know.
- The slice also changes two behaviors outside the huella (revert with the code): the verifier takes the generic
  rejection message from the method's registry entry (the PIN text is byte-identical), and
  `replaceMetodosHabilitados` serializes concurrent saves of a farmacia with an advisory lock.

## Slice 2b: huella UI (no schema)

The feature becomes usable: the «Huella» panel in Mi cuenta, the Administrador's removal in Usuarios › detalle, the real
dialog field and the setup note in the admin section. UI and read-only queries only: no migration, nothing to drop.

- Revert the PR 4 commits (any order; they are independent of each other). The slice-2a stub of the HUELLA dialog entry
  comes back with them, so the dialog still works end to end.
- Reverting only this slice leaves a working server side with no way to enrol or remove a huella from the UI. If the
  method is already on in a farmacia, switch it off first (`/admin/configuracion/pin`) or the empleados cannot add a
  huella while the dialog still offers it.
- Final order of a full rollback: revert the code of slices 2b, 2a, 1 and 0 (newest first), then the 0137 down script,
  then the 0136 one, each as a NEW forward migration.
- Behavior outside the huella that this slice changes (revert with the code): after a reader method (huella) answers, the
  dialog stays up for 300 ms and swallows further submits (the PIN dialog closes at once, unchanged); a retry after a rejection reopens on the method that was just rejected; `UsuarioDetalle` has a new
  `credencialesOperador` field; `/cuenta` renders its panels in a container query grid.
