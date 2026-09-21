/**
 * DB tests for prisma/migrations/*_0008_partidas_movimientos_stock.
 * See tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/designacion-dt.test.ts for the tenant/sistema/DT seeding
 * pattern reused here.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";

async function insertTenant(tx: Client, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

async function createSistemaUser(tx: Client, tenantId: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
     VALUES ($1, $2, $3, 'Sistema', 'Tecnico', $4, 'ACTIVO', true, $1)`,
    [id, tenantId, `sistema+${id}@internal.local`, `SISTEMA-${id}`],
  );
  const sistemaRol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'SISTEMA'`);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
    tenantId,
    id,
    sistemaRol.rows[0].id,
  ]);
  return id;
}

async function createUserWithRole(tx: Client, tenantId: string, rolCodigo: string, sistema: string, suffix: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5)`,
    [id, tenantId, `${suffix}-${Date.now()}@example.com`, `DNI-${suffix}-${Date.now()}`, sistema],
  );
  const rol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = $1`, [rolCodigo]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    rol.rows[0].id,
    sistema,
  ]);
  return id;
}

async function designarDtVigente(tx: Client, tenantId: string, usuarioId: string, registradoPorId: string): Promise<void> {
  await tx.query(
    `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
     VALUES ($1, $2, 'TITULAR', $3, current_date - interval '1 day', $4)`,
    [tenantId, usuarioId, `MAT-${randomUUID()}`, registradoPorId],
  );
}

async function insertUnidad(tx: Client, suffix: string): Promise<string> {
  const codigo = `TEST-UM-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const result = await tx.query(
    `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
     VALUES ($1, $1, 'x', 'MASA', 1, false) RETURNING id`,
    [codigo],
  );
  return result.rows[0].id as string;
}

async function insertDroga(tx: Client, tenantId: string, unidadId: string): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, `Droga-${randomUUID()}`, unidadId],
  );
  return result.rows[0].id as string;
}

async function insertProveedor(tx: Client, tenantId: string): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'Prov', $2) RETURNING id`,
    [tenantId, `2${Math.floor(10000000000 + Math.random() * 8999999999)}`.slice(0, 11)],
  );
  return result.rows[0].id as string;
}

interface CrearPartidaInput {
  tenantId: string;
  drogaId: string;
  proveedorId: string;
  registradoPorId: string;
  cantidadInicial: number;
  fechaVencimiento: string; // 'YYYY-MM-DD'
  lote?: string;
}

/** Inserts a partida (cantidad_disponible defaults to 0) + its mandatory INGRESO_COMPRA, atomically. */
async function crearPartidaConIngreso(tx: Client, input: CrearPartidaInput): Promise<string> {
  const partida = await tx.query(
    `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
     VALUES ($1, $2, $3, $4, 10, $5, $6) RETURNING id`,
    [input.tenantId, input.drogaId, input.proveedorId, input.lote ?? `LOTE-${randomUUID()}`, input.cantidadInicial, input.fechaVencimiento],
  );
  const partidaId = partida.rows[0].id as string;

  await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
     VALUES ($1, $2, 'INGRESO_COMPRA', $3, $4)`,
    [input.tenantId, partidaId, input.cantidadInicial, input.registradoPorId],
  );

  return partidaId;
}

async function cantidadDisponible(tx: Client, partidaId: string): Promise<number> {
  const result = await tx.query(`SELECT cantidad_disponible FROM fsj.partida WHERE id = $1`, [partidaId]);
  return Number(result.rows[0].cantidad_disponible);
}

/**
 * Builds the minimal chain (paciente/medico/receta/item/componente/ficha/
 * linea/preparacion) needed to get a REAL preparacion id, now that
 * migration 0013 adds movimiento_stock.preparacion_id's composite FK
 * (previously unconstrained since 0008 -- see that migration's header).
 * `drogaId`/`unidadId` are reused from the caller's own partida setup so
 * this stays a single extra round-trip chain, not a second droga.
 */
async function insertPreparacionParaEgreso(
  tx: Client,
  tenantId: string,
  drogaId: string,
  unidadId: string,
  sistema: string,
): Promise<{ preparacionId: string; lineaPesajeId: string }> {
  const paciente = await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'P', 'A') RETURNING id`, [
    tenantId,
  ]);
  const medico = await tx.query(
    `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'M', 'D', $2) RETURNING id`,
    [tenantId, `MAT-${randomUUID()}`],
  );
  const receta = await tx.query(
    `INSERT INTO fsj.receta (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id)
     VALUES ($1, $2, $3, current_date, 'PRESENCIAL', $4) RETURNING id`,
    [tenantId, paciente.rows[0].id, medico.rows[0].id, sistema],
  );
  const item = await tx.query(
    `INSERT INTO fsj.item_receta (tenant_id, receta_id, forma_farmaceutica, cantidad_unidades) VALUES ($1, $2, 'CREMA', 1) RETURNING id`,
    [tenantId, receta.rows[0].id],
  );
  await tx.query(
    `INSERT INTO fsj.componente_item_receta (tenant_id, item_receta_id, droga_id, unidad_medida_id, modo_expresion, orden)
     VALUES ($1, $2, $3, $4, 'CS', 0)`,
    [tenantId, item.rows[0].id, drogaId, unidadId],
  );
  const ficha = await tx.query(
    `INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id) VALUES ($1, $2, 1, $3) RETURNING id`,
    [tenantId, item.rows[0].id, sistema],
  );
  const linea = await tx.query(
    `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, orden)
     VALUES ($1, $2, $3, 'D', 1, 1, $4, 0) RETURNING id`,
    [tenantId, ficha.rows[0].id, drogaId, unidadId],
  );
  const preparacion = await tx.query(
    `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, ficha.rows[0].id, sistema],
  );
  // NOTE: migration 0014 adds movimiento_stock.linea_pesaje_id, REQUIRED
  // (CHECK, immediate) for every EGRESO_PREPARACION -- callers must pass
  // lineaPesajeId on every such INSERT from here on. The matching
  // SUM(egresos) = cantidad_a_pesar deferred check (INV-S12) never fires
  // in these tests since inRollbackTx always ROLLBACKs before COMMIT.
  return { preparacionId: preparacion.rows[0].id as string, lineaPesajeId: linea.rows[0].id as string };
}

const FUTURO = "2099-12-31";
const PASADO = "2000-01-01";

describe.skipIf(dbTestSkipReason() !== null)("0008_partidas_movimientos_stock migration (fsj schema)", () => {
  it("partida creation is atomic: INSERT + mandatory INGRESO_COMPRA raises cantidad_disponible to cantidad_inicial", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "crea");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "crea");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);

        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 100,
          fechaVencimiento: FUTURO,
        });

        expect(await cantidadDisponible(tx, partidaId)).toBe(100);
      }),
    );
  });

  it("a partida without its mandatory INGRESO_COMPRA fails at COMMIT (INV-STK-002, deferred constraint trigger)", async () => {
    await asOwner((client) =>
      inRollbackTx(
        client,
        async (tx) => {
          const tenantId = await insertTenant(tx, "sinIngreso");
          const unidadId = await insertUnidad(tx, "sinIngreso");
          const drogaId = await insertDroga(tx, tenantId, unidadId);
          const proveedorId = await insertProveedor(tx, tenantId);

          await expectInvariantViolation(
            tx,
            () =>
              tx.query(
                `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
                 VALUES ($1, $2, $3, 'LOTE-X', 10, 100, $4)`,
                [tenantId, drogaId, proveedorId, FUTURO],
              ),
            "INV-STK-002",
          );
        },
        { setConstraintsImmediate: true },
      ),
    );
  });

  it("direct UPDATE of partida.cantidad_disponible is rejected, even for fsj_owner (INV-S01/S04)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "directupd");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "directupd");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 50,
          fechaVencimiento: FUTURO,
        });

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.partida SET cantidad_disponible = 999 WHERE id = $1`, [partidaId]),
          "INV-S01",
        );
      }),
    );
  });

  it("fsj_app has no UPDATE grant on cantidad_disponible at all (defense in depth)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "grantcheck");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "grantcheck");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 50,
          fechaVencimiento: FUTURO,
        });

        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.partida SET cantidad_disponible = 1 WHERE id = $1`, [partidaId]),
          "42501",
        );
      }),
    );
  });

  it("INV-S02: an EGRESO_PREPARACION larger than the available balance is rejected (never goes negative)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "negativo");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "negativo");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        const { preparacionId, lineaPesajeId } = await insertPreparacionParaEgreso(tx, tenantId, drogaId, unidadId, sistema);

        // Savepoint-wrapped (via expectDbRejection) so the balance check
        // below still runs -- see the aborted-transaction rule in
        // tests/db/helpers.ts.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
               VALUES ($1, $2, 'EGRESO_PREPARACION', 20, $3, $4, $5)`,
              [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
            ),
          "23514",
        );

        expect(await cantidadDisponible(tx, partidaId)).toBe(10);
      }),
    );
  });

  it("INV-S03: cantidad_disponible can never exceed cantidad_inicial (a second INGRESO_COMPRA overflowing it is rejected)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "overflow");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "overflow");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
               VALUES ($1, $2, 'INGRESO_COMPRA', 1, $3)`,
              [tenantId, partidaId, sistema],
            ),
          "23514",
        );
      }),
    );
  });

  it("INV-S06: movimiento_stock rows are never updated or deleted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "inmutable");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "inmutable");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });
        const movimiento = await tx.query(
          `SELECT id FROM fsj.movimiento_stock WHERE partida_id = $1 AND tipo = 'INGRESO_COMPRA'`,
          [partidaId],
        );
        const movimientoId = movimiento.rows[0].id as string;

        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.movimiento_stock SET cantidad = 1 WHERE id = $1`, [movimientoId]),
          "INV-IMMUTABLE",
        );
      }),
    );
  });

  it("INV-S06 (DELETE): movimiento_stock rows are never deleted", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "inmutabledel");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "inmutabledel");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });
        const movimiento = await tx.query(
          `SELECT id FROM fsj.movimiento_stock WHERE partida_id = $1 AND tipo = 'INGRESO_COMPRA'`,
          [partidaId],
        );

        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.movimiento_stock WHERE id = $1`, [movimiento.rows[0].id]),
          "INV-IMMUTABLE",
        );
      }),
    );
  });

  it("INV-S07: movimiento cantidad must be > 0", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "cant0");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "cant0");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, registrado_por_id)
               VALUES ($1, $2, 'EGRESO_PREPARACION', 0, $3, $4)`,
              [tenantId, partidaId, randomUUID(), sistema],
            ),
          "23514",
        );
      }),
    );
  });

  it("INV-S08: AJUSTE without motivo_ajuste or autorizado_por_id is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ajustesinmotivo");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "ajustesinmotivo");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "ajustesinmotivo");
        await designarDtVigente(tx, tenantId, dt, sistema);

        // Each is savepoint-wrapped (via expectDbRejection) so the second
        // insert genuinely re-exercises the check constraint (missing
        // autorizado_por_id this time) instead of riding the first
        // insert's aborted transaction.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, autorizado_por_id)
               VALUES ($1, $2, 'AJUSTE', 1, $3, $4)`,
              [tenantId, partidaId, sistema, dt],
            ),
          "23514",
        );

        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, registrado_por_id)
               VALUES ($1, $2, 'AJUSTE', 1, 'ROTURA', $3)`,
              [tenantId, partidaId, sistema],
            ),
          "23514",
        );
      }),
    );
  });

  it("INV-U05: AJUSTE authorized by a user WITHOUT a vigente DT designation is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ajustenodt");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "ajustenodt");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });
        const farmaceutico = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "ajustenodt");

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, registrado_por_id, autorizado_por_id)
               VALUES ($1, $2, 'AJUSTE', 1, 'ROTURA', $3, $4)`,
              [tenantId, partidaId, sistema, farmaceutico],
            ),
          "INV-U05",
        );
      }),
    );
  });

  it("INV-U05: AJUSTE authorized by a vigente DT succeeds, and DP-21b: AJUSTE always subtracts", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "ajusteok");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "ajusteok");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 100,
          fechaVencimiento: FUTURO,
        });
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "ajusteok");
        await designarDtVigente(tx, tenantId, dt, sistema);

        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, registrado_por_id, autorizado_por_id)
           VALUES ($1, $2, 'AJUSTE', 30, 'DIFERENCIA_ARQUEO', $3, $4)`,
          [tenantId, partidaId, sistema, dt],
        );

        // 100 - 30 = 70: the AJUSTE SUBTRACTED, never added (DP-21b).
        expect(await cantidadDisponible(tx, partidaId)).toBe(70);
      }),
    );
  });

  it("INV-S09: EGRESO_PREPARACION without preparacion_id is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "sinprep");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "sinprep");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id)
               VALUES ($1, $2, 'EGRESO_PREPARACION', 1, $3)`,
              [tenantId, partidaId, sistema],
            ),
          "23514",
        );
      }),
    );
  });

  it("INV-S10: EGRESO_PREPARACION against an expired partida is rejected (DB-level reinforcement)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "vencida");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "vencida");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: PASADO,
        });

        const { preparacionId, lineaPesajeId } = await insertPreparacionParaEgreso(tx, tenantId, drogaId, unidadId, sistema);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
               VALUES ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, $5)`,
              [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
            ),
          "INV-S10",
        );
      }),
    );
  });

  it("INV-S16/S17: fecha_apertura is set on the first EGRESO_PREPARACION and never reverts or changes again", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "apertura");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "apertura");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        const { preparacionId, lineaPesajeId } = await insertPreparacionParaEgreso(tx, tenantId, drogaId, unidadId, sistema);

        const before = await tx.query(`SELECT fecha_apertura FROM fsj.partida WHERE id = $1`, [partidaId]);
        expect(before.rows[0].fecha_apertura).toBeNull();

        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, $5)`,
          [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
        );

        const afterFirst = await tx.query(`SELECT fecha_apertura FROM fsj.partida WHERE id = $1`, [partidaId]);
        expect(afterFirst.rows[0].fecha_apertura).not.toBeNull();
        const firstFechaApertura = afterFirst.rows[0].fecha_apertura;

        // A second EGRESO_PREPARACION must NOT change fecha_apertura again.
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 1, $3, $4, $5)`,
          [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
        );
        const afterSecond = await tx.query(`SELECT fecha_apertura FROM fsj.partida WHERE id = $1`, [partidaId]);
        expect(afterSecond.rows[0].fecha_apertura).toEqual(firstFechaApertura);

        // A direct attempt to null it back out (or change it) is rejected.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.partida SET fecha_apertura = NULL WHERE id = $1`, [partidaId]),
          "INV-S17",
        );
      }),
    );
  });

  it("cross-tenant isolation: fsj_app under tenant A never sees tenant B's partida/movimiento_stock rows", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "isoA");
        const tenantB = await insertTenant(tx, "isoB");
        const sistemaB = await createSistemaUser(tx, tenantB);
        const unidadId = await insertUnidad(tx, "iso");
        const drogaB = await insertDroga(tx, tenantB, unidadId);
        const proveedorB = await insertProveedor(tx, tenantB);
        await crearPartidaConIngreso(tx, {
          tenantId: tenantB,
          drogaId: drogaB,
          proveedorId: proveedorB,
          registradoPorId: sistemaB,
          cantidadInicial: 10,
          fechaVencimiento: FUTURO,
        });

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantA, async (c) => {
          const partidas = await c.query(`SELECT * FROM fsj.partida`);
          const movimientos = await c.query(`SELECT * FROM fsj.movimiento_stock`);
          expect(partidas.rows).toHaveLength(0);
          expect(movimientos.rows).toHaveLength(0);
        });
      }),
    );
  });

  it("fsj.v_stock_droga: sums cantidad_disponible over non-expired partidas only", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "vista");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "vista");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);

        await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 40,
          fechaVencimiento: FUTURO,
        });
        await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 999,
          fechaVencimiento: PASADO, // expired -- must NOT count
        });

        const result = await tx.query(`SELECT stock_disponible FROM fsj.v_stock_droga WHERE droga_id = $1`, [drogaId]);
        expect(Number(result.rows[0].stock_disponible)).toBe(40);
      }),
    );
  });

  it("property: balance = cantidad_inicial - sum(egresos) - sum(ajustes) after a mixed sequence of movements", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "propiedad");
        const sistema = await createSistemaUser(tx, tenantId);
        const unidadId = await insertUnidad(tx, "propiedad");
        const drogaId = await insertDroga(tx, tenantId, unidadId);
        const proveedorId = await insertProveedor(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "propiedad");
        await designarDtVigente(tx, tenantId, dt, sistema);

        const partidaId = await crearPartidaConIngreso(tx, {
          tenantId,
          drogaId,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 100,
          fechaVencimiento: FUTURO,
        });

        const { preparacionId, lineaPesajeId } = await insertPreparacionParaEgreso(tx, tenantId, drogaId, unidadId, sistema);

        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 15, $3, $4, $5)`,
          [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
        );
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, motivo_ajuste, registrado_por_id, autorizado_por_id)
           VALUES ($1, $2, 'AJUSTE', 5, 'ROTURA', $3, $4)`,
          [tenantId, partidaId, sistema, dt],
        );
        await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 10, $3, $4, $5)`,
          [tenantId, partidaId, preparacionId, lineaPesajeId, sistema],
        );

        // 100 - 15 - 5 - 10 = 70
        expect(await cantidadDisponible(tx, partidaId)).toBe(70);
      }),
    );
  });
});
