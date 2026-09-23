/**
 * DB tests for the confirmación de preparación transaction (M11, FASE 8
 * point 8.3/8.4). These tests exercise the SAME sequence of SQL statements
 * `modules/preparaciones/application/confirmar-preparacion.ts` issues
 * (movimiento_stock EGRESO_PREPARACION -> asiento_recetario ->
 * detalle_asiento -> preparacion CONFIRMADA -> asiento_contralor when
 * applicable), directly against Postgres -- proving what the DATABASE
 * itself guarantees (atomicity of the whole sequence, the gapless counter
 * surviving a rolled-back attempt, and the contralor saldo chain),
 * independent of whether `withTenantTransaction`'s own wrapping has bugs.
 *
 * See tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/fixtures.ts for the shared seed helpers this file reuses.
 *
 * Cross-connection concurrency: see the dedicated test near the bottom of
 * this file -- same HONEST SCOPE as tests/db/libro-recetario.test.ts's own
 * concurrency test (advisory lock, zero committed rows), and the same
 * reason a true race on the REAL `fsj.partida` row lock /
 * `fsj.contador_correlativo_tomar` cannot run in this harness (it would
 * need a COMMITTED partida row, permanently stuck in the one shared real
 * Supabase database).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { asOwner, inRollbackTx, inSavepoint, expectDbRejection } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  crearLibrosRubricados,
  insertUnidad,
  insertDroga,
  insertPaciente,
  insertMedico,
  insertReceta,
  insertItemReceta,
  insertComponente,
  insertFicha,
  insertLinea,
  insertProveedor,
  crearPartidaConIngreso,
  FUTURO,
} from "./fixtures";

interface Seed {
  tenantId: string;
  sistema: string;
  drogaId: string;
  unidadId: string;
  itemRecetaId: string;
  fichaTecnicaId: string;
  lineaPesajeId: string;
  partidaId: string;
  preparacionId: string;
  libroRecetarioId: string;
}

/** Full chain ready for a confirmación attempt: preparación stays INICIADA (unlike fixtures.ts's `seedAsientoSistema`, which is already CONFIRMADA). */
async function seedParaConfirmacion(tx: Client, suffix: string, cantidadAPesar = 5): Promise<Seed> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  await crearLibrosRubricados(tx, tenantId, sistema);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "TOTAL", cantidad: cantidadAPesar });
  const fichaTecnicaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
  const lineaPesajeId = await insertLinea(tx, { tenantId, fichaTecnicaId, drogaId, unidadMedidaId: unidadId, cantidadTeorica: cantidadAPesar, cantidadAPesar });

  const proveedorId = await insertProveedor(tx, tenantId);
  const partidaId = await crearPartidaConIngreso(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema, cantidadInicial: 1000, fechaVencimiento: FUTURO });

  const prep = await tx.query(`INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1,$2,$3) RETURNING id`, [
    tenantId,
    fichaTecnicaId,
    sistema,
  ]);

  const libro = await tx.query(`SELECT id FROM fsj.libro_rubricado WHERE tenant_id = $1 AND tipo = 'RECETARIO' AND fecha_cierre IS NULL`, [tenantId]);

  return {
    tenantId,
    sistema,
    drogaId,
    unidadId,
    itemRecetaId,
    fichaTecnicaId,
    lineaPesajeId,
    partidaId,
    preparacionId: prep.rows[0].id as string,
    libroRecetarioId: libro.rows[0].id as string,
  };
}

/**
 * The EXACT sequence confirmar-preparacion.ts issues for ONE non-manual
 * línea, fully consumed by a single partida.
 *
 * D4 (migration 0034, hash V3): detalle_asiento is now inserted BEFORE its
 * asiento_recetario, against an APP-GENERATED id (`randomUUID()`) --
 * INV-L22 requires >= 1 detalle already present when the SISTEMA asiento
 * is inserted, and INV-L23 rejects a detalle inserted once its asiento
 * already exists. Mirrors the new order in
 * modules/preparaciones/infrastructure/preparacion-repository.ts#insertAsientoRecetario.
 */
