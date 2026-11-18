/**
 * Local development database seed (M00/plan §16).
 *
 * Populates a fresh local database (.env.desarrollo) with an initial tenant,
 * users for every role with pre-configured passwords and PINs, and sufficient
 * master data (suppliers, doctors, patients, drugs, stock batches, price rules)
 * to immediately test recipes and laboratory flows without manual setup.
 *
 * Connects with DIRECT_URL (owner role `postgres`), never DATABASE_URL --
 * same convention as scripts/create-tenant.ts and scripts/db-bootstrap.ts.
 * Runs outside withTenantTransaction (no app.tenant_id, bypasses RLS) so it
 * can initialize data across platform and tenant tables.
 *
 * Strictly local-only: refuses to run unless DIRECT_URL points to 127.0.0.1,
 * localhost, or ::1. Never runs against production.
 *
 * Idempotent: safe to run multiple times. Lookups are performed by natural
 * keys (CUIT, email, code, name); existing records are preserved or updated.
 *
 * Passwords and PINs: read from FSJ_SEED_PASSWORD and FSJ_SEED_PIN in
 * .env.desarrollo. Values are hashed with argon2id and NEVER logged or printed.
 *
 * Usage:
 *   $env:DOTENV_CONFIG_PATH=".env.desarrollo"; npm run db:seed; Remove-Item Env:DOTENV_CONFIG_PATH
 */
import "dotenv/config";
import { Client } from "pg";
import { validatePassword } from "@/shared/auth/policy";
import { validatePin } from "@/modules/auth/domain/pin";
import { hashPassword } from "@/modules/auth/domain/password";
import { HOJA_PREDETERMINADA } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import {
  ETIQUETA_TAMANO_PREDETERMINADO,
  ETIQUETA_TAMANO_PREDETERMINADO_NOMBRE,
} from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";

