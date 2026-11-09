# Design — plataforma-superadmin

Proposal and decisions: `proposal.md` (D1-D18). Rules: `specs/plataforma/spec.md` (P1-P16).

> Updated 2026-11-09 after pulling master: RLS on `fsj.tenant` already shipped (0119), every new `fsj` table needs a
> policy (`tests/db/catalogo-guardas.test.ts`), and rejected logins are padded to `AUTH_POLICY.loginFallidoMinimoMs`.
> Migrations renumbered to 0124-0126.

## 1. EvoralStock -> FSJ mapping

| EvoralStock | FSJ | Note |
|---|---|---|
| `superadmin(id_auth_user)` references `auth.users` | `fsj.superadmin` with its own email + argon2id hash | No Supabase Auth in FSJ. |
| RLS on, no policy, `revoke ... from authenticated, anon` | RLS on + forced, deny-all policy `plataforma_sin_acceso` (`USING (false)`), `REVOKE ALL ... FROM fsj_app, PUBLIC` | Same "nobody reads it" idea, for FSJ's roles. |
| `esSuperAdmin(id)` with service-role on every request | `fsj.plataforma_validar_sesion(token_hash)` (SECURITY DEFINER) on every request | Still a DB check per request: immediate revocation (the tradeoff stays the right one). |
| `auth.getUser()` validates against the server | Opaque token -> SHA-256 -> `fsj.superadmin_sesion` | Same as tenant sessions (`fsj.sesion`). |
| Service client only after the guard | No privileged client exists. Platform functions are SECURITY DEFINER, `fsj_app` only has EXECUTE | Nothing in TS can bypass RLS; the bypass is in reviewed SQL. |
| `sp_*(p_actor uuid)` re-validates actor | `fsj.plataforma_*(p_token_hash text, ...)` derives the actor | A uuid can be guessed or leaked; the token hash is a secret. |
| Alta: create Auth user, then tenant, delete user on failure | One transaction: `fsj.plataforma_crear_tenant` -> `fsj.crear_tenant_interno` | Nothing external, nothing to compensate. |
| `login`: claim `tenant_id` or superadmin | `fsj.usuario_resolve_login(email)`, then `fsj.superadmin_resolve_login(email)` only when no usuario matched | Every rejection is padded to `loginFallidoMinimoMs` (P2-01), so the extra round trip leaks nothing. |
| `app/(app)/layout.tsx` redirects a superadmin to `/plataforma` | Not needed: separate cookie with `Path=/plataforma`; logging in clears the other cookie | A superadmin on a tenant path just has no tenant session -> `/login`. |
| Paquetes revendedoras / consignación | Out of scope (D16) | |

### Threat model (what D3 does and does not buy)

- **Covers:** a platform use case that forgets `requireSuperAdmin()`; a tenant code path that by mistake queries
  platform tables (no grant); an id leaked in a URL or log (useless without a live token); SQL injection limited to a
  tenant query (no grant on platform tables).
- **Does not cover:** a full compromise of the `fsj_app` credential. Whoever holds it can call
  `fsj.plataforma_iniciar_sesion` and mint a session, exactly as it can already set `app.tenant_id` to any pharmacy
  and read everything. The argon2 check runs in Node, so the DB cannot require the password. This is the same trust
  boundary as today's tenant login; the platform audit (P7) is the detection layer. 2FA (follow-up) does not change
  this either; only a separate DB role with its own credential would, and it is not worth it now.

## 2. Schema

### 0124 `superadmin_identidad`

