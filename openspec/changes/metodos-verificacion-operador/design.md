# Design: operador verification methods (one registry + huella)

Decision and scope: `proposal.md`. Behavior: `specs/cuentas-de-sector/spec.md` (delta). No new Next.js API is used
(Server Actions and the existing `<dialog>` pattern only).

## Technical approach

Three closed registries keyed by `MetodoVerificacion`, one per layer, each a mapped type so a method missing from any
of them fails `npm run typecheck`:

| Layer | File | Holds |
|---|---|---|
| Domain catalog (pure, client-safe) | `modules/auth/domain/verificacion-identidad.ts` | proof union, label, proof keys, `siempreHabilitado`, `almacen` |
| Server registry | `modules/auth/application/metodos-verificacion.ts` | zod proof schema, `identificador`, messages, optional `iniciar` |
| Client registry | `modules/operadores/ui/metodos-en-dialogo.tsx` | input component, dialog priority |

Everything else (carrier, form plumbing, field-error marker, logger, audit label) derives from the domain catalog
through `shared/auth/operador-campos.ts` and never names a method. PIN and huella share one strategy
(`identificacion-por-codigo.ts`) and differ only in their `FuenteDeCodigos`.

## Architecture decisions

| # | Topic | Options | Decision / rationale |
|---|---|---|---|
| D1 | Source of the method list | zod-first (`z.infer`) / domain type-first | **Domain type-first.** `domain/` imports no zod (verified: no domain file does). `MetodoVerificacion = PruebaDeIdentidad["metodo"]`; every registry is `{ [M in MetodoVerificacion]: … }`. |
| D2 | Proof validation | `z.discriminatedUnion` built from entries / dispatch | **Dispatch**: `z.object({ metodo: z.enum(METODOS_VERIFICACION) })` then `REGISTRO[metodo].prueba.safeParse`. Same outcome (any failure gives `MENSAJE_OPERADOR_RECHAZADO`, no audit) and no tuple cast. Each `prueba` is typed `z.ZodType<PruebaDe<M>>`, so schema and domain type cannot drift. |
| D3 | Huella hash | argon2 candidate scan / HMAC keyed hash + unique index | **argon2id scan, like PIN.** One strategy, no new secret in `shared/env.ts`, no rotation runbook, same S8 semantics (AMBIGUA included). Cost: N argon2 verifies per scan, but only over that method's candidates, and a farmacia has few usuarios (libuv's pool runs 4 at a time). HMAC stays possible later as a second `FuenteDeCodigos` with an indexed lookup, with no consumer changes. |
| D4 | Carrier | method-specific fields / neutral envelope | **Neutral by convention.** Field = `operador` + capitalized proof key (`pin` → `operadorPin`, `huella` → `operadorHuella`), plus `operadorMetodo`. `credencialDesde` collects every catalog field present. With no `operadorMetodo` it defaults to `METODO_POR_DEFECTO = "PIN"`, so `{ operadorPin }` still yields exactly `{ prueba: { metodo: "PIN", pin } }`. |
| D5 | Rejection field marker (`usecase.ts:304`) | constant / all fields / claimed method's fields | **Claimed method's fields** (`camposDeOperador(credencial.prueba.metodo)`), or every operador field when the method is unknown. A PIN rejection stays `[CAMPO_OPERADOR_PIN]`, which the pipeline test pins. |
| D6 | Huella proof key | `codigo` / `huella` | **`huella`.** The logger redacts by key at three levels, and `codigo` would hide permiso and droga codes. |
| D7 | Enablement storage | row per enabled method with PIN seeded / presence set without PIN | **Presence set, PIN not stored** (`fsj.metodo_verificacion_habilitado`, same shape as `accion_con_pin`). PIN being always on is code (`siempreHabilitado`), so a row would only be able to contradict it. Huella defaults to off, so there is **no seed, no backfill and no `crear_tenant_interno` replacement**. This deviates from the proposal on purpose. A future default-on method does need that 0125-style replacement. |
| D8 | Server gate | DB read in the verifier / set loaded with the session | **Session**: `SesionDeSector.metodosHabilitados`, filled by `loadMetodosHabilitados` (seeded with the `siempreHabilitado` methods, mirroring `loadPermisosConPin` + `PERMISOS_CON_PIN_SIEMPRE`). It is optional on the type. Absent means only the always-on methods (fail-closed), so the existing fixtures typecheck unchanged. The verifier checks it before scanning: rejected, audited with internal reason `DESHABILITADO`. |
| D9 | Client registry location | `shared/ui` / `modules/operadores/ui` | **`modules/operadores/ui`.** `shared/ui` never imports a module (the `shared/ui/operador.tsx` contract, docs). Only `operador-provider.tsx` consumes it. ESLint does not enforce this, so it is kept by convention. |
| D10 | Huella enrollment | method-specific use case / generic code-credential use case | **Generic**, over `METODOS_CON_CREDENCIAL_PROPIA` (`almacen: "CREDENCIAL_OPERADOR"`). PIN keeps `configurar-pin*` (step-up, mandatory step) untouched. |

