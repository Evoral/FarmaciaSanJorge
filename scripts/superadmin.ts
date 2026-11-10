/**
 * Platform-operator CLI for superadmins (openspec/specs/plataforma/spec.md P2): the ONLY way to create a
 * superadmin, reset its password, or deactivate / reactivate it. There is no screen for it on purpose: an alta by UI
 * would be an escalation path.
 *
 * Connects with DIRECT_URL (owner, bypasses RLS and owns fsj.superadmin), never DATABASE_URL -- same convention as
 * scripts/create-tenant.ts. The password is asked twice on stdin with the echo disabled (never a flag: it would land
 * in the shell history), must meet the full password policy, is stored only as an argon2id hash and is never printed.
 *
 * Usage:
 *   npx tsx scripts/superadmin.ts --crear --email=ops@example.com --nombre="Nombre Apellido"
 *   npx tsx scripts/superadmin.ts --restablecer-password --email=ops@example.com
 *   npx tsx scripts/superadmin.ts --desactivar --email=ops@example.com     (also revokes its open sessions)
 *   npx tsx scripts/superadmin.ts --reactivar --email=ops@example.com
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { Client } from "pg";
import { email as emailSchema, nonEmptyString } from "@/shared/validation";
import { validatePassword } from "@/shared/auth/policy";
import { hashPassword } from "@/modules/auth/domain/password";

type Operacion = "crear" | "restablecer-password" | "desactivar" | "reactivar";
const OPERACIONES: readonly Operacion[] = ["crear", "restablecer-password", "desactivar", "reactivar"];

function fail(message: string): never {
  console.error(`superadmin: ${message}\n`);
  console.error(
    "Usage: npx tsx scripts/superadmin.ts (--crear --email=... --nombre=... | --restablecer-password --email=... | --desactivar --email=... | --reactivar --email=...)",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { operacion: Operacion; valores: Record<string, string> } {
  const valores: Record<string, string> = {};
  const flags: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) flags.push(arg.slice(2));
    else valores[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  const operaciones = flags.filter((flag): flag is Operacion => (OPERACIONES as readonly string[]).includes(flag));
  if (operaciones.length !== 1) fail("pass exactly one of --crear, --restablecer-password, --desactivar, --reactivar.");
  if ("password" in valores) fail("the password is never a flag; it is asked on the console.");
  return { operacion: operaciones[0]!, valores };
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

async function pedirPasswordHash(): Promise<string> {
  const password = await promptHidden("Password: ");
  const confirmacion = await promptHidden("Repeat the password: ");
  if (password !== confirmacion) fail("the two passwords do not match.");
  const violations = validatePassword(password);
  if (violations.length > 0) fail(`the password does not meet the password policy:\n${violations.map((v) => `  - ${v}`).join("\n")}`);
  return hashPassword(password);
}

async function main(): Promise<void> {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    console.error("superadmin: DIRECT_URL is required (see .env.example). Never uses DATABASE_URL.");
    process.exitCode = 1;
    return;
  }

  const { operacion, valores } = parseArgs(process.argv.slice(2));
  const email = emailSchema.safeParse(valores.email);
  if (!email.success) fail("--email is missing or invalid.");

  let nombre: string | null = null;
  if (operacion === "crear") {
    const parsed = nonEmptyString.safeParse(valores.nombre);
    if (!parsed.success) fail("--nombre is required with --crear.");
    nombre = parsed.data;
  }
  // Hashed before connecting: argon2id is slow and must not hold a transaction.
  const passwordHash = operacion === "crear" || operacion === "restablecer-password" ? await pedirPasswordHash() : null;

  const client = new Client({ connectionString: directUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    let filas: number;
    switch (operacion) {
      case "crear": {
        const result = await client.query(`INSERT INTO fsj.superadmin (email, nombre, password_hash) VALUES ($1, $2, $3)`, [email.data, nombre, passwordHash]);
        filas = result.rowCount ?? 0;
        break;
      }
      case "restablecer-password": {
        const result = await client.query(
          `UPDATE fsj.superadmin SET password_hash = $2, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE email = $1::extensions.citext`,
          [email.data, passwordHash],
        );
        filas = result.rowCount ?? 0;
        // A reset ends every open session of that superadmin.
        await client.query(
          `UPDATE fsj.superadmin_sesion SET revocada_en = now()
           WHERE revocada_en IS NULL AND superadmin_id = (SELECT id FROM fsj.superadmin WHERE email = $1::extensions.citext)`,
          [email.data],
        );
        break;
      }
      case "desactivar":
      case "reactivar": {
        const estado = operacion === "desactivar" ? "INACTIVO" : "ACTIVO";
        const result = await client.query(`UPDATE fsj.superadmin SET estado = $2 WHERE email = $1::extensions.citext`, [email.data, estado]);
        filas = result.rowCount ?? 0;
        if (operacion === "desactivar") {
          await client.query(
            `UPDATE fsj.superadmin_sesion SET revocada_en = now()
             WHERE revocada_en IS NULL AND superadmin_id = (SELECT id FROM fsj.superadmin WHERE email = $1::extensions.citext)`,
            [email.data],
          );
        }
        break;
      }
    }
    if (filas === 0) {
      await client.query("ROLLBACK");
      fail(`no superadmin with email ${email.data}.`);
    }
    await client.query("COMMIT");
    console.log(`\nsuperadmin: ${operacion} done for ${email.data}.\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/postgres(ql)?:\/\/\S+/gi, "[REDACTED_URL]");
  console.error(`superadmin failed: ${message}`);
  process.exitCode = 1;
});
