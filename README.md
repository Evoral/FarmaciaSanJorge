This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Database setup (Supabase)

There is **one** Supabase project for everything (dev and DB tests both run
against it -- there is no separate test project yet, see note below). Never
point it at a local/Docker/embedded Postgres.

1. Create the Supabase project. From its connection settings, copy:
   - the **pooler** connection string (Supavisor, transaction mode, port `6543`) into `DATABASE_URL`
   - the **direct** connection string (port `5432`, role `postgres`) into `DIRECT_URL`
   - see `.env.example` for the exact format, including the `fsj_app.<project-ref>` pooler username
2. Pick a strong password for the `fsj_app` runtime role and put it in `FSJ_APP_DB_PASSWORD` (used only by `db:bootstrap`, never committed).
3. **Important**: in the Supabase dashboard, do **not** add `fsj` to *Data API > Exposed schemas*. The app schema must stay unreachable from PostgREST/Supabase Auth -- see `docs/architecture.md`.

### DB tests run against the real database (temporary)

`npm run test:db` (`tests/db/**`) currently runs against `DATABASE_URL`/
`DIRECT_URL` -- the same project as the app, because there is no dedicated
test/staging Supabase project yet. This is safe only because:

- Every DB test wraps its work in `inRollbackTx()` (`tests/db/helpers.ts`), which always issues `ROLLBACK` -- nothing it does (inserts, `CREATE TABLE`, `GRANT`, anything) survives the test.
- `tests/db/global-setup.ts` never runs `prisma migrate reset` or any destructive command; it only checks (read-only) that migrations are applied and fails loudly if they aren't.
- The suite requires explicit opt-in: `FSJ_DB_TESTS=yes`. Without it, `npm run test:db` skips cleanly.

**Revisit before production go-live**: provision a dedicated test/staging
Supabase project and point `tests/db` at it instead of the real database.

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