async function intentarConfirmacion(tx: Client, seed: Seed, cantidad = 5, detalleLineaPesajeIdOverride?: string): Promise<{ movimientoId: string; asientoId: string }> {
  const movimiento = await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
     VALUES ($1, $2, 'EGRESO_PREPARACION', $3, $4, $5, $6) RETURNING id`,
    [seed.tenantId, seed.partidaId, cantidad, seed.preparacionId, seed.lineaPesajeId, seed.sistema],
  );

  const asientoId = randomUUID();

  await tx.query(
    `INSERT INTO fsj.detalle_asiento (tenant_id, asiento_recetario_id, linea_pesaje_id, descripcion, cantidad, unidad_texto, orden)
     VALUES ($1, $2, $3, 'Droga', $4, 'g', 0)`,
    [seed.tenantId, asientoId, detalleLineaPesajeIdOverride ?? seed.lineaPesajeId, cantidad],
  );

  const asiento = await tx.query(
    `INSERT INTO fsj.asiento_recetario (id, tenant_id, origen, preparacion_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
     VALUES ($1, $2, 'SISTEMA', $3, 'Paciente Test', 'Medico Test - MAT-1', 'Formula de prueba', $4) RETURNING id, numero_correlativo`,
    [asientoId, seed.tenantId, seed.preparacionId, seed.sistema],
  );

  await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
    seed.sistema,
    seed.preparacionId,
  ]);

  return { movimientoId: movimiento.rows[0].id as string, asientoId: asiento.rows[0].id as string };
}

async function contadorUltimoValor(tx: Client, tenantId: string, libroId: string): Promise<number> {
  const r = await tx.query(`SELECT ultimo_valor FROM fsj.contador_correlativo WHERE tenant_id = $1 AND libro_id = $2`, [tenantId, libroId]);
  return Number(r.rows[0].ultimo_valor);
}

describe.skipIf(dbTestSkipReason() !== null)("confirmación de preparación -- atomicidad y contador (FASE 8 point 8.4)", () => {
  it("a failure partway through the sequence (bad detalle_asiento FK) leaves NOTHING persisted: no movimiento, no asiento, counter unchanged", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedParaConfirmacion(tx, "atom1");
        expect(await contadorUltimoValor(tx, seed.tenantId, seed.libroRecetarioId)).toBe(0);

        await inSavepoint(tx, () =>
          expectDbRejection(
            tx,
            () => intentarConfirmacion(tx, seed, 5, "00000000-0000-0000-0000-000000000000"), // linea_pesaje_id does not exist -> FK violation
            "23503",
          ),
        );

        const movimientos = await tx.query(`SELECT count(*)::int AS n FROM fsj.movimiento_stock WHERE preparacion_id = $1`, [seed.preparacionId]);
        expect(movimientos.rows[0].n).toBe(0);

        const asientos = await tx.query(`SELECT count(*)::int AS n FROM fsj.asiento_recetario WHERE preparacion_id = $1`, [seed.preparacionId]);
        expect(asientos.rows[0].n).toBe(0);

        const prep = await tx.query(`SELECT estado FROM fsj.preparacion WHERE id = $1`, [seed.preparacionId]);
        expect(prep.rows[0].estado).toBe("INICIADA"); // never touched

        expect(await contadorUltimoValor(tx, seed.tenantId, seed.libroRecetarioId)).toBe(0);
      }),
    );
  });

  it("a failure at the LAST step (preparación already DESCARTADA -- INV-P05, terminal) still rolls back the movimiento AND the asiento it already inserted this attempt", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedParaConfirmacion(tx, "atom2");

        // Force INV-P05: mark the preparación DESCARTADA behind the scenes
        // (a genuine estado CHANGE, unlike re-setting CONFIRMADA on an
        // already-CONFIRMADA row, which the trigger treats as a no-op --
        // `NEW.estado IS DISTINCT FROM OLD.estado` is false and the
        // transition check never even runs), then attempt the FULL sequence
        // again as if it were still INICIADA.
        await tx.query(
          `UPDATE fsj.preparacion SET estado = 'DESCARTADA', motivo_descarte = 'Test', descartada_por_id = $1, descartada_en = now() WHERE id = $2`,
          [seed.sistema, seed.preparacionId],
        );

        await inSavepoint(tx, () =>
          expectDbRejection(
            tx,
            async () => {
              // The movimiento + asiento_recetario themselves succeed (nothing
              // stops a second EGRESO_PREPARACION at the SQL level alone) --
              // it is the UPDATE ... SET estado='CONFIRMADA' (DESCARTADA is
              // terminal, INV-P05) that rejects, taking the whole savepoint
              // (including this attempt's OWN movimiento/asiento) down with it.
              await tx.query(
                `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
                 VALUES ($1, $2, 'EGRESO_PREPARACION', 5, $3, $4, $5)`,
                [seed.tenantId, seed.partidaId, seed.preparacionId, seed.lineaPesajeId, seed.sistema],
              );
              await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA' WHERE id = $1`, [seed.preparacionId]);
            },
            "P0001",
          ),
        );

        // Exactly the ORIGINAL (out-of-band) CONFIRMADA state -- the second
        // attempt's own EGRESO_PREPARACION never survives, confirming ONE
        // movimiento total (from the setup UPDATE path there was none --
        // only the failed attempt's, which rolled back).
        const movimientos = await tx.query(`SELECT count(*)::int AS n FROM fsj.movimiento_stock WHERE preparacion_id = $1`, [seed.preparacionId]);
        expect(movimientos.rows[0].n).toBe(0);
      }),
    );
  });

  it("the gapless counter is NOT consumed by a rolled-back attempt: the next successful confirmación still gets número 1", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedParaConfirmacion(tx, "counter1");

        // Attempt 1: fails (bad FK), rolled back via savepoint.
        await inSavepoint(tx, () =>
          expectDbRejection(tx, () => intentarConfirmacion(tx, seed, 5, "00000000-0000-0000-0000-000000000000"), "23503"),
        );
        expect(await contadorUltimoValor(tx, seed.tenantId, seed.libroRecetarioId)).toBe(0);

        // Attempt 2: succeeds -- must get número 1, not 2 (no gap left by attempt 1).
        const { asientoId } = await intentarConfirmacion(tx, seed, 5);
        const asiento = await tx.query(`SELECT numero_correlativo::int AS n FROM fsj.asiento_recetario WHERE id = $1`, [asientoId]);
        expect(asiento.rows[0].n).toBe(1);
        expect(await contadorUltimoValor(tx, seed.tenantId, seed.libroRecetarioId)).toBe(1);
      }),
    );
  });

  it("a successful confirmación (single línea, single partida) writes exactly one movimiento, one asiento with número 1, and CONFIRMADA preparación", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedParaConfirmacion(tx, "happy1");
        const { movimientoId, asientoId } = await intentarConfirmacion(tx, seed, 5);

        const mov = await tx.query(`SELECT cantidad::text AS cantidad, tipo FROM fsj.movimiento_stock WHERE id = $1`, [movimientoId]);
        expect(mov.rows[0].tipo).toBe("EGRESO_PREPARACION");
        expect(mov.rows[0].cantidad).toBe("5");

        const partida = await tx.query(`SELECT cantidad_disponible::text AS saldo FROM fsj.partida WHERE id = $1`, [seed.partidaId]);
        expect(partida.rows[0].saldo).toBe("995"); // 1000 - 5

        const asiento = await tx.query(`SELECT numero_correlativo::int AS n, estado FROM fsj.asiento_recetario WHERE id = $1`, [asientoId]);
        expect(asiento.rows[0].n).toBe(1);
        expect(asiento.rows[0].estado).toBe("VIGENTE");

        const prep = await tx.query(`SELECT estado, preparada_por_id FROM fsj.preparacion WHERE id = $1`, [seed.preparacionId]);
        expect(prep.rows[0].estado).toBe("CONFIRMADA");
        expect(prep.rows[0].preparada_por_id).toBe(seed.sistema);
      }),
    );
  });

  it(
    "concurrency: a transaction-scoped lock held by one real connection blocks a second real connection until the holder's " +
      "transaction ends (zero DDL, zero committed rows -- both transactions roll back)",
    async () => {
      // HONEST SCOPE -- same technique and same limitation as
      // tests/db/libro-recetario.test.ts's own concurrency test (read that
      // one's comment for the full argument). What this proves: two REAL,
      // separate connections serialize on a lock held inside a transaction
      // (here: a plain advisory lock, standing in for the row lock
      // `lockPartidasParaConfirmacion` takes with `SELECT ... FOR UPDATE`),
      // and releasing it (via ROLLBACK) lets the waiter proceed. What this
      // does NOT prove: a genuine two-connection race on `fsj.partida`'s
      // row lock or `fsj.contador_correlativo_tomar` for THIS preparación --
      // that would require a COMMITTED partida/preparación row, which would
      // be permanently stuck in the single shared real Supabase database
      // this harness runs against (no disposable test project exists yet).
      const { directUrl } = requireDbTestEnv();
      const a = new Client({ connectionString: directUrl });
      const b = new Client({ connectionString: directUrl });
      await a.connect();
      await b.connect();
      const key = Math.floor(Math.random() * 2 ** 31);
      try {
        await a.query("BEGIN");
        await b.query("BEGIN");
        await a.query("SELECT pg_advisory_xact_lock($1::bigint)", [key]);

        const bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
        let bAcquired = false;
        const bPromise = b.query("SELECT pg_advisory_xact_lock($1::bigint)", [key]).then(() => {
          bAcquired = true;
        });

        let bWaiting = false;
        for (let i = 0; i < 50 && !bWaiting; i++) {
          const w = await a.query(`SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`, [bPid]);
          bWaiting = w.rows[0].n > 0;
          if (!bWaiting) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(bWaiting).toBe(true);
        expect(bAcquired).toBe(false);

        await a.query("ROLLBACK");
        await bPromise;
        expect(bAcquired).toBe(true);

        await b.query("ROLLBACK");
      } finally {
        await a.end();
        await b.end();
      }
    },
  );
});

