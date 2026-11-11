## ADDED Requirements

### Requirement: P1 — Superadmin is an identity outside every tenant

A superadmin SHALL be a row of `fsj.superadmin` (email, argon2id password hash, nombre, estado ACTIVO / INACTIVO),
never a `fsj.usuario`, and SHALL have no `tenant_id`. No tenant RLS policy MUST ever grant it access, and no policy of
the form "or is superadmin" MUST exist.

#### Scenario: Superadmin and tenant data
- **GIVEN** a valid superadmin session
- **WHEN** any tenant-scoped table is queried in its request
- **THEN** no row is visible, because no `app.tenant_id` is set

### Requirement: P2 — Alta of a superadmin only by the owner CLI

A superadmin SHALL be created, have its password reset, or be set INACTIVO only by `scripts/superadmin.ts`, run with
`DIRECT_URL`. The app MUST NOT offer any screen or use case to do it, and `fsj_app` MUST have no privilege on
`fsj.superadmin` or `fsj.superadmin_sesion`.

#### Scenario: fsj_app reads the allowlist
- **WHEN** `fsj_app` runs `SELECT * FROM fsj.superadmin`
- **THEN** the database refuses it with a permission error

#### Scenario: Password taken from the console
- **WHEN** the script is run without the password flag
- **THEN** it asks for it twice with the echo disabled, applies the full password policy and never prints it

### Requirement: P3 — One login, uniform response

`/login` SHALL serve usuarios and superadmins. An email MUST be unique across `fsj.usuario` and `fsj.superadmin`
(enforced by the DB on both tables). Every rejected attempt (unknown email, wrong password, INACTIVO, locked) MUST get
the existing generic message, after exactly one argon2 verification and no sooner than `AUTH_POLICY.loginFallidoMinimoMs`. The superadmin's
lockout SHALL be the login's (5 consecutive failures lock it 15 minutes).

#### Scenario: Superadmin logs in
- **WHEN** a superadmin enters its email and correct password
- **THEN** a platform session is created, the `fsj_plataforma` cookie is written, the `fsj_session` cookie is cleared and the browser goes to `/plataforma`

#### Scenario: Same email in both tables
- **GIVEN** a usuario with email `a@x.com`
- **WHEN** the script tries to create a superadmin with `a@x.com`
- **THEN** the database refuses it

#### Scenario: Wrong password
- **WHEN** a superadmin enters a wrong password
- **THEN** the response is the same generic message a usuario gets, and the failure counter of the superadmin grows

### Requirement: P4 — Platform session

A platform session SHALL be a row of `fsj.superadmin_sesion` keyed by the SHA-256 of an opaque token. The cookie
`fsj_plataforma` SHALL be httpOnly, SameSite=Lax, Secure in production and `Path=/plataforma`. It MUST expire after
15 minutes idle or 8 hours absolute, and MUST stop working at once when it is revoked (logout) or the superadmin is
INACTIVO. The lifecycle check SHALL live in the database (`fsj.plataforma_validar_sesion`), one place.

#### Scenario: Idle session
- **GIVEN** a platform session last used 16 minutes ago
- **WHEN** the superadmin opens `/plataforma`
- **THEN** it is sent to `/login`

#### Scenario: Superadmin set INACTIVO
- **GIVEN** an open platform session
- **WHEN** the script sets that superadmin INACTIVO and the superadmin performs any action
- **THEN** the action is refused

### Requirement: P5 — Panel hidden from everybody else

Every page under `/plataforma` SHALL check the platform session in its layout: without a valid one, and without a
tenant session, it MUST redirect to `/login`; with a tenant session but no platform session it MUST answer
`notFound()`. The proxy SHALL look for the `fsj_plataforma` cookie on `/plataforma` paths and for `fsj_session`
elsewhere.

#### Scenario: Pharmacy user types /plataforma
- **GIVEN** a usuario logged in to a pharmacy
- **WHEN** it opens `/plataforma`
- **THEN** it gets the same "not found" page as any non-existent path