```sql
CREATE TYPE fsj.estado_superadmin AS ENUM ('ACTIVO', 'INACTIVO');

CREATE TABLE fsj.superadmin (
  id                 uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  email              extensions.citext NOT NULL UNIQUE,
  nombre             text NOT NULL,
  password_hash      text NOT NULL,
  estado             fsj.estado_superadmin NOT NULL DEFAULT 'ACTIVO',
  intentos_fallidos  integer NOT NULL DEFAULT 0,
  bloqueado_hasta    timestamptz,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso      timestamptz
);

CREATE TABLE fsj.superadmin_sesion (
  id             uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  superadmin_id  uuid NOT NULL REFERENCES fsj.superadmin (id),
  token_hash     text NOT NULL UNIQUE,
  creada_en      timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_en  timestamptz NOT NULL DEFAULT now(),
  expira_en      timestamptz NOT NULL,          -- absolute: creada_en + 8 h
  revocada_en    timestamptz,
  ip             text,
  user_agent     text
);

CREATE TABLE fsj.plataforma_auditoria (
  id              uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  superadmin_id   uuid NOT NULL REFERENCES fsj.superadmin (id),
  accion          text NOT NULL,                          -- CHECK in a fixed list (LOGIN, LOGIN_BLOQUEO, LOGOUT, TENANT_CREAR, ...)
  entidad         text NOT NULL,
  entidad_id      uuid NOT NULL,
  tenant_id       uuid REFERENCES fsj.tenant (id),
  valor_anterior  jsonb,
  valor_nuevo     jsonb,
  motivo          text,
  ip              text,
  request_id      text,
  ocurrido_en     timestamptz NOT NULL DEFAULT now()
);
-- superadmin_id NOT NULL: only events of a known superadmin are recorded (unknown-email attempts are not, as today).
```

- All three: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `plataforma_sin_acceso USING (false) WITH CHECK (false)` (the catalog guard requires a policy; this one documents that nobody reads through RLS), `REVOKE ALL ... FROM PUBLIC, fsj_app` (and `anon`,
  `authenticated` guarded like migration 0000).
- `plataforma_auditoria`: `fsj.forbid_update_delete()` + `trg_plataforma_auditoria_forbid_truncate` (migration 0104).
  `superadmin`: `fsj.forbid_delete()` + truncate trigger (a superadmin is set INACTIVO, never deleted, so audit FKs hold).
- Index `plataforma_auditoria (tenant_id, ocurrido_en DESC)`.
- **Email unique across tables (P3):** trigger function `fsj.email_login_unico()` (SECURITY DEFINER, search_path
  pinned) on `BEFORE INSERT OR UPDATE OF email` of both `fsj.usuario` and `fsj.superadmin`; raises
  `INV-PLAT-EMAIL: el email ya está en uso` when the other table has it. No table lock: a race needs a superadmin
  created by the CLI and a usuario with the same email in the same instant. Accepted, noted in the function comment.

Functions (all `SECURITY DEFINER`, `SET search_path = fsj, extensions`, `REVOKE ALL ... FROM PUBLIC`, EXECUTE to
`fsj_app` only where listed):

| Function | fsj_app | Does |
|---|---|---|
| `fsj.superadmin_resolve_login(p_email text)` returns `(superadmin_id, password_hash, estado, intentos_fallidos, bloqueado_hasta)` | yes | Called by `login()` only when `usuario_resolve_login` found nothing. Zero rows for an unknown email. |
| `fsj.plataforma_iniciar_sesion(p_superadmin_id, p_token_hash, p_ip, p_user_agent)` returns `expira_en` | yes | Resets counters, `ultimo_acceso`, inserts the session (`expira_en = now() + 8 h`), audits LOGIN. Refuses an INACTIVO superadmin. |
| `fsj.plataforma_login_fallido(p_superadmin_id, p_max, p_bloqueo_minutos)` returns `intentos` | yes | Increments, locks at `p_max`, audits LOGIN_BLOQUEO when it locks. |
| `fsj.plataforma_actor(p_token_hash)` returns `uuid` | **no** | Internal. Session not revoked, `expira_en > now()`, `ultimo_uso_en > now() - 15 min`, superadmin ACTIVO; touches `ultimo_uso_en` when older than 1 min; else `RAISE 'INV-PLAT-AUTH: sesión de plataforma inválida'`. Every other platform function calls it first. |
| `fsj.plataforma_validar_sesion(p_token_hash)` returns `(superadmin_id, email, nombre)` | yes | `plataforma_actor` + the identity, for `requireSuperAdmin()`. Returns zero rows instead of raising. |
| `fsj.plataforma_cerrar_sesion(p_token_hash)` | yes | Sets `revocada_en`, audits LOGOUT. |

`now()` here means `fsj.instante_actual()` (migration 0026) wherever a business date is compared, so the test clock
keeps working; session expiry uses real `now()` like tenant sessions do -- the builder checks
`modules/auth/infrastructure/session-repository.ts` and follows it.

### 0125 `tenant_estado_y_alta`

