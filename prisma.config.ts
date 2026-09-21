// Prisma 7 CLI configuration. Connection URLs are intentionally NOT read
// from schema.prisma (v7 convention) but from here, sourced from process.env
// via shared/env.ts semantics. dotenv is loaded explicitly because Prisma 7
// no longer loads .env files implicitly.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// NOTE (deviation, installed prisma@7.10.0): the schema engine REQUIRES
// `directUrl` to live in prisma.config.ts now ("The datasource property
// `directUrl` is no longer supported in schema files. Move connection URLs
// to `prisma.config.ts`"), but the published `@prisma/config` Datasource
// TS type in this release only declares `url`/`shadowDatabaseUrl` --
// `directUrl` is missing from the type even though the CLI reads it at
// runtime. Typing this object separately (not as an inline literal at the
// defineConfig() call site) sidesteps TypeScript's excess-property check
// for object literals while still passing the field through structurally.
const datasource: { url?: string; directUrl?: string } = {
  // Runtime + `prisma migrate deploy`: Supabase pooler (Supavisor,
  // transaction mode, port 6543), authenticated as role `fsj_app`.
  url: process.env["DATABASE_URL"],
  // `prisma migrate dev` / `migrate diff` / `db execute` only: Supabase
  // direct connection, authenticated as the `postgres` owner role.
  // Never used at runtime.
  directUrl: process.env["DIRECT_URL"],
};

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource,
});