### Requirement: P6 — Guard on every action, then the database checks again

Every platform Server Action and query SHALL start with `requireSuperAdmin()` (fails closed: any error means "not a
superadmin"), then zod, then the use case. The use case SHALL call a `SECURITY DEFINER` function passing the session's
token hash; the function MUST validate the session and the superadmin again before doing anything and MUST raise
`INV-PLAT-AUTH` otherwise. The page layout alone MUST NOT be trusted to protect an action.

#### Scenario: Guard forgotten in TS
- **GIVEN** a platform use case that skipped `requireSuperAdmin()` by mistake
- **WHEN** it is called with an invalid or revoked token hash
- **THEN** the database function raises `INV-PLAT-AUTH` and nothing is written

### Requirement: P7 — Platform audit

Every platform write (alta, suspender, reactivar, editar contacto, cargo, pago, anulación) and every superadmin login,
lockout and logout SHALL write one row of `fsj.plataforma_auditoria` (superadmin, acción, entidad, entidad id, tenant
when there is one, valor anterior / nuevo, motivo, ip, request id, instant) in the same transaction. The table MUST be
immutable (no UPDATE, DELETE or TRUNCATE). Passwords MUST never appear in it.

#### Scenario: Audit of a suspension
- **WHEN** the superadmin suspends a pharmacy with motivo "falta de pago"
- **THEN** one audit row records SUSPENDER, the pharmacy, estado ACTIVO -> SUSPENDIDO and the motivo

### Requirement: P8 — Pharmacy list

`/plataforma` SHALL list the pharmacies 25 per page, searchable by razón social, nombre de fantasía or CUIT, showing
nombre, CUIT, estado and saldo. Ordered by razón social. Dadas de baja (`fecha_baja`) are listed with their own badge.

#### Scenario: Search by CUIT
- **WHEN** the superadmin searches "30-12345678"
- **THEN** only pharmacies whose CUIT contains it are listed, with their saldo

### Requirement: P9 — Pharmacy detail

`/plataforma/farmacias/[id]` SHALL show the `fsj.tenant` datos (razón social, nombre de fantasía, CUIT, domicilio,
matrícula, zona horaria, creada, estado), the contacto, the saldo, the cuenta corriente (cargos and pagos ordered by
fecha, anulados shown struck through with who, when and motivo) and the platform audit rows of that pharmacy. It MUST
NOT read any tenant-scoped table.

#### Scenario: Unknown id
- **WHEN** the superadmin opens a detail with an id that is not a tenant
- **THEN** it gets "not found"

### Requirement: P10 — Alta of a pharmacy

The alta form SHALL take the tenant's datos (razón social, CUIT, nombre de fantasía, domicilio, matrícula, zona
horaria), its contacto (email, teléfono, nombre) and the first Administrador (email, nombre, apellido, DNI, temporary
password >= 6 characters). On error the form MUST keep what was typed (the password stays only in the browser: the
server never sends it back) and mark the offending field.

#### Scenario: CUIT already used
- **GIVEN** a pharmacy with CUIT 30-12345678-9
- **WHEN** the superadmin submits an alta with that CUIT
- **THEN** nothing is created and the CUIT field shows the error, with the rest of the form kept

#### Scenario: Administrador email already used
- **WHEN** the admin email belongs to another usuario or to a superadmin
- **THEN** nothing is created, not even the tenant, and the email field shows the error

#### Scenario: First login of the new Administrador
- **WHEN** the new Administrador logs in with the temporary password
- **THEN** it must change it before anything else (`contrasena-temporal`)

### Requirement: P10a — Alta is one transaction with every seed

