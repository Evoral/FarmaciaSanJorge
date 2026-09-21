# Architecture

Modular monolith on Next.js 16 (App Router). Each business capability is a
**module** with four layers; **all** DB access goes through **Prisma**
against a dedicated Postgres schema (`fsj`) on **Supabase**, using two
different DB roles depending on whether code is running migrations or
serving requests.

## Quick path

1. Business logic lives in `modules/<name>/{domain,application,infrastructure,ui}`, never in `app/`.
2. Every action follows: `requireSession -> authorize -> zod.parse -> transaction -> audit` (see below).
3. Every DB write goes through `withTenantTransaction` (`shared/db/transaction.ts`), which sets the tenant for Row Level Security before your code runs.
4. Run `npm run typecheck && npm run lint && npm test` before pushing -- see `.github/workflows/ci.yml` for the full gate.

## Layers

```
app/                         routing/UI only (RSC + thin Server Actions)
  (auth)/, (app)/<modulo>/, api/<modulo>/
modules/<modulo>/
  domain/          pure types, rules, state machines -- no I/O, no Prisma, no Next
  application/      use cases: requireSession -> authorize -> zod -> transaction -> audit
  infrastructure/   Prisma repositories, typed $queryRaw
  ui/               container/presentational components for this module
shared/
  db/        Prisma client singleton + withTenantTransaction/withPlatformTransaction
  auth/      sessions, requireSession, authorize          (FASE 2.1/2.6 -- facade over modules/auth/*)
  audit/     audit.record(tx, ...)                        (FASE 2.7 -- landed alongside shared/usecase.ts)
  errors/    AppError hierarchy, mapDbError, toSafeError
  validation/ shared zod primitives (uuid, decimalString, ...)
  decimal/   Decimal.js config + dec()/isPositive() helpers
  time/      jornadaDe() -- business-day computation in tenant TZ
  logging/   pino logger with secret redaction
prisma/       schema.prisma, migrations/ (hand-written SQL for triggers/RLS/grants)
tests/{unit,db,e2e}
```

**Why this shape**: a module's `domain/` has zero dependencies on
infrastructure, so business rules stay testable without a database and
without Next.js running. ESLint enforces this (see below) instead of
relying on discipline alone.

### Enforced boundaries (`eslint.config.mjs`)

| Rule | Why |
|------|-----|
| `modules/*/domain/**` cannot import `@prisma/client`, `shared/db`, `next`, or any module's `infrastructure/**` | Keeps domain code pure and swappable; a rule you can typecheck beats one you have to remember in review. |
| `app/**` cannot import `modules/*/infrastructure/**` directly | Forces routes/UI through a module's `application/` use cases, so authorization and auditing can't be accidentally skipped. |

## The use-case pattern

Every Server Action / route handler that mutates data follows the same
shape, no exceptions -- enforced structurally by `shared/usecase.ts`'s
`defineCommand`/`defineQuery` (FASE 2.7), the only way to define a use
case in this codebase:

```
action(input)
  -> requireSession()                 // shared/auth, FASE 2.1
  -> authorize(permiso)               // shared/auth, FASE 2.6
  -> zod.parse(input)                 // shared/validation
  -> withTenantTransaction(tenantId, tx => {
       // business rules + writes
       // audit.record(tx, ...)       // shared/audit, FASE 2.7 -- same transaction, not after it
     })
  -> mapDbError(e) on failure         // shared/errors
```

The audit record is written **inside** the same transaction as the
operation it audits -- if the transaction rolls back, so does the audit
entry. There is no "write data, then audit" two-step that could leave one
without the other.

## Database roles and the Supabase schema decision

| Piece | Decision | Why |
|-------|----------|-----|
| Hosting | PostgreSQL managed by Supabase | User decision -- no local Postgres, Docker, or embedded Postgres anywhere in this repo. |
| App schema | `fsj`, never `public` | Keeps app tables out of Supabase's PostgREST Data API entirely (`fsj` is not in the exposed schemas list) and out of the default search_path other tools assume. |
| ORM | Prisma 7, with the `@prisma/adapter-pg` driver adapter | Prisma 7 requires an explicit driver adapter for SQL providers (see the note below). Triggers, RLS, grants, and exclusion constraints are hand-written SQL inside migration files -- Prisma's schema language doesn't model them. |
| `DIRECT_URL` (role `postgres`) | Supabase direct connection, owner | Used only by `prisma migrate` and `scripts/db-bootstrap.ts`. Never used to serve a request. |
| `DATABASE_URL` (role `fsj_app`) | Supabase pooler (Supavisor, transaction mode, port 6543) | Used at runtime and by `migrate deploy`. `fsj_app` has no `BYPASSRLS`, no DDL rights, and (deliberately) no default UPDATE/DELETE on new tables -- those are granted per table, never for legal/immutable tables (INV-X01). |
| Multi-tenancy | `tenant_id` + RLS on every business table, keyed off `current_setting('app.tenant_id', true)` | `withTenantTransaction` sets this per-transaction from the **session**, never from client input. No business tables exist yet (FASE 0 is infrastructure only) but the helper functions/triggers (`fsj.current_tenant_id()`, `fsj.forbid_tenant_id_change()`) are already in place for FASE 1 to build on. |
| Test database | None yet -- `tests/db` runs against `DATABASE_URL`/`DIRECT_URL`, the same database as the app | Safety comes entirely from `tests/db/helpers.ts#inRollbackTx` (every DB test runs inside a transaction that is always rolled back) plus `tests/db/global-setup.ts`, which only *verifies* migrations are applied and never runs `migrate reset` or any destructive command. Opt-in gated by `FSJ_DB_TESTS=yes`. **Revisit before production go-live**: provision a dedicated test/staging Supabase project instead of testing against the real one. |

### Why a driver adapter (Prisma 7 note)

Prisma 7 made driver adapters mandatory for SQL providers instead of
optional (Prisma 6 and earlier shipped a built-in query engine per
database). `shared/db/client.ts` wires `@prisma/adapter-pg` (backed by the
`pg` driver) to `DATABASE_URL`. Connection URLs live in `prisma.config.ts`
at the repo root, not in `schema.prisma` -- another Prisma 7 change from
Prisma 6, documented inline in that file.

## Checklist (FASE 0 exit criteria)

- [x] `npm run typecheck && npm run lint && npm test` pass locally and in CI.
- [x] `env` validation fails fast with a readable, value-free message when required variables are missing (lazily, so `next build` still works without DB credentials -- see `shared/env.ts`).
- [x] `prisma/migrations/*/migration.sql` creates the `fsj` schema, the `fsj_app` role, and the generic INV-T03 / immutability trigger functions.
- [x] `npm run test:db` skips cleanly (does not fail the suite) when `DATABASE_URL`/`DIRECT_URL`/`FSJ_DB_TESTS=yes` are absent, and every DB test rolls back its own transaction when they are present.
- [ ] A real Supabase project exists and the migration has actually been applied to it -- manual step, see the root `README.md`.

## Next step

FASE 1 adds the first real tables (`tenant`, `parametro`, users/roles) on
top of this foundation -- see plan §16 FASE 1 and §9 M00/M01.