- `fsj.tenant`: `estado fsj.estado_tenant NOT NULL DEFAULT 'ACTIVO'` (`ACTIVO`, `SUSPENDIDO`), `contacto_nombre`,
  `contacto_email citext`, `contacto_telefono varchar(40)`, all nullable. No new column grant to `fsj_app` (estado and
  contacto change only through platform functions; the existing column-level UPDATE grant does not cover them).
- `fsj.crear_tenant_interno(p_razon_social, p_cuit, p_nombre_fantasia, p_domicilio, p_matricula, p_zona_horaria,
  p_contacto_nombre, p_contacto_email, p_contacto_telefono, p_admin_email, p_admin_nombre, p_admin_apellido,
  p_admin_dni, p_admin_password_hash)` returns `(tenant_id, admin_id)`: the exact body of `scripts/create-tenant.ts`
  today (tenant, `seed_roles_tenant`, `seed_acciones_con_pin`, SISTEMA + rol, admin + rol, the 12 parámetros, etiqueta
  tamaño, etiqueta hoja, 3 libros). Inserts into tenant-scoped tables run as owner (BYPASSRLS), so no `app.tenant_id`
  is needed, as in the script. Default sizes of etiqueta tamaño / hoja come from TS constants today
  (`modules/etiqueta-tamanos/domain/*`): pass them as parameters (`p_etiqueta_*`) so TS stays their only source.
  `REVOKE EXECUTE ... FROM fsj_app` (migration 0101 rule).
- `fsj.plataforma_crear_tenant(p_token_hash, ...same params..., p_ip, p_request_id)`: `plataforma_actor`, then
  `crear_tenant_interno`, audit TENANT_CREAR (valor_nuevo = tenant datos + admin email; never the hash).
- `fsj.plataforma_cambiar_estado_tenant(p_token_hash, p_tenant_id, p_estado, p_motivo, p_ip, p_request_id)`: refuses
  `fecha_baja` set (`INV-PLAT-BAJA`), same-state (`INV-PLAT-ESTADO`), empty motivo when suspending; audits
  TENANT_SUSPENDER / TENANT_REACTIVAR. Locks the row `FOR UPDATE`.
- `fsj.plataforma_editar_contacto_tenant(p_token_hash, p_tenant_id, p_nombre, p_email, p_telefono, ...)`: audits with
  before/after.