## Interfaces (sketch)

```ts
// modules/auth/domain/verificacion-identidad.ts (pure)
export type PruebaDeIdentidad = { metodo: "PIN"; pin: string } | { metodo: "HUELLA"; huella: string };
export type MetodoVerificacion = PruebaDeIdentidad["metodo"];
export const METODOS_VERIFICACION = ["PIN", "HUELLA"] as const satisfies readonly MetodoVerificacion[];
type ClaveDePrueba<M extends MetodoVerificacion> = Exclude<keyof PruebaDe<M>, "metodo">;
export interface DescripcionDeMetodo<M extends MetodoVerificacion> {
  metodo: M; etiqueta: string;              // "PIN" | "Huella" (dialog, admin, audit)
  claves: readonly ClaveDePrueba<M>[];      // every proof key is secret -> form fields + redaction
  siempreHabilitado: boolean;               // PIN: true (v1)
  almacen: "USUARIO_PIN" | "CREDENCIAL_OPERADOR";
}
export const METODOS: { [M in MetodoVerificacion]: DescripcionDeMetodo<M> } = { … };

// modules/auth/application/metodos-verificacion.ts
interface EntradaServidor<M extends MetodoVerificacion> {
  prueba: z.ZodType<PruebaDe<M>>;           // PIN: exactly today's min(1).max(64)
  identificador: IdentificadorDeEmpleado<M, ContextoIdentificacion>;
  rechazo: Record<RechazoIdentificacion, string>;  // PIN: today's two messages, verbatim
  /** Two-step methods (WebAuthn) only. No caller in v1. */
  iniciar?(ctx: ContextoIdentificacion): Promise<{ desafio: unknown }>;
}
export const REGISTRO: { [M in MetodoVerificacion]: EntradaServidor<M> };

// modules/auth/application/identificacion-por-codigo.ts (shared strategy)
interface FuenteDeCodigos {
  candidatos(tx, tenantId): Promise<{ usuarioId: string; hash: string }[]>;        // S7
  hashesDeOtros(tx, tenantId, usuarioId): Promise<string[]>;                       // takes the advisory lock
}
export function identificadorPorCodigo<M>(metodo: M, clave: ClaveDePrueba<M>, fuente: FuenteDeCodigos): IdentificadorDeEmpleado<M, …>;
export async function assertCodigoDisponible(fuente, tx, tenantId, usuarioId, codigo, { mensaje, campo }): Promise<void>;

// shared/auth/operador-campos.ts (client-safe, re-exports the catalog)
export const campoDeOperador = (clave: string) => `operador${clave[0]!.toUpperCase()}${clave.slice(1)}`;
export const CAMPO_OPERADOR_PIN = "operadorPin";            // kept: tests and existing imports
export const CAMPOS_DE_PRUEBA_OPERADOR: readonly string[];  // every method's fields
export function camposDeOperador(metodo: string): readonly string[];
export function esCampoDeOperador(campo: string): boolean;

// modules/operadores/ui/metodos-en-dialogo.tsx
interface MetodoEnDialogo { prioridad: number; Campo: (p: { id: string; ref: Ref<HTMLInputElement>; valores: Record<string, string>; onChange(clave: string, valor: string): void }) => ReactNode }
export const METODOS_EN_DIALOGO: { [M in MetodoVerificacion]: MetodoEnDialogo };
```

