/**
 * Local development demo seed (M00/plan §16, demo operational dataset).
 *
 * Populates the local database (.env.desarrollo) with realistic operational
 * data spread across a 60-day window around TODAY (now - 30 days .. now + 30 days):
 * recipes in every lifecycle state, laboratory preparations, real weighings,
 * batch reservations, printed labels, delivery records (counter & courier),
 * annulled delivery history, expired preparations/pickups, purchase invoices,
 * physical stock movements, initial inventory, stock adjustments, batch reanalysis,
 * self-elaborated dilution lot, supplier price history with VAT, official
 * ledger entries (libro recetario and contralor psicotrópicos), and signed daily closes.
 *
 * Runs AFTER the base seed (prisma/seed.ts, `npm run db:seed`) and builds on it:
 * same tenant (CUIT 30-11223344-5), existing users, and baseline master data.
 *
 * Connects with DIRECT_URL (owner role `postgres`), never DATABASE_URL.
 * Strictly local-only: refuses to run unless DIRECT_URL points to 127.0.0.1,
 * localhost, or ::1. Never runs against production.
 *
 * Chronology: walks the historical window day by day in strict chronological order,
 * setting `fsj.reloj_prueba` for each daily step so the database itself derives
 * legal dates, hash chains, and gapless correlatives.
 *
 * Idempotent & Re-run safe: skips closed or already-chained days, never violates
 * immutability or ledger linearity, and regenerates drafts/pending items around
 * the current date. Uses a seeded PRNG keyed on the execution date for reproducible runs.
 *
 * Usage:
 *   $env:DOTENV_CONFIG_PATH=".env.desarrollo"; npm run db:seed:demo; Remove-Item Env:DOTENV_CONFIG_PATH
 */
import "dotenv/config";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { dec } from "@/shared/decimal";
import { calcularPrecioFinal, type ReglasPrecio } from "@/modules/precios/domain/regla-precio";
import {
  calcularFichaTecnica,
  type ComponenteInput,
  type FormaFarmaceutica,
  type ItemRecetaInput,
  type LineaPesajeCalculada,
  type TipoMagnitud,
  type UnidadMedidaRef,
} from "@/modules/elaboracion/domain/calcular-ficha-tecnica";
import { formatearMedicoTexto, formatearPacienteTexto } from "@/modules/preparaciones/domain/preparacion";

const ALLOWED_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function assertLocalHost(directUrl: string): void {
  let url: URL;
  try {
    url = new URL(directUrl);
  } catch {
    console.error("seed-demo: DIRECT_URL is not a valid URL.");
    process.exit(1);
  }

  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    console.error(
      `seed-demo: refused to run. DIRECT_URL must point to a local host (127.0.0.1, localhost, or ::1).\n` +
        `Current host: '${hostname}'.\n` +
        `Never run db:seed:demo against production or remote databases.`,
    );
    process.exit(1);
  }
}

