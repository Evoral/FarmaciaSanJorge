This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Database setup (Supabase)

Two databases, one per env file:

- `.env.desarrollo`: a **local** Supabase Postgres in Docker, used by
  `npm run dev:desarrollo` and `npm run test:db`. Setup and commands:
  `docs/local-db.md`.
- `.env.prod`: the hosted Supabase project. Steps below.

Don't point either at a plain Postgres image: the migrations rely on
Supabase's roles and `extensions` schema (`docs/deploy.md` §4, step 0).

1. Create the Supabase project. From its connection settings, copy:
   - the **pooler** connection string (Supavisor, transaction mode, port `6543`) into `DATABASE_URL`
   - the **direct** connection string (port `5432`, role `postgres`) into `DIRECT_URL`
   - see `.env.example` for the exact format, including the `fsj_app.<project-ref>` pooler username
2. Pick a strong password for the `fsj_app` runtime role and put it in `FSJ_APP_DB_PASSWORD` (used only by `db:bootstrap`, never committed).
3. **Important**: in the Supabase dashboard, do **not** add `fsj` to *Data API > Exposed schemas*. The app schema must stay unreachable from PostgREST/Supabase Auth -- see `docs/architecture.md`. Leave the Data API disabled: migration 0108 points PostgREST at the empty schema `pgrst_no_exposed_schemas`, which silences the `schema "pg_pgrst_no_exposed_schemas" does not exist` log noise Supabase produces otherwise. From then on the dashboard's *Exposed schemas* setting has no effect (see `docs/rollbacks/postgrest-schema-vacio.md` to undo it).

### DB tests

`npm run test:db` (`tests/db/**`) runs against `DATABASE_URL`/`DIRECT_URL`
of the env file it is given -- the local database:

```powershell
$env:DOTENV_CONFIG_PATH=".env.desarrollo"; $env:FSJ_DB_TESTS="yes"; npm run test:db; Remove-Item Env:DOTENV_CONFIG_PATH, Env:FSJ_DB_TESTS
```

The local database also holds your dev data, so the suite keeps its safety rules:

- Every DB test wraps its work in `inRollbackTx()` (`tests/db/helpers.ts`), which always issues `ROLLBACK` -- nothing it does (inserts, `CREATE TABLE`, `GRANT`, anything) survives the test.
- `tests/db/global-setup.ts` never runs `prisma migrate reset` or any destructive command; it only checks (read-only) that migrations are applied and fails loudly if they aren't.
- The suite requires explicit opt-in: `FSJ_DB_TESTS=yes`. Without it, `npm run test:db` skips cleanly.

Never run `test:db` with `.env.prod`.

### E2E tests (Playwright)

`@playwright/test` is installed and `playwright.config.ts` exists, but no
E2E specs are written yet and browsers are not downloaded. `tests/e2e/`
intentionally contains only a `.gitkeep`. E2E tests will be written at the
end of the project, once the UI flows they exercise actually exist.

Then, in order:

```bash
npm install
npm run db:migrate      # prisma migrate deploy -- creates schema fsj, role fsj_app, triggers
npm run db:bootstrap     # sets fsj_app's login password + search_path (needs FSJ_APP_DB_PASSWORD)
npm run db:generate      # regenerate the Prisma client (also runs automatically after install in CI)
npm run dev
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
