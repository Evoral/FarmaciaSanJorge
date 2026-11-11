/**
 * Platform-operator CLI (DP-04/DP-37): creates a new tenant, its per-tenant
 * SISTEMA technical user, and the tenant's first ADMINISTRADOR -- with a
 * temporary password the operator chooses (openspec/specs/contrasena-temporal/spec.md).
 *
 * There is no "operator console" UI yet (DP-37 is unresolved on whether one
 * ever exists) -- this script IS the FASE 1 delivery mechanism for the
 * "who creates the first ADM" requirement (INV-U01: creado_por_id NOT NULL,
 * with no self-registration).
 *
 * Connects with DIRECT_URL (owner role `postgres`), never DATABASE_URL --
 * same convention as scripts/db-bootstrap.ts. This also means it runs
 * OUTSIDE `withTenantTransaction` (no app.tenant_id, no RLS to work around):
 * Supabase's `postgres` role has BYPASSRLS, so it can insert into
 * FORCE-RLS tables like `fsj.usuario` directly -- that privilege is
 * exactly why this is an operator-only script, never application code.
 *
 * Temporary password: taken from `--admin-password-temporal` or, when the
 * flag is absent, asked twice on stdin with the echo disabled (a flag lands
 * in the shell history, the prompt does not). It must satisfy the temporary
 * password policy (at least 6 characters; the admin's own password, chosen on
 * first login, gets the full policy), is stored only as an argon2id hash, and is NEVER printed or logged
 * (INV-AU-001). The admin is created ACTIVO with `debe_cambiar_password`, so
 * the first login forces a new password and a PIN.
 *
 * Usage:
 *   npx tsx scripts/create-tenant.ts \
 *     --tenant-razon-social="Farmacia San Jorge S.R.L." \
 *     --tenant-cuit="30-12345678-9" \
 *     --tenant-nombre-fantasia="Farmacia San Jorge" \
 *     --tenant-domicilio="..." \
 *     --tenant-matricula-farmacia="..." \
 *     --tenant-zona-horaria="America/Argentina/Mendoza" \
 *     --admin-email="admin@example.com" \
 *     --admin-nombre="..." \
 *     --admin-apellido="..." \
 *     --admin-dni="..." \
 *     [--admin-password-temporal="..."] \
 *     [--contacto-nombre="..."] [--contacto-email="..."] [--contacto-telefono="..."]
 *
 * The operator hands the temporary password to the admin in person (DP-05).
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { Client } from "pg";
import { z } from "zod";
import { nonEmptyString, email as emailSchema } from "@/shared/validation";
import { validateTemporaryPassword } from "@/shared/auth/policy";
import { hashPassword } from "@/modules/auth/domain/password";
import { HOJA_PREDETERMINADA } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { ETIQUETA_TAMANO_PREDETERMINADO, ETIQUETA_TAMANO_PREDETERMINADO_NOMBRE } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";

const argsSchema = z.object({
  tenantRazonSocial: nonEmptyString,
  tenantCuit: nonEmptyString,
  tenantNombreFantasia: z.string().trim().optional(),
  tenantDomicilio: z.string().trim().optional(),
  tenantMatriculaFarmacia: z.string().trim().optional(),
  tenantZonaHoraria: z.string().trim().default("America/Argentina/Mendoza"),
  adminEmail: emailSchema,
  adminNombre: nonEmptyString,
  adminApellido: nonEmptyString,
  adminDni: nonEmptyString,
  adminPasswordTemporal: z.string().optional(),
  contactoNombre: z.string().trim().optional(),
  contactoEmail: emailSchema.optional(),
  contactoTelefono: z.string().trim().optional(),
});

type Args = z.infer<typeof argsSchema>;

/** Parses `--kebab-key=value` CLI flags into a camelCase record. Minimal on purpose -- no extra dependency for a handful of flags. */
function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) continue;
    const rawKey = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    const camelKey = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