const ALLOWED_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function assertLocalHost(directUrl: string): void {
  let url: URL;
  try {
    url = new URL(directUrl);
  } catch {
    console.error("seed: DIRECT_URL is not a valid URL.");
    process.exit(1);
  }

  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    console.error(
      `seed: refused to run. DIRECT_URL must point to a local host (127.0.0.1, localhost, or ::1).\n` +
        `Current host: '${hostname}'.\n` +
        `Never run db:seed against production or remote databases.`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    console.error("seed: DIRECT_URL is required (see .env.example). Never uses DATABASE_URL.");
    process.exit(1);
  }
  assertLocalHost(directUrl);

  const seedPassword = process.env.FSJ_SEED_PASSWORD;
  if (!seedPassword) {
    console.error("seed: FSJ_SEED_PASSWORD is required in environment variables (see docs/local-db.md).");
    process.exit(1);
  }
  const passwordViolations = validatePassword(seedPassword);
  if (passwordViolations.length > 0) {
    console.error(
      `seed: FSJ_SEED_PASSWORD does not meet the password policy:\n${passwordViolations.map((v) => `  - ${v}`).join("\n")}`,
    );
    process.exit(1);
  }

  const seedPin = process.env.FSJ_SEED_PIN;
  if (!seedPin) {
    console.error("seed: FSJ_SEED_PIN is required in environment variables (see docs/local-db.md).");
    process.exit(1);
  }
  const pinViolations = validatePin(seedPin);
  if (pinViolations.length > 0) {
    console.error(
      `seed: FSJ_SEED_PIN does not meet the PIN policy:\n${pinViolations.map((v) => `  - ${v}`).join("\n")}`,
    );
    process.exit(1);
  }

  // Precompute argon2id hashes before opening the database transaction.
  const passwordHash = await hashPassword(seedPassword);
  const pinHash = await hashPassword(seedPin);

  const client = new Client({ connectionString: directUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    // ------------------------------------------------------------------------
    // 1. Superadmin (platform operator)
    // ------------------------------------------------------------------------
    const SUPERADMIN_EMAIL = "admin@evoralfarm.com";
    const SUPERADMIN_NOMBRE = "Superadmin Local";

    await client.query(
      `INSERT INTO fsj.superadmin (email, nombre, password_hash, estado)
       VALUES ($1, $2, $3, 'ACTIVO')
       ON CONFLICT (email) DO UPDATE
       SET nombre = EXCLUDED.nombre,
           password_hash = EXCLUDED.password_hash,
           estado = 'ACTIVO',
           intentos_fallidos = 0,
           bloqueado_hasta = NULL`,
      [SUPERADMIN_EMAIL, SUPERADMIN_NOMBRE, passwordHash],
    );

    // ------------------------------------------------------------------------
    // 2. Tenant and SISTEMA / first ADMINISTRADOR
    // ------------------------------------------------------------------------
    const TENANT_CUIT = "30-11223344-5";
    const ADMIN_EMAIL = "admin@example.com";

    let tenantId: string;
    let adminId: string;

    const tenantRes = await client.query<{ id: string }>(
      `SELECT id FROM fsj.tenant WHERE cuit = $1`,
      [TENANT_CUIT],
    );

    if (tenantRes.rows.length === 0) {
      // The whole initial tenant setup (tenant, default roles, PIN actions, SISTEMA technical
      // user, parameters, label sizes and books) is handled by fsj.crear_tenant_interno.
      const result = await client.query<{ tenant_id: string; admin_id: string }>(
        `SELECT tenant_id, admin_id FROM fsj.crear_tenant_interno(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )`,
        [
          "Farmacia San Jorge S.R.L.",
          TENANT_CUIT,
          "Farmacia San Jorge",
          "Av. San Martín 1234, Mendoza",
          "F-9876",
          "America/Argentina/Mendoza",
          "Contacto San Jorge",
          "contacto@farmaciasanjorge.local",
          "261-555-0100",
          ADMIN_EMAIL,
          "Administrador",
          "Local",
          "10000001",
          passwordHash,
          ETIQUETA_TAMANO_PREDETERMINADO_NOMBRE,
          ETIQUETA_TAMANO_PREDETERMINADO.anchoMm,
          ETIQUETA_TAMANO_PREDETERMINADO.altoMm,
          HOJA_PREDETERMINADA.anchoMm,
          HOJA_PREDETERMINADA.altoMm,
          HOJA_PREDETERMINADA.margenMm,
        ],
      );
      tenantId = result.rows[0]!.tenant_id;
      adminId = result.rows[0]!.admin_id;
    } else {
      tenantId = tenantRes.rows[0]!.id;
      const adminRes = await client.query<{ id: string }>(
        `SELECT id FROM fsj.usuario WHERE tenant_id = $1 AND email = $2::extensions.citext`,
        [tenantId, ADMIN_EMAIL],
      );
      if (adminRes.rows.length === 0) {
        throw new Error(`seed: tenant exists but admin user ${ADMIN_EMAIL} was not found.`);
      }
      adminId = adminRes.rows[0]!.id;
    }

    // Retrieve SISTEMA technical user id
    const sistemaRes = await client.query<{ id: string }>(
      `SELECT id FROM fsj.usuario WHERE tenant_id = $1 AND es_tecnico = true`,
      [tenantId],
    );
    if (sistemaRes.rows.length === 0) {
      throw new Error(`seed: SISTEMA user was not found for tenant ${tenantId}.`);
    }
    const sistemaId = sistemaRes.rows[0]!.id;

    // Ensure the administrator has no forced password change and is ready to log in right away
    await client.query(
      `UPDATE fsj.usuario
       SET password_hash = $1,
           debe_cambiar_password = false,
           estado = 'ACTIVO',
           intentos_fallidos = 0,
           bloqueado_hasta = NULL,
           pin_hash = NULL,
           pin_bloqueado = false,
           pin_intentos_fallidos = 0
       WHERE id = $2 AND tenant_id = $3`,
      [passwordHash, adminId, tenantId],
    );

    // ------------------------------------------------------------------------
    // 3. Operational users: Director Técnico & Farmacéutico
    // ------------------------------------------------------------------------
    const DT_EMAIL = "dt@example.com";
    let dtId: string;

    const dtExisting = await client.query<{ id: string }>(
      `SELECT id FROM fsj.usuario WHERE tenant_id = $1 AND email = $2::extensions.citext`,
      [tenantId, DT_EMAIL],
    );

    if (dtExisting.rows.length === 0) {
      const dtRes = await client.query<{ id: string }>(
        `INSERT INTO fsj.usuario (
          tenant_id, email, nombre, apellido, dni, numero_matricula, estado, es_tecnico,
          creado_por_id, password_hash, pin_hash, debe_cambiar_password, pin_bloqueado, pin_intentos_fallidos, pin_actualizado_en
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', false, $7, $8, $9, false, false, 0, now())
        RETURNING id`,
        [tenantId, DT_EMAIL, "Directora Técnica", "Local", "10000002", "MP-10002", sistemaId, passwordHash, pinHash],
      );
      dtId = dtRes.rows[0]!.id;

      await client.query(
        `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
         SELECT $1, $2, r.id, $3
         FROM fsj.rol r
         WHERE r.tenant_id = $1 AND r.codigo = 'DIRECTOR_TECNICO'`,
        [tenantId, dtId, sistemaId],
      );
    } else {
      dtId = dtExisting.rows[0]!.id;
      await client.query(
        `UPDATE fsj.usuario
         SET password_hash = $1,
             pin_hash = $2,
             debe_cambiar_password = false,
             estado = 'ACTIVO',
             intentos_fallidos = 0,
             bloqueado_hasta = NULL,
             pin_bloqueado = false,
             pin_intentos_fallidos = 0,
             numero_matricula = $3
         WHERE id = $4 AND tenant_id = $5`,
        [passwordHash, pinHash, "MP-10002", dtId, tenantId],
      );
      await client.query(
        `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
         SELECT $1, $2, r.id, $3
         FROM fsj.rol r
         WHERE r.tenant_id = $1 AND r.codigo = 'DIRECTOR_TECNICO'
         ON CONFLICT (tenant_id, usuario_id, rol_id) DO NOTHING`,
        [tenantId, dtId, sistemaId],
      );
    }

    // Active designation for the Director Técnico (required for signing daily books and DT operations)
    const dtDesignacionRes = await client.query<{ id: string }>(
      `SELECT id FROM fsj.designacion_director_tecnico
       WHERE tenant_id = $1 AND usuario_id = $2 AND caracter = 'TITULAR' AND vigente_hasta IS NULL`,
      [tenantId, dtId],
    );
    if (dtDesignacionRes.rows.length === 0) {
      await client.query(
        `INSERT INTO fsj.designacion_director_tecnico (
          tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id
        )
        VALUES ($1, $2, 'TITULAR', 'MP-10002', '2025-01-01', $3)`,
        [tenantId, dtId, adminId],
      );
    }

    const FARMA_EMAIL = "farmaceutico@example.com";
    let farmaceuticoId: string;

    const farmaExisting = await client.query<{ id: string }>(
      `SELECT id FROM fsj.usuario WHERE tenant_id = $1 AND email = $2::extensions.citext`,
      [tenantId, FARMA_EMAIL],
    );

    if (farmaExisting.rows.length === 0) {
      const farmaRes = await client.query<{ id: string }>(
        `INSERT INTO fsj.usuario (
          tenant_id, email, nombre, apellido, dni, numero_matricula, estado, es_tecnico,
          creado_por_id, password_hash, pin_hash, debe_cambiar_password, pin_bloqueado, pin_intentos_fallidos, pin_actualizado_en
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', false, $7, $8, $9, false, false, 0, now())
        RETURNING id`,
        [tenantId, FARMA_EMAIL, "Farmacéutico", "Local", "10000003", "MP-10003", sistemaId, passwordHash, pinHash],
      );
      farmaceuticoId = farmaRes.rows[0]!.id;

      await client.query(
        `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
         SELECT $1, $2, r.id, $3
         FROM fsj.rol r
         WHERE r.tenant_id = $1 AND r.codigo = 'FARMACEUTICO'`,
        [tenantId, farmaceuticoId, sistemaId],
      );
    } else {
      farmaceuticoId = farmaExisting.rows[0]!.id;
      await client.query(
        `UPDATE fsj.usuario
         SET password_hash = $1,
             pin_hash = $2,
             debe_cambiar_password = false,
             estado = 'ACTIVO',
             intentos_fallidos = 0,
             bloqueado_hasta = NULL,
             pin_bloqueado = false,
             pin_intentos_fallidos = 0,
             numero_matricula = $3
         WHERE id = $4 AND tenant_id = $5`,
        [passwordHash, pinHash, "MP-10003", farmaceuticoId, tenantId],
      );
      await client.query(
        `INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id)
         SELECT $1, $2, r.id, $3
         FROM fsj.rol r
         WHERE r.tenant_id = $1 AND r.codigo = 'FARMACEUTICO'
         ON CONFLICT (tenant_id, usuario_id, rol_id) DO NOTHING`,
        [tenantId, farmaceuticoId, sistemaId],
      );
    }

    // ------------------------------------------------------------------------
    // 4. Proveedores
    // ------------------------------------------------------------------------
    const PROVEEDORES = [
      { razonSocial: "Droguería Farmaplus S.A.", cuit: "30998877661" },
      { razonSocial: "Química Médica Argentina S.R.L.", cuit: "30998877662" },
    ];
    const proveedorIds: Record<string, string> = {};

    for (const prov of PROVEEDORES) {
      const provRes = await client.query<{ id: string }>(
        `INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, cuit) DO UPDATE
         SET razon_social = EXCLUDED.razon_social, fecha_baja = NULL, motivo_baja = NULL
         RETURNING id`,
        [tenantId, prov.razonSocial, prov.cuit],
      );
      proveedorIds[prov.cuit] = provRes.rows[0]!.id;
    }

    // ------------------------------------------------------------------------
    // 5. Médicos
    // ------------------------------------------------------------------------
    const MEDICOS = [
      {
        nombre: "Carlos",
        apellido: "Gómez",
        matricula: "MP-44556",
        jurisdiccion: "PROVINCIAL",
        especialidad: "Dermatología",
        telefono: "261-420-1122",
        email: "dr.gomez@example.com",
      },
      {
        nombre: "Mariana",
        apellido: "Fernández",
        matricula: "MN-77889",
        jurisdiccion: "NACIONAL",
        especialidad: "Pediatría",
        telefono: "261-420-3344",
        email: "dra.fernandez@example.com",
      },
    ];

    for (const med of MEDICOS) {
      const existingMed = await client.query<{ id: string }>(
        `SELECT id FROM fsj.medico
         WHERE tenant_id = $1 AND matricula = $2 AND matricula_jurisdiccion = $3::fsj.jurisdiccion_matricula`,
        [tenantId, med.matricula, med.jurisdiccion],
      );
      if (existingMed.rows.length === 0) {
        await client.query(
          `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula, matricula_jurisdiccion, especialidad, telefono, email)
           VALUES ($1, $2, $3, $4, $5::fsj.jurisdiccion_matricula, $6, $7, $8)`,
          [tenantId, med.nombre, med.apellido, med.matricula, med.jurisdiccion, med.especialidad, med.telefono, med.email],
        );
      } else {
        await client.query(
          `UPDATE fsj.medico
           SET nombre = $1, apellido = $2, especialidad = $3, telefono = $4, email = $5, fecha_baja = NULL, motivo_baja = NULL
           WHERE id = $6 AND tenant_id = $7`,
          [med.nombre, med.apellido, med.especialidad, med.telefono, med.email, existingMed.rows[0]!.id, tenantId],
        );
      }
    }

    // ------------------------------------------------------------------------
    // 6. Pacientes
    // ------------------------------------------------------------------------
    const PACIENTES = [
      {
        nombre: "Sofía",
        apellido: "Martínez",
        dni: "40123456",
        cuil: "27401234568",
        fechaNacimiento: "1997-03-15",
        telefono: "261-611-2233",
        email: "sofia.martinez@example.com",
        domicilio: "Calle Las Heras 450, Ciudad, Mendoza",
        sexo: "F",
        whatsapp: true,
      },
      {
        nombre: "Lucas",
        apellido: "Benítez",
        dni: "35987654",
        cuil: "20359876549",
        fechaNacimiento: "1990-08-22",
        telefono: "261-644-5566",
        email: "lucas.benitez@example.com",
        domicilio: "Av. Colón 780, Godoy Cruz, Mendoza",
        sexo: "M",
        whatsapp: false,
      },
    ];

    for (const pac of PACIENTES) {
      const existingPac = await client.query<{ id: string }>(
        `SELECT id FROM fsj.paciente WHERE tenant_id = $1 AND dni = $2`,
        [tenantId, pac.dni],
      );
      if (existingPac.rows.length === 0) {
        await client.query(
          `INSERT INTO fsj.paciente (
            tenant_id, nombre, apellido, dni, cuil, fecha_nacimiento, telefono, email, domicilio, sexo, acepta_recordatorios_whatsapp
          )
          VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11)`,
          [
            tenantId,
            pac.nombre,
            pac.apellido,
            pac.dni,
            pac.cuil,
            pac.fechaNacimiento,
            pac.telefono,
            pac.email,
            pac.domicilio,
            pac.sexo,
            pac.whatsapp,
          ],
        );
      } else {
        await client.query(
          `UPDATE fsj.paciente
           SET nombre = $1, apellido = $2, cuil = $3, fecha_nacimiento = $4::date, telefono = $5,
               email = $6, domicilio = $7, sexo = $8, acepta_recordatorios_whatsapp = $9,
               fecha_baja = NULL, motivo_baja = NULL
           WHERE id = $10 AND tenant_id = $11`,
          [
            pac.nombre,
            pac.apellido,
            pac.cuil,
            pac.fechaNacimiento,
            pac.telefono,
            pac.email,
            pac.domicilio,
            pac.sexo,
            pac.whatsapp,
            existingPac.rows[0]!.id,
            tenantId,
          ],
        );
      }
    }

    // ------------------------------------------------------------------------
    // 7. Unidades de Medida
    // ------------------------------------------------------------------------
    const unidadesRes = await client.query<{ id: string; codigo: string }>(
      `SELECT id, codigo FROM fsj.unidad_medida WHERE codigo IN ('GRAMO', 'MILILITRO')`,
    );
    const unidadMap = new Map<string, string>();
    for (const row of unidadesRes.rows) {
      unidadMap.set(row.codigo, row.id);
    }
    const gramoId = unidadMap.get("GRAMO");
    const mililitroId = unidadMap.get("MILILITRO");
    if (!gramoId || !mililitroId) {
      throw new Error("seed: global units GRAMO or MILILITRO were not found in fsj.unidad_medida.");
    }

    // ------------------------------------------------------------------------
    // 8. Drogas, Excipientes, Costos de Proveedor y Partidas con Stock
    // ------------------------------------------------------------------------
    const DROGAS = [
      {
        nombre: "Ibuprofeno",
        unidadBaseId: gramoId,
        esControlada: false,
        tipoControl: "NINGUNO",
        clase: "DROGA",
        stockMinimo: "100.00",
        proveedorCuit: "30998877661",
        costoUnitario: "150.0000",
        lote: "IBU-2026-001",
        cantidadInicial: "500.000",
        fechaVencimiento: "2028-12-31",
        sinonimo: "Ácido isobutilfenilpropiónico",
        sinonimoNorm: "acido isobutilfenilpropionico",
      },
      {
        nombre: "Ácido Salicílico",
        unidadBaseId: gramoId,
        esControlada: false,
        tipoControl: "NINGUNO",
        clase: "DROGA",
        stockMinimo: "50.00",
        proveedorCuit: "30998877662",
        costoUnitario: "85.0000",
        lote: "SAL-2026-001",
        cantidadInicial: "250.000",
        fechaVencimiento: "2028-12-31",
        sinonimo: null,
        sinonimoNorm: null,
      },
      {
        nombre: "Vaselina Sólida",
        unidadBaseId: gramoId,
        esControlada: false,
        tipoControl: "NINGUNO",
        clase: "EXCIPIENTE",
        stockMinimo: "500.00",
        proveedorCuit: "30998877661",
        costoUnitario: "25.0000",
        lote: "VAS-2026-001",
        cantidadInicial: "2000.000",
        fechaVencimiento: "2029-06-30",
        sinonimo: null,
        sinonimoNorm: null,
      },
      {
        nombre: "Alcohol 96%",
        unidadBaseId: mililitroId,
        esControlada: false,
        tipoControl: "NINGUNO",
        clase: "EXCIPIENTE",
        stockMinimo: "1000.00",
        proveedorCuit: "30998877662",
        costoUnitario: "18.0000",
        lote: "ALC-2026-001",
        cantidadInicial: "5000.000",
        fechaVencimiento: "2029-12-31",
        sinonimo: null,
        sinonimoNorm: null,
      },
      {
        nombre: "Clonazepam",
        unidadBaseId: gramoId,
        esControlada: true,
        tipoControl: "PSICOTROPICO",
        clase: "DROGA",
        stockMinimo: "10.00",
        proveedorCuit: "30998877661",
        costoUnitario: "450.0000",
        lote: "CLO-2026-001",
        cantidadInicial: "50.000",
        fechaVencimiento: "2028-12-31",
        sinonimo: null,
        sinonimoNorm: null,
      },
    ];

    for (const d of DROGAS) {
      let drogaId: string;
      const existingDroga = await client.query<{ id: string }>(
        `SELECT id FROM fsj.droga WHERE tenant_id = $1 AND nombre = $2::extensions.citext`,
        [tenantId, d.nombre],
      );

      if (existingDroga.rows.length === 0) {
        const drogaRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.droga (
            tenant_id, nombre, unidad_base_id, es_controlada, tipo_control, clase, stock_minimo
          )
          VALUES ($1, $2, $3, $4, $5::fsj.tipo_control, $6::fsj.clase_droga, $7)
          RETURNING id`,
          [tenantId, d.nombre, d.unidadBaseId, d.esControlada, d.tipoControl, d.clase, d.stockMinimo],
        );
        drogaId = drogaRes.rows[0]!.id;
      } else {
        drogaId = existingDroga.rows[0]!.id;
        await client.query(
          `UPDATE fsj.droga
           SET unidad_base_id = $1, es_controlada = $2, tipo_control = $3::fsj.tipo_control,
               clase = $4::fsj.clase_droga, stock_minimo = $5, fecha_baja = NULL, motivo_baja = NULL
           WHERE id = $6 AND tenant_id = $7`,
          [d.unidadBaseId, d.esControlada, d.tipoControl, d.clase, d.stockMinimo, drogaId, tenantId],
        );
      }

      // Synonym / alias
      if (d.sinonimo && d.sinonimoNorm) {
        const existingAlias = await client.query<{ id: string }>(
          `SELECT id FROM fsj.droga_alias WHERE tenant_id = $1 AND alias_normalizado = $2`,
          [tenantId, d.sinonimoNorm],
        );
        if (existingAlias.rows.length === 0) {
          await client.query(
            `INSERT INTO fsj.droga_alias (tenant_id, droga_id, alias_normalizado, texto, creado_por_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [tenantId, drogaId, d.sinonimoNorm, d.sinonimo, sistemaId],
          );
        }
      }

      const provId = proveedorIds[d.proveedorCuit]!;

      // Supplier cost with IVA (costos-proveedor spec R7/R7a): required so recipes can quote prices
      const existingCosto = await client.query<{ id: string }>(
        `SELECT id FROM fsj.costo_proveedor
         WHERE tenant_id = $1 AND droga_id = $2 AND proveedor_id = $3 AND vigente_hasta IS NULL`,
        [tenantId, drogaId, provId],
      );
      if (existingCosto.rows.length === 0) {
        await client.query(
          `INSERT INTO fsj.costo_proveedor (
            tenant_id, droga_id, proveedor_id, precio_informado, unidad_precio_id,
            costo_unitario, alicuota_iva, precio_informado_con_iva, costo_unitario_con_iva,
            fecha_precio, vigente_desde, vigente_hasta, creado_por_id
          )
          VALUES (
            $1, $2, $3, $4::numeric, $5,
            $6::numeric, $7::numeric, round($4::numeric * (1 + $7::numeric / 100), 6), round($6::numeric * (1 + $7::numeric / 100), 10),
            CURRENT_DATE, now(), NULL, $8
          )`,
          [tenantId, drogaId, provId, d.costoUnitario, d.unidadBaseId, d.costoUnitario, "21", sistemaId],
        );
      }

      // Partida with stock: insert partida and mandatory initial INGRESO_COMPRA movement
      const existingPartida = await client.query<{ id: string }>(
        `SELECT id FROM fsj.partida
         WHERE tenant_id = $1 AND droga_id = $2 AND proveedor_id = $3 AND lote = $4`,
        [tenantId, drogaId, provId, d.lote],
      );
      if (existingPartida.rows.length === 0) {
        const partidaRes = await client.query<{ id: string }>(
          `INSERT INTO fsj.partida (
            tenant_id, droga_id, proveedor_id, lote, costo_unitario,
            cantidad_inicial, fecha_ingreso, fecha_vencimiento, origen
          )
          VALUES ($1, $2, $3, $4, $5, $6, now(), $7::date, 'COMPRA')
          RETURNING id`,
          [tenantId, drogaId, provId, d.lote, d.costoUnitario, d.cantidadInicial, d.fechaVencimiento],
        );
        const partidaId = partidaRes.rows[0]!.id;

        // Triggers trg_movimiento_stock_aplicar (adjusts stock) and trg_partida_ingreso_compra_obligatorio
        // require exactly one initial INGRESO_COMPRA movement matching cantidad_inicial in the same transaction.
        await client.query(
          `INSERT INTO fsj.movimiento_stock (
            tenant_id, partida_id, tipo, cantidad, registrado_por_id
          )
          VALUES ($1, $2, 'INGRESO_COMPRA', $3, $4)`,
          [tenantId, partidaId, d.cantidadInicial, farmaceuticoId],
        );
      }
    }

    // ------------------------------------------------------------------------
    // 9. Regla de precio y tramos de margen (openspec/specs/reglas-precio/spec.md)
    // ------------------------------------------------------------------------
    const existingRegla = await client.query<{ id: string }>(
      `SELECT id FROM fsj.regla_precio WHERE tenant_id = $1 AND vigente_hasta IS NULL`,
      [tenantId],
    );
    if (existingRegla.rows.length === 0) {
      const reglaRes = await client.query<{ id: string }>(
        `INSERT INTO fsj.regla_precio (tenant_id, precio_minimo, vigente_desde, vigente_hasta, creado_por_id)
         VALUES ($1, '5000', now(), NULL, $2)
         RETURNING id`,
        [tenantId, sistemaId],
      );
      const reglaId = reglaRes.rows[0]!.id;

      await client.query(
        `INSERT INTO fsj.regla_precio_tramo (tenant_id, regla_precio_id, orden, costo_hasta, margen)
         VALUES
           ($1, $2, 1, '50000', '100'),
           ($1, $2, 2, NULL, '50')`,
        [tenantId, reglaId],
      );
    }

    await client.query("COMMIT");

    console.log("\nseed: database seeded successfully.");
    console.log(`  Tenant: Farmacia San Jorge S.R.L. (${tenantId})`);
    console.log("  Users ready to log in (password from FSJ_SEED_PASSWORD):");
    console.log(`    - Superadmin:       ${SUPERADMIN_EMAIL}`);
    console.log(`    - Administrador:    ${ADMIN_EMAIL}`);
    console.log(`    - Director Técnico: ${DT_EMAIL} (PIN from FSJ_SEED_PIN)`);
    console.log(`    - Farmacéutico:     ${FARMA_EMAIL} (PIN from FSJ_SEED_PIN)\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  const password = process.env.FSJ_SEED_PASSWORD;
  const pin = process.env.FSJ_SEED_PIN;
  let message = raw;
  if (password) message = message.split(password).join("[REDACTED_PASSWORD]");
  if (pin) message = message.split(pin).join("[REDACTED_PIN]");
  message = message.replace(/postgres(ql)?:\/\/\S+/gi, "[REDACTED_URL]");
  console.error(`seed failed: ${message}`);
  process.exitCode = 1;
});