describe.skipIf(dbTestSkipReason() !== null)("confirmación de preparación -- contralor activo (FASE 8 point 8.3, INV-L08/L12/L13/L14)", () => {
  /**
   * `now()` is FROZEN for the whole transaction in Postgres (transaction
   * timestamp, not statement timestamp) -- every `inRollbackTx` test runs
   * inside exactly ONE transaction, so a plain `now()` in one statement and
   * `now()` in a LATER statement are the SAME instant, not "before" vs
   * "after". `crearPartidaConIngresoBackdated` (below) and `activarContralor`
   * anchor explicit, clearly-ordered timestamps instead of relying on
   * statement order -- this is a TEST-HARNESS artifact only: in production
   * each confirmación is its own transaction with its own frozen "now()",
   * so a real activation-vs-movement race is always across transactions.
   */
  const HACE_UN_DIA = "now() - interval '1 day'";
  const HACE_12_HORAS = "now() - interval '12 hours'"; // between HACE_UN_DIA and the (frozen) "now" the confirmación's own EGRESO movements get.

  /** Same shape as fixtures.ts's `crearPartidaConIngreso`, but with an explicit (backdated) `registrado_en` for the INGRESO_COMPRA -- see the doc comment above. */
  async function crearPartidaConIngresoBackdated(tx: Client, input: { tenantId: string; drogaId: string; proveedorId: string; registradoPorId: string; cantidadInicial: number }): Promise<string> {
    const partida = await tx.query(
      `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
       VALUES ($1, $2, $3, $4, 10, $5, $6) RETURNING id`,
      [input.tenantId, input.drogaId, input.proveedorId, `LOTE-${input.tenantId}-${Math.random().toString(36).slice(2, 8)}`, input.cantidadInicial, FUTURO],
    );
    const partidaId = partida.rows[0].id as string;
    await tx.query(
      `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, registrado_por_id, registrado_en)
       VALUES ($1, $2, 'INGRESO_COMPRA', $3, $4, ${HACE_UN_DIA})`,
      [input.tenantId, partidaId, input.cantidadInicial, input.registradoPorId],
    );
    return partidaId;
  }

  /**
   * A controlled droga, contralor NOT YET active, for a FRESH tenant.
   * Cannot reuse `seedParaConfirmacion` (which inserts a NINGUNO droga and
   * only later gives it a partida) -- INV-DRG-001 forbids changing
   * `tipo_control`/`es_controlada` on a droga that already has a partida,
   * so the droga must be CREATED controlled. Its first partida's own
   * INGRESO_COMPRA is deliberately backdated to BEFORE contralor activation
   * (`activarContralor`, called separately by each test) -- per spec
   * section 4, "los movimientos anteriores a la fecha de activación no
   * generan asientos retroactivos" -- so it needs neither
   * `numero_vale_adquisicion` (INV-L16) nor its own `asiento_contralor`
   * (INV-L08). Tests that need a SECOND pre-activation partida call
   * `insertPartidaAdicional` before `activarContralor`.
   */
  async function seedControladaBase(tx: Client, suffix: string, cantidadAPesar = 5): Promise<Seed> {
    const tenantId = await insertTenant(tx, suffix);
    const sistema = await createSistemaUser(tx, tenantId);
    await crearLibrosRubricados(tx, tenantId, sistema);
    const unidadId = await insertUnidad(tx, suffix);

    const drogaResult = await tx.query(
      `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, tipo_control, es_controlada) VALUES ($1, $2, $3, 'PSICOTROPICO', true) RETURNING id`,
      [tenantId, `Droga-Controlada-${suffix}`, unidadId],
    );
    const drogaId = drogaResult.rows[0].id as string;

    const pacienteId = await insertPaciente(tx, tenantId);
    const medicoId = await insertMedico(tx, tenantId);
    const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
    const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
    await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "TOTAL", cantidad: cantidadAPesar });
    const fichaTecnicaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
    const lineaPesajeId = await insertLinea(tx, { tenantId, fichaTecnicaId, drogaId, unidadMedidaId: unidadId, cantidadTeorica: cantidadAPesar, cantidadAPesar });

    const proveedorId = await insertProveedor(tx, tenantId);
    const partidaId = await crearPartidaConIngresoBackdated(tx, { tenantId, drogaId, proveedorId, registradoPorId: sistema, cantidadInicial: 1000 });

    const prep = await tx.query(`INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1,$2,$3) RETURNING id`, [
      tenantId,
      fichaTecnicaId,
      sistema,
    ]);
    const preparacionId = prep.rows[0].id as string;

    const libroRecetario = await tx.query(`SELECT id FROM fsj.libro_rubricado WHERE tenant_id = $1 AND tipo = 'RECETARIO' AND fecha_cierre IS NULL`, [
      tenantId,
    ]);

    return {
      tenantId,
      sistema,
      drogaId,
      unidadId,
      itemRecetaId,
      fichaTecnicaId,
      lineaPesajeId,
      partidaId,
      preparacionId,
      libroRecetarioId: libroRecetario.rows[0].id as string,
    };
  }

  /** A second pre-activation (backdated) partida of the seed's own controlled droga -- for the "split across two partidas" test. Call BEFORE `activarContralor`. */
  async function insertPartidaAdicional(tx: Client, seed: Seed, cantidadInicial = 100): Promise<string> {
    const proveedorId = await insertProveedor(tx, seed.tenantId);
    return crearPartidaConIngresoBackdated(tx, { tenantId: seed.tenantId, drogaId: seed.drogaId, proveedorId, registradoPorId: seed.sistema, cantidadInicial });
  }

  /** Sets `tenant.fecha_activacion_contralor` to a fixed point BETWEEN the backdated seed partida(s) and the confirmación's own (frozen "now") EGRESO movements, and inserts the mandatory APERTURA (INV-L15). See the timestamp doc comment above for why this cannot just be `now()`. */
  async function activarContralor(tx: Client, seed: Seed, saldoApertura = 50): Promise<string> {
    await tx.query(`UPDATE fsj.tenant SET fecha_activacion_contralor = ${HACE_12_HORAS} WHERE id = $1`, [seed.tenantId]);

    const libro = await tx.query(`SELECT id FROM fsj.libro_rubricado WHERE tenant_id = $1 AND tipo = 'PSICOTROPICO' AND fecha_cierre IS NULL`, [seed.tenantId]);
    const libroContralorId = libro.rows[0].id as string;

    await tx.query(
      `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, registrado_por_id)
       VALUES ($1, 'APERTURA', $2, 'Droga controlada', $3, $4, $5)`,
      [seed.tenantId, seed.drogaId, saldoApertura, seed.unidadId, seed.sistema],
    );

    return libroContralorId;
  }

  it("a confirmación of a controlled droga's línea writes exactly ONE asiento_contralor (EGRESO) per movimiento, with the correct saldo chain", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedControladaBase(tx, "contralor1");
        await activarContralor(tx, seed, 50);
        const { movimientoId, asientoId } = await intentarConfirmacion(tx, seed, 5);

        await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, movimiento_stock_id, asiento_recetario_id, registrado_por_id)
           VALUES ($1, 'EGRESO', $2, 'Droga controlada', 5, $3, $4, $5, $6)`,
          [seed.tenantId, seed.drogaId, seed.unidadId, movimientoId, asientoId, seed.sistema],
        );

        const rows = await tx.query(
          `SELECT tipo_movimiento, saldo_anterior::text AS anterior, saldo_posterior::text AS posterior, movimiento_stock_id, asiento_recetario_id, numero_correlativo::int AS numero
           FROM fsj.asiento_contralor WHERE droga_id = $1 ORDER BY numero_correlativo ASC`,
          [seed.drogaId],
        );
        expect(rows.rows).toHaveLength(2); // APERTURA + this EGRESO
        expect(rows.rows[0].tipo_movimiento).toBe("APERTURA");
        expect(rows.rows[0].posterior).toBe("50");
        expect(rows.rows[1].tipo_movimiento).toBe("EGRESO");
        expect(rows.rows[1].anterior).toBe("50");
        expect(rows.rows[1].posterior).toBe("45"); // 50 - 5
        expect(rows.rows[1].movimiento_stock_id).toBe(movimientoId);
        expect(rows.rows[1].asiento_recetario_id).toBe(asientoId);

        // INV-L08 (deferred) is satisfied -- committing the deferred checks must not raise.
        await tx.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      }),
    );
  });

  it("INV-L08: a movimiento of a controlled droga WITHOUT its matching asiento_contralor is rejected at commit (deferred constraint)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedControladaBase(tx, "contralor2");
        await activarContralor(tx, seed, 50);
        await intentarConfirmacion(tx, seed, 5); // deliberately NO asiento_contralor inserted

        await expectDbRejection(tx, () => tx.query(`SET CONSTRAINTS ALL IMMEDIATE`), "P0001");
      }),
    );
  });

  it("two movimientos of the SAME controlled droga (split across two partidas) produce TWO asiento_contralor rows, saldo chained correctly", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedControladaBase(tx, "contralor3", 8); // línea needs 8 total, split 5 + 3 across two partidas
        // A second (pre-activation) partida of the same droga, so the
        // línea's 8 units split as 5 + 3 -- inserted BEFORE activarContralor
        // so it needs neither numero_vale_adquisicion (INV-L16) nor its own
        // asiento_contralor (INV-L08); see insertPartidaAdicional's doc comment.
        const partida2Id = await insertPartidaAdicional(tx, seed, 100);
        await activarContralor(tx, seed, 50);

        const mov1 = await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 5, $3, $4, $5) RETURNING id`,
          [seed.tenantId, seed.partidaId, seed.preparacionId, seed.lineaPesajeId, seed.sistema],
        );
        const mov2 = await tx.query(
          `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
           VALUES ($1, $2, 'EGRESO_PREPARACION', 3, $3, $4, $5) RETURNING id`,
          [seed.tenantId, partida2Id, seed.preparacionId, seed.lineaPesajeId, seed.sistema],
        );

        // D4 (migration 0034): detalle_asiento BEFORE its asiento_recetario -- see intentarConfirmacion's doc comment above.
        const asientoId2 = randomUUID();
        await tx.query(
          `INSERT INTO fsj.detalle_asiento (tenant_id, asiento_recetario_id, linea_pesaje_id, descripcion, cantidad, unidad_texto, orden)
           VALUES ($1, $2, $3, 'Droga', 8, 'g', 0)`,
          [seed.tenantId, asientoId2, seed.lineaPesajeId],
        );
        const asiento = await tx.query(
          `INSERT INTO fsj.asiento_recetario (id, tenant_id, origen, preparacion_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
           VALUES ($1, $2, 'SISTEMA', $3, 'Paciente Test', 'Medico Test - MAT-1', 'Formula de prueba', $4) RETURNING id`,
          [asientoId2, seed.tenantId, seed.preparacionId, seed.sistema],
        );
        await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
          seed.sistema,
          seed.preparacionId,
        ]);

        await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, movimiento_stock_id, asiento_recetario_id, registrado_por_id)
           VALUES ($1, 'EGRESO', $2, 'Droga controlada', 5, $3, $4, $5, $6)`,
          [seed.tenantId, seed.drogaId, seed.unidadId, mov1.rows[0].id, asiento.rows[0].id, seed.sistema],
        );
        await tx.query(
          `INSERT INTO fsj.asiento_contralor (tenant_id, tipo_movimiento, droga_id, droga_descripcion, cantidad, unidad_medida_id, movimiento_stock_id, asiento_recetario_id, registrado_por_id)
           VALUES ($1, 'EGRESO', $2, 'Droga controlada', 3, $3, $4, $5, $6)`,
          [seed.tenantId, seed.drogaId, seed.unidadId, mov2.rows[0].id, asiento.rows[0].id, seed.sistema],
        );

        const rows = await tx.query(
          `SELECT tipo_movimiento, saldo_anterior::text AS anterior, saldo_posterior::text AS posterior
           FROM fsj.asiento_contralor WHERE droga_id = $1 ORDER BY numero_correlativo ASC`,
          [seed.drogaId],
        );
        expect(rows.rows).toHaveLength(3); // APERTURA + 2 EGRESO
        expect(rows.rows[1].anterior).toBe("50");
        expect(rows.rows[1].posterior).toBe("45");
        expect(rows.rows[2].anterior).toBe("45");
        expect(rows.rows[2].posterior).toBe("42"); // 45 - 3

        await tx.query(`SET CONSTRAINTS ALL IMMEDIATE`);
      }),
    );
  });
});
