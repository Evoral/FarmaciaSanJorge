# Rollback: PostgREST con schema vacío

No spec: this is infrastructure, not a business rule. Rationale in `docs/architecture.md` (Data API row). The change
is **schema-only** (migration `prisma/migrations/20261027120000_0108_postgrest_schema_vacio`): no code depends on it.

## When to revert

- Only to re-enable Supabase's Data API (or to give *Data API > Exposed schemas* back to the dashboard). The app does
  not need it; re-enabling it still must never expose `fsj`.

## What the down migration loses

- Nothing stored. With the Data API still disabled, the `schema "pg_pgrst_no_exposed_schemas" does not exist` log
  noise comes back.

## Order

1. Copy `prisma/rollbacks/0108_postgrest_schema_vacio.down.sql` into a NEW migration folder (next free number, a
   timestamp later than every existing one) and apply it. Never edit or delete the applied 0108 migration.
2. Only then re-enable the Data API in the dashboard, if that is the goal.

## New files (delete on rollback)

- `prisma/rollbacks/0108_postgrest_schema_vacio.down.sql` and this file (optional)
- `prisma/migrations/20261027120000_0108_postgrest_schema_vacio/` (keep it once applied)

## Edited files (revert the 0108 hunks)

- `README.md`: the Data API sentence in Database setup step 3.
- `docs/architecture.md`: the Data API row.