**PIN wiring (keeps the tests' mocks valid).** The PIN `FuenteDeCodigos` wraps `loadPinHashesDeOperadores` and
`loadPinHashesDeOtros` (lock `'fsj.pin:'`, unchanged) in **arrow functions**. The unit tests mock
`usuario-repository` and `domain/password` with partial factories, and reading a missing export while the module
loads throws in vitest. `pin-disponible.ts` keeps its signature and messages and delegates. The S7 filter moves to
`modules/auth/infrastructure/operador-elegible.ts` (one source). `loadPinHashesDeOperadores` spreads it, so its
`findMany` argument is deep-equal to today's.

**Huella source.** New file `modules/auth/infrastructure/credencial-operador-repository.ts`:
`candidatos` = `credencialOperador.findMany({ where: { tenantId, metodo, usuario: OPERADOR_ELEGIBLE } })`, and
`hashesDeOtros` locks `hashtext('fsj.credencial:' || metodo || ':' || tenant)`. Hash = `hashPassword` (argon2id).

## Data flow

```
dialog (client registry) -> {operadorMetodo, operador<Clave>…} -> use-form-submit (FormData kept)
  -> Server Action conOperador -> credencialDesde (catalog fields) -> ALS
  -> usecase.resolverActor -> verificarOperadorEnTx:
       parse metodo -> gate session.sector.metodosHabilitados -> REGISTRO[m].prueba
       -> identificadorPorCodigo(fuente) -> decideCandidatoOperador -> ok | audit(rejection)
  -> rejection: DomainError(fields = camposDeOperador(m)) -> esCampoDeOperador -> dialog reopens on m
```

## Client

- `layout.tsx` passes `metodos={[...session.sector.metodosHabilitados]}` to `OperadorProvider`.
- The dialog opens on the highest-`prioridad` enabled method (HUELLA before PIN), or on the last method used when it
  reopens after a rejection. It shows a method switch only with more than one method, so a PIN-only farmacia sees
  today's dialog unchanged.
- The selected method's input is focused on open and on switch. The wedge's Enter submits the native form.
- The main form's data survives because `use-form-submit` resubmits the stored `FormData`. The rejected secret is
  cleared, as it is today.
- `use-form-submit`, `form-parts.tsx:140` and `planilla-existencia-inicial.tsx:480` use `esCampoDeOperador`. On
  success, `use-form-submit` deletes every `CAMPOS_DE_PRUEBA_OPERADOR` field.
- Logger: `enTresNiveles([...existing, ...CLAVES_Y_CAMPOS_DE_PRUEBA])`. The literal `operadorPin` becomes derived.
- `auditoria-diff.tsx`: shows `METODOS[verificacion]?.etiqueta ?? verificacion`. PIN still reads "identificado con
  PIN". The `contexto` keeps the code.

## Use cases

| Use case | Module | Permiso | Audit (never code nor hash) |
|---|---|---|---|
| `operadores.metodosVerificacion.configurar` (+ list) | operadores | `config.editar` (list: same as `list-acciones-con-pin`) | `metodo_verificacion`/MODIFICAR, `entidadId` = tenant, before/after + activados/desactivados |
| `auth.credencialOperador.registrar` `{metodo, passwordActual, huella}` | auth | `auth.password.cambiar` (precedent `configurarPin`) | `usuario`/MODIFICAR, motivo alta/reemplazo, `{ credencial: metodo }` |
| `auth.credencialOperador.eliminar` (own) | auth | `auth.password.cambiar` | `usuario`/MODIFICAR |
| `usuarios.credencialOperador.eliminar` `{usuarioId, metodo}` | usuarios | `usuarios.credencial.restablecer` (precedent `restablecer-pin`: lock order, not on self) | `usuario`/RESTABLECER_CREDENCIAL |

- Registering rejects a cuenta de sector, an admin-only usuario and a method the farmacia has disabled. It requires
  the current password, as `configurarPin` does, and min 6 chars. It checks uniqueness with
  `assertCodigoDisponible` before hashing. Replacing an enrolled code is an upsert.
- None of these acciones is in `PERMISOS_CON_PIN_*`, and `config.editar` / `usuarios.*` are forbidden to cuentas de
  sector, so none of them uses `conOperador`.
- `auditoria/domain/presentacion.ts` gains a label for `metodo_verificacion`. `ayuda-permisos.ts` names the huella.

## Schema

| Migration | Content |
|---|---|
| `0132_metodo_verificacion_habilitado` (slice 1) | `(tenant_id → tenant, metodo text CHECK (metodo ~ '^[A-Z][A-Z_]{1,29}$' AND metodo <> 'PIN'), PK (tenant_id, metodo))`; `fsj.setup_tenant_table`; `GRANT DELETE`, `REVOKE UPDATE` (delete + insert, same as 0077). |
| `0133_credencial_operador` (slice 2a) | `(tenant_id, usuario_id, metodo text CHECK (same, <> 'PIN'), hash text NOT NULL, creado_en, actualizado_en, PK (tenant_id, usuario_id, metodo), FK (tenant_id, usuario_id) → usuario (tenant_id, id))`; `setup_tenant_table`; `GRANT UPDATE (hash, actualizado_en), DELETE`. |

- The PKs lead with `(tenant_id, …)` and satisfy `catalogo-guardas` without adding an exception. `usuario_id` is the
  owner, not an actor, so it is indexed.
- The method is not a DB enum: the app validates it against the registry, so a new method needs no `ALTER TYPE`.
- Disabling a method deletes only its config row. `credencial_operador` rows stay, are ignored while the method is
  off, and work again when it is turned back on.
- Each migration has a `prisma/rollbacks/<m>.down.sql` (drop the table) and Prisma models.
- `docs/rollbacks/metodos-verificacion-operador.md`: revert the code first, then 0133.down, then 0132.down. PIN never
  depends on either table, and with the code reverted nothing reads them. Recheck the numbers before applying: the
  repo already has duplicate numbers (0124, 0129, 0130).

## Slices and tests (TDD: test first, `npm test`)

| Slice | Content | Guard |
|---|---|---|
| 0 | Catalog, both registries (PIN only), strategy, carrier, marker, logger, audit label. No copy change. | All `cuentas-de-sector-*`, `auth-pin-disponible`, `auth-configurar-pin*`, `contrasena-temporal-operadores`, `logger` tests **unchanged and green**. New: registry keys equal `METODOS_VERIFICACION` (runtime check against casts); `campoDeOperador`/`camposDeOperador`; carrier collects the fields generically; strategy run against a fake source. |
| 1 | 0132, `loadMetodosHabilitados`, verifier gate + audit, configure/list use cases, admin section (rendered only when a method is optional), neutral copy | Unit: the gate with a mocked registry entry (no optional method exists yet); the configure command. DB: RLS/grants of the table, `catalogo-guardas`. |
| 2a | HUELLA in the catalog and the server registry, 0133, source, the three credential use cases | Unit: identification and AMBIGUA; uniqueness with lock; disabled method rejected; redaction of `huella`/`operadorHuella`; audit has no code. DB: the table. |
| 2b | Client entry, Mi cuenta panel, admin removal in Usuarios › detalle | Manual: a real wedge reader, the dialog defaults and focus, 375px. |

## How to add a method (the extension guide)

1. Domain: add the proof variant to `PruebaDeIdentidad`, the code to `METODOS_VERIFICACION`, and its `METODOS` entry
   (label, keys, `almacen`).
2. Server: add the `REGISTRO` entry. A code method uses `identificadorPorCodigo` with a `FuenteDeCodigos` (for
   `CREDENCIAL_OPERADOR`, the existing table works as is). Any other method writes its own `IdentificadorDeEmpleado`.
3. Client: add the `METODOS_EN_DIALOGO` entry (component + `prioridad`).
4. Enrollment: a code method reuses the generic credential use cases and panel. Any other method writes its own.
5. A two-step method (WebAuthn) implements `iniciar`. Add one `iniciarVerificacionAction(metodo)` in
   `modules/operadores/ui/actions.ts` that calls it and stores the challenge server-side, single-use. Its `Campo`
   fetches the challenge on mount and puts the signed assertion into its proof keys. The verifier checks it inside
   `identificar`.
6. `npm run typecheck` lists every registry still missing the method. Nothing else changes: not the carrier,
   `conOperador` sites, `resolverActor`, the logger, the audit writer or the field markers.

## Open questions

- [ ] D7 drops the proposal's seed and backfill. The spec delta must not require a PIN row in
      `crear_tenant_interno`.
- [ ] S7 for huella: the candidate needs a huella credential. Does it also still need a PIN? The design assumes
      not (same filter, minus "has a PIN").
- [ ] Registering a huella while the method is disabled is rejected (assumed). Removing one is always allowed.
- [ ] `openspec/config.yaml` has `strict_tdd: false` while the orchestrator reports strict TDD as active.
      Reconcile before apply.
