/**
 * Seed stub. FASE 0 has no business tables, so there is nothing to seed
 * yet -- this exists so `npm run db:seed` / `prisma db seed` (which reads
 * `migrations.seed` in prisma.config.ts) has something to invoke.
 * Real seeds (roles/permisos globales, tenant de ejemplo, usuario SISTEMA)
 * land with FASE 1 (plan §16, points 1.1/1.2).
 */
async function main(): Promise<void> {
  console.log("prisma/seed.ts: nothing to seed in FASE 0.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`seed failed: ${message}`);
  process.exitCode = 1;
});