The alta SHALL create, in ONE transaction, the tenant (ACTIVO), its default roles, acciones con PIN, SISTEMA, the
Administrador (ACTIVO, `debe_cambiar_password`), parámetros, etiqueta tamaño and hoja, and the three libros -- through
`fsj.crear_tenant_interno`, the same function `scripts/create-tenant.ts` calls. If any step fails, nothing MUST be
created.

#### Scenario: Same result as the script
- **WHEN** a pharmacy is created from the panel and another with the script
- **THEN** both have the same rows in every seeded table

### Requirement: P11 — Suspend and reactivate

The superadmin SHALL suspend an ACTIVO pharmacy with a required motivo, and reactivate a SUSPENDIDO one. A SUSPENDIDO
pharmacy MUST reject login with the generic message and MUST invalidate its open sessions on their next request; its
data MUST NOT change and the daily jobs MUST keep processing it. A pharmacy with `fecha_baja` MUST NOT be suspended or
reactivated.

#### Scenario: Open session of a suspended pharmacy
- **GIVEN** a usuario working in a pharmacy
- **WHEN** the superadmin suspends it and the usuario clicks anything
- **THEN** the usuario is sent to `/login`, and logging in again is refused with the generic message

#### Scenario: Reactivation
- **WHEN** the superadmin reactivates the pharmacy
- **THEN** its usuarios can log in again and nothing in its data changed

### Requirement: P12 — Edit contacto

The superadmin SHALL edit only the pharmacy's contacto (email, teléfono, nombre). The tenant's own datos MUST NOT be
editable from the panel: they belong to the pharmacy's Administrador (Configuración › Farmacia, `cuit-farmacia`). This
is why the panel's edit offers less than its alta.

#### Scenario: Contacto changed
- **WHEN** the superadmin changes the contacto email
- **THEN** it is saved and audited with the previous and new value

### Requirement: P13 — Register a cargo

A cargo SHALL have período (month and year), monto (> 0, two decimals, ARS) and concepto (required, up to 200
characters). Two non-anulados cargos MUST NOT share pharmacy, período and concepto.

#### Scenario: Double submit
- **WHEN** the same cargo is submitted twice
- **THEN** only one is created and the second gets a clear message

### Requirement: P14 — Register a pago

A pago SHALL have fecha (not after today in `America/Argentina/Buenos_Aires`), monto (> 0, two decimals, ARS), medio
(TRANSFERENCIA, EFECTIVO, MERCADO_PAGO, OTRO) and an optional nota (up to 500 characters). The form SHALL send an
`envio_id` generated once per form instance; a repeated `envio_id` MUST create nothing.

#### Scenario: Future date
- **WHEN** the superadmin enters tomorrow as fecha
- **THEN** it is refused and the fecha field shows the error

#### Scenario: Response lost
- **GIVEN** a pago submitted whose response never arrived
- **WHEN** the superadmin submits the same form again
- **THEN** no second pago is created

### Requirement: P15 — Anular a cargo or a pago

A cargo or pago SHALL be anulado with a required motivo. It MUST NOT be deleted: the row keeps its data and gains
`anulado_en`, `anulado_por_id` and `motivo_anulacion`, written once. An anulado one MUST NOT be anulado again and no
other column of a cargo or pago MUST ever change. Anulados do not count in the saldo.

#### Scenario: Anular a pago
- **GIVEN** a saldo of 10.000 and a pago of 4.000
- **WHEN** the superadmin anula the pago
- **THEN** the saldo becomes 14.000 and the pago is still listed, struck through, with who, when and motivo

#### Scenario: Delete attempt
- **WHEN** anything runs `DELETE` on a cargo or pago
- **THEN** the database refuses it

### Requirement: P16 — Saldo

The saldo of a pharmacy SHALL be the sum of its non-anulados cargos minus the sum of its non-anulados pagos,
computed by the database on each read, never stored. Positive means the pharmacy owes. Amounts MUST be handled with
decimal.js in TS.

#### Scenario: No movements
- **WHEN** a pharmacy has no cargos or pagos
- **THEN** its saldo is 0,00
