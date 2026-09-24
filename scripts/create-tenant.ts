/**
 * Platform-operator CLI (DP-04/DP-37): creates a new tenant, its per-tenant
 * SISTEMA technical user, and the tenant's first ADMINISTRADOR -- with a
 * one-use activation credential for that admin, printed to the terminal
 * exactly once.
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
 * Credential token: a random, already-high-entropy 256-bit value, hashed
 * with SHA-256 before storage (fast hash is correct here, unlike password
 * hashing with argon2id -- there is no human-chosen low-entropy secret to
 * protect against brute force, only the DB row itself). The raw token is
 * printed ONCE and never stored or logged anywhere else (INV-AU-001-style
 * discipline, even though INV-AU-001 is about the user's own password).
 *
 * Usage:
 *   npx tsx scripts/create-tenant.ts \
 *     --tenant-razon-social="Farmacia San Jose S.R.L." \
 *     --tenant-cuit="30-12345678-9" \
 *     --tenant-nombre-fantasia="Farmacia San Jose" \
 *     --tenant-domicilio="..." \
 *     --tenant-matricula-farmacia="..." \
 *     --tenant-zona-horaria="America/Argentina/Mendoza" \
 *     --admin-email="admin@example.com" \
 *     --admin-nombre="..." \
 *     --admin-apellido="..." \
 *     --admin-dni="..."
 *
 * DP-05 (credential delivery channel) is unresolved; this script implements
 * option (a) from the plan's recommendation -- screen only, delivered in
 * person -- since that requires no integration and is the safer default.
 */
import "dotenv/config";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { nonEmptyString, email as emailSchema } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";

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
      "--admin-email=... --admin-nombre=... --admin-apellido=... --admin-dni=...",
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

