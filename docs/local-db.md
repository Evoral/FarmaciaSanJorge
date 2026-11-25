# Local database (development and DB tests)

Development (`npm run dev:desarrollo`) and DB tests (`npm run test:db`) run
against a local Supabase Postgres in Docker, managed by the Supabase CLI.
Production (`.env.prod`) stays on hosted Supabase.

Why local: the hosted free-tier dev project paused itself after a few days
without use. The local stack uses the same image as hosted Supabase
(Postgres 17, same roles: `postgres` without superuser, `authenticator`,
`anon`, schema `extensions`), so migrations behave the same.

## What runs

`supabase/config.toml` disables every Supabase service except Postgres: the
app only uses Postgres (Prisma + its own auth, no `@supabase/*` client). The
stack is a single container, `supabase_db_farmacia-san-jorge`, ~70-250 MB RAM.

| Thing | Value |
|---|---|
| Port | `57322` (the `573xx` range, so it runs next to other projects' stacks) |
| Owner role | `postgres` / `postgres` (local-only default) |
| Data | Docker volume, kept across `stop`/`start` and reboots |

## Commands

| Task | Command |
|---|---|
| Start | `npm run db:local:start` (`supabase start -x kong`: Kong is the API gateway, unused) |
| Stop (keeps data) | `npm run db:local:stop` |
| psql | `docker exec -it supabase_db_farmacia-san-jorge psql -U postgres` |

`supabase stop --no-backup` deletes the volume (all local data). Only the user
runs it; agents never run destructive DB commands.

## Daily workflow

Docker Desktop must be running.

| Task | Command (PowerShell) |
|---|---|
| 1. Start the DB | `npm run db:local:start` |
| 2. Dev server | `npm run dev:desarrollo` |
| Apply new migrations | `$env:DOTENV_CONFIG_PATH=".env.desarrollo"; npm run db:migrate; Remove-Item Env:DOTENV_CONFIG_PATH` |
| DB tests | `$env:DOTENV_CONFIG_PATH=".env.desarrollo"; $env:FSJ_DB_TESTS="yes"; npm run test:db; Remove-Item Env:DOTENV_CONFIG_PATH, Env:FSJ_DB_TESTS` |
| Done for the day | `npm run db:local:stop` |

### Why `DOTENV_CONFIG_PATH`

The scripts (`scripts/db-*.ts`, `scripts/create-tenant.ts`, `scripts/superadmin.ts`)
and the DB tests load variables with `import "dotenv/config"`, which reads a file
named `.env` by default. This project has no `.env`, only `.env.desarrollo` and
`.env.prod`, so every such command names its file through `DOTENV_CONFIG_PATH`;
without it they fail with "DIRECT_URL is required". The `Remove-Item` at the end
clears the variable so the next command in that terminal doesn't silently reuse
the same database. The dev server doesn't need it: `npm run dev:desarrollo`
passes the file to `scripts/dev.ts`.

## `.env.desarrollo`

```
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:57322/postgres
DATABASE_URL=postgresql://fsj_app:<FSJ_APP_DB_PASSWORD>@127.0.0.1:57322/postgres
```

No pooler locally: `DATABASE_URL` connects straight to Postgres as `fsj_app`
(plain username, no `.<project-ref>` suffix). Keep `FSJ_APP_DB_PASSWORD` and
the rest of the file as they are.

## First time on a fresh volume

Same order as a new hosted database (`docs/deploy.md` §4 and §5), always
against `.env.desarrollo`:

```powershell
$env:DOTENV_CONFIG_PATH=".env.desarrollo"; npm run db:migrate; npm run db:bootstrap; Remove-Item Env:DOTENV_CONFIG_PATH
```

Then create a tenant and the superadmin (`db:create-tenant`, `db:superadmin`)
with the same `DOTENV_CONFIG_PATH`, or run the seed (`npm run db:seed`).

## Seed

`npm run db:seed` (`prisma/seed.ts`) populates a local database with an initial tenant,
users for every role, and master data so developers can immediately test recipe creation,
stock movements, and preparation flows without manual setup.

Strictly local-only: refuses to run unless `DIRECT_URL`'s host is `127.0.0.1`, `localhost`, or `::1`.
Idempotent: safe to run repeatedly; preserves existing records and updates credentials.

### Configuration (`.env.desarrollo`)

Add the seed credentials to `.env.desarrollo`:

```ini
FSJ_SEED_PASSWORD="Admin123456!"
FSJ_SEED_PIN="1357"
```

- `FSJ_SEED_PASSWORD`: shared password for all seed accounts (must meet password policy: >= 8 characters, at least 1 uppercase).
- `FSJ_SEED_PIN`: shared operational PIN for roles that require one (exactly 4 non-trivial digits).

### Reset flow

To reset the local database and re-seed from scratch:

```powershell
npx supabase db reset
$env:DOTENV_CONFIG_PATH=".env.desarrollo"; npm run db:migrate; npm run db:bootstrap; npm run db:seed; Remove-Item Env:DOTENV_CONFIG_PATH
```

### What it creates

- **Superadmin**: platform operator (`fsj.superadmin`).
- **Tenant**: "Farmacia San Jorge S.R.L." (CUIT `30-11223344-5`) created through `fsj.crear_tenant_interno` with its SISTEMA user and per-tenant parameters.
- **Logins** (all active, no forced password change; password from `FSJ_SEED_PASSWORD`):
  - `admin@evoralfarm.com` (Superadmin)
  - `admin@example.com` (Administrador)
  - `dt@example.com` (Director Técnico, designated Titular; PIN from `FSJ_SEED_PIN`)
  - `farmaceutico@example.com` (Farmacéutico; PIN from `FSJ_SEED_PIN`)
- **Master data**:
  - Suppliers: Droguería Farmaplus S.A., Química Médica Argentina S.R.L.
  - Doctors: Dr. Carlos Gómez (Dermatología), Dra. Mariana Fernández (Pediatría)
  - Patients: Sofía Martínez, Lucas Benítez
  - Drugs & Excipients: Ibuprofeno, Ácido Salicílico, Vaselina Sólida, Alcohol 96%, Clonazepam (Psicotrópico Lista IV)
  - Stock: active batches (`partida`) with initial stock movements (`movimiento_stock`)
  - Pricing: supplier costs with IVA (`costo_proveedor`) and active price rules (`regla_precio` with margin tranches)

### Demo seed (`npm run db:seed:demo`)

`npm run db:seed:demo` (`prisma/seed-demo.ts`) fills the local database with realistic operational data spread across a 60-day window (`now - 30 days .. now + 30 days`), simulating active daily pharmacy operations around today. It runs **after** the base seed (`npm run db:seed`) and builds on the same tenant (`30-11223344-5`) and users.

Strictly local-only: connects as owner via `DIRECT_URL` (host must be `127.0.0.1`, `localhost`, or `::1`) and advances the database clock using `SET LOCAL fsj.reloj_prueba` so all trigger-generated timestamps, audit rows, book entries, and state transitions reflect their simulated operational date.

#### Commands

Dry run (validates everything in a single transaction, then rolls back cleanly without persisting changes):

```powershell
$env:DOTENV_CONFIG_PATH=".env.desarrollo"; npm run db:seed:demo:dry; Remove-Item Env:DOTENV_CONFIG_PATH
```

Full execution (commits to the local database):

```powershell
$env:DOTENV_CONFIG_PATH=".env.desarrollo"; npm run db:seed:demo; Remove-Item Env:DOTENV_CONFIG_PATH
```

#### What it creates

- **Recetas in every database state (59 prescriptions)**:
  - `ENTREGADA` (34): both over-the-counter (`MOSTRADOR`, pagada) and home delivery (`ENVIO` with assigned delivery driver `repartidor`, pagada).
  - `PREPARADA` (8): completed preparations with technical sheet (`ficha_tecnica`), verified weighings (`pesada_real`), printed label (`etiqueta`), and formal recipe book entry (`asiento_recetario`).
  - `PENDIENTE_PREPARACION` (7): validated prescriptions queued for compounding, with reserved stock where applicable.
  - `EN_PREPARACION` (5): compounding in progress, associated with in-progress technical sheets and draft weighings (`pesada_borrador`).
  - `RETIRO_VENCIDO` (2): completed preparations whose pickup window expired.
  - `ANULADA` (2): canceled prescriptions with recorded cancellation audit reasons.
  - `ENVIADA_PEND_FIRMA` (1): dispatched home delivery in transit, pending driver confirmation or signature.
  - *Domain notes*: Pure pre-prescription price quotes live in `cotizacion`, draft weighings live in `pesada_borrador`, and confirmed preparations live in `preparacion`, strictly honoring the 7 values defined in PostgreSQL enum `fsj.estado_receta`.
  - Recurring patients (3+ recetas each: Sofía Martínez, Lucas Benítez, Martín Castro, Camila Morales) and doctors with different specialties.
- **Stock & Batches**:
  - Compras with fiscal invoices (Facturas A from Farmaplus and Química Médica with CAE).
  - Initial stock (`INGRESO_INICIAL`), adjustments with reason and DT authorization (`AJUSTE`), expired and near-expiry batches.
  - Low stock alert (drugs below `stock_minimo`).
  - Batch reanalysis extending shelf life (`reanalisis_partida`).
  - Self-elaborated dilution batch with full traceability (`ELABORACION_PROPIA` / `elaboracion_lote`).
- **Cost History & Pricing**:
  - `costo_proveedor` history (13 historical price records with closed vigencias and IVA).
  - Concurrent suppliers for the same drug (Ibuprofeno from Farmaplus and Química Médica).
  - Price rules with margin tranches applied.
- **Libro Recetario & Legal**:
  - 45 sequential immutable libro recetario entries hashed with SHA-256 (V4).
  - 9 contralor book entries for controlled psychotropics (Clonazepam with opening and sequential egress).
  - 29 daily closings (`cierre_diario`) digitally signed by the DT for past days, leaving yesterday pending signature.

#### Re-run behaviour

The script is safe to run repeatedly:
- **Legal/immutable records**: Asientos and closed days cannot be modified or backdated. On a re-run, any past date that is already closed or whose chain position is behind existing asientos is automatically skipped, logging how many steps were skipped.
- **Non-legal data**: Drafts, quotes, pending recipes, and future appointments are regenerated around the current execution date using a deterministic PRNG keyed on the run date.
- **Transaction safety**: The entire seed runs in a single transaction. If any step fails, the transaction is rolled back with secret redaction.

## Several projects on one machine

Each project gets its own stack (named by `project_id`); the CLI never shares
one Postgres between projects. To keep RAM down:

- Disable in each project's `config.toml` every service it doesn't use. The
  heavy ones are `analytics` (~600 MB), `studio` (~300 MB) and `realtime`
  (~250 MB); Postgres alone is ~70-250 MB.
- Give each project its own port range.
- `supabase stop` in the projects you are not working on. Stacks restart
  with Docker Desktop, so a stack left running comes back after a reboot.
- Cap Docker's VM in `%UserProfile%\.wslconfig`:
  ```ini
  [wsl2]
  memory=6GB

  [experimental]
  autoMemoryReclaim=gradual
  ```
  then `wsl --shutdown` and restart Docker Desktop.
