# Proposal — Métodos de verificación del operador (registro único + huella)

> **Status:** proposal, scope approved by the user; residual product questions at the end.
> **Specs affected:** `openspec/specs/cuentas-de-sector/spec.md` (delta in `specs/cuentas-de-sector/spec.md`).

## Intent

On a cuenta de sector the employee is identified by a PIN that is hard-wired across the app: the request carrier
(`operadorPin` in `shared/auth/operador-context.ts`, `operador-campos.ts`), the dialog (`operador-provider.tsx`), the
form error mapping (`CAMPO_OPERADOR_PIN` in `shared/ui/use-form-submit.ts`), log redaction and audit labels. The
domain contract (`verificacion-identidad.ts`, `IDENTIFICADORES`) is pluggable, but nothing around it is. Goal: ONE
place verifiers are consumed from, so a new way to identify the person means programming only that method (how it is
enrolled, how it is read) and enabling it from admin. No duplicated code.

## User decision (2026-11-25)

1. One method registry, consumed app-wide: server side each method declares its proof schema and identifies the
   employee; client side each method contributes its component to the operador dialog. Adding a method = one entry
   per registry. The 34 `conOperador` call sites, the usecase pipeline and the audit writer do not change.
2. PIN becomes one registered method, with no behavior change. Step-up `reautenticar.ts` is untouched.
3. New method **huella**: a reader that types a code + Enter (keyboard wedge, like the QR reader). Code hashed,
   unique per farmacia, never logged; same rejection semantics as PIN (S8: no lockout, generic message; S9: audited).
4. PIN and huella share ONE generic "identification by secret code" strategy, parametrized per method.
5. Each employee enrolls their huella in «Mi cuenta»; an Administrador can remove it.
6. The Administrador enables/disables each method per farmacia. PIN is always enabled in v1 (fallback).
7. Which acciones require verification is unchanged (`accion_con_pin`, `PERMISOS_CON_PIN_*`,
   `/admin/configuracion/pin` keep their names); only user-facing copy becomes method-neutral («Verificación»).
8. Face ID / WebAuthn / FIDO2 / TOTP are out, but the server contract leaves room for a two-step method.

## Current gap

| Today | After |
|---|---|
| Credential is `operadorPin` (string) | Generic `{ metodo, prueba }` carried by `conOperador` |
| Dialog renders a PIN field only | Dialog renders the farmacia's enabled methods from the client registry |
| Adding a method touches carrier, dialog, form errors, logger, audit label | One server entry + one client entry |
| No per-farmacia choice of method | Per-tenant enablement, PIN always on |

## Scope

- **Server registry** (`modules/auth`): entry = `metodo`, zod proof schema, `identificar(ctx, prueba)`, optional
  `iniciar(ctx)` returning a server challenge (unused in v1; reserved for WebAuthn), label, rejection message,
  redacted proof keys. The proof union is derived from the registry.
- **Generic secret-code strategy**: candidates (S7) + where the hash lives + uniqueness check under advisory lock
  (generalizes `pin-disponible.ts`). PIN reads `usuario.pin_hash`; huella reads its own storage.
- **Client registry** (`modules/operadores/ui`): per-method input component; dialog, field-error mapping and
  pre-submit flow read from it.
- **Per-tenant config** table shaped like `fsj.accion_con_pin`; admin section under Configuración (`config.editar`,
  audited before/after). The server rejects a proof of a disabled method, not just the UI.
- **Huella**: enroll/replace in «Mi cuenta» (not for cuentas de sector), removal by Administrador in Usuarios ›
  detalle, both audited; input accepts the wedge code + Enter; `contexto.verificacion = "HUELLA"`.

## Out of scope

- WebAuthn, platform biometrics (Windows Hello / Face ID), FIDO2 keys, TOTP.
- Renaming `accion_con_pin`, `PERMISOS_CON_PIN_*`, the `/admin/configuracion/pin` route or the `configurar-pin` step.
- Disabling PIN, per-acción choice of method, per-equipo method preference.
- Step-up reautenticación and its `usuario.pin_*` counters.
- Reader configuration (suffix, prefixes): documented, no code.

## Approach

- Keep `usuario.pin_hash` as PIN storage (shared with step-up). Non-PIN methods get a new per-user credential
  table, one row per `(tenant, usuario, metodo)`.
- Registry entries are data + a strategy instance; no method-specific `if` outside its entry. Mirrors the
  `parametros-registry.ts` precedent.