- `fsj.plataforma_listar_tenants(p_token_hash, p_busqueda, p_limit, p_offset)` returns rows + `total` (window count)
  + `saldo` (from 0126; in 0125 it returns 0 and 0126 replaces the function -- or 0125 omits saldo and 0126 does
  `CREATE OR REPLACE`; builder's call).
- `fsj.plataforma_ver_tenant(p_token_hash, p_tenant_id)`: one tenant row (no `logo` bytes).
- `fsj.plataforma_auditoria_tenant(p_token_hash, p_tenant_id, p_limit)`.
- Remove permisos `tenants.crear/editar/baja` (D18): `DELETE FROM fsj.rol_permiso` / `fsj.permiso` for those codes --
  the builder checks migration 0054 for the exact tables and any immutability trigger on them.
- `validateSession` / session repository: reject `estado <> 'ACTIVO'` next to `fecha_baja` (P11). Login needs no
  change: the session it creates is rejected on the first request -- **check:** `loginAction` redirects to `/`, which
  then redirects to `/login` with no message. Acceptable (D10) but the builder must make sure it does not loop.
  Better: `login()` reads `tenant.estado` inside its transaction on the success path only and returns the generic
  error without creating the session. The rejected path stays uniform because that read happens only after a correct
  password (same rule as `loadPasosPendientes`). **Do this.**

### 0126 `cuenta_corriente`

```sql
CREATE TYPE fsj.medio_pago_plataforma AS ENUM ('TRANSFERENCIA', 'EFECTIVO', 'MERCADO_PAGO', 'OTRO');

CREATE TABLE fsj.plataforma_cargo (
  id                uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES fsj.tenant (id),
  periodo           date NOT NULL CHECK (extract(day FROM periodo) = 1),
  monto             numeric(14,2) NOT NULL CHECK (monto > 0),
  concepto          text NOT NULL CHECK (length(btrim(concepto)) BETWEEN 1 AND 200),
  creado_por_id     uuid NOT NULL REFERENCES fsj.superadmin (id),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  anulado_en        timestamptz,
  anulado_por_id    uuid REFERENCES fsj.superadmin (id),
  motivo_anulacion  text,
  CHECK ((anulado_en IS NULL) = (anulado_por_id IS NULL) AND (anulado_en IS NULL) = (motivo_anulacion IS NULL))
);
CREATE UNIQUE INDEX plataforma_cargo_unico ON fsj.plataforma_cargo (tenant_id, periodo, lower(btrim(concepto)))
  WHERE anulado_en IS NULL;

CREATE TABLE fsj.plataforma_pago (
  id                uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES fsj.tenant (id),
  fecha             date NOT NULL,
  monto             numeric(14,2) NOT NULL CHECK (monto > 0),
  medio             fsj.medio_pago_plataforma NOT NULL,
  nota              text CHECK (nota IS NULL OR length(nota) <= 500),
  envio_id          uuid NOT NULL UNIQUE,
  creado_por_id ... anulado_* ... (same as cargo)
);
```

- Both: RLS forced + `plataforma_sin_acceso` policy, no grant to `fsj_app`; `fsj.forbid_delete()` + truncate trigger; a `BEFORE UPDATE`
  trigger `fsj.plataforma_movimiento_solo_anular()` that allows only the NULL -> value transition of the three
  anulación columns and refuses any other change (`INV-PLAT-INMUTABLE`).
- "Fecha not in the future" (P14) is checked in the function: `p_fecha <= (fsj.instante_actual() AT TIME ZONE
  'America/Argentina/Buenos_Aires')::date` -> `INV-PLAT-FECHA-FUTURA`. Not a CHECK (CHECK cannot depend on time).
- Functions: `fsj.plataforma_registrar_cargo`, `fsj.plataforma_registrar_pago` (a repeated `envio_id` returns the
  existing pago id and writes nothing, like `alta-receta-idempotente` R2), `fsj.plataforma_anular_cargo`,
  `fsj.plataforma_anular_pago` (row `FOR UPDATE`, refuses already anulado: `INV-PLAT-ANULADO`),
  `fsj.plataforma_cuenta_corriente(p_token_hash, p_tenant_id)` (cargos + pagos as one list, ordered by date: cargo
  date = `periodo`, pago date = `fecha`, then `creado_en`), `fsj.plataforma_saldo_tenant` internal helper used by the
  list and the detail. Each write audits.
- Duplicate cargo: map the unique-violation of `plataforma_cargo_unico` to a clear message (add the constraint name
  to `mapDbError`'s known list, like `INV-DT-002`).

### Rollbacks

Each migration gets `prisma/rollbacks/<migration>.down.sql`. `docs/rollbacks/plataforma-superadmin.md` states the order
(0126 -> 0124), that 0126's down drops cargos/pagos (export first) and that 0124's down needs the code of stage 1 reverted in the same deploy.

## 3. Code

### modules/auth (identity and sessions)

- `domain/session-plataforma.ts`: `SuperAdminSession { superadminId, email, nombre, tokenHash }`; the cookie name
  `fsj_plataforma` and its options in `domain/cookie-policy.ts` (`path: "/plataforma"`).
- `infrastructure/superadmin-repository.ts`: `$queryRaw` wrappers over the 0124 functions.
- `application/login.ts`: after `usuario_resolve_login` finds nothing, call `superadmin_resolve_login`; `LoginResult` gains `tipo: "USUARIO" | "SUPERADMIN"`. Superadmin
  branch: `decideLogin` (reuse it as is; `estado` INACTIVO maps to its non-ACTIVO case) -> `plataforma_iniciar_sesion`
  or `plataforma_login_fallido`, inside `withPlatformTransaction`. One argon2 verify in every path, as today.
- `application/require-superadmin.ts`: `requireSuperAdmin()` (React `cache`): reads the cookie, calls
  `plataforma_validar_sesion`, any exception or zero rows -> `AuthorizationError` code `no-session`. Also
  `superAdminActual()` returning `SuperAdminSession | null` (never throws) for the layout. `logoutPlataforma()`.
- `shared/auth/plataforma.ts`: facade re-exporting `requireSuperAdmin`, `superAdminActual`, cookie write/clear.
- `app/(auth)/login/actions.ts`: by `tipo`, write the matching cookie, clear the other, redirect to `/plataforma` or
  the current destination.

### modules/plataforma (the panel) -- no `domain/` beyond validation and labels

- `application/define-plataforma.ts`: `definePlataformaCommand` / `definePlataformaQuery`: `requireSuperAdmin()` ->
  zod -> `withPlatformTransaction(tx => handler({ tx, actor, input }))` -> `mapDbError`. No `audit` option: the SQL
  function audits (P7). This is a new pattern, justified because `defineCommand` requires a tenant session and a
  permiso. Registered in the same use-case registry if `shared/usecase.ts` keeps one that tests iterate -- the builder
  checks `tests/unit/*registry*` and either adds a platform registry or documents why not.
- ESLint: add `modules/plataforma/application/define-plataforma.ts` to the ignore list of the "no direct
  transaction" rule, next to the two jobs.
- Use cases: `listarFarmacias`, `verFarmacia`, `cuentaCorriente`, `auditoriaFarmacia`, `crearFarmacia` (hashes the
  temporary password with `hashPassword` before the transaction, validates CUIT with the existing CUIT validator --
  builder finds it via `openspec/specs/cuit-farmacia/spec.md`), `suspenderFarmacia`, `reactivarFarmacia`,
  `editarContacto`, `registrarCargo`, `registrarPago`, `anularCargo`, `anularPago`.
- Money: inputs as `decimalString` (`shared/validation`), `dec()` from `shared/decimal`, passed to SQL as text and cast
  `::numeric`; outputs formatted with `shared/format`.
- `ui/`: forms with `shared/ui/use-form-submit.ts` and `field-errors.ts`; list with the shared pagination and filters;
  confirm dialogs (suspend, anular) with the shared dialog; the alta form never re-fills the password on error.

### app/(plataforma)

```
app/(plataforma)/layout.tsx                   superAdminActual(); null -> tenant cookie present ? notFound() : redirect("/login")
app/(plataforma)/plataforma/page.tsx          list
app/(plataforma)/plataforma/farmacias/nueva/page.tsx
app/(plataforma)/plataforma/farmacias/[id]/page.tsx
app/(plataforma)/plataforma/actions.ts        thin Server Actions -> use cases (each use case calls requireSuperAdmin itself)
```

Own minimal shell (header with "Plataforma", the superadmin's name, Cerrar sesión). No tenant sidebar, no tenant logo.

### proxy.ts

`/plataforma` paths: require the `fsj_plataforma` cookie, else redirect to `/login`. Other paths: unchanged. CSP and
request id: unchanged for both.

### scripts

- `scripts/superadmin.ts --crear --email= --nombre=` / `--restablecer-password --email=` / `--desactivar --email=` /
  `--reactivar --email=`: `DIRECT_URL`, password asked twice hidden (full policy, `validatePassword`), argon2id. Deactivating also
  revokes its open sessions. Prints nothing secret.
- `scripts/create-tenant.ts`: keeps its flags, adds optional `--contacto-*`, and replaces its inserts with one
  `SELECT * FROM fsj.crear_tenant_interno(...)`.

### Docs to update

`modules/README.md` (new `plataforma` row), `docs/architecture.md` (platform identity row in the DB table),
`shared/auth/README.md` (platform session section), `AGENTS.md` one line: "A new per-tenant seed goes in
`fsj.crear_tenant_interno` (via a migration that replaces it), not in `scripts/create-tenant.ts`". Search
`docs/plan-implementacion.md` for DP-37 and 3.12 and mark them resolved by this change.

## 4. Testing

- Unit: login branches (usuario, superadmin, unknown, wrong password, locked, INACTIVO) all produce one argon2 call and
  the same message; `requireSuperAdmin` fails closed on thrown errors; zod schemas (fecha futura in AR timezone, monto,
  período); proxy cookie selection per path.
- DB (`FSJ_DB_TESTS=yes`, rolled back): `fsj_app` cannot select platform tables; every `fsj.plataforma_*` raises
  `INV-PLAT-AUTH` with a bogus / revoked / idle token; alta creates exactly what the old script created (compare row
  counts per table) and rolls back fully on a duplicate admin email; anulación transitions; DELETE refused; saldo.
- Manual (user): log in as superadmin, alta, first login of the new admin, suspend while a usuario is working,
  reactivate, cargo, pago, anular both, check saldo.