/** Deterministic pseudo-random generator (LCG / Mulberry32) keyed on integer seed. */
function crearPrng(semilla: number): () => number {
  let s = semilla >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(d: Date, days: number): Date {
  const res = new Date(d);
  res.setUTCDate(res.getUTCDate() + days);
  return res;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toIsoMendoza(d: Date, hora = "10:30:00"): string {
  return `${toDateStr(d)}T${hora}-03:00`;
}

async function setReloj(client: Client, isoInstant: string): Promise<void> {
  await client.query("SELECT set_config('fsj.reloj_prueba', $1, true)", [isoInstant]);
}

async function setTenant(client: Client, tenantId: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

interface SeedContext {
  tenantId: string;
  adminId: string;
  dtId: string;
  farmaId: string;
  sistemaId: string;
  dtDesignacionId: string;
  gramoId: string;
  mililitroId: string;
  unidadId: string;
  drogas: {
    ibuprofenoId: string;
    acidoSalicilicoId: string;
    vaselinaId: string;
    alcoholId: string;
    clonazepamId: string;
  };
  proveedores: {
    farmaplusId: string;
    quimicaMedicaId: string;
  };
  medicoIds: string[];
  pacienteIds: string[];
  repartidorIds: string[];
  reglaPrecioId: string;
  reglasPrecio: ReglasPrecio;
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes("--dry-run");
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    console.error("seed-demo: DIRECT_URL is required (see .env.desarrollo). Never uses DATABASE_URL.");
    process.exit(1);
  }
  assertLocalHost(directUrl);

  const TENANT_CUIT = "30-11223344-5";
  const hoyReal = new Date();
  const hoy = new Date(Date.UTC(hoyReal.getFullYear(), hoyReal.getMonth(), hoyReal.getDate(), 12, 0, 0));
  const semilla = hoy.getUTCFullYear() * 10000 + (hoy.getUTCMonth() + 1) * 100 + hoy.getUTCDate();
  const prng = crearPrng(semilla);
  void prng;

  const client = new Client({ connectionString: directUrl });
  await client.connect();

  let pasoActual = "Inicio";
  let diaActualLog = toDateStr(hoy);

  try {
    await client.query("BEGIN");

    // ------------------------------------------------------------------------
    // 1. Look up base tenant and seed users
    // ------------------------------------------------------------------------
    pasoActual = "Verificación de tenant base";
    const tenantRes = await client.query<{ id: string; fecha_activacion_contralor: string | null }>(
      `SELECT id, fecha_activacion_contralor FROM fsj.tenant WHERE cuit = $1`,
      [TENANT_CUIT],
    );
    if (tenantRes.rows.length === 0) {
      throw new Error(`seed-demo: tenant ${TENANT_CUIT} does not exist. Run 'npm run db:seed' first.`);
    }
    const tenantId = tenantRes.rows[0]!.id;
    await setTenant(client, tenantId);

    const usuariosRes = await client.query<{ id: string; email: string }>(
      `SELECT id, email::text FROM fsj.usuario WHERE tenant_id = $1 AND email IN ('admin@example.com', 'dt@example.com', 'farmaceutico@example.com') OR (tenant_id = $1 AND es_tecnico = true)`,
      [tenantId],
    );
    const userMap = new Map<string, string>();
    let sistemaId = "";
    for (const u of usuariosRes.rows) {
      userMap.set(u.email, u.id);
    }
    const adminId = userMap.get("admin@example.com");
    const dtId = userMap.get("dt@example.com");
    const farmaId = userMap.get("farmaceutico@example.com");

    const sisRes = await client.query<{ id: string }>(
      `SELECT id FROM fsj.usuario WHERE tenant_id = $1 AND es_tecnico = true LIMIT 1`,
      [tenantId],
    );
    if (sisRes.rows.length > 0) sistemaId = sisRes.rows[0]!.id;

    if (!adminId || !dtId || !farmaId || !sistemaId) {
      throw new Error("seed-demo: base users (admin, dt, farmaceutico, sistema) are missing. Run 'npm run db:seed' first.");
    }

    // Active DT designation
    const dtDesignacionRes = await client.query<{ id: string }>(
      `SELECT id FROM fsj.designacion_director_tecnico WHERE tenant_id = $1 AND usuario_id = $2 AND vigente_hasta IS NULL LIMIT 1`,
      [tenantId, dtId],
    );
    if (dtDesignacionRes.rows.length === 0) {
      throw new Error("seed-demo: no active DT designation found. Run 'npm run db:seed' first.");
    }
    const dtDesignacionId = dtDesignacionRes.rows[0]!.id;

    // Units
    const unidadesRes = await client.query<{ id: string; codigo: string }>(
      `SELECT id, codigo FROM fsj.unidad_medida WHERE codigo IN ('GRAMO', 'MILILITRO', 'UNIDAD')`,
    );
    const unidadMap = new Map<string, string>();
    for (const row of unidadesRes.rows) unidadMap.set(row.codigo, row.id);
    const gramoId = unidadMap.get("GRAMO")!;
    const mililitroId = unidadMap.get("MILILITRO")!;
    const unidadId = unidadMap.get("UNIDAD") || gramoId;

    // Drugs
    const drogasRes = await client.query<{ id: string; nombre: string }>(
      `SELECT id, nombre::text FROM fsj.droga WHERE tenant_id = $1`,
      [tenantId],
    );
    const drogaMap = new Map<string, string>();
    for (const row of drogasRes.rows) drogaMap.set(row.nombre, row.id);
    const ibuprofenoId = drogaMap.get("Ibuprofeno")!;
    const acidoSalicilicoId = drogaMap.get("Ácido Salicílico")!;
    const vaselinaId = drogaMap.get("Vaselina Sólida")!;
    const alcoholId = drogaMap.get("Alcohol 96%")!;
    const clonazepamId = drogaMap.get("Clonazepam")!;

    // Suppliers
    const provRes = await client.query<{ id: string; cuit: string }>(
      `SELECT id, cuit FROM fsj.proveedor WHERE tenant_id = $1`,
      [tenantId],
    );
    const provMap = new Map<string, string>();
    for (const row of provRes.rows) provMap.set(row.cuit, row.id);
    const farmaplusId = provMap.get("30998877661")!;
    const quimicaMedicaId = provMap.get("30998877662")!;

    // Price rules
    const reglaRes = await client.query<{ id: string; precio_minimo: string }>(
      `SELECT id, precio_minimo FROM fsj.regla_precio WHERE tenant_id = $1 AND vigente_hasta IS NULL LIMIT 1`,
      [tenantId],
    );
    if (reglaRes.rows.length === 0) {
      throw new Error("seed-demo: active regla_precio not found. Run 'npm run db:seed' first.");
    }
    const reglaPrecioId = reglaRes.rows[0]!.id;
    const tramosRes = await client.query<{ costo_hasta: string | null; margen: string }>(
      `SELECT costo_hasta, margen FROM fsj.regla_precio_tramo WHERE tenant_id = $1 AND regla_precio_id = $2 ORDER BY orden ASC`,
      [tenantId, reglaPrecioId],
    );
    const reglasPrecio: ReglasPrecio = {
      precioMinimo: reglaRes.rows[0]!.precio_minimo,
      tramos: tramosRes.rows.map((t) => ({ costoHasta: t.costo_hasta, margen: t.margen })),
    };

    // ------------------------------------------------------------------------
    // 2. Extend Master Data: Doctors, Patients, Couriers, Contralor Activation
    // ------------------------------------------------------------------------
    pasoActual = "Ampliación de datos maestros";

    // Activate contralor starting 35 days ago if not active
    const fechaActivacionContralor = toDateStr(addDays(hoy, -35));
    await client.query(
      `UPDATE fsj.tenant SET fecha_activacion_contralor = $1 WHERE id = $2 AND fecha_activacion_contralor IS NULL`,
      [fechaActivacionContralor, tenantId],
    );

    // Couriers (repartidores)
    // fsj.repartidor has no natural unique key: look up by name before inserting so re-runs don't duplicate.
    const REPARTIDORES = [
      { nombre: "Matías", apellido: "Romero", telefono: "261-700-1100" },
      { nombre: "Esteban", apellido: "Sosa", telefono: "261-700-2200" },
    ];
    const repartidorIds: string[] = [];
    for (const rep of REPARTIDORES) {
      const existingRep = await client.query<{ id: string }>(
        `SELECT id FROM fsj.repartidor WHERE tenant_id = $1 AND nombre = $2 AND apellido = $3 LIMIT 1`,
        [tenantId, rep.nombre, rep.apellido],
      );
      if (existingRep.rows[0]) {
        await client.query(`UPDATE fsj.repartidor SET activo = true WHERE id = $1 AND tenant_id = $2`, [existingRep.rows[0].id, tenantId]);
        repartidorIds.push(existingRep.rows[0].id);
        continue;
      }
      const repRes = await client.query<{ id: string }>(
        `INSERT INTO fsj.repartidor (tenant_id, nombre, apellido, telefono, activo, creado_por_id)
         VALUES ($1, $2, $3, $4, true, $5)
         RETURNING id`,
        [tenantId, rep.nombre, rep.apellido, rep.telefono, adminId],
      );
      repartidorIds.push(repRes.rows[0]!.id);
    }

    // Additional Doctors
    const NUEVOS_MEDICOS = [
      {
        nombre: "Alejandro",
        apellido: "Rossi",
        matricula: "MP-55667",
        jurisdiccion: "PROVINCIAL",
        especialidad: "Clínica Médica",
        telefono: "261-420-5566",
        email: "dr.rossi@example.com",
      },
      {
        nombre: "Valentina",
        apellido: "Paz",
        matricula: "MN-88990",
        jurisdiccion: "NACIONAL",
        especialidad: "Traumatología",
        telefono: "261-420-7788",
        email: "dra.paz@example.com",
      },
    ];
    for (const m of NUEVOS_MEDICOS) {
      await client.query(
        `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula, matricula_jurisdiccion, especialidad, telefono, email)
         VALUES ($1, $2, $3, $4, $5::fsj.jurisdiccion_matricula, $6, $7, $8)
         ON CONFLICT (tenant_id, matricula_jurisdiccion, matricula) WHERE fecha_baja IS NULL DO NOTHING`,
        [tenantId, m.nombre, m.apellido, m.matricula, m.jurisdiccion, m.especialidad, m.telefono, m.email],
      );
    }
    const allMedicosRes = await client.query<{ id: string }>(
      `SELECT id FROM fsj.medico WHERE tenant_id = $1 ORDER BY apellido, nombre`,
      [tenantId],
    );
    const medicoIds = allMedicosRes.rows.map((r) => r.id);

    // Additional Patients
    const NUEVOS_PACIENTES = [
      { nombre: "Martín", apellido: "Castro", dni: "38111222", cuil: "20381112225", fnac: "1994-05-12", sexo: "M", tel: "261-622-1100", email: "martin.castro@example.com", dom: "Perito Moreno 340, Godoy Cruz, Mendoza" },
      { nombre: "Camila", apellido: "Morales", dni: "42333444", cuil: "27423334448", fnac: "1999-11-20", sexo: "F", tel: "261-633-2211", email: "camila.morales@example.com", dom: "Mitre 910, Ciudad, Mendoza" },
      { nombre: "Tomás", apellido: "Herrera", dni: "29555666", cuil: "20295556663", fnac: "1982-02-17", sexo: "M", tel: "261-644-3322", email: "tomas.herrera@example.com", dom: "Belgrano 1450, Guaymallén, Mendoza" },
      { nombre: "Elena", apellido: "Domínguez", dni: "31777888", cuil: "27317778881", fnac: "1985-09-04", sexo: "F", tel: "261-655-4433", email: "elena.dominguez@example.com", dom: "Sarmiento 220, Maipú, Mendoza" },
      { nombre: "Mateo", apellido: "Rivas", dni: "45999000", cuil: "20459990007", fnac: "2004-07-28", sexo: "M", tel: "261-666-5544", email: "mateo.rivas@example.com", dom: "España 830, Ciudad, Mendoza" },
    ];
    for (const p of NUEVOS_PACIENTES) {
      await client.query(
        `INSERT INTO fsj.paciente (tenant_id, nombre, apellido, dni, cuil, fecha_nacimiento, telefono, email, domicilio, sexo, acepta_recordatorios_whatsapp)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, true)
         ON CONFLICT (tenant_id, dni) WHERE dni IS NOT NULL DO NOTHING`,
        [tenantId, p.nombre, p.apellido, p.dni, p.cuil, p.fnac, p.tel, p.email, p.dom, p.sexo],
      );
    }
    const allPacientesRes = await client.query<{ id: string }>(
      `SELECT id FROM fsj.paciente WHERE tenant_id = $1 ORDER BY apellido, nombre`,
      [tenantId],
    );
    const pacienteIds = allPacientesRes.rows.map((r) => r.id);

    const ctx: SeedContext = {
      tenantId,
      adminId,
      dtId,
      farmaId,
      sistemaId,
      dtDesignacionId,
      gramoId,
      mililitroId,
      unidadId,
      drogas: { ibuprofenoId, acidoSalicilicoId, vaselinaId, alcoholId, clonazepamId },
      proveedores: { farmaplusId, quimicaMedicaId },
      medicoIds,
      pacienteIds,
      repartidorIds,
      reglaPrecioId,
      reglasPrecio,
    };

    // ------------------------------------------------------------------------
    // 3. Inspect existing legal records for idempotency and safe re-runs
    // ------------------------------------------------------------------------
    pasoActual = "Inspección de cierres y asientos existentes";
    const maxCierreRes = await client.query<{ max_cierre: string | null }>(
      `SELECT MAX(fecha)::text AS max_cierre FROM fsj.cierre_diario WHERE tenant_id = $1`,
      [tenantId],
    );
    const maxCierre = maxCierreRes.rows[0]?.max_cierre ?? null;
    const fechaLimiteExistente = maxCierre ?? "1970-01-01";

    let skippedDaysCount = 0;
    let skippedStepsCount = 0;

    // Draft laboratory rows (pesada/excipiente/insumo_borrador) are never deleted: the developer's own
    // in-progress drafts live in the same tenant. Each run adds drafts only to the recetas it creates.

    // ------------------------------------------------------------------------
    // 4. Day -30: Initial setup (Existencia Inicial, Contralor APERTURA, Cost History)
    // ------------------------------------------------------------------------
    const diaMenos30 = addDays(hoy, -30);
    const fechaDiaMenos30 = toDateStr(diaMenos30);
    diaActualLog = fechaDiaMenos30;
    await setReloj(client, toIsoMendoza(diaMenos30, "08:00:00"));

    if (fechaDiaMenos30 <= fechaLimiteExistente) {
      skippedDaysCount++;
    } else {
      // 4a. Initial stock inventory (EXISTENCIA_INICIAL) while relevamiento_inicial_abierto is true
      pasoActual = "Carga de existencia inicial";
      const existingPartidaIni = await client.query<{ id: string }>(
        `SELECT id FROM fsj.partida WHERE tenant_id = $1 AND lote = 'INI-SAL-001'`,
        [tenantId],
      );
      if (existingPartidaIni.rows.length === 0) {
        const partidaIniRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.partida (
             tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial,
             fecha_ingreso, fecha_vencimiento, origen
           )
           VALUES ($1, $2, NULL, 'INI-SAL-001', '80.0000', '150.000', now(), $3::date, 'EXISTENCIA_INICIAL')
           RETURNING id`,
          [tenantId, acidoSalicilicoId, toDateStr(addDays(hoy, 365))],
        );
        await client.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_INICIAL', '150.000', $3)`,
          [tenantId, partidaIniRes.rows[0]!.id, farmaId],
        );
      }

      // 4b. Opening balance for controlled drug (Clonazepam) in PSICOTROPICO book (INV-L15)
      pasoActual = "Apertura de libro contralor (Psicotrópicos)";
      const existingApertura = await client.query<{ id: string }>(
        `SELECT a.id FROM fsj.asiento_contralor a
         JOIN fsj.libro_rubricado l ON l.id = a.libro_id AND l.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.droga_id = $2 AND l.tipo = 'PSICOTROPICO'`,
        [tenantId, clonazepamId],
      );
      if (existingApertura.rows.length === 0) {
        await client.query(
          `INSERT INTO fsj.asiento_contralor (
             tenant_id, libro_id, numero_correlativo, fecha_asiento, tipo_movimiento,
             droga_id, droga_descripcion, cantidad, unidad_medida_id,
             saldo_anterior, saldo_posterior, hash_integridad, hash_anterior, registrado_por_id
           )
           VALUES (
             $1, '00000000-0000-0000-0000-000000000000', 0, $2::date, 'APERTURA',
             $3, 'Clonazepam', '50.000', $4,
             0, 0, '', '', $5
           )`,
          [tenantId, fechaDiaMenos30, clonazepamId, gramoId, dtId],
        );
      }

      // 4c. Supplier cost history: 2-3 price changes per drug over the window
      pasoActual = "Historial de costos de proveedor";
      const fechaCosto1 = toDateStr(addDays(hoy, -28));
      const fechaCosto2 = toDateStr(addDays(hoy, -14));

      // Query base seed costs to align vigencias
      const baseCostosRes = await client.query<{ droga_id: string; proveedor_id: string; vigente_desde: string }>(
        `SELECT droga_id, proveedor_id, vigente_desde::text FROM fsj.costo_proveedor WHERE tenant_id = $1 AND vigente_hasta IS NULL`,
        [tenantId],
      );
      const baseCostosMap = new Map<string, string>();
      for (const b of baseCostosRes.rows) {
        baseCostosMap.set(`${b.droga_id}:${b.proveedor_id}`, b.vigente_desde);
      }

      // Historical cost records with Decimal arithmetic
      const HISTORIAL_COSTOS = [
        // Ibuprofeno - Farmaplus (base row exists: close previous vigencias before it)
        { drogaId: ibuprofenoId, provId: farmaplusId, precio: "155.0000", desde: fechaCosto1, hasta: fechaCosto2 },
        { drogaId: ibuprofenoId, provId: farmaplusId, precio: "165.0000", desde: fechaCosto2, hasta: baseCostosMap.get(`${ibuprofenoId}:${farmaplusId}`) ?? null },
        // Ibuprofeno - Química Médica (second provider: not in base seed, leaves open vigencia)
        { drogaId: ibuprofenoId, provId: quimicaMedicaId, precio: "160.0000", desde: fechaCosto2, hasta: toDateStr(addDays(hoy, -3)) },
        { drogaId: ibuprofenoId, provId: quimicaMedicaId, precio: "170.0000", desde: toDateStr(addDays(hoy, -3)), hasta: null },
        // Ácido Salicílico - Química Médica
        { drogaId: acidoSalicilicoId, provId: quimicaMedicaId, precio: "88.0000", desde: fechaCosto1, hasta: fechaCosto2 },
        { drogaId: acidoSalicilicoId, provId: quimicaMedicaId, precio: "95.0000", desde: fechaCosto2, hasta: baseCostosMap.get(`${acidoSalicilicoId}:${quimicaMedicaId}`) ?? null },
        // Vaselina Sólida - Farmaplus
        { drogaId: vaselinaId, provId: farmaplusId, precio: "26.0000", desde: fechaCosto1, hasta: fechaCosto2 },
        { drogaId: vaselinaId, provId: farmaplusId, precio: "29.0000", desde: fechaCosto2, hasta: baseCostosMap.get(`${vaselinaId}:${farmaplusId}`) ?? null },
        // Alcohol 96% - Química Médica
        { drogaId: alcoholId, provId: quimicaMedicaId, precio: "19.5000", desde: fechaCosto1, hasta: fechaCosto2 },
        { drogaId: alcoholId, provId: quimicaMedicaId, precio: "22.0000", desde: fechaCosto2, hasta: baseCostosMap.get(`${alcoholId}:${quimicaMedicaId}`) ?? null },
        // Clonazepam - Farmaplus
        { drogaId: clonazepamId, provId: farmaplusId, precio: "460.0000", desde: fechaCosto1, hasta: fechaCosto2 },
        { drogaId: clonazepamId, provId: farmaplusId, precio: "490.0000", desde: fechaCosto2, hasta: baseCostosMap.get(`${clonazepamId}:${farmaplusId}`) ?? null },
      ];

      for (const c of HISTORIAL_COSTOS) {
        const precioDec = dec(c.precio);
        const ivaDec = dec("21");
        const precioIva = precioDec.times(ivaDec.dividedBy(100).plus(1)).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
        const costoIva = precioDec.times(ivaDec.dividedBy(100).plus(1)).toDecimalPlaces(10, Decimal.ROUND_HALF_UP);
        const unidadPrecioId = c.drogaId === alcoholId ? mililitroId : gramoId;

        const desdeIso = toIsoMendoza(new Date(`${c.desde}T00:00:00Z`), "09:00:00");
        const hastaIso = c.hasta
          ? (c.hasta.includes(" ") || c.hasta.includes("T") ? c.hasta : toIsoMendoza(new Date(`${c.hasta}T00:00:00Z`), "09:00:00"))
          : null;

        await client.query(
          `INSERT INTO fsj.costo_proveedor (
             tenant_id, droga_id, proveedor_id, precio_informado, unidad_precio_id,
             costo_unitario, alicuota_iva, precio_informado_con_iva, costo_unitario_con_iva,
             fecha_precio, vigente_desde, vigente_hasta, creado_por_id
           )
           VALUES (
             $1, $2, $3, $4::numeric, $5,
             $4::numeric, $6::numeric, $7::numeric, $8::numeric,
             $9::date, $10::timestamptz, $11::timestamptz, $12
           )`,
          [
            tenantId,
            c.drogaId,
            c.provId,
            precioDec.toString(),
            unidadPrecioId,
            ivaDec.toString(),
            precioIva.toString(),
            costoIva.toString(),
            c.desde,
            desdeIso,
            hastaIso,
            adminId,
          ],
        );
      }
    }

    // ------------------------------------------------------------------------
    // 5. Special Stock Milestones (Purchases with Factura, Reanálisis, Elaboración)
    // ------------------------------------------------------------------------
    pasoActual = "Hitos especiales de stock";

    // Purchase Invoice 1 (Day -24, Farmaplus)
    const diaCompra1 = addDays(hoy, -24);
    if (toDateStr(diaCompra1) > fechaLimiteExistente) {
      await setReloj(client, toIsoMendoza(diaCompra1, "11:00:00"));
      const existingComp1 = await client.query<{ id: string }>(
        `SELECT id FROM fsj.comprobante_compra WHERE tenant_id = $1 AND proveedor_id = $2 AND letra = 'A' AND punto_venta = '0001' AND numero = '00012345'`,
        [tenantId, farmaplusId],
      );
      let comp1Id: string;
      if (existingComp1.rows.length === 0) {
        const compRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.comprobante_compra (
             tenant_id, proveedor_id, letra, punto_venta, numero, fecha_emision, cae, subtotal, iva, total, registrado_por_id, registrado_en
           )
           VALUES ($1, $2, 'A', '0001', '00012345', $3::date, '74123456789012', 60000, 12600, 72600, $4, now())
           RETURNING id`,
          [tenantId, farmaplusId, toDateStr(diaCompra1), farmaId],
        );
        comp1Id = compRes.rows[0]!.id;

        const partCompRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.partida (
             tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial,
             fecha_ingreso, fecha_vencimiento, origen, comprobante_compra_id
           )
           VALUES ($1, $2, $3, 'IBU-2026-F02', '165.0000', '400.000', now(), $4::date, 'COMPRA', $5)
           RETURNING id`,
          [tenantId, ibuprofenoId, farmaplusId, toDateStr(addDays(hoy, 400)), comp1Id],
        );
        await client.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', '400.000', $3)`,
          [tenantId, partCompRes.rows[0]!.id, farmaId],
        );
      }
    }

    // Purchase Invoice 2 (Day -17, Química Médica)
    const diaCompra2 = addDays(hoy, -17);
    if (toDateStr(diaCompra2) > fechaLimiteExistente) {
      await setReloj(client, toIsoMendoza(diaCompra2, "11:00:00"));
      const existingComp2 = await client.query<{ id: string }>(
        `SELECT id FROM fsj.comprobante_compra WHERE tenant_id = $1 AND proveedor_id = $2 AND letra = 'A' AND punto_venta = '0002' AND numero = '00056789'`,
        [tenantId, quimicaMedicaId],
      );
      if (existingComp2.rows.length === 0) {
        const compRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.comprobante_compra (
             tenant_id, proveedor_id, letra, punto_venta, numero, fecha_emision, cae, subtotal, iva, total, registrado_por_id, registrado_en
           )
           VALUES ($1, $2, 'A', '0002', '00056789', $3::date, '74987654321098', 50000, 10500, 60500, $4, now())
           RETURNING id`,
          [tenantId, quimicaMedicaId, toDateStr(diaCompra2), farmaId],
        );
        const comp2Id = compRes.rows[0]!.id;

        const partCompRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.partida (
             tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial,
             fecha_ingreso, fecha_vencimiento, origen, comprobante_compra_id
           )
           VALUES ($1, $2, $3, 'VAS-2026-Q02', '28.0000', '1500.000', now(), $4::date, 'COMPRA', $5)
           RETURNING id`,
          [tenantId, vaselinaId, quimicaMedicaId, toDateStr(addDays(hoy, 500)), comp2Id],
        );
        await client.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', '1500.000', $3)`,
          [tenantId, partCompRes.rows[0]!.id, farmaId],
        );
      }
    }

    // Lote de elaboración propia (Day -12, Dilución Ibuprofeno 10%)
    const diaElab = addDays(hoy, -12);
    if (toDateStr(diaElab) > fechaLimiteExistente) {
      await setReloj(client, toIsoMendoza(diaElab, "15:00:00"));
      const existingElab = await client.query<{ id: string }>(
        `SELECT id FROM fsj.partida WHERE tenant_id = $1 AND lote = 'DIL-IBU-10-01'`,
        [tenantId],
      );
      if (existingElab.rows.length === 0) {
        // Partida to consume (base seed IBU-2026-001)
        const baseIbuRes = await client.query<{ id: string; fecha_vencimiento_vigente: string | null }>(
          `SELECT id, to_char(fecha_vencimiento_vigente, 'YYYY-MM-DD') AS fecha_vencimiento_vigente
           FROM fsj.partida WHERE tenant_id = $1 AND lote = 'IBU-2026-001'`,
          [tenantId],
        );
        if (baseIbuRes.rows.length > 0) {
          const partidaConsumidaId = baseIbuRes.rows[0]!.id;
          // INV-EL4 (migration 0114): an elaborated lot expires exactly when the first consumed DROGA partida does.
          const vencimientoElaborado = baseIbuRes.rows[0]!.fecha_vencimiento_vigente;
          const partidaElabRes = await client.query<{ id: string }>(
            `INSERT INTO fsj.partida (
               tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial,
               fecha_ingreso, fecha_vencimiento, origen, potencia_declarada
             )
             VALUES ($1, $2, NULL, 'DIL-IBU-10-01', '15.0000', '100.000', now(), $3::date, 'ELABORACION_PROPIA', '10.000000')
             RETURNING id`,
            [tenantId, ibuprofenoId, vencimientoElaborado],
          );
          const partidaElabId = partidaElabRes.rows[0]!.id;

          const elabRes = await client.query<{ id: string }>(
            `INSERT INTO fsj.elaboracion_lote (
               tenant_id, partida_id, tipo, elaborado_por_id, nombre, aspecto, observacion
             )
             VALUES ($1, $2, 'DILUCION', $3, 'Dilución Ibuprofeno 10%', 'Polvo blanco homogéneo', 'Elaboración propia de dilución en mortero')
             RETURNING id`,
            [tenantId, partidaElabId, farmaId],
          );
          const elaboracionLoteId = elabRes.rows[0]!.id;

          // Ingreso of produced batch
          await client.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, elaboracion_lote_id)
             VALUES ($1, $2, 'INGRESO_ELABORACION', '100.000', $3, $4)`,
            [tenantId, partidaElabId, farmaId, elaboracionLoteId],
          );

          // Egreso of consumed raw drug
          await client.query(
            `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, elaboracion_lote_id)
             VALUES ($1, $2, 'EGRESO_ELABORACION', '10.000', $3, $4)`,
            [tenantId, partidaConsumidaId, farmaId, elaboracionLoteId],
          );
        }
      }
    }

    // Stock Adjustment (Day -9, DT Authorized loss/breakage)
    const diaAjuste = addDays(hoy, -9);
    if (toDateStr(diaAjuste) > fechaLimiteExistente) {
      await setReloj(client, toIsoMendoza(diaAjuste, "16:00:00"));
      const partidaVasRes = await client.query<{ id: string }>(
        `SELECT id FROM fsj.partida WHERE tenant_id = $1 AND lote = 'VAS-2026-001'`,
        [tenantId],
      );
      if (partidaVasRes.rows.length > 0) {
        const partidaVasId = partidaVasRes.rows[0]!.id;
        const existingAjuste = await client.query<{ id: string }>(
          `SELECT id FROM fsj.movimiento_stock WHERE tenant_id = $1 AND partida_id = $2 AND tipo = 'AJUSTE'`,
          [tenantId, partidaVasId],
        );
        if (existingAjuste.rows.length === 0) {
          await client.query(
            `INSERT INTO fsj.movimiento_stock (
               tenant_id, partida_id, tipo, cantidad, motivo_ajuste, observacion, autorizado_por_id, registrado_por_id
             )
             VALUES ($1, $2, 'AJUSTE', '5.000', 'ROTURA', 'Pérdida por rotura accidental de recipiente en mesada', $3, $4)`,
            [tenantId, partidaVasId, dtId, farmaId],
          );
        }
      }
    }

    // Reanálisis de partida by DT (Day -6, Ácido Salicílico)
    const diaReanalisis = addDays(hoy, -6);
    if (toDateStr(diaReanalisis) > fechaLimiteExistente) {
      await setReloj(client, toIsoMendoza(diaReanalisis, "17:00:00"));
      const partidaSalRes = await client.query<{ id: string }>(
        `SELECT id FROM fsj.partida WHERE tenant_id = $1 AND lote = 'SAL-2026-001'`,
        [tenantId],
      );
      if (partidaSalRes.rows.length > 0) {
        const partidaSalId = partidaSalRes.rows[0]!.id;
        const existingRean = await client.query<{ id: string }>(
          `SELECT id FROM fsj.reanalisis_partida WHERE tenant_id = $1 AND partida_id = $2`,
          [tenantId, partidaSalId],
        );
        if (existingRean.rows.length === 0) {
          await client.query(
            `INSERT INTO fsj.reanalisis_partida (
               tenant_id, partida_id, fecha_reanalisis, fecha_vencimiento_anterior, motivo, respaldo, registrado_por_id
             )
             VALUES ($1, $2, $3::date, '1970-01-01'::date, 'Control periódico de estabilidad y humedad', 'Protocolo CC-9981', $4)`,
            [tenantId, partidaSalId, toDateStr(addDays(hoy, 730)), dtId],
          );
        }
      }
    }

    // Batches close to expiry and already expired
    const diaLotesVenc = addDays(hoy, -10);
    if (toDateStr(diaLotesVenc) > fechaLimiteExistente) {
      await setReloj(client, toIsoMendoza(diaLotesVenc, "10:00:00"));
      // Expired batch (fecha_vencimiento 4 days ago)
      const existingExp = await client.query<{ id: string }>(
        `SELECT id FROM fsj.partida WHERE tenant_id = $1 AND lote = 'ALC-EXP-001'`,
        [tenantId],
      );
      if (existingExp.rows.length === 0) {
        const pExpRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.partida (
             tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial,
             fecha_ingreso, fecha_vencimiento, origen
           )
           VALUES ($1, $2, $3, 'ALC-EXP-001', '18.0000', '100.000', now(), $4::date, 'COMPRA')
           RETURNING id`,
          [tenantId, alcoholId, quimicaMedicaId, toDateStr(addDays(hoy, -4))],
        );
        await client.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', '100.000', $3)`,
          [tenantId, pExpRes.rows[0]!.id, farmaId],
        );
      }

      // Near-expiry batch (fecha_vencimiento in 12 days)
      const existingNear = await client.query<{ id: string }>(
        `SELECT id FROM fsj.partida WHERE tenant_id = $1 AND lote = 'VAS-PV-001'`,
        [tenantId],
      );
      if (existingNear.rows.length === 0) {
        const pNearRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.partida (
             tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial,
             fecha_ingreso, fecha_vencimiento, origen
           )
           VALUES ($1, $2, $3, 'VAS-PV-001', '25.0000', '200.000', now(), $4::date, 'COMPRA')
           RETURNING id`,
          [tenantId, vaselinaId, farmaplusId, toDateStr(addDays(hoy, 12))],
        );
        await client.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
           VALUES ($1, $2, 'INGRESO_COMPRA', '200.000', $3)`,
          [tenantId, pNearRes.rows[0]!.id, farmaId],
        );
      }
    }

    // ------------------------------------------------------------------------
    // 6. Chronological Generation of 40-60 Recetas across the window
    // ------------------------------------------------------------------------
    pasoActual = "Generación cronológica de recetas y libros";

    // Setup active partidas lookup for laboratory stock consumption
    const partidasMapRes = await client.query<{ id: string; droga_id: string; lote: string }>(
      `SELECT id, droga_id, lote FROM fsj.partida WHERE tenant_id = $1 AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= $2::date)`,
      [tenantId, fechaDiaMenos30],
    );
    const partidasPorDroga = new Map<string, string[]>();
    for (const r of partidasMapRes.rows) {
      const arr = partidasPorDroga.get(r.droga_id) ?? [];
      arr.push(r.id);
      partidasPorDroga.set(r.droga_id, arr);
    }

    // Helper to find an active partida with enough available stock
    async function getPartidaConStock(drogaId: string, cantidadRequerida: string, fechaActual: string): Promise<string | null> {
      const res = await client.query<{ id: string }>(
        `SELECT id FROM fsj.partida
         WHERE tenant_id = $1 AND droga_id = $2
           AND cantidad_disponible >= $3::numeric
           AND (fecha_vencimiento_vigente IS NULL OR fecha_vencimiento_vigente >= $4::date)
         ORDER BY cantidad_disponible DESC
         LIMIT 1`,
        [tenantId, drogaId, cantidadRequerida, fechaActual],
      );
      return res.rows[0]?.id ?? null;
    }

    // Target specification of ~52 recetas distributed chronologically
    interface RecetaPlan {
      offsetDias: number; // day relative to hoy (-30 .. +20)
      pacienteIdx: number;
      medicoIdx: number;
      formulaTipo: "IBU_CREMA" | "SAL_POMADA" | "ALC_SOL" | "CLO_CAPS";
      estadoDestino:
        | "ENTREGADA_MOSTRADOR"
        | "ENTREGADA_ENVIO"
        | "ENVIADA_PEND_FIRMA"
        | "ANULADA_ENTREGA"
        | "PREPARADA_NORMAL"
        | "PREPARADA_VENCIDA"
        | "PREPARADA_POR_VENCER"
        | "RETIRO_VENCIDO"
        | "EN_PREPARACION"
        | "PENDIENTE_BORRADOR"
        | "PENDIENTE_NORMAL"
        | "PENDIENTE_FUTURA"
        | "ANULADA";
      pagadaInicial?: boolean;
    }

    const PLAN_RECETAS: RecetaPlan[] = [
      // Day -29 (Week 1)
      { offsetDias: -29, pacienteIdx: 0, medicoIdx: 0, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -29, pacienteIdx: 1, medicoIdx: 1, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -28
      { offsetDias: -28, pacienteIdx: 2, medicoIdx: 2, formulaTipo: "ALC_SOL", estadoDestino: "ENTREGADA_ENVIO" },
      { offsetDias: -28, pacienteIdx: 3, medicoIdx: 3, formulaTipo: "CLO_CAPS", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -27
      { offsetDias: -27, pacienteIdx: 4, medicoIdx: 0, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -27, pacienteIdx: 0, medicoIdx: 1, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_ENVIO" },
      // Day -26
      { offsetDias: -26, pacienteIdx: 5, medicoIdx: 2, formulaTipo: "IBU_CREMA", estadoDestino: "RETIRO_VENCIDO" },
      { offsetDias: -26, pacienteIdx: 6, medicoIdx: 3, formulaTipo: "CLO_CAPS", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -25
      { offsetDias: -25, pacienteIdx: 1, medicoIdx: 0, formulaTipo: "SAL_POMADA", estadoDestino: "RETIRO_VENCIDO" },
      { offsetDias: -25, pacienteIdx: 2, medicoIdx: 1, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_ENVIO" },
      // Day -22 (Week 2)
      { offsetDias: -22, pacienteIdx: 3, medicoIdx: 2, formulaTipo: "ALC_SOL", estadoDestino: "PREPARADA_VENCIDA" }, // Aqueous short expiration
      { offsetDias: -22, pacienteIdx: 4, medicoIdx: 3, formulaTipo: "IBU_CREMA", estadoDestino: "PREPARADA_POR_VENCER" },
      { offsetDias: -22, pacienteIdx: 0, medicoIdx: 0, formulaTipo: "CLO_CAPS", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -21
      { offsetDias: -21, pacienteIdx: 1, medicoIdx: 1, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -21, pacienteIdx: 2, medicoIdx: 2, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_ENVIO" },
      // Day -20
      { offsetDias: -20, pacienteIdx: 3, medicoIdx: 3, formulaTipo: "ALC_SOL", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -20, pacienteIdx: 5, medicoIdx: 0, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -19
      { offsetDias: -19, pacienteIdx: 6, medicoIdx: 1, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_ENVIO" },
      { offsetDias: -19, pacienteIdx: 0, medicoIdx: 2, formulaTipo: "CLO_CAPS", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -18
      { offsetDias: -18, pacienteIdx: 1, medicoIdx: 3, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -18, pacienteIdx: 2, medicoIdx: 0, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -15 (Week 3)
      { offsetDias: -15, pacienteIdx: 3, medicoIdx: 1, formulaTipo: "ALC_SOL", estadoDestino: "ANULADA" },
      { offsetDias: -15, pacienteIdx: 4, medicoIdx: 2, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_ENVIO" },
      // Day -14
      { offsetDias: -14, pacienteIdx: 5, medicoIdx: 3, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -14, pacienteIdx: 6, medicoIdx: 0, formulaTipo: "CLO_CAPS", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -13
      { offsetDias: -13, pacienteIdx: 0, medicoIdx: 1, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -13, pacienteIdx: 1, medicoIdx: 2, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_ENVIO" },
      // Day -12
      { offsetDias: -12, pacienteIdx: 2, medicoIdx: 3, formulaTipo: "ALC_SOL", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -12, pacienteIdx: 3, medicoIdx: 0, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -11
      { offsetDias: -11, pacienteIdx: 4, medicoIdx: 1, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -11, pacienteIdx: 5, medicoIdx: 2, formulaTipo: "CLO_CAPS", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -8 (Week 4)
      { offsetDias: -8, pacienteIdx: 6, medicoIdx: 3, formulaTipo: "IBU_CREMA", estadoDestino: "ANULADA" },
      { offsetDias: -8, pacienteIdx: 0, medicoIdx: 0, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_ENVIO" },
      // Day -7
      { offsetDias: -7, pacienteIdx: 1, medicoIdx: 1, formulaTipo: "ALC_SOL", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -7, pacienteIdx: 2, medicoIdx: 2, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -6
      { offsetDias: -6, pacienteIdx: 3, medicoIdx: 3, formulaTipo: "CLO_CAPS", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -6, pacienteIdx: 4, medicoIdx: 0, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_ENVIO" },
      // Day -5
      { offsetDias: -5, pacienteIdx: 5, medicoIdx: 1, formulaTipo: "IBU_CREMA", estadoDestino: "ANULADA_ENTREGA" }, // Reverted delivery
      { offsetDias: -5, pacienteIdx: 6, medicoIdx: 2, formulaTipo: "SAL_POMADA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -4
      { offsetDias: -4, pacienteIdx: 0, medicoIdx: 3, formulaTipo: "IBU_CREMA", estadoDestino: "ENTREGADA_MOSTRADOR" },
      { offsetDias: -4, pacienteIdx: 1, medicoIdx: 0, formulaTipo: "CLO_CAPS", estadoDestino: "ENTREGADA_MOSTRADOR" },
      // Day -3 (Recent days)
      { offsetDias: -3, pacienteIdx: 2, medicoIdx: 1, formulaTipo: "SAL_POMADA", estadoDestino: "PREPARADA_NORMAL" },
      { offsetDias: -3, pacienteIdx: 3, medicoIdx: 2, formulaTipo: "IBU_CREMA", estadoDestino: "PREPARADA_NORMAL" },
      // Day -2
      { offsetDias: -2, pacienteIdx: 4, medicoIdx: 3, formulaTipo: "ALC_SOL", estadoDestino: "PREPARADA_NORMAL" },
      { offsetDias: -2, pacienteIdx: 5, medicoIdx: 0, formulaTipo: "CLO_CAPS", estadoDestino: "PREPARADA_NORMAL" },
      { offsetDias: -2, pacienteIdx: 6, medicoIdx: 1, formulaTipo: "IBU_CREMA", estadoDestino: "ENVIADA_PEND_FIRMA" }, // Courier in transit, unpaid!
      // Day -1 (Yesterday)
      { offsetDias: -1, pacienteIdx: 0, medicoIdx: 2, formulaTipo: "SAL_POMADA", estadoDestino: "EN_PREPARACION" },
      { offsetDias: -1, pacienteIdx: 1, medicoIdx: 3, formulaTipo: "IBU_CREMA", estadoDestino: "EN_PREPARACION" },
      { offsetDias: -1, pacienteIdx: 2, medicoIdx: 0, formulaTipo: "ALC_SOL", estadoDestino: "PREPARADA_NORMAL" },
      // Day 0 (Today)
      { offsetDias: 0, pacienteIdx: 3, medicoIdx: 1, formulaTipo: "CLO_CAPS", estadoDestino: "EN_PREPARACION" },
      { offsetDias: 0, pacienteIdx: 4, medicoIdx: 2, formulaTipo: "IBU_CREMA", estadoDestino: "EN_PREPARACION" },
      { offsetDias: 0, pacienteIdx: 5, medicoIdx: 3, formulaTipo: "SAL_POMADA", estadoDestino: "EN_PREPARACION" },
      { offsetDias: 0, pacienteIdx: 6, medicoIdx: 0, formulaTipo: "IBU_CREMA", estadoDestino: "PENDIENTE_BORRADOR" },
      { offsetDias: 0, pacienteIdx: 0, medicoIdx: 1, formulaTipo: "ALC_SOL", estadoDestino: "PENDIENTE_BORRADOR" },
      { offsetDias: 0, pacienteIdx: 1, medicoIdx: 2, formulaTipo: "SAL_POMADA", estadoDestino: "PENDIENTE_NORMAL" },
      { offsetDias: 0, pacienteIdx: 2, medicoIdx: 3, formulaTipo: "IBU_CREMA", estadoDestino: "PENDIENTE_NORMAL" },
      // Future Prescriptions (scheduled / future valid dates)
      { offsetDias: 3, pacienteIdx: 3, medicoIdx: 0, formulaTipo: "IBU_CREMA", estadoDestino: "PENDIENTE_FUTURA" },
      { offsetDias: 7, pacienteIdx: 4, medicoIdx: 1, formulaTipo: "SAL_POMADA", estadoDestino: "PENDIENTE_FUTURA" },
      { offsetDias: 14, pacienteIdx: 5, medicoIdx: 2, formulaTipo: "CLO_CAPS", estadoDestino: "PENDIENTE_FUTURA" },
    ];

    interface ComponenteFormula {
      drogaId: string;
      nombre: string;
      cantidad: string;
      unidadId: string;
      esPa: boolean;
      simbolo: string;
    }

    interface FormulaData {
      descripcion: string;
      forma: FormaFarmaceutica;
      cantidadTotal: string;
      unidadTotalId: string;
      componentes: ComponenteFormula[];
    }

    // Helper to build formula inputs
    function buildFormula(tipo: RecetaPlan["formulaTipo"]): FormulaData {
      if (tipo === "IBU_CREMA") {
        return {
          descripcion: "Crema de Ibuprofeno 5%",
          forma: "CREMA",
          cantidadTotal: "100.000",
          unidadTotalId: gramoId,
          componentes: [
            { drogaId: ibuprofenoId, nombre: "Ibuprofeno", cantidad: "5.000", unidadId: gramoId, esPa: true, simbolo: "g" },
            { drogaId: vaselinaId, nombre: "Vaselina Sólida", cantidad: "95.000", unidadId: gramoId, esPa: false, simbolo: "g" },
          ],
        };
      }
      if (tipo === "SAL_POMADA") {
        return {
          descripcion: "Pomada de Ácido Salicílico 10%",
          forma: "UNGUENTO",
          cantidadTotal: "50.000",
          unidadTotalId: gramoId,
          componentes: [
            { drogaId: acidoSalicilicoId, nombre: "Ácido Salicílico", cantidad: "5.000", unidadId: gramoId, esPa: true, simbolo: "g" },
            { drogaId: vaselinaId, nombre: "Vaselina Sólida", cantidad: "45.000", unidadId: gramoId, esPa: false, simbolo: "g" },
          ],
        };
      }
      if (tipo === "ALC_SOL") {
        return {
          descripcion: "Solución Alcohólica de Ácido Salicílico 2%",
          forma: "SOLUCION",
          cantidadTotal: "100.000",
          unidadTotalId: mililitroId,
          componentes: [
            { drogaId: acidoSalicilicoId, nombre: "Ácido Salicílico", cantidad: "2.000", unidadId: gramoId, esPa: true, simbolo: "g" },
            { drogaId: alcoholId, nombre: "Alcohol 96%", cantidad: "98.000", unidadId: mililitroId, esPa: false, simbolo: "mL" },
          ],
        };
      }
      // CLO_CAPS (Controlled)
      return {
        descripcion: "Cápsulas de Clonazepam 0.5 mg",
        forma: "CAPSULA",
        cantidadTotal: "30.000",
        unidadTotalId: unidadId,
        componentes: [
          { drogaId: clonazepamId, nombre: "Clonazepam", cantidad: "0.015", unidadId: gramoId, esPa: true, simbolo: "g" },
          { drogaId: vaselinaId, nombre: "Vaselina Sólida", cantidad: "6.000", unidadId: gramoId, esPa: false, simbolo: "g" },
        ],
      };
    }

    // Tracking counts
    const counts = {
      recetasTotal: 0,
      porEstado: {} as Record<string, number>,
      asientosRecetario: 0,
      asientosContralor: 0,
      cierresFirmados: 0,
    };

    // Sort plans chronologically by offsetDias
    PLAN_RECETAS.sort((a, b) => a.offsetDias - b.offsetDias);

    // Group plans by day
    const planesPorDia = new Map<number, RecetaPlan[]>();
    for (const p of PLAN_RECETAS) {
      const arr = planesPorDia.get(p.offsetDias) ?? [];
      arr.push(p);
      planesPorDia.set(p.offsetDias, arr);
    }

    // Iterate through past days and today (-30 .. 0)
    for (let offset = -30; offset <= 0; offset++) {
      const dia = addDays(hoy, offset);
      const fechaDiaStr = toDateStr(dia);
      diaActualLog = fechaDiaStr;
      pasoActual = `Recetas de jornada ${fechaDiaStr}`;

      // Set test clock for this day
      await setReloj(client, toIsoMendoza(dia, "09:00:00"));

      // If this day is behind or equal to existing legal boundary, skip legal modifications
      if (fechaDiaStr <= fechaLimiteExistente) {
        skippedDaysCount++;
        const planesDeHoy = planesPorDia.get(offset) ?? [];
        skippedStepsCount += planesDeHoy.length;
        continue;
      }

      const planesDeHoy = planesPorDia.get(offset) ?? [];

      for (const plan of planesDeHoy) {
        counts.recetasTotal++;
        const formula = buildFormula(plan.formulaTipo);
        const pacienteId = ctx.pacienteIds[plan.pacienteIdx % ctx.pacienteIds.length]!;
        const medicoId = ctx.medicoIds[plan.medicoIdx % ctx.medicoIds.length]!;

        const pacRow = await client.query<{ nombre: string; apellido: string; domicilio: string | null }>(
          `SELECT nombre, apellido, domicilio FROM fsj.paciente WHERE id = $1`,
          [pacienteId],
        );
        const medRow = await client.query<{ nombre: string; apellido: string; matricula: string }>(
          `SELECT nombre, apellido, matricula FROM fsj.medico WHERE id = $1`,
          [medicoId],
        );
        const pac = pacRow.rows[0]!;
        const med = medRow.rows[0]!;

        const esAnuladaInicial = plan.estadoDestino === "ANULADA";
        const esPagada =
          plan.estadoDestino === "ENTREGADA_MOSTRADOR" ||
          plan.estadoDestino === "ENTREGADA_ENVIO" ||
          plan.pagadaInicial === true;

        const pagadaEnVal = esPagada ? toIsoMendoza(dia, "09:15:00") : null;
        const pagadaPorVal = esPagada ? farmaId : null;

        // Create Receta row
        const recetaRes = await client.query<{ id: string; numero_interno: string }>(
          `INSERT INTO fsj.receta (
             tenant_id, numero_interno, paciente_id, medico_id, fecha_creada,
             fecha_prescripcion, fecha_valida_desde, fecha_ingreso, origen, estado,
             registrada_por_id, motivo_anulacion, pagada, pagada_en, pagada_por_id,
             domicilio_paciente, domicilio_entrega
           )
           VALUES (
             $1, 0, $2, $3, now(),
             $4::date, NULL, now(), 'PRESENCIAL', 'PENDIENTE_PREPARACION',
             $5, $6, $7, $8::timestamptz, $9,
             $10, $10
           )
           RETURNING id, numero_interno`,
          [
            tenantId,
            pacienteId,
            medicoId,
            fechaDiaStr,
            farmaId,
            esAnuladaInicial ? "Paciente desistió del preparado" : null,
            esPagada,
            pagadaEnVal,
            pagadaPorVal,
            pac.domicilio,
          ],
        );
        const recetaId = recetaRes.rows[0]!.id;

        // Create ItemReceta
        const itemRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.item_receta (
             tenant_id, receta_id, descripcion, forma_farmaceutica, cantidad_unidades,
             fraccion_dosis_por_unidad, cantidad_total, unidad_total_id
           )
           VALUES ($1, $2, $3, $4::fsj.forma_farmaceutica, 1, '1', $5::numeric, $6)
           RETURNING id`,
          [tenantId, recetaId, formula.descripcion, formula.forma, formula.cantidadTotal, formula.unidadTotalId],
        );
        const itemId = itemRes.rows[0]!.id;

        // Create Componentes
        const componenteIds: string[] = [];
        for (let i = 0; i < formula.componentes.length; i++) {
          const c = formula.componentes[i]!;
          const compRes = await client.query<{ id: string }>(
            `INSERT INTO fsj.componente_item_receta (
               tenant_id, item_receta_id, droga_id, cantidad, unidad_medida_id,
               modo_expresion, es_principio_activo, posicion
             )
             VALUES ($1, $2, $3, $4::numeric, $5, 'TOTAL', $6, $7)
             RETURNING id`,
            [tenantId, itemId, c.drogaId, c.cantidad, c.unidadId, c.esPa, i],
          );
          componenteIds.push(compRes.rows[0]!.id);
        }

        // Domain Ficha Técnica calculation
        const itemDominio: ItemRecetaInput = {
          formaFarmaceutica: formula.forma,
          cantidadUnidades: formula.forma === "CAPSULA" ? 30 : 1,
          fraccionDosisPorUnidad: "1",
          cantidadTotal: formula.cantidadTotal,
          unidadTotal: {
            id: formula.unidadTotalId,
            simbolo: formula.forma === "SOLUCION" ? "mL" : formula.forma === "CAPSULA" ? "u" : "g",
            tipoMagnitud: formula.forma === "SOLUCION" ? "VOLUMEN" : formula.forma === "CAPSULA" ? "UNIDADES" : "MASA",
            factorABase: "1",
          },
        };
        const componentesDominio: ComponenteInput[] = formula.componentes.map((c, idx) => ({
          drogaId: c.drogaId,
          drogaNombre: c.nombre,
          cantidad: c.cantidad,
          unidadMedida: {
            id: c.unidadId,
            simbolo: c.simbolo,
            tipoMagnitud: c.simbolo === "mL" ? "VOLUMEN" : "MASA",
            factorABase: "1",
          },
          modoExpresion: "TOTAL",
          posicion: idx,
        }));
        const unidadesBaseRef: Record<TipoMagnitud, UnidadMedidaRef> = {
          MASA: { id: gramoId, simbolo: "g", tipoMagnitud: "MASA", factorABase: "1" },
          VOLUMEN: { id: mililitroId, simbolo: "mL", tipoMagnitud: "VOLUMEN", factorABase: "1" },
          UNIDADES: { id: unidadId, simbolo: "u", tipoMagnitud: "UNIDADES", factorABase: "1" },
        };
        const lineasCalculadas: LineaPesajeCalculada[] = calcularFichaTecnica(
          itemDominio,
          componentesDominio,
          { excesoPesadaPorcentaje: "0" },
          unidadesBaseRef,
        );

        // Insert Ficha Técnica & Líneas de Pesaje
        const fichaRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id, generada_en)
           VALUES ($1, $2, 1, $3, now())
           RETURNING id`,
          [tenantId, itemId, farmaId],
        );
        const fichaId = fichaRes.rows[0]!.id;

        const lineasGuardadas: { id: string; drogaId: string; drogaNombre: string; cantidad: string; unidadId: string; simbolo: string }[] = [];
        for (const l of lineasCalculadas) {
          const lRes = await client.query<{ id: string }>(
            `INSERT INTO fsj.linea_pesaje (
               tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica,
               exceso_aplicado, cantidad_a_pesar, unidad_medida_id, es_enrase_manual, orden
             )
             VALUES ($1, $2, $3, $4, $5::numeric, '0', $5::numeric, $6, $7, $8)
             RETURNING id`,
            [
              tenantId,
              fichaId,
              l.drogaId,
              l.drogaNombre,
              l.cantidadAPesar ? l.cantidadAPesar.toString() : "0",
              l.unidadMedida.id,
              l.esEnraseManual,
              l.orden,
            ],
          );
          lineasGuardadas.push({
            id: lRes.rows[0]!.id,
            drogaId: l.drogaId,
            drogaNombre: l.drogaNombre,
            cantidad: l.cantidadAPesar ? l.cantidadAPesar.toString() : "0",
            unidadId: l.unidadMedida.id,
            simbolo: l.unidadMedida.simbolo ?? "g",
          });
        }

        // Domain Cotización calculation
        let costoTotalInsumos = dec(0);
        const detalleLineas = [];
        for (const lg of lineasGuardadas) {
          const costoUnit = lg.drogaId === clonazepamId ? dec("490") : lg.drogaId === ibuprofenoId ? dec("175") : lg.drogaId === acidoSalicilicoId ? dec("95") : dec("29");
          const ivaUnit = costoUnit.times(dec("1.21")).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
          const costoLinea = dec(lg.cantidad).times(ivaUnit);
          costoTotalInsumos = costoTotalInsumos.plus(costoLinea);
          detalleLineas.push({
            lineaPesajeId: lg.id,
            drogaId: lg.drogaId,
            drogaNombre: lg.drogaNombre,
            cantidad: lg.cantidad,
            unidadSimbolo: lg.simbolo,
            costo: costoLinea.toString(),
            costoConIva: costoLinea.toString(),
            fuente: "PROVEEDOR",
            fuenteRegistrada: true,
          });
        }
        const precioCalc = calcularPrecioFinal(costoTotalInsumos, ctx.reglasPrecio);

        await client.query(
          `INSERT INTO fsj.cotizacion (
             tenant_id, item_receta_id, costo_insumos, costo_insumos_con_iva,
             margen_aplicado, precio_final, precio_minimo_aplicado, regla_precio_id,
             es_parcial, es_incompleta, detalle, calculada_en, calculada_por_id
           )
           VALUES (
             $1, $2, $3::numeric, $3::numeric,
             $4::numeric, $5::numeric, $6, $7,
             false, false, $8::jsonb, now(), $9
           )`,
          [
            tenantId,
            itemId,
            costoTotalInsumos.toString(),
            precioCalc.margenAplicado.toString(),
            precioCalc.precioFinal.toString(),
            precioCalc.precioMinimoAplicado,
            ctx.reglaPrecioId,
            JSON.stringify({ lineas: detalleLineas }),
            farmaId,
          ],
        );

        // If PENDIENTE_BORRADOR, add draft laboratory weighings and stop
        if (plan.estadoDestino === "PENDIENTE_BORRADOR") {
          const primeraLinea = lineasGuardadas[0];
          if (primeraLinea) {
            const partidaId = await getPartidaConStock(primeraLinea.drogaId, primeraLinea.cantidad, fechaDiaStr);
            if (partidaId) {
              await client.query(
                `INSERT INTO fsj.pesada_borrador (tenant_id, linea_pesaje_id, partida_ids, cantidad_real, actualizado_por_id, actualizado_en)
                 VALUES ($1, $2, ARRAY[$3]::uuid[], $4::numeric, $5, now())
                 ON CONFLICT (tenant_id, linea_pesaje_id) DO NOTHING`,
                [tenantId, primeraLinea.id, partidaId, primeraLinea.cantidad, farmaId],
              );
            }
          }
          counts.porEstado["PENDIENTE_PREPARACION"] = (counts.porEstado["PENDIENTE_PREPARACION"] ?? 0) + 1;
          continue;
        }

        // If PENDIENTE_NORMAL or PENDIENTE_FUTURA, stop here
        if (plan.estadoDestino === "PENDIENTE_NORMAL" || plan.estadoDestino === "PENDIENTE_FUTURA") {
          counts.porEstado["PENDIENTE_PREPARACION"] = (counts.porEstado["PENDIENTE_PREPARACION"] ?? 0) + 1;
          continue;
        }

        // If ANULADA at intake, transition and stop
        if (esAnuladaInicial) {
          await client.query(`UPDATE fsj.receta SET estado = 'ANULADA' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);
          counts.porEstado["ANULADA"] = (counts.porEstado["ANULADA"] ?? 0) + 1;
          continue;
        }

        // Take receta in lab
        await client.query(
          `UPDATE fsj.receta SET tomada_por_id = $1, tomada_en = now() WHERE id = $2 AND tenant_id = $3`,
          [farmaId, recetaId, tenantId],
        );

        // If EN_PREPARACION: create INICIADA preparación with active reserva_stock
        if (plan.estadoDestino === "EN_PREPARACION") {
          const prepRes = await client.query<{ id: string }>(
            `INSERT INTO fsj.preparacion (
               tenant_id, ficha_tecnica_id, item_receta_id, estado, iniciada_en, iniciada_por_id
             )
             VALUES ($1, $2, $3, 'INICIADA', now(), $4)
             RETURNING id`,
            [tenantId, fichaId, itemId, farmaId],
          );
          const prepId = prepRes.rows[0]!.id;

          for (const lg of lineasGuardadas) {
            const partidaId = await getPartidaConStock(lg.drogaId, lg.cantidad, fechaDiaStr);
            if (partidaId) {
              await client.query(
                `INSERT INTO fsj.reserva_stock (tenant_id, preparacion_id, linea_pesaje_id, partida_id, cantidad, reservada_por_id)
                 VALUES ($1, $2, $3, $4, $5::numeric, $6)`,
                [tenantId, prepId, lg.id, partidaId, lg.cantidad, farmaId],
              );
            }
          }
          counts.porEstado["EN_PREPARACION"] = (counts.porEstado["EN_PREPARACION"] ?? 0) + 1;
          continue;
        }

        // --------------------------------------------------------------------
        // Completing preparation: CONFIRMADA, weigh movements, label, official book
        // --------------------------------------------------------------------
        let tipoVenc: string = "ESTANDAR";
        let fechaVencPrep: string = toDateStr(addDays(dia, 90));

        if (plan.estadoDestino === "PREPARADA_VENCIDA") {
          tipoVenc = "ACUOSA_SIN_CONSERVANTE"; // 14-day limit
          fechaVencPrep = toDateStr(addDays(dia, 14));
        } else if (plan.estadoDestino === "PREPARADA_POR_VENCER") {
          tipoVenc = "ACUOSA_CON_CONSERVANTE"; // 35-day limit
          fechaVencPrep = toDateStr(addDays(dia, 35));
        }

        const prepRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.preparacion (
             tenant_id, ficha_tecnica_id, item_receta_id, estado, iniciada_en, iniciada_por_id,
             confirmada_en, preparada_por_id, fecha_vencimiento, tipo_vencimiento
           )
           VALUES ($1, $2, $3, 'CONFIRMADA', now(), $4, now(), $4, $5::date, $6::fsj.tipo_vencimiento_preparado)
           RETURNING id`,
          [tenantId, fichaId, itemId, farmaId, fechaVencPrep, tipoVenc],
        );
        const prepId = prepRes.rows[0]!.id;

        // Register stock consumption (movimiento_stock) for each weigh line
        const egresosControlados: { drogaId: string; drogaNombre: string; cantidad: string; unidadId: string; movimientoId: string }[] = [];
        for (const lg of lineasGuardadas) {
          const partidaId = await getPartidaConStock(lg.drogaId, lg.cantidad, fechaDiaStr);
          if (partidaId) {
            const movRes = await client.query<{ id: string }>(
              `INSERT INTO fsj.movimiento_stock (
                 tenant_id, partida_id, tipo, cantidad, linea_pesaje_id, preparacion_id, registrado_por_id
               )
               VALUES ($1, $2, 'EGRESO_PREPARACION', $3::numeric, $4, $5, $6)
               RETURNING id`,
              [tenantId, partidaId, lg.cantidad, lg.id, prepId, farmaId],
            );
            if (lg.drogaId === clonazepamId) {
              egresosControlados.push({
                drogaId: lg.drogaId,
                drogaNombre: lg.drogaNombre,
                cantidad: lg.cantidad,
                unidadId: lg.unidadId,
                movimientoId: movRes.rows[0]!.id,
              });
            }
          }
        }

        // Generate and print Label (Etiqueta)
        const contenidoEtiqueta =
          `Director Técnico Directora Técnica Local - MAT. MP-10002\n` +
          `Av. San Martín 1234, Mendoza\n` +
          `Tel: 261-555-0100\n` +
          `Rp/\n` +
          `${formula.descripcion}\n` +
          `Vence: ${fechaVencPrep.slice(5, 7)}/${fechaVencPrep.slice(2, 4)}\n` +
          `Receta N ${recetaRes.rows[0]!.numero_interno}`;

        await client.query(
          `INSERT INTO fsj.etiqueta (tenant_id, preparacion_id, contenido, generada_en, impresa, impresa_en, impresa_por_id)
           VALUES ($1, $2, $3, now(), true, now(), $4)`,
          [tenantId, prepId, contenidoEtiqueta, farmaId],
        );

        // Legal Ledger (Libro Recetario)
        // 1. asiento_preparacion
        const asientoId = randomUUID();
        await client.query(
          `INSERT INTO fsj.asiento_preparacion (tenant_id, asiento_recetario_id, preparacion_id, orden)
           VALUES ($1, $2, $3, 1)`,
          [tenantId, asientoId, prepId],
        );

        // 2. detalle_asiento
        for (let idx = 0; idx < lineasGuardadas.length; idx++) {
          const lg = lineasGuardadas[idx]!;
          await client.query(
            `INSERT INTO fsj.detalle_asiento (
               tenant_id, asiento_recetario_id, linea_pesaje_id, descripcion, cantidad, unidad_texto, orden
             )
             VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)`,
            [tenantId, asientoId, lg.id, lg.drogaNombre, lg.cantidad, lg.simbolo, idx + 1],
          );
        }

        // 3. asiento_recetario (trigger computes correlativo, hashes, fecha_asiento)
        const formulaTexto = formula.componentes.map((c) => `${c.nombre}: ${c.cantidad} ${c.simbolo}`).join("; ");
        const pacienteTexto = formatearPacienteTexto(pac.nombre, pac.apellido);
        const medicoTexto = formatearMedicoTexto(med.nombre, med.apellido, med.matricula);

        await client.query(
          `INSERT INTO fsj.asiento_recetario (
             id, tenant_id, libro_id, numero_correlativo, fecha_asiento, origen,
             receta_id, paciente_texto, medico_texto, formula_texto,
             hash_integridad, hash_anterior, registrado_por_id
           )
           VALUES (
             $1, $2, '00000000-0000-0000-0000-000000000000', 0, '1970-01-01'::date, 'SISTEMA',
             $3, $4, $5, $6,
             '', '', $7
           )`,
          [asientoId, tenantId, recetaId, pacienteTexto, medicoTexto, formulaTexto, farmaId],
        );
        counts.asientosRecetario++;

        // 4. asiento_contralor for controlled psychotropic drugs (Clonazepam)
        for (const egreso of egresosControlados) {
          await client.query(
            `INSERT INTO fsj.asiento_contralor (
               tenant_id, libro_id, numero_correlativo, fecha_asiento, tipo_movimiento,
               droga_id, droga_descripcion, cantidad, unidad_medida_id,
               saldo_anterior, saldo_posterior, movimiento_stock_id,
               asiento_recetario_id, hash_integridad, hash_anterior, registrado_por_id
             )
             VALUES (
               $1, '00000000-0000-0000-0000-000000000000', 0, '1970-01-01'::date, 'EGRESO',
               $2, $3, $4::numeric, $5,
               0, 0, $6,
               $7, '', '', $8
             )`,
            [
              tenantId,
              egreso.drogaId,
              egreso.drogaNombre,
              egreso.cantidad,
              egreso.unidadId,
              egreso.movimientoId,
              asientoId,
              farmaId,
            ],
          );
          counts.asientosContralor++;
        }

        // Transition receta: PENDIENTE_PREPARACION -> EN_PREPARACION -> PREPARADA
        await client.query(`UPDATE fsj.receta SET estado = 'EN_PREPARACION' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);
        await client.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);

        // State branches after PREPARADA:
        if (
          plan.estadoDestino === "PREPARADA_NORMAL" ||
          plan.estadoDestino === "PREPARADA_VENCIDA" ||
          plan.estadoDestino === "PREPARADA_POR_VENCER"
        ) {
          counts.porEstado["PREPARADA"] = (counts.porEstado["PREPARADA"] ?? 0) + 1;
          continue;
        }

        if (plan.estadoDestino === "RETIRO_VENCIDO") {
          await client.query(`UPDATE fsj.receta SET estado = 'RETIRO_VENCIDO' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);
          counts.porEstado["RETIRO_VENCIDO"] = (counts.porEstado["RETIRO_VENCIDO"] ?? 0) + 1;
          continue;
        }

        if (plan.estadoDestino === "ENTREGADA_MOSTRADOR") {
          // Counter pickup requires pagada = true (INV-R14)
          await client.query(`UPDATE fsj.receta SET pagada = true, pagada_en = now(), pagada_por_id = $1 WHERE id = $2 AND tenant_id = $3`, [farmaId, recetaId, tenantId]);
          await client.query(
            `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id, entregada_en, firma_recibida)
             VALUES ($1, $2, 'RETIRO_PRESENCIAL', $3, now(), false)`,
            [tenantId, recetaId, farmaId],
          );
          await client.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);
          counts.porEstado["ENTREGADA"] = (counts.porEstado["ENTREGADA"] ?? 0) + 1;
          continue;
        }

        if (plan.estadoDestino === "ENTREGADA_ENVIO") {
          const repartidorId = ctx.repartidorIds[0]!;
          await client.query(`UPDATE fsj.receta SET pagada = true, pagada_en = now(), pagada_por_id = $1 WHERE id = $2 AND tenant_id = $3`, [farmaId, recetaId, tenantId]);
          await client.query(
            `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id, entregada_en, firma_recibida, firma_recibida_en, repartidor_id)
             VALUES ($1, $2, 'ENVIO', $3, now(), true, now(), $4)`,
            [tenantId, recetaId, farmaId, repartidorId],
          );
          await client.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);
          counts.porEstado["ENTREGADA"] = (counts.porEstado["ENTREGADA"] ?? 0) + 1;
          continue;
        }

        if (plan.estadoDestino === "ENVIADA_PEND_FIRMA") {
          const repartidorId = ctx.repartidorIds[1] ?? ctx.repartidorIds[0]!;
          // Delivery in progress with courier: impaga (INV-R14 permits ENVIADA_PEND_FIRMA without pagada)
          await client.query(
            `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id, entregada_en, firma_recibida, repartidor_id)
             VALUES ($1, $2, 'ENVIO', $3, now(), false, $4)`,
            [tenantId, recetaId, farmaId, repartidorId],
          );
          await client.query(`UPDATE fsj.receta SET estado = 'ENVIADA_PEND_FIRMA' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);
          counts.porEstado["ENVIADA_PEND_FIRMA"] = (counts.porEstado["ENVIADA_PEND_FIRMA"] ?? 0) + 1;
          continue;
        }

        if (plan.estadoDestino === "ANULADA_ENTREGA") {
          // Deliver first, then annul delivery
          await client.query(`UPDATE fsj.receta SET pagada = true, pagada_en = now(), pagada_por_id = $1 WHERE id = $2 AND tenant_id = $3`, [farmaId, recetaId, tenantId]);
          const entregaRes = await client.query<{ id: string }>(
            `INSERT INTO fsj.entrega (tenant_id, receta_id, modalidad, entregada_por_id, entregada_en, firma_recibida)
             VALUES ($1, $2, 'RETIRO_PRESENCIAL', $3, now(), false)
             RETURNING id`,
            [tenantId, recetaId, farmaId],
          );
          await client.query(`UPDATE fsj.receta SET estado = 'ENTREGADA' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);

          // Anular entrega: copy to entrega_anulada, delete entrega, revert to PREPARADA and unpaid
          await client.query(
            `INSERT INTO fsj.entrega_anulada (
               tenant_id, entrega_id, receta_id, modalidad, entregada_por_id, entregada_en,
               firma_recibida, motivo, anulada_por_id, anulada_en
             )
             VALUES ($1, $2, $3, 'RETIRO_PRESENCIAL', $4, now(), false, 'Paciente retirará en otra sucursal', $4, now())`,
            [tenantId, entregaRes.rows[0]!.id, recetaId, farmaId],
          );
          await client.query(`DELETE FROM fsj.entrega WHERE id = $1 AND tenant_id = $2`, [entregaRes.rows[0]!.id, tenantId]);
          await client.query(`UPDATE fsj.receta SET estado = 'PREPARADA' WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);
          await client.query(`UPDATE fsj.receta SET pagada = false, pagada_en = NULL, pagada_por_id = NULL WHERE id = $1 AND tenant_id = $2`, [recetaId, tenantId]);

          counts.porEstado["PREPARADA"] = (counts.porEstado["PREPARADA"] ?? 0) + 1;
          continue;
        }
      }

      // ----------------------------------------------------------------------
      // Daily Close (Cierre Diario): sign past days up to yesterday (Day -1)
      // Leave Day -1 (yesterday) unsigned (pending DT signature!)
      // ----------------------------------------------------------------------
      if (offset < -1) {
        pasoActual = `Firma de cierre diario para ${fechaDiaStr}`;
        const diaSiguiente = addDays(dia, 1);
        await setReloj(client, toIsoMendoza(diaSiguiente, "08:30:00"));

        const existingCierre = await client.query<{ id: string }>(
          `SELECT id FROM fsj.cierre_diario WHERE tenant_id = $1 AND fecha = $2::date`,
          [tenantId, fechaDiaStr],
        );
        if (existingCierre.rows.length === 0) {
          await client.query(
            `SELECT fsj.cierre_diario_firmar($1, $2::date, $3, $4, NULL, NULL)`,
            [tenantId, fechaDiaStr, dtId, dtDesignacionId],
          );
          counts.cierresFirmados++;
        }
      }
    }

    // ------------------------------------------------------------------------
    // 7. Future Prescriptions (scheduled / future valid dates)
    // ------------------------------------------------------------------------
    pasoActual = "Carga de recetas con fechas futuras";
    await setReloj(client, toIsoMendoza(hoy, "14:00:00"));

    const planesFuturos = PLAN_RECETAS.filter((p) => p.offsetDias > 0);
    for (const plan of planesFuturos) {
      const formula = buildFormula(plan.formulaTipo);
      const pacienteId = ctx.pacienteIds[plan.pacienteIdx % ctx.pacienteIds.length]!;
      const medicoId = ctx.medicoIds[plan.medicoIdx % ctx.medicoIds.length]!;
      const diaFuturo = addDays(hoy, plan.offsetDias);
      const fechaFuturaStr = toDateStr(diaFuturo);

      const pacFutRes = await client.query<{ domicilio: string }>(
        `SELECT domicilio FROM fsj.paciente WHERE id = $1 AND tenant_id = $2`,
        [pacienteId, tenantId],
      );
      const domFut = pacFutRes.rows[0]?.domicilio ?? "Av. San Martín 100, Mendoza";

      counts.recetasTotal++;
      const recetaRes = await client.query<{ id: string }>(
        `INSERT INTO fsj.receta (
           tenant_id, numero_interno, paciente_id, medico_id, fecha_creada,
           fecha_prescripcion, fecha_valida_desde, fecha_ingreso, origen, estado,
           registrada_por_id, pagada, domicilio_paciente, domicilio_entrega
         )
         VALUES (
           $1, 0, $2, $3, now(),
           $4::date, $5::date, now(), 'PRESENCIAL', 'PENDIENTE_PREPARACION',
           $6, false, $7, $7
         )
         RETURNING id`,
        [tenantId, pacienteId, medicoId, toDateStr(hoy), fechaFuturaStr, farmaId, domFut],
      );
      const recFutId = recetaRes.rows[0]!.id;

      await client.query(
        `INSERT INTO fsj.item_receta (
           tenant_id, receta_id, descripcion, forma_farmaceutica, cantidad_unidades,
           fraccion_dosis_por_unidad, cantidad_total, unidad_total_id
         )
         VALUES ($1, $2, $3, $4::fsj.forma_farmaceutica, 1, '1', $5::numeric, $6)`,
        [tenantId, recFutId, formula.descripcion, formula.forma, formula.cantidadTotal, formula.unidadTotalId],
      );

      counts.porEstado["PENDIENTE_PREPARACION"] = (counts.porEstado["PENDIENTE_PREPARACION"] ?? 0) + 1;
    }

    if (isDryRun) {
      await client.query("ROLLBACK");
      console.log("\n=======================================================");
      console.log("dry run: rolled back");
      console.log("=======================================================");
    } else {
      await client.query("COMMIT");
      console.log("\n=======================================================");
      console.log("seed-demo: Operational DEMO data seeded successfully!");
      console.log("=======================================================");
    }
    console.log(`Tenant: Farmacia San Jorge S.R.L. (${tenantId})`);
    console.log(`Date window: ${toDateStr(addDays(hoy, -30))} .. ${toDateStr(addDays(hoy, 30))}`);
    console.log(`Execution reference date (TODAY): ${toDateStr(hoy)}\n`);

    console.log("Recetas created:");
    console.log(`  - Total recetas: ${counts.recetasTotal}`);
    for (const [estado, cant] of Object.entries(counts.porEstado)) {
      console.log(`    * ${estado.padEnd(24)}: ${cant}`);
    }

    console.log("\nStock & Batches:");
    console.log("  - Compras con comprobante:  2 facturas A (Farmaplus & Química Médica)");
    console.log("  - Existencia inicial:       1 lote INI-SAL-001 (Ácido Salicílico)");
    console.log("  - Elaboración propia:       1 lote DIL-IBU-10-01 (Dilución Ibuprofeno 10%)");
    console.log("  - Ajuste de stock por DT:   1 ajuste por rotura (Vaselina Sólida)");
    console.log("  - Reanálisis por DT:        1 reanálisis de vencimiento (Ácido Salicílico)");
    console.log("  - Partidas especiales:      1 partida vencida y 1 partida por vencer");
    console.log("  - Alerta de stock:          Drogas con saldo bajo stock mínimo");

    console.log("\nCostos & Precios:");
    console.log("  - Historial de precios:     13 registros históricos con vigencia cerrada e IVA");
    console.log("  - Multi-proveedor:          Ibuprofeno cotizado por Farmaplus y Química Médica");
    console.log("  - Cotizaciones calculadas:  Margen de tramo y precio mínimo piso aplicados");

    console.log("\nLibros Oficiales & Cierres:");
    console.log(`  - Asientos Libro Recetario: ${counts.asientosRecetario}`);
    console.log(`  - Asientos Libro Contralor: ${counts.asientosContralor}`);
    console.log(`  - Cierres diarios firmados: ${counts.cierresFirmados}`);
    console.log("  - Cierre diario pendiente:  1 jornada (ayer, pendiente de firma por DT)");

    if (skippedDaysCount > 0 || skippedStepsCount > 0) {
      console.log(`\nRe-run info:`);
      console.log(`  - Días históricos omitidos: ${skippedDaysCount}`);
      console.log(`  - Pasos omitidos por cierre:${skippedStepsCount}`);
    }
    console.log("=======================================================\n");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const raw = error instanceof Error ? error.message : String(error);
    const password = process.env.FSJ_SEED_PASSWORD;
    const pin = process.env.FSJ_SEED_PIN;
    let message = raw;
    if (password) message = message.split(password).join("[REDACTED_PASSWORD]");
    if (pin) message = message.split(pin).join("[REDACTED_PIN]");
    message = message.replace(/postgres(ql)?:\/\/\S+/gi, "[REDACTED_URL]");
    const errObj = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
    const detail = typeof errObj?.detail === "string" ? errObj.detail : "";
    const table = typeof errObj?.table === "string" ? errObj.table : "";
    const constraint = typeof errObj?.constraint === "string" ? errObj.constraint : "";
    console.error(
      `seed-demo failed at step '${pasoActual}' on simulated day ${diaActualLog}: ${message}`,
      detail,
      table,
      constraint,
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  console.error(`seed-demo unhandled error: ${raw}`);
  process.exitCode = 1;
});