- Security notes recorded in the spec: a code-emitting reader is a static secret, as strong as its code (like an
  access badge). On a shared sector PC an OS biometric verifies presence, not identity; future biometrics must be
  identifying (per-employee authenticator or identify-then-verify).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cuentas-de-sector`: S1, S2, S5, S7, S8, S9, «Unicidad de PIN» and «conOperador» become method-neutral (PIN rules
  kept as the PIN instance, none dropped); ADDED per-tenant method enablement, huella enrollment/removal, huella
  storage and redaction; «Fuera de alcance» narrows to WebAuthn/OS biometrics; «Verificación» section rewritten.
  `contrasena-temporal` and specs that only name "acción con PIN" are expected unchanged (spec phase confirms).

## Affected areas

| Area | Impact |
|---|---|
| `modules/auth/domain/verificacion-identidad.ts`, `modules/auth/application/{verificar-operador,identificador-pin,pin-disponible}.ts` | Modified: registry + generic strategy |
| `shared/auth/{operador-context,operador-campos,operador}.ts` | Modified: generic credential |
| `shared/usecase.ts` (`resolverActor`) | Unchanged contract; reads method from credential |
| `modules/operadores/ui/operador-provider.tsx`, `shared/ui/use-form-submit.ts`, `shared/ui/form-parts.tsx` | Modified: client registry |
| `shared/logging/logger.ts` | Modified: redaction from registry |
| `modules/auditoria/ui/auditoria-diff.tsx` | Modified: method label from registry |
| `app/(app)/cuenta/*`, Usuarios › detalle, `app/(app)/admin/configuracion/pin/*` | Modified: huella panel, removal, methods section |
| `prisma/migrations/0132_*`+, `prisma/rollbacks/*.down.sql`, `docs/rollbacks/metodos-verificacion-operador.md` | New |
| `tests/db/catalogo-guardas.test.ts` | Must pass unchanged |

## Schema and rollback impact

- Config table `(tenant_id, metodo)`: RLS ENABLE + FORCE + policy; seeded in `fsj.crear_tenant_interno` by a
  migration replacing it (last: 0125); backfill PIN for every farmacia.
- Credential table `(tenant_id, usuario_id, metodo, hash, ...)`: RLS forced, index `(tenant_id, usuario_id)`.
- Each migration ships its `.down.sql`; one `docs/rollbacks/metodos-verificacion-operador.md`.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Slice 0 refactor changes PIN behavior | Med | Existing `cuentas-de-sector-*` tests pass unchanged; no copy change in slice 0 |
| Huella code leaks to logs/audit | Low | Redaction keys come from the registry; logger test per method |
| Weak or guessable reader codes | Med | Minimum length per method; treated as a badge, documented |
| Argon2 scan cost grows with two methods | Low | Scan only the method's candidates; design may pick a keyed hash for high-entropy codes |
| `iniciar` hook over-designed for v1 | Low | Optional, no caller in v1 |

## Rollback

Slice 0: revert the commit (no schema). Slices 1–2: run their `.down.sql` (drop tables, restore previous
`crear_tenant_interno`), revert code; PIN keeps working because it never depended on the new tables. Steps in
`docs/rollbacks/metodos-verificacion-operador.md`.

## Slicing suggestion

| Slice | Content | Review size |
|---|---|---|
| 0 | Registries, generic credential and strategy, PIN as entry; no behavior/copy change | ~400 lines |
| 1 | Per-tenant config (migration, use cases, admin section, server rejection), neutral copy | ~400 lines |
| 2a | Huella server: credential table, enroll/remove use cases, registry entry | ~350 lines |
| 2b | Huella UI: «Mi cuenta» panel, admin removal, dialog input | ~300 lines |

## Proposal question round — answered (2026-11-25)

1. **Huella code format**: minimum 6 characters. No check against the employee's PIN (costly, low value).
2. **Disabling huella keeps enrolled codes**: they are ignored while disabled; re-enabling restores them without
   re-enrollment.
3. **Dialog default**: when huella is enabled, the dialog opens on huella with focus in its input (the wedge reader
   types into the focused field, so a PIN-focused dialog would swallow the scan). PIN is one click away.
4. **Removal**: the employee can remove (and replace) their own huella in «Mi cuenta»; an Administrador can also
   remove it from Usuarios › detalle.

## Success criteria

- [ ] Adding a method requires only one server and one client registry entry (no edits to `conOperador` sites,
      `resolverActor` or the audit writer).
- [ ] PIN behavior, messages and audit rows are identical after slice 0.
- [ ] An employee with an enrolled huella performs an acción con PIN with the reader; audit shows `HUELLA`.
- [ ] A disabled method is rejected server-side; the huella code never appears in logs or audit.
