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
 *     [--admin-password-temporal="..."]
 *
 * The operator hands the temporary password to the admin in person (DP-05).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
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
      "[--admin-password-temporal=... (asked on stdin when omitted)]",
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

    // Default roles of the tenant (DP-03, migration 0054; since 0106 only
    // ADMINISTRADOR, DIRECTOR_TECNICO, FARMACEUTICO and SISTEMA): roles are
    // per-tenant rows. The AFTER INSERT trigger on fsj.tenant already ran
    // this same function; calling it explicitly keeps the dependency visible
    // here and is a no-op on a tenant that already has its roles.
    await client.query(`SELECT fsj.seed_roles_tenant($1)`, [tenantId]);

    // Default acciones that ask an empleado's PIN in a cuenta de sector
    // (migration 0077): same pattern, the trigger already ran it.
    await client.query(`SELECT fsj.seed_acciones_con_pin($1)`, [tenantId]);

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
       SELECT $1, $2, r.id, $2 FROM fsj.rol r WHERE r.tenant_id = $1 AND r.codigo = 'SISTEMA'`,
      [tenantId, sistemaId],
    );

    // First ADMINISTRADOR: creado_por_id = SISTEMA (DP-04), ACTIVO with the
    // temporary password; it must change it (and set a PIN) on first login.
    const adminId = randomUUID();
    await client.query(
      `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id, password_hash, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', false, $7, $8, true)`,
      [adminId, tenantId, args.adminEmail, args.adminNombre, args.adminApellido, args.adminDni, sistemaId, passwordHash],
    );
    await client.query(
      `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
       SELECT $1, $2, r.id, $3 FROM fsj.rol r WHERE r.tenant_id = $1 AND r.codigo = 'ADMINISTRADOR'`,
      [tenantId, adminId, sistemaId],
    );

    // Per-tenant weighing parameters (M10, FASE 1 point 1.10 --
    // openspec/specs/ficha-tecnica/spec.md "ParametrosPesaje") + the stock
    // vencimiento-alert window (M07, FASE 5 point 5.7, DP-14) + the cierre
    // diario firma-plazo (M13a, FASE 10 point 10.1, DP-18 RESUELTA). Also
    // backfilled for pre-existing tenants by migration 0012 (the first two)
    // and migration 0038 (plazo_firma_dias) and migration 0042
    // (plazo_archivo_comun_anios / plazo_archivo_controladas_anios) -- kept here so every path (a
    // brand-new tenant via this script, and a tenant that already existed
    // when those migrations ran) ends up with the same rows.
    // `meses_vencimiento_preparado` (DP-28 "Vencimiento") is also backfilled
    // for pre-existing tenants, by migration 0068; `dias_retiro_vencido`
    // (openspec/specs/retiro-vencido/spec.md) by migration 0095.
    // `dias_relevamiento_inicial` (openspec/specs/existencia-inicial/spec.md) needs no
    // backfill either: fsj.relevamiento_inicial_fecha_limite falls back to 30.
    // `dias_alerta_vencimiento_partida` needs no migration/backfill:
    // modules/stock/infrastructure/partida-repository.ts#getDiasAlertaVencimiento
    // falls back to the same default (30) for any tenant without this row.
    await client.query(
      `INSERT INTO fsj.parametro (tenant_id, clave, tipo, valor, descripcion)
       VALUES
         ($1, 'precision_balanza', 'NUMERO', '0.001', 'Precision de la balanza para redondeo de linea_pesaje (GRAMO) -- openspec/specs/ficha-tecnica/spec.md R8'),
         ($1, 'exceso_pesada_porcentaje', 'NUMERO', '0', 'Porcentaje de exceso de pesada aplicado a lineas no manuales -- openspec/specs/ficha-tecnica/spec.md R7'),
         ($1, 'tolerancia_pesada_porcentaje', 'NUMERO', '5', 'Desvio maximo, en porcentaje, entre la pesada real y la esperada; fuera de el se pide la co-firma del Director Tecnico -- openspec/specs/pesada-real/spec.md'),
         ($1, 'dias_alerta_vencimiento_partida', 'NUMERO', '30', 'Dias de anticipacion para la alerta de partidas por vencer -- DP-14, FASE 5 punto 5.7'),
         ($1, 'plazo_firma_dias', 'NUMERO', '0', 'Dias corridos de gracia, despues del dia siguiente a la jornada, para firmar el cierre diario en termino (0 = solo el dia siguiente) -- DP-18'),
         ($1, 'plazo_archivo_comun_anios', 'NUMERO', '2', 'Anios de conservacion en archivo fisico para lotes sin recetas controladas -- DP-26 PARCIAL, FASE 12 punto 12.1'),
         ($1, 'plazo_archivo_controladas_anios', 'NUMERO', '3', 'Anios de conservacion en archivo fisico para lotes con al menos una receta controlada -- DP-26 PARCIAL, FASE 12 punto 12.1'),
         ($1, 'meses_vencimiento_preparado', 'NUMERO', '3', 'Meses desde la elaboracion tras los cuales vence un preparado; se fija al confirmar la preparacion -- DP-28 Vencimiento'),
         ($1, 'dias_retiro_vencido', 'NUMERO', '30', 'Dias, desde que la receta queda preparada, tras los cuales un preparado que nadie retiro pasa a Retiro vencido; 0 desactiva el vencimiento -- openspec/specs/retiro-vencido/spec.md'),
         ($1, 'dias_relevamiento_inicial', 'NUMERO', '30', 'Dias, desde el primer cierre diario firmado, durante los cuales se puede cargar existencia inicial si el DT no cerro antes el relevamiento -- openspec/specs/existencia-inicial/spec.md')
       ON CONFLICT (tenant_id, clave) DO NOTHING`,
      [tenantId],
    );

    // Etiqueta page size (migration 0066): every tenant starts with the
    // 100 x 42 mm the label was designed for, so printing always has at least
    // one option; the administrator adds more in Configuración -> Etiquetas.
    // Also backfilled for pre-existing tenants by migration 0066 (same row).
    await client.query(
      `INSERT INTO fsj.etiqueta_tamano (tenant_id, nombre, ancho_mm, alto_mm)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [tenantId, ETIQUETA_TAMANO_PREDETERMINADO_NOMBRE, ETIQUETA_TAMANO_PREDETERMINADO.anchoMm, ETIQUETA_TAMANO_PREDETERMINADO.altoMm],
    );

    // Etiqueta sheet (migration 0096): the PDF page is the sheet, the etiqueta
    // is drawn in a cell of it. Every tenant starts on A4 portrait with a 5 mm
    // margin (the 100 x 42 mm size above fits it 2 x 6 times); the administrator
    // changes it in Configuración -> Etiquetas. Also backfilled for pre-existing
    // tenants by migration 0096 (same row).
    await client.query(
      `INSERT INTO fsj.etiqueta_hoja (tenant_id, ancho_mm, alto_mm, margen_mm)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [tenantId, HOJA_PREDETERMINADA.anchoMm, HOJA_PREDETERMINADA.altoMm, HOJA_PREDETERMINADA.margenMm],
    );

    // libro_rubricado (M12, FASE 1 point 1.12 -- openspec/specs/libro-recetario-y-contralor/spec.md):
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