async function main(): Promise<void> {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    console.error("create-tenant: DIRECT_URL is required (see .env.example). Never uses DATABASE_URL.");
    process.exitCode = 1;
    return;
  }

  const args = parseAndValidateArgs();

  const client = new Client({ connectionString: directUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    const tenantResult = await client.query<{ id: string }>(
      `INSERT INTO fsj.tenant (razon_social, cuit, nombre_fantasia, domicilio, matricula_farmacia, zona_horaria)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        args.tenantRazonSocial,
        args.tenantCuit,
        args.tenantNombreFantasia ?? null,
        args.tenantDomicilio ?? null,
        args.tenantMatriculaFarmacia ?? null,
        args.tenantZonaHoraria,
      ],
    );
    const tenantId = tenantResult.rows[0]!.id;

    // SISTEMA: self-created (creado_por_id = its own id), one per tenant,
    // es_tecnico = true. Gets the internal SISTEMA role (see migration
    // 0002 comment on fsj.rol for why that role exists at all).
    const sistemaId = randomUUID();
    await client.query(
      `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
       VALUES ($1, $2, $3, 'Sistema', 'Tecnico', $4, 'ACTIVO', true, $1)`,
      [sistemaId, tenantId, `sistema+${tenantId}@internal.local`, `SISTEMA-${tenantId}`],
    );
    await client.query(
      `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
       SELECT $1, $2, r.id, $2 FROM fsj.rol r WHERE r.codigo = 'SISTEMA'`,
      [tenantId, sistemaId],
    );

    // First ADMINISTRADOR: creado_por_id = SISTEMA (DP-04), PENDIENTE_ACTIVACION.
    const adminId = randomUUID();
    await client.query(
      `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE_ACTIVACION', false, $7)`,
      [adminId, tenantId, args.adminEmail, args.adminNombre, args.adminApellido, args.adminDni, sistemaId],
    );
    await client.query(
      `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
       SELECT $1, $2, r.id, $3 FROM fsj.rol r WHERE r.codigo = 'ADMINISTRADOR'`,
      [tenantId, adminId, sistemaId],
    );

    // One-use activation credential, shown ONCE below.
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const ttlHours = AUTH_POLICY.activationCredentialTtlHours;

    await client.query(
      `INSERT INTO fsj.credencial_activacion (tenant_id, usuario_id, token_hash, emitida_por_id, vence_en, motivo_emision)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, 'ALTA')`,
      [tenantId, adminId, tokenHash, sistemaId, String(ttlHours)],
    );

    // Per-tenant weighing parameters (M10, FASE 1 point 1.10 --
    // docs/specs/ficha-tecnica.md "ParametrosPesaje") + the stock
    // vencimiento-alert window (M07, FASE 5 point 5.7, DP-14) + the cierre
    // diario firma-plazo (M13a, FASE 10 point 10.1, DP-18 RESUELTA). Also
    // backfilled for pre-existing tenants by migration 0012 (the first two)
    // and migration 0038 (plazo_firma_dias) and migration 0040
    // (plazo_regularizacion_dias) -- kept here so every path (a brand-new
    // tenant via this script, and a tenant that already existed when those
    // migrations ran) ends up with the same rows.
    // `dias_alerta_vencimiento_partida` needs no migration/backfill:
    // modules/stock/infrastructure/partida-repository.ts#getDiasAlertaVencimiento
    // falls back to the same default (30) for any tenant without this row.
    await client.query(
      `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
       VALUES
         ($1, 'precision_balanza', 'NUMERO', '0.001', 'Precision de la balanza para redondeo de linea_pesaje (GRAMO) -- docs/specs/ficha-tecnica.md R8'),
         ($1, 'exceso_pesada_porcentaje', 'NUMERO', '0', 'Porcentaje de exceso de pesada aplicado a lineas no manuales -- docs/specs/ficha-tecnica.md R7'),
         ($1, 'dias_alerta_vencimiento_partida', 'NUMERO', '30', 'Dias de anticipacion para la alerta de partidas por vencer -- DP-14, FASE 5 punto 5.7'),
         ($1, 'plazo_firma_dias', 'NUMERO', '0', 'Plazo en dias corridos para firmar el cierre diario en termino -- DP-18, FASE 10 punto 10.1'),
         ($1, 'plazo_regularizacion_dias', 'NUMERO', '7', 'Plazo en dias corridos, desde el asiento mas antiguo sin receta fisica recibida, para considerar vencida una receta en /regularizacion -- DP-15, FASE 11 punto 11.3')
       ON CONFLICT (tenant_id, clave) DO NOTHING`,
      [tenantId],
    );

    // libro_rubricado (M12, FASE 1 point 1.12 -- docs/specs/libro-recetario-y-contralor.md):
    // every tenant gets all 3 tipos, open from day one (RECETARIO is
    // required for every preparacion regardless of whether the contralor
    // is ever activated; see migration 0014 header for why PSICOTROPICO/
    // ESTUPEFACIENTE are also created unconditionally). Each INSERT fires
    // trg_libro_rubricado_crear_contador, which creates the matching
    // fsj.contador_correlativo row (starting at 0 -- first asiento is 1).
    // Also backfilled for pre-existing tenants by migration 0014.
    //
    // numero / fecha_rubrica / expediente_rubrica are deliberately left
    // NULL. They are official data issued by the health authority, and this
    // libro is the pharmacy's OWN digital book, not the physical rubricated
    // one -- the physical rubric model is DP-38, still pending with the
    // Asociacion de Farmacias. Never invent them: each column accepts
    // exactly one NULL -> value transition later (migration 0018, B3), so a
    // made-up value here could never be corrected.
    await client.query(
      `INSERT INTO fsj.libro_rubricado (tenant_id, tipo, registrado_por_id)
       VALUES
         ($1, 'RECETARIO', $2),
         ($1, 'PSICOTROPICO', $2),
         ($1, 'ESTUPEFACIENTE', $2)`,
      [tenantId, sistemaId],
    );

    await client.query("COMMIT");

    console.log("\ncreate-tenant: tenant and first ADMINISTRADOR created.\n");
    console.log(`  tenant id:  ${tenantId}`);
    console.log(`  admin id:   ${adminId}`);
    console.log(`  admin email: ${args.adminEmail}`);
    console.log(`\n  Activation credential (shown ONCE -- deliver in person, DP-05):`);
    console.log(`    ${rawToken}`);
    console.log(`  Expires in ${ttlHours}h. This value is never stored or logged anywhere else.\n`);
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