function printUsageAndExit(message: string): never {
  console.error(`create-tenant: ${message}\n`);
  console.error(
    "Usage: npx tsx scripts/create-tenant.ts " +
      "--tenant-razon-social=... --tenant-cuit=... " +
      "[--tenant-nombre-fantasia=...] [--tenant-domicilio=...] " +
      "[--tenant-matricula-farmacia=...] [--tenant-zona-horaria=...] " +
      "--admin-email=... --admin-nombre=... --admin-apellido=... --admin-dni=... " +
      "[--admin-password-temporal=... (asked on stdin when omitted)] [--contacto-nombre=...] [--contacto-email=...] [--contacto-telefono=...]",
  );
  process.exit(1);
}

function parseAndValidateArgs(): Args {
  const raw = parseArgs(process.argv.slice(2));
  const parsed = argsSchema.safeParse(raw);
  if (!parsed.success) {
    printUsageAndExit(
      `invalid or missing arguments:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  return parsed.data;
}

/** Asks `question` on stdin with the echo disabled; resolves with the typed line. */
function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  return new Promise((resolvePrompt) => {
    process.stdout.write(question);
    muted = true;
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolvePrompt(answer);
    });
  });
}

/** The temporary password: the flag when given, else typed twice (hidden). Exits on a mismatch or a policy violation. */
async function resolveTemporaryPassword(fromFlag: string | undefined): Promise<string> {
  let passwordTemporal = fromFlag;
  if (passwordTemporal === undefined) {
    passwordTemporal = await promptHidden("Temporary password for the first admin: ");
    const confirmation = await promptHidden("Repeat the temporary password: ");
    if (passwordTemporal !== confirmation) printUsageAndExit("the two passwords do not match.");
  }
  const violations = validateTemporaryPassword(passwordTemporal);
  if (violations.length > 0) {
    printUsageAndExit(`the temporary password does not meet the temporary password policy:\n${violations.map((v) => `  - ${v}`).join("\n")}`);
  }
  return passwordTemporal;
}

async function main(): Promise<void> {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    console.error("create-tenant: DIRECT_URL is required (see .env.example). Never uses DATABASE_URL.");
    process.exitCode = 1;
    return;
  }

  const args = parseAndValidateArgs();
  const passwordTemporal = await resolveTemporaryPassword(args.adminPasswordTemporal);
  // Hashed before the transaction opens: argon2id is slow and must not hold it.
  const passwordHash = await hashPassword(passwordTemporal);

  const client = new Client({ connectionString: directUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    // The whole alta (tenant, roles, acciones con PIN, SISTEMA, first ADMINISTRADOR, parámetros, etiqueta tamaño and
    // hoja, the three libros) is ONE SQL function since migration 0125, shared with the /plataforma alta, so both
    // seed exactly the same rows. A new per-tenant seed goes in that function, not here.
    const result = await client.query<{ tenant_id: string; admin_id: string }>(
      `SELECT tenant_id, admin_id FROM fsj.crear_tenant_interno($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        args.tenantRazonSocial,
        args.tenantCuit,
        args.tenantNombreFantasia ?? null,
        args.tenantDomicilio ?? null,
        args.tenantMatriculaFarmacia ?? null,
        args.tenantZonaHoraria,
        args.contactoNombre ?? null,
        args.contactoEmail ?? null,
        args.contactoTelefono ?? null,
        args.adminEmail,
        args.adminNombre,
        args.adminApellido,
        args.adminDni,
        passwordHash,
        ETIQUETA_TAMANO_PREDETERMINADO_NOMBRE,
        ETIQUETA_TAMANO_PREDETERMINADO.anchoMm,
        ETIQUETA_TAMANO_PREDETERMINADO.altoMm,
        HOJA_PREDETERMINADA.anchoMm,
        HOJA_PREDETERMINADA.altoMm,
        HOJA_PREDETERMINADA.margenMm,
      ],
    );
    const tenantId = result.rows[0]!.tenant_id;
    const adminId = result.rows[0]!.admin_id;

    await client.query("COMMIT");

    console.log("\ncreate-tenant: tenant and first ADMINISTRADOR created.\n");
    console.log(`  tenant id:  ${tenantId}`);
    console.log(`  admin id:   ${adminId}`);
    console.log(`  admin email: ${args.adminEmail}`);
    console.log("\n  On first login the admin must change this temporary password and set a PIN.\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/postgres(ql)?:\/\/\S+/gi, "[REDACTED_URL]");
  console.error(`create-tenant failed: ${message}`);
  process.exitCode = 1;
});
