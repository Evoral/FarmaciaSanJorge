# Dependency maintenance

How npm and GitHub Actions dependencies are kept up to date and secure.
Config: [`.github/dependabot.yml`](../.github/dependabot.yml).

## The three lanes

| Lane | What | When it arrives | What you do |
|---|---|---|---|
| 1. Security | A known vulnerability (CVE/advisory) in a dependency | Any day, as soon as GitHub matches an advisory | Review **every day**; merge the same day if CI is green |
| 2. Routine | Minor and patch bumps, grouped | Once a month, the 1st at 09:00 (Argentina) | Merge when CI is green; the `database` PR needs the DB tests first |
| 3. Majors | Breaking releases (Next, React, Prisma, ...) | Never automatic | Plan it as a refactor: read the changelog, upgrade by hand |

### 1. Security (daily)

- Not scheduled in `dependabot.yml`. It depends on two repo settings in
  GitHub → Settings → Code security: **Dependabot alerts** and
  **Dependabot security updates**. If either is off, this lane does not exist.
- Each security PR touches one package, bumped to the minimum patched version.
  It still arrives when the fix is a major: the `ignore` rule uses
  `update-types`, which only affects version updates. Never replace it with an
  `ignore` without `update-types`, or security PRs for that package stop.
- Daily check: GitHub → Security → Dependabot, and the open PRs labeled
  `dependencies`. To get them by email, enable Dependabot alerts in your
  personal GitHub → Settings → Notifications.
- If the security PR touches a DB package (see below), run the DB tests before merging.

### 2. Routine (monthly)

Two grouped PRs per month at most:

- **`database`** (`prisma`, `@prisma/*`, `pg`, `@types/pg`): CI does **not** run
  the DB tests (there is a single Supabase database; see the note in
  `.github/workflows/ci.yml`), so a green CI does not prove queries still work.
  Before merging:

  ```bash
  git fetch origin && git switch <dependabot-branch>
  npm ci
  npm run db:generate
  npm run test:db
  ```

  `npm run test:db` **exits 0 and skips** when `DATABASE_URL`, `DIRECT_URL` or
  `FSJ_DB_TESTS=yes` are missing (`tests/db/env.ts`). Check the output shows
  tests ran, not a skip message.
- **`minor-and-patch`** (everything else): merge when CI is green.

If a grouped PR fails CI, find the package that broke it, comment
`@dependabot ignore <package-name>` on that PR or pin it in
`package.json`, and let Dependabot rebuild the group.

### 3. Majors (by hand)

Dependabot never opens them. Check `npm outdated` when planning work, then
upgrade one major at a time in its own branch, following the package's
migration guide (for Next, also `node_modules/next/dist/docs/`).

## Prerequisites to keep this working

- The CI job in `ci.yml` is a **required status check** on `master`
  (Settings → Branches), so a red Dependabot PR cannot be merged.
- `ci.yml` needs no secrets. Keep it that way: Dependabot PRs do not get
  Actions secrets, so a step that needs one fails on every Dependabot PR.
- GitHub only reads `dependabot.yml` from the default branch (`master`).
