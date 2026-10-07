<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Farmacia San Jorge — agent guide

Single source of truth for every coding agent (Claude, Codex, Copilot, Cursor...).
`CLAUDE.md` only imports this file. Vendor memories and personal configs are
NOT shared between agents: any rule that matters for this repo belongs here.

Pharmacy compounding management (recetas magistrales, stock, libro recetario,
cierres): a multi-tenant modular monolith on Next.js 16 (App Router), React 19,
Prisma 7 + Postgres (Supabase, schema `fsj`), zod 4, decimal.js, Tailwind 4.

## Commands

| Task | Command |
|---|---|
| Dev server | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Lint (includes architecture boundaries) | `npm run lint` |
| Unit tests | `npm test` |
| DB tests (opt-in, `FSJ_DB_TESTS=yes`, real DB inside rolled-back tx) | `npm run test:db` |
| Regenerate Prisma client | `npm run db:generate` |

CI (`.github/workflows/ci.yml`) runs typecheck → lint → test → build. Never run
`prisma migrate reset` or any destructive DB command: dev and tests share the
one real Supabase project.

## Architecture (non-negotiable)

- Business logic lives in `modules/<modulo>/{domain,application,infrastructure,ui}`,
  never in `app/`. `app/` is routing plus thin Server Actions. Module map:
  `modules/README.md`.
- `domain/` is pure: no Prisma, no `shared/db`, no Next, no `infrastructure/`.
- `app/**` reaches a module only through its `application/` use cases.
- Every use case is defined with `defineCommand` / `defineQuery`
  (`shared/usecase.ts`): `requireSession → authorize → zod → withTenantTransaction → audit`.
  Never open a tenant transaction directly; the audit record is written inside
  the same transaction.
- Money and quantities use `decimal.js` (`shared/decimal`), never JS `number` arithmetic.
- Schema changes: new migration in `prisma/migrations/` (triggers, RLS and grants
  are hand-written SQL) plus its `prisma/rollbacks/<migration>.down.sql`.

The ESLint config enforces most of these rules. Full rationale: `docs/architecture.md`.

## Conventions

- **Language**: business vocabulary in Spanish (modules, identifiers such as
  `calcularPrecioFinal`, UI copy). Code comments and technical docs in English.
- **Forms keep user input on error.** Every Server Action form uses
  `shared/ui/use-form-submit.ts` (React 19 otherwise resets the form on every
  submit). Only reset on success; on error mark the offending field
  (`shared/ui/field-errors.ts`). Losing a long pharmacy form to one bad field is a bug.
- Reuse `shared/ui/` primitives (forms, filters, dialogs, pagination, toasts)
  and `shared/format/` before writing new ones.
- Follow the patterns of the nearest existing module; don't introduce new ones
  without a reason stated in the change.

## How to work

- **Go straight to the fix.** Locate the cause with targeted searches, make the
  minimal change that fits existing patterns. Don't explore the whole repo.
- **Don't run or edit tests, builds or browser checks unless the task asks for it.**
  CI is the gate. When you finish, state what you did NOT verify.
- **Read only what the task needs.** Use the index below; never read
  `docs/plan-implementacion.md` end to end (950 lines, historical) — search it
  for the specific `M0x` / `DP-xx` / `INV-xx` reference instead.

### By change size

| Change | Do |
|---|---|
| Small fix (1–2 files) | Just fix it. |
| Feature or business-rule change | Read/update `docs/specs/<feature>.md` first. If the implementation changes a rule, update the spec in the same commit. |
| Schema change or multi-module change | Spec + `docs/rollbacks/<feature>.md` + `.down.sql`. Prefer a review by a different agent/vendor than the one that implemented it. |

### Keeping this file useful

- Add a rule here only when an agent made the same mistake twice, or when a
  decision would surprise a newcomer. One line per rule.
- Keep it short: this file is loaded on every task. Detail goes in `docs/`.
- If you find something here that contradicts the code, say so; don't silently follow either.

## Where to find things

| Before touching... | Read |
|---|---|
| Any business feature | `docs/specs/<feature>.md` (most specs link the code they govern) |
| A module you don't know | `modules/README.md` (module map) |
| Auth, sessions, permissions | `shared/auth/README.md` |
| Auditing | `shared/audit/README.md` |
| DB roles, RLS, tenancy, Supabase setup | `docs/architecture.md`, `README.md` |
| Deploy | `docs/deploy.md` |
| Reverting a shipped feature | `docs/rollbacks/<feature>.md` |
| Original plan (modules `M00`–`M16`, invariants `INV-*`, pending decisions `DP-*`) | `docs/plan-implementacion.md` — search, don't read |
| Ideas not yet approved | `docs/propuestas/` — not a source of truth |
