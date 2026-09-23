/**
 * DB tests for prisma/migrations/.../0014_libro_recetario_contralor --
 * the libro recetario half: contador_correlativo (gapless), hash chain,
 * anulacion/rectificativo (DP-16/DP-16c), asiento_historico (DP-17), and
 * INV-P04. See tests/db/helpers.ts for the rollback-transaction safety
 * model and tests/db/fixtures.ts for the shared seed helpers.
 *
 * Also covers migration 0018_legal_core_fixes: hash serialization V2 +
 * fsj.verificar_cadena (B2), NULL-able rubric data on libro_rubricado
 * (B3), fsj.jornada_de at the Mendoza day boundary (N2/N3).
 *
 * Cross-connection concurrency: see the dedicated test near the bottom of
 * this file for why the real counter/contralor triggers cannot be
 * race-tested with two REAL connections inside this harness, and what is
 * proven instead.
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { describe, it, expect } from "vitest";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { asOwner, inRollbackTx, inSavepoint, withTenant, expectInvariantViolation, expectDbRejection, setRelojPrueba } from "./helpers";
import {
  insertTenant,
  createSistemaUser,
  crearLibrosRubricados,
  designarDt,
  createUserWithRole,
  seedAsientoSistema,
  insertAsientoSistema,
  hashV2,
  type AsientoSistemaResult,
} from "./fixtures";

/** Genesis hash constant, computed the same way fsj.hash_genesis() does. */
const GENESIS = createHash("sha256").update("FSJ-LIBRO-GENESIS-V1").digest("hex");

/**
 * Recomputes an asiento_recetario row's hash exactly per migration 0018's
 * documented serialization V2 (tag FSJ-ASIENTO-V2), using the Node-side
 * `hashV2` from fixtures.ts -- independent of the DB's own implementation.
 * `fechaAsiento` must be YYYY-MM-DD (select it with to_char, never ::text).
 */
function recomputeAsientoHash(fields: {
  tenantId: string;
  libroId: string;
  numeroCorrelativo: string | number;
  fechaAsiento: string;
  origen: string;
  preparacionId: string | null;
  asientoOriginalId: string | null;
  pacienteTexto: string;
  medicoTexto: string;
  formulaTexto: string;
  hashAnterior: string;
}): string {
  return hashV2([
    "FSJ-ASIENTO-V2",
    fields.tenantId,
    fields.libroId,
    String(fields.numeroCorrelativo),
    fields.fechaAsiento,
    fields.origen,
    fields.preparacionId,
    fields.asientoOriginalId,
    fields.pacienteTexto,
    fields.medicoTexto,
    fields.formulaTexto,
    fields.hashAnterior,
  ]);
}

/**
 * D4 (migration 0034): same fields as `recomputeAsientoHash` (V2) plus the
 * asiento's own detalle_asiento lines (orden, descripcion, cantidad,
 * unidad_texto, linea_pesaje_id -- in that order, ORDER BY orden),
 * prefixed by their count -- tag 'FSJ-ASIENTO-V3'. Every asiento created
 * from migration 0034 forward is hashed this way (see fixtures.ts#insertAsientoSistema).
 */
function recomputeAsientoHashV3(
  fields: {
    tenantId: string;
    libroId: string;
    numeroCorrelativo: string | number;
    fechaAsiento: string;
    origen: string;
    preparacionId: string | null;
    asientoOriginalId: string | null;
    pacienteTexto: string;
    medicoTexto: string;
    formulaTexto: string;
    hashAnterior: string;
  },
  detalles: ReadonlyArray<{ orden: number; descripcion: string; cantidad: string; unidadTexto: string; lineaPesajeId: string | null }>,
): string {
  const lineas = detalles.flatMap((d) => [String(d.orden), d.descripcion, d.cantidad, d.unidadTexto, d.lineaPesajeId]);
  return hashV2([
    "FSJ-ASIENTO-V3",
    fields.tenantId,
    fields.libroId,
    String(fields.numeroCorrelativo),
    fields.fechaAsiento,
    fields.origen,
    fields.preparacionId,
    fields.asientoOriginalId,
    fields.pacienteTexto,
    fields.medicoTexto,
    fields.formulaTexto,
    fields.hashAnterior,
    String(detalles.length),
    ...lineas,
  ]);
}

async function openLibroId(tx: Client, tenantId: string, tipo = "RECETARIO"): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.libro_rubricado WHERE tenant_id = $1 AND tipo = $2 AND fecha_cierre IS NULL`, [
    tenantId,
    tipo,
  ]);
  return result.rows[0].id as string;
}

/** D4 (migration 0034): thin wrapper over fixtures.ts#insertAsientoSistema, keeping this file's original call shape (`sistema` instead of `registradoPorId`). */
async function insertAsientoSimple(
  tx: Client,
  input: { tenantId: string; preparacionId: string; sistema: string; numeroCorrelativoForzado?: number },
): Promise<{ id: string; numeroCorrelativo: string; libroId: string; hashIntegridad: string; hashAnterior: string; fechaAsiento: string }> {
  return insertAsientoSistema(tx, {
    tenantId: input.tenantId,
    preparacionId: input.preparacionId,
    registradoPorId: input.sistema,
    pacienteTexto: "Paciente",
    medicoTexto: "Medico - MAT-1",
    formulaTexto: "Formula",
    numeroCorrelativoForzado: input.numeroCorrelativoForzado,
  });
}

/**
 * Creates a NEW ficha_tecnica VERSION (its own linea_pesaje) + a fresh
 * preparacion (INICIADA, unconfirmed is fine -- deferred P04 never fires
 * under rollback) for a second asiento. A second preparacion on the SAME
 * ficha_tecnica_id would violate INV-P02 (uq_preparacion_ficha_activa,
 * migration 0013) since seed's original preparacion is already
 * CONFIRMADA (not DESCARTADA) -- a new ficha VERSION of the same
 * item_receta sidesteps that exactly like preparacion-etiqueta.test.ts's
 * INV-PRP-003 test does.
 */
async function insertPreparacionAdicional(tx: Client, seed: AsientoSistemaResult): Promise<string> {
  const versionResult = await tx.query(
    `SELECT coalesce(max(version), 0) + 1 AS next FROM fsj.ficha_tecnica WHERE tenant_id = $1 AND item_receta_id = $2`,
    [seed.tenantId, seed.itemRecetaId],
  );
  const version = versionResult.rows[0].next as number;
  const fichaResult = await tx.query(
    `INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [seed.tenantId, seed.itemRecetaId, version, seed.sistema],
  );
  const fichaTecnicaId = fichaResult.rows[0].id as string;
  await tx.query(
    `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, orden)
     VALUES ($1, $2, $3, 'D', 1, 1, $4, 0)`,
    [seed.tenantId, fichaTecnicaId, seed.drogaId, seed.unidadId],
  );
  const result = await tx.query(
    `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
    [seed.tenantId, fichaTecnicaId, seed.sistema],
  );
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0014_libro_recetario_contralor migration -- libro recetario (fsj schema)", () => {
  it("correlativo starts at 1 and increments 1,2,3... per book, per tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "correlativo1");
        // seed itself already inserted asiento #1 -- confirm that, then add two more.
        expect(seed).toBeTruthy();
        const a1 = await tx.query(`SELECT numero_correlativo FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        expect(String(a1.rows[0].numero_correlativo)).toBe("1");

        const prep2 = await insertPreparacionAdicional(tx, seed);
        const a2 = await insertAsientoSimple(tx, { tenantId: seed.tenantId, preparacionId: prep2, sistema: seed.sistema });
        expect(a2.numeroCorrelativo).toBe("2");

        const prep3 = await insertPreparacionAdicional(tx, seed);
        const a3 = await insertAsientoSimple(tx, { tenantId: seed.tenantId, preparacionId: prep3, sistema: seed.sistema });
        expect(a3.numeroCorrelativo).toBe("3");
      }),
    );
  });

  it("correlativo is independent per tenant -- a second tenant's RECETARIO libro also starts at 1", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seedA = await seedAsientoSistema(tx, "correlativoTenantA");
        const seedB = await seedAsientoSistema(tx, "correlativoTenantB");

        const a = await tx.query(`SELECT numero_correlativo FROM fsj.asiento_recetario WHERE id = $1`, [seedA.asientoId]);
        const b = await tx.query(`SELECT numero_correlativo FROM fsj.asiento_recetario WHERE id = $1`, [seedB.asientoId]);
        expect(String(a.rows[0].numero_correlativo)).toBe("1");
        expect(String(b.rows[0].numero_correlativo)).toBe("1");
      }),
    );
  });

  it("a rolled-back insert does NOT consume a correlativo number (proven with a nested savepoint)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "savepointGap");
        // seed already consumed #1. Attempt and then discard a second asiento
        // inside its own savepoint (simulating a later failure in the same
        // transaction that forces a partial rollback).
        const prep2 = await insertPreparacionAdicional(tx, seed);
        let discardedNumero: string | null = null;
        await inSavepoint(tx, async () => {
          const discarded = await insertAsientoSimple(tx, { tenantId: seed.tenantId, preparacionId: prep2, sistema: seed.sistema });
          discardedNumero = discarded.numeroCorrelativo;
        });
        expect(discardedNumero).toBe("2");

        // A REAL next asiento must still get #2 -- the discarded attempt left no gap.
        const prep3 = await insertPreparacionAdicional(tx, seed);
        const real = await insertAsientoSimple(tx, { tenantId: seed.tenantId, preparacionId: prep3, sistema: seed.sistema });
        expect(real.numeroCorrelativo).toBe("2");
      }),
    );
  });

  it("the app cannot set numero_correlativo -- the BEFORE INSERT trigger overrides any value sent", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "noAppNumero");
        const prep2 = await insertPreparacionAdicional(tx, seed);

        const forced = await insertAsientoSimple(tx, {
          tenantId: seed.tenantId,
          preparacionId: prep2,
          sistema: seed.sistema,
          numeroCorrelativoForzado: 9999,
        });
        // The trigger runs BEFORE INSERT and unconditionally overwrites
        // NEW.numero_correlativo -- the forced 9999 never survives.
        expect(forced.numeroCorrelativo).toBe("2");
      }),
    );
  });

  it("hash chain: recomputing hash_integridad in plain SQL from the stored fields matches the trigger-computed value (V3, migration 0034)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "hashVerify");
        const row = await tx.query(
          `SELECT tenant_id, libro_id, numero_correlativo, to_char(fecha_asiento, 'YYYY-MM-DD') AS fecha_asiento, origen,
                  preparacion_id, asiento_original_id, paciente_texto, medico_texto, formula_texto, hash_integridad, hash_anterior, version_hash
           FROM fsj.asiento_recetario WHERE id = $1`,
          [seed.asientoId],
        );
        const r = row.rows[0];
        expect(r.hash_anterior).toBe(GENESIS); // first asiento of a fresh libro chains against genesis
        // Every asiento inserted by seedAsientoSistema (fixtures.ts#insertAsientoSistema) goes through the
        // migration 0034 BEFORE INSERT trigger, which always pins version_hash = 3.
        expect(r.version_hash).toBe(3);

        const detalles = await tx.query(
          `SELECT orden, descripcion, cantidad::text, unidad_texto, linea_pesaje_id FROM fsj.detalle_asiento
           WHERE asiento_recetario_id = $1 ORDER BY orden`,
          [seed.asientoId],
        );

        const recomputed = recomputeAsientoHashV3(
          {
            tenantId: r.tenant_id,
            libroId: r.libro_id,
            numeroCorrelativo: r.numero_correlativo,
            fechaAsiento: r.fecha_asiento,
            origen: r.origen,
            preparacionId: r.preparacion_id,
            asientoOriginalId: r.asiento_original_id,
            pacienteTexto: r.paciente_texto,
            medicoTexto: r.medico_texto,
            formulaTexto: r.formula_texto,
            hashAnterior: r.hash_anterior,
          },
          detalles.rows.map((d) => ({ orden: d.orden, descripcion: d.descripcion, cantidad: d.cantidad, unidadTexto: d.unidad_texto, lineaPesajeId: d.linea_pesaje_id })),
        );
        expect(recomputed).toBe(r.hash_integridad);
      }),
    );
  });

  it("hash chain: the SECOND asiento of a libro chains hash_anterior to the FIRST asiento's hash_integridad", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "hashChain");
        const first = await tx.query(`SELECT hash_integridad FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);

        const prep2 = await insertPreparacionAdicional(tx, seed);
        const second = await insertAsientoSimple(tx, { tenantId: seed.tenantId, preparacionId: prep2, sistema: seed.sistema });

        expect(second.hashAnterior).toBe(first.rows[0].hash_integridad);
        expect(second.hashIntegridad).not.toBe(first.rows[0].hash_integridad);
      }),
    );
  });

  it("hash chain: tampering is detectable -- recomputing with an altered field does NOT match the stored hash", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "tamperDetect");
        const row = await tx.query(
          `SELECT tenant_id, libro_id, numero_correlativo, to_char(fecha_asiento, 'YYYY-MM-DD') AS fecha_asiento, origen,
                  preparacion_id, asiento_original_id, paciente_texto, medico_texto, formula_texto, hash_integridad, hash_anterior
           FROM fsj.asiento_recetario WHERE id = $1`,
          [seed.asientoId],
        );
        const r = row.rows[0];

        // Recompute (V2 formula -- fine here: the stored hash is now V3
        // (migration 0034), so ANY recompute of a DIFFERENT algorithm
        // already fails to match trivially; this only needs inequality,
        // unlike the "matches the trigger-computed value" test above,
        // which needs the EXACT algorithm and uses recomputeAsientoHashV3)
        // as if formula_texto had been tampered with -- must NOT match.
        const tampered = recomputeAsientoHash({
          tenantId: r.tenant_id,
          libroId: r.libro_id,
          numeroCorrelativo: r.numero_correlativo,
          fechaAsiento: r.fecha_asiento,
          origen: r.origen,
          preparacionId: r.preparacion_id,
          asientoOriginalId: r.asiento_original_id,
          pacienteTexto: r.paciente_texto,
          medicoTexto: r.medico_texto,
          formulaTexto: "FORMULA ALTERADA", // <- tampering
          hashAnterior: r.hash_anterior,
        });
        expect(tampered).not.toBe(r.hash_integridad);

        // The row itself cannot actually be tampered with in place either
        // (immutability, INV-L01) -- direct proof alongside the hash proof.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.asiento_recetario SET formula_texto = 'FORMULA ALTERADA' WHERE id = $1`, [seed.asientoId]),
          "INV-L01",
        );
      }),
    );
  });

  it("anulacion in an OPEN jornada works and flips estado to ANULADO (INV-L09)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "anulaOk");
        const dtUser = await tx.query(
          // estado explicitly ACTIVO -- NOT the schema's DEFAULT
          // (PENDIENTE_ACTIVACION, migration 0002). Needed since migration
          // 0022 (FASE 3 point 3.9 finding M1): anulacion_asiento_validar's
          // INV-U05 check now goes through fsj.es_dt_vigente, which
          // requires the DT be ACTIVO right now, not just role-holding.
          `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, estado, creado_por_id) VALUES ($1,$2,'D','T',$3,'ACTIVO',$4) RETURNING id`,
          [seed.tenantId, `dt-${randomUUID()}@example.com`, `DNI-${randomUUID()}`, seed.sistema],
        );
        const dtId = dtUser.rows[0].id as string;
        const rolResult = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'DIRECTOR_TECNICO'`);
        await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
          seed.tenantId,
          dtId,
          rolResult.rows[0].id,
          seed.sistema,
        ]);
        await designarDt(tx, seed.tenantId, dtId, seed.sistema);

        await tx.query(
          `INSERT INTO fsj.anulacion_asiento (tenant_id, asiento_id, motivo, autorizado_por_id, anulado_por_id)
           VALUES ($1, $2, 'paciente no retira', $3, $4)`,
          [seed.tenantId, seed.asientoId, dtId, seed.sistema],
        );

        const result = await tx.query(`SELECT estado FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        expect(result.rows[0].estado).toBe("ANULADO");
      }),
    );
  });

  it("jd-fix-agent FIX 1: as fsj_app, lockAsientoParaAnular's advisory lock succeeds where a raw `FOR UPDATE` on asiento_recetario would be rejected (42501, no UPDATE grant -- migration 0014)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "lockAdvisory");

        // The bug this fix removes: fsj_app has no UPDATE privilege on
        // fsj.asiento_recetario (migration 0014's INV-X01 REVOKE), and
        // Postgres requires it for `FOR UPDATE`, even on a read-only lock.
        await inSavepoint(tx, async () => {
          await tx.query("SET LOCAL ROLE fsj_app");
          await withTenant(tx, seed.tenantId, async () => {
            await expectDbRejection(
              tx,
              () =>
                tx.query(`SELECT id FROM fsj.asiento_recetario WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [
                  seed.asientoId,
                  seed.tenantId,
                ]),
              "42501",
            );
          });
        });

        // The fix: the SAME advisory-lock key `lockAsientoParaAnular` takes,
        // followed by a plain SELECT -- both succeed as fsj_app, no table
        // privilege beyond SELECT required.
        await inSavepoint(tx, async () => {
          await tx.query("SET LOCAL ROLE fsj_app");
          await withTenant(tx, seed.tenantId, async () => {
            await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('asiento_recetario:' || $1 || ':' || $2, 0))`, [
              seed.tenantId,
              seed.asientoId,
            ]);
            const rows = await tx.query(`SELECT id FROM fsj.asiento_recetario WHERE id = $1 AND tenant_id = $2`, [
              seed.asientoId,
              seed.tenantId,
            ]);
            expect(rows.rows).toHaveLength(1);
          });
        });
      }),
    );
  });

  it("INV-U05 (migration 0022, FASE 3 point 3.9 M1): anulacion authorized by a SUSPENDIDO DT (a vigente designation, but not ACTIVO) is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "anulaSusp");
        // Designate while ACTIVO (INV-DT-005 requires ACTIVO at INSERT
        // time -- a SUSPENDIDO user could never even be designated), THEN
        // suspend (a valid ACTIVO -> SUSPENDIDO transition, INV-USR-006).
        // The designation itself is untouched and still covers today --
        // before migration 0022 this was accepted regardless, since
        // fsj.es_dt_vigente only checked the designation period, never
        // usuario.estado.
        const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "anulaSusp");
        await designarDt(tx, seed.tenantId, dtId, seed.sistema);
        await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [dtId]);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.anulacion_asiento (tenant_id, asiento_id, motivo, autorizado_por_id, anulado_por_id)
               VALUES ($1, $2, 'paciente no retira', $3, $4)`,
              [seed.tenantId, seed.asientoId, dtId, seed.sistema],
            ),
          "INV-U05",
        );
      }),
    );
  });

  it("anulacion in a SIGNED jornada is rejected (INV-L02) -- use a rectificativo instead", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "anulaSigned");
        const dtUser = await tx.query(
          // estado explicitly ACTIVO -- NOT the schema's DEFAULT
          // (PENDIENTE_ACTIVACION, migration 0002). Needed since migration
          // 0022 (FASE 3 point 3.9 finding M1): anulacion_asiento_validar's
          // INV-U05 check now goes through fsj.es_dt_vigente, which
          // requires the DT be ACTIVO right now, not just role-holding.
          `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, estado, creado_por_id) VALUES ($1,$2,'D','T',$3,'ACTIVO',$4) RETURNING id`,
          [seed.tenantId, `dt-${randomUUID()}@example.com`, `DNI-${randomUUID()}`, seed.sistema],
        );
        const dtId = dtUser.rows[0].id as string;
        const rolResult = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'DIRECTOR_TECNICO'`);
        await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
          seed.tenantId,
          dtId,
          rolResult.rows[0].id,
          seed.sistema,
        ]);
        const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema);

        const asiento = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        const fecha = asiento.rows[0].fecha_asiento as string;

        await tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha, dtId, designacionId]);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.anulacion_asiento (tenant_id, asiento_id, motivo, autorizado_por_id, anulado_por_id)
               VALUES ($1, $2, 'demasiado tarde', $3, $4)`,
              [seed.tenantId, seed.asientoId, dtId, seed.sistema],
            ),
          "INV-L02",
        );
      }),
    );
  });

  it("rectificativo in a SIGNED jornada works, gets the next correlativo, and a second rectificativo is rejected (INV-L18/L19)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        // Day D: sign it, then move "now" forward to day D+1 (setRelojPrueba,
        // prisma/migrations/.../0024_jornada_reloj_de_prueba) -- this is how
        // these tests get a second, strictly-later jornada without waiting
        // for real time to pass.
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "rectificativo");

        const dtUser = await tx.query(
          // estado explicitly ACTIVO -- NOT the schema's DEFAULT
          // (PENDIENTE_ACTIVACION, migration 0002). Needed since migration
          // 0022 (FASE 3 point 3.9 finding M1): anulacion_asiento_validar's
          // INV-U05 check now goes through fsj.es_dt_vigente, which
          // requires the DT be ACTIVO right now, not just role-holding.
          `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, estado, creado_por_id) VALUES ($1,$2,'D','T',$3,'ACTIVO',$4) RETURNING id`,
          [seed.tenantId, `dt-${randomUUID()}@example.com`, `DNI-${randomUUID()}`, seed.sistema],
        );
        const dtId = dtUser.rows[0].id as string;
        const rolResult = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'DIRECTOR_TECNICO'`);
        await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
          seed.tenantId,
          dtId,
          rolResult.rows[0].id,
          seed.sistema,
        ]);
        const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema);

        const asientoOriginal = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        const fechaOriginal = asientoOriginal.rows[0].fecha_asiento as string;

        await tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fechaOriginal, dtId, designacionId]);

        // Move "now" forward to day D+1.
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");
        const jornadaNueva = await tx.query(`SELECT fsj.jornada_actual($1)::text AS jornada`, [seed.tenantId]);
        expect(jornadaNueva.rows[0].jornada > fechaOriginal).toBe(true);

        const rectificativo = await tx.query(
          `INSERT INTO fsj.asiento_recetario (tenant_id, origen, asiento_original_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
           VALUES ($1, 'RECTIFICATIVO', $2, 'Paciente', 'Medico - MAT-1', 'Formula corregida', $3)
           RETURNING numero_correlativo, fecha_asiento::text`,
          [seed.tenantId, seed.asientoId, seed.sistema],
        );
        expect(String(rectificativo.rows[0].numero_correlativo)).toBe("2"); // next number in the SAME libro
        expect(rectificativo.rows[0].fecha_asiento).toBe(jornadaNueva.rows[0].jornada);

        // A second rectificativo of the SAME original is rejected (INV-L19).
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_recetario (tenant_id, origen, asiento_original_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
               VALUES ($1, 'RECTIFICATIVO', $2, 'Paciente', 'Medico - MAT-1', 'Formula corregida otra vez', $3)`,
              [seed.tenantId, seed.asientoId, seed.sistema],
            ),
          "23505",
        );
      }),
    );
  });

  it("a rectificativo of an UNSIGNED asiento is rejected (INV-L18)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "rectificativoUnsigned");

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_recetario (tenant_id, origen, asiento_original_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
               VALUES ($1, 'RECTIFICATIVO', $2, 'Paciente', 'Medico - MAT-1', 'Formula corregida', $3)`,
              [seed.tenantId, seed.asientoId, seed.sistema],
            ),
          "INV-L18",
        );
      }),
    );
  });

  it("asiento_historico rows do NOT touch fsj.contador_correlativo (DP-17)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "historico");
        const sistema = await createSistemaUser(tx, tenantId);
          await crearLibrosRubricados(tx, tenantId, sistema);
        const libroId = await openLibroId(tx, tenantId, "RECETARIO");

        const before = await tx.query(`SELECT ultimo_valor FROM fsj.contador_correlativo WHERE tenant_id = $1 AND libro_id = $2`, [
          tenantId,
          libroId,
        ]);
        expect(String(before.rows[0].ultimo_valor)).toBe("0");

        await tx.query(
          `INSERT INTO fsj.asiento_historico (tenant_id, tipo_libro, numero_asiento_fisico, fecha_asiento, formula_texto, digitalizado_por_id)
           VALUES ($1, 'RECETARIO', '34163', '2020-01-15', 'Acido salicilico 3g, vaselina csp 30g', $2)`,
          [tenantId, sistema],
        );
        await tx.query(
          `INSERT INTO fsj.asiento_historico (tenant_id, tipo_libro, numero_asiento_fisico, fecha_asiento, formula_texto, digitalizado_por_id)
           VALUES ($1, 'RECETARIO', '34164', '2020-01-16', 'Hidroquinona 1.2g, crema base csp 30g', $2)`,
          [tenantId, sistema],
        );

        const after = await tx.query(`SELECT ultimo_valor FROM fsj.contador_correlativo WHERE tenant_id = $1 AND libro_id = $2`, [
          tenantId,
          libroId,
        ]);
        expect(String(after.rows[0].ultimo_valor)).toBe("0"); // unchanged

        const historicoCount = await tx.query(`SELECT count(*)::int AS n FROM fsj.asiento_historico WHERE tenant_id = $1`, [tenantId]);
        expect(historicoCount.rows[0].n).toBe(2);

        // No DELETE/UPDATE grant either (immutable, like every other legal table).
        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.asiento_historico SET formula_texto = 'x' WHERE tenant_id = $1`, [tenantId]),
          "42501",
        );
      }),
    );
  });

  it("D5 (migration 0035): the same physical folio (tipo_libro + numero_asiento_fisico) cannot be digitalized twice for the same tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "historicoUnico");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);

        await tx.query(
          `INSERT INTO fsj.asiento_historico (tenant_id, tipo_libro, numero_asiento_fisico, fecha_asiento, formula_texto, digitalizado_por_id)
           VALUES ($1, 'RECETARIO', '500', '2020-01-15', 'Formula A', $2)`,
          [tenantId, sistema],
        );

        // Same folio, same libro -> rejected.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.asiento_historico (tenant_id, tipo_libro, numero_asiento_fisico, fecha_asiento, formula_texto, digitalizado_por_id)
               VALUES ($1, 'RECETARIO', '500', '2020-01-16', 'Formula A (duplicado)', $2)`,
              [tenantId, sistema],
            ),
          "23505",
        );

        // Same numero, but a DIFFERENT tipo_libro -> allowed (different physical book).
        const otroLibro = await tx.query(
          `INSERT INTO fsj.asiento_historico (tenant_id, tipo_libro, numero_asiento_fisico, fecha_asiento, formula_texto, digitalizado_por_id)
           VALUES ($1, 'PSICOTROPICO', '500', '2020-01-15', 'Formula B', $2) RETURNING id`,
          [tenantId, sistema],
        );
        expect(otroLibro.rows).toHaveLength(1);

        // A different tenant digitalizing the SAME folio number is unaffected (no cross-tenant collision).
        const tenant2 = await insertTenant(tx, "historicoUnico2");
        const sistema2 = await createSistemaUser(tx, tenant2);
        await crearLibrosRubricados(tx, tenant2, sistema2);
        const otroTenant = await tx.query(
          `INSERT INTO fsj.asiento_historico (tenant_id, tipo_libro, numero_asiento_fisico, fecha_asiento, formula_texto, digitalizado_por_id)
           VALUES ($1, 'RECETARIO', '500', '2020-01-15', 'Formula C', $2) RETURNING id`,
          [tenant2, sistema2],
        );
        expect(otroTenant.rows).toHaveLength(1);
      }),
    );
  });

  it("jd-fix-agent FIX 3: asiento_historico_numero_fisico_canonico_check rejects untrimmed/empty/leading-zero values, and a leading-zero duplicate ('07' vs '7') is caught by the UNIQUE constraint once both are canonical", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "historicoCanonico");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);

        const insertar = (numero: string) =>
          tx.query(
            `INSERT INTO fsj.asiento_historico (tenant_id, tipo_libro, numero_asiento_fisico, fecha_asiento, formula_texto, digitalizado_por_id)
             VALUES ($1, 'RECETARIO', $2, '2020-01-15', 'Formula', $3)`,
            [tenantId, numero, sistema],
          );

        // Untrimmed, empty, and leading-zero values are all rejected by the CHECK (23514).
        await expectDbRejection(tx, () => insertar(" 7"), "23514");
        await expectDbRejection(tx, () => insertar("7 "), "23514");
        await expectDbRejection(tx, () => insertar(""), "23514");
        await expectDbRejection(tx, () => insertar("07"), "23514");

        // A single "0" is the canonical all-zero form -- allowed.
        await insertar("0");

        // "7" is canonical and distinct from the already-inserted "0" -- allowed.
        await insertar("7");

        // A SECOND "7" (already canonical, no leading zero to strip) collides via the UNIQUE constraint.
        await expectDbRejection(tx, () => insertar("7"), "23505");
      }),
    );
  });

  it("INV-P04 (direction 1): a preparacion cannot become CONFIRMADA without a SISTEMA asiento_recetario (deferred, checked at commit)", async () => {
    await asOwner((client) =>
      inRollbackTx(
        client,
        async (tx) => {
          const tenantId = await insertTenant(tx, "p04a");
          const sistema = await createSistemaUser(tx, tenantId);
          await crearLibrosRubricados(tx, tenantId, sistema);
          const unidadResult = await tx.query(
            `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base) VALUES ($1,$1,'x','MASA',1,false) RETURNING id`,
            [`UM-P04A-${randomUUID()}`],
          );
          const unidadId = unidadResult.rows[0].id as string;
          const drogaResult = await tx.query(`INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id) VALUES ($1,$2,$3) RETURNING id`, [
            tenantId,
            `Droga-${randomUUID()}`,
            unidadId,
          ]);
          const drogaId = drogaResult.rows[0].id as string;
          const paciente = await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1,'P','A') RETURNING id`, [
            tenantId,
          ]);
          const medico = await tx.query(
            `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1,'M','D',$2) RETURNING id`,
            [tenantId, `MAT-${randomUUID()}`],
          );
          const receta = await tx.query(
            `INSERT INTO fsj.receta (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, registrada_por_id)
             VALUES ($1,$2,$3,current_date,'PRESENCIAL',$4) RETURNING id`,
            [tenantId, paciente.rows[0].id, medico.rows[0].id, sistema],
          );
          const item = await tx.query(
            `INSERT INTO fsj.item_receta (tenant_id, receta_id, forma_farmaceutica, cantidad_unidades) VALUES ($1,$2,'CREMA',1) RETURNING id`,
            [tenantId, receta.rows[0].id],
          );
          await tx.query(
            `INSERT INTO fsj.componente_item_receta (tenant_id, item_receta_id, droga_id, unidad_medida_id, modo_expresion, orden)
             VALUES ($1,$2,$3,$4,'CS',0)`,
            [tenantId, item.rows[0].id, drogaId, unidadId],
          );
          const ficha = await tx.query(
            `INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id) VALUES ($1,$2,1,$3) RETURNING id`,
            [tenantId, item.rows[0].id, sistema],
          );
          await tx.query(
            `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, orden)
             VALUES ($1,$2,$3,'D',1,1,$4,0)`,
            [tenantId, ficha.rows[0].id, drogaId, unidadId],
          );
          const preparacion = await tx.query(
            `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1,$2,$3) RETURNING id`,
            [tenantId, ficha.rows[0].id, sistema],
          );

          // CONFIRMADA with NO matching asiento_recetario at all.
          await tx.query(
            `UPDATE fsj.preparacion SET estado='CONFIRMADA', confirmada_en=now(), preparada_por_id=$1 WHERE id=$2`,
            [sistema, preparacion.rows[0].id],
          );

          await expectInvariantViolation(tx, () => tx.query(`SET CONSTRAINTS ALL IMMEDIATE`), "INV-P04");
        },
        {},
      ),
    );
  });

  it("INV-P04 (direction 2): a SISTEMA asiento_recetario cannot exist for a preparacion that is not CONFIRMADA (deferred, checked at commit)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "p04b");
        // Un-confirm the preparacion after its SISTEMA asiento already exists
        // -- impossible via UPDATE (estado is terminal, INV-P05), so instead
        // create a FRESH INICIADA preparacion and a SISTEMA asiento pointing
        // at it directly (bypassing the app-level ordering, exactly the kind
        // of direct-SQL attempt the deferred trigger must catch).
        const prep2 = await insertPreparacionAdicional(tx, seed);
        await insertAsientoSimple(tx, { tenantId: seed.tenantId, preparacionId: prep2, sistema: seed.sistema });
        // prep2 stays INICIADA (never confirmed) -- its asiento_recetario now
        // violates P04 direction 2 once constraints are checked.

        await expectInvariantViolation(tx, () => tx.query(`SET CONSTRAINTS ALL IMMEDIATE`), "INV-P04");
      }),
    );
  });

  it(
    "concurrency: a transaction-scoped lock held by one real connection blocks a second real connection until the holder's " +
      "transaction ends (zero DDL, zero committed rows -- both transactions roll back)",
    async () => {
      // HONEST SCOPE -- read before trusting this test for more than it proves.
      //
      // What this proves: with two REAL, separate connections, a lock taken
      // inside a transaction (pg_advisory_xact_lock here -- the same
      // "held until the transaction ends" semantics as the FOR UPDATE row
      // lock fsj.contador_correlativo_tomar takes) makes the second
      // connection genuinely WAIT (observed in pg_locks, not guessed from a
      // sleep) until the first transaction ends, and that it then proceeds.
      // Both transactions ROLL BACK: no DDL, no committed row, nothing to
      // clean up -- the suite's "DB tests never commit" rule holds.
      //
      // What this does NOT prove: a true two-connection race on the REAL
      // triggers (fsj.contador_correlativo_tomar / fsj.asiento_contralor_preparar,
      // migration 0018 B1). A second connection can only see the counter
      // row / previous asiento_contralor row after they are COMMITTED, and
      // those rows (plus their tenant, usuario, libro_rubricado, ...) are
      // protected by forbid_delete triggers -- committed fixture data would
      // be PERMANENTLY stuck in the single real Supabase database. That
      // race test cannot run in this harness. It is a concrete reason to
      // provision a dedicated, disposable test database before go-live.
      // Until then, B1 is covered by a single-transaction saldo-chaining test
      // plus a STRUCTURAL guard on the trigger body (tests/db/contralor.test.ts).
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

        // Deterministic: wait until the server itself reports b as waiting.
        let bWaiting = false;
        for (let i = 0; i < 50 && !bWaiting; i++) {
          const w = await a.query(
            `SELECT count(*)::int AS n FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`,
            [bPid],
          );
          bWaiting = w.rows[0].n > 0;
          if (!bWaiting) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(bWaiting).toBe(true);
        expect(bAcquired).toBe(false);

        await a.query("ROLLBACK"); // ends a's transaction -> releases its xact lock; nothing was committed

        await bPromise;
        expect(bAcquired).toBe(true);

        // b now holds the lock: a (outside any transaction) cannot take it.
        const aTry = await a.query("SELECT pg_try_advisory_xact_lock($1::bigint) AS ok", [key]);
        expect(aTry.rows[0].ok).toBe(false);

        await b.query("ROLLBACK");
      } finally {
        // Closing a connection aborts any transaction still open on it.
        await a.end();
        await b.end();
      }
    },
  );
});

// ============================================================================
// Migration 0018 -- B2: hash serialization V2 + fsj.verificar_cadena.
// ============================================================================
async function crearDtVigente(tx: Client, seed: AsientoSistemaResult): Promise<string> {
  const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dtV2");
  await designarDt(tx, seed.tenantId, dtId, seed.sistema);
  return dtId;
}

describe.skipIf(dbTestSkipReason() !== null)("0018_legal_core_fixes -- B2 hash serialization V2 (fsj schema)", () => {
  it("V2 is injective: two rows that COLLIDE under the old chr(31) join produce DIFFERENT V2 hashes", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const base = {
          tenant_id: randomUUID(),
          libro_id: randomUUID(),
          numero_correlativo: 7,
          fecha_asiento: "2026-09-21",
          origen: "SISTEMA",
          preparacion_id: randomUUID(),
          asiento_original_id: null,
          formula_texto: "F",
          estado: "VIGENTE",
          hash_anterior: GENESIS,
        };
        // paciente='A<US>B', medico='C'  vs  paciente='A', medico='B<US>C'
        const rowX = { ...base, paciente_texto: "A\x1fB", medico_texto: "C" };
        const rowY = { ...base, paciente_texto: "A", medico_texto: "B\x1fC" };

        const hashes = await tx.query(
          `SELECT fsj.asiento_recetario_hash_v1(jsonb_populate_record(NULL::fsj.asiento_recetario, $1::jsonb)) AS v1_x,
                  fsj.asiento_recetario_hash_v1(jsonb_populate_record(NULL::fsj.asiento_recetario, $2::jsonb)) AS v1_y,
                  fsj.asiento_recetario_hash_v2(jsonb_populate_record(NULL::fsj.asiento_recetario, $1::jsonb)) AS v2_x,
                  fsj.asiento_recetario_hash_v2(jsonb_populate_record(NULL::fsj.asiento_recetario, $2::jsonb)) AS v2_y`,
          [JSON.stringify(rowX), JSON.stringify(rowY)],
        );
        const h = hashes.rows[0];
        // The defect, reproduced with the V1 algorithm: identical hashes for different rows.
        expect(h.v1_x).toBe(h.v1_y);
        // The fix.
        expect(h.v2_x).not.toBe(h.v2_y);

        // NULL, empty string and a literal '-' are three distinct encodings.
        const nulls = await tx.query(
          `SELECT fsj.hash_v2(ARRAY['T', NULL]) AS h_null, fsj.hash_v2(ARRAY['T', '']) AS h_empty, fsj.hash_v2(ARRAY['T', '-']) AS h_dash`,
        );
        const n = nulls.rows[0];
        expect(new Set([n.h_null, n.h_empty, n.h_dash]).size).toBe(3);
        expect(n.h_null).toBe(hashV2(["T", null]));
        expect(n.h_empty).toBe(hashV2(["T", ""]));
        expect(n.h_dash).toBe(hashV2(["T", "-"]));

        // Multi-byte text: the length prefix counts UTF-8 BYTES (documented).
        const utf8 = await tx.query(`SELECT fsj.hash_campo_v2('ñá€') AS c`);
        expect(utf8.rows[0].c).toBe("7:ñá€");
      }),
    );
  });

  it("V2 hash does not depend on the session DateStyle (trigger-computed hash under 'SQL, DMY' matches the spec recomputation)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "datestyle");
        const prep2 = await insertPreparacionAdicional(tx, seed);

        await tx.query(`SET LOCAL DateStyle = 'SQL, DMY'`);
        // Sanity: the setting really changes date::text (what V1 hashed).
        const probe = await tx.query(`SELECT '2026-09-21'::date::text AS t`);
        expect(probe.rows[0].t).toBe("21/09/2026");

        const inserted = await insertAsientoSimple(tx, { tenantId: seed.tenantId, preparacionId: prep2, sistema: seed.sistema });
        // The asiento itself is hashed V3 (migration 0034) -- fsj.asiento_recetario_hash_v2
        // is exercised directly (independent of what version the row actually uses) to
        // keep proving IT, specifically, is DateStyle-independent.
        const hashSql = await tx.query(`SELECT fsj.asiento_recetario_hash_v2(a) AS h, fsj.asiento_recetario_hash_v3(a) AS h3 FROM fsj.asiento_recetario a WHERE id = $1`, [inserted.id]);

        await tx.query(`SET LOCAL DateStyle = 'ISO, YMD'`);
        const hashIso = await tx.query(`SELECT fsj.asiento_recetario_hash_v2(a) AS h, fsj.asiento_recetario_hash_v3(a) AS h3 FROM fsj.asiento_recetario a WHERE id = $1`, [inserted.id]);

        const row = await tx.query(
          `SELECT tenant_id, libro_id, numero_correlativo, to_char(fecha_asiento, 'YYYY-MM-DD') AS fecha_asiento, origen,
                  preparacion_id, asiento_original_id, paciente_texto, medico_texto, formula_texto, hash_anterior
           FROM fsj.asiento_recetario WHERE id = $1`,
          [inserted.id],
        );
        const r = row.rows[0];
        const spec = recomputeAsientoHash({
          tenantId: r.tenant_id,
          libroId: r.libro_id,
          numeroCorrelativo: r.numero_correlativo,
          fechaAsiento: r.fecha_asiento,
          origen: r.origen,
          preparacionId: r.preparacion_id,
          asientoOriginalId: r.asiento_original_id,
          pacienteTexto: r.paciente_texto,
          medicoTexto: r.medico_texto,
          formulaTexto: r.formula_texto,
          hashAnterior: r.hash_anterior,
        });

        expect(hashSql.rows[0].h).toBe(spec);
        expect(hashIso.rows[0].h).toBe(spec);
        // The row's OWN stored hash is V3 -- matches fsj.asiento_recetario_hash_v3
        // under both DateStyles too (same DateStyle-independence property).
        expect(inserted.hashIntegridad).toBe(hashSql.rows[0].h3);
        expect(hashIso.rows[0].h3).toBe(hashSql.rows[0].h3);

        const verif = await tx.query(`SELECT fsj.verificar_cadena($1, $2) AS roto`, [seed.tenantId, inserted.libroId]);
        expect(verif.rows[0].roto).toBeNull();
      }),
    );
  });

  it("fsj.verificar_cadena: NULL on an intact chain (also after an anulacion), and detects tampering, a broken link and a removed tail row", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "verificar");
        const a2 = await insertAsientoSimple(tx, {
          tenantId: seed.tenantId,
          preparacionId: await insertPreparacionAdicional(tx, seed),
          sistema: seed.sistema,
        });
        const a3 = await insertAsientoSimple(tx, {
          tenantId: seed.tenantId,
          preparacionId: await insertPreparacionAdicional(tx, seed),
          sistema: seed.sistema,
        });
        const libroId = a2.libroId;
        const verificar = async () =>
          String((await tx.query(`SELECT fsj.verificar_cadena($1, $2) AS roto`, [seed.tenantId, libroId])).rows[0].roto);

        expect(await verificar()).toBe("null");

        // estado is NOT part of the V2 payload: a legal anulacion must not "break" the chain.
        const dtId = await crearDtVigente(tx, seed);
        await tx.query(
          `INSERT INTO fsj.anulacion_asiento (tenant_id, asiento_id, motivo, autorizado_por_id, anulado_por_id)
           VALUES ($1, $2, 'paciente no retira', $3, $4)`,
          [seed.tenantId, a2.id, dtId, seed.sistema],
        );
        expect(await verificar()).toBe("null");

        // Tampering simulations. The immutability triggers (INV-L01,
        // forbid_delete) reject these writes BY DESIGN, so to simulate an
        // attacker with raw storage/superuser access we bypass ordinary
        // triggers with SET LOCAL session_replication_role = replica -- as
        // the table owner, inside a savepoint that inSavepoint ALWAYS rolls
        // back (which also undoes the SET LOCAL), inside inRollbackTx.
        await inSavepoint(tx, async () => {
          await tx.query(`SET LOCAL session_replication_role = replica`);
          await tx.query(`UPDATE fsj.asiento_recetario SET formula_texto = 'FORMULA ALTERADA' WHERE id = $1`, [a2.id]);
          await tx.query(`SET LOCAL session_replication_role = origin`);
          expect(await verificar()).toBe(a2.numeroCorrelativo);
        });

        await inSavepoint(tx, async () => {
          await tx.query(`SET LOCAL session_replication_role = replica`);
          // Re-hashing the tampered row consistently still breaks the NEXT link.
          await tx.query(
            `UPDATE fsj.asiento_recetario SET formula_texto = 'FORMULA ALTERADA' WHERE id = $1`,
            [a2.id],
          );
          // a2.version_hash is 3 (migration 0034) -- re-hash with the SAME
          // function fsj.verificar_cadena will use for this row, or the row
          // would be flagged as broken itself instead of merely breaking
          // the NEXT link (which is what this simulation is testing).
          await tx.query(
            `UPDATE fsj.asiento_recetario a SET hash_integridad = fsj.asiento_recetario_hash_v3(a) WHERE id = $1`,
            [a2.id],
          );
          await tx.query(`SET LOCAL session_replication_role = origin`);
          expect(await verificar()).toBe(a3.numeroCorrelativo);
        });

        await inSavepoint(tx, async () => {
          await tx.query(`SET LOCAL session_replication_role = replica`);
          await tx.query(`DELETE FROM fsj.asiento_recetario WHERE id = $1`, [a3.id]);
          await tx.query(`SET LOCAL session_replication_role = origin`);
          // The counter still says 3: the tail row is missing.
          expect(await verificar()).toBe(a3.numeroCorrelativo);
        });

        // Everything above was rolled back: intact again.
        expect(await verificar()).toBe("null");

        // As fsj_app, RLS confines it to the caller's own tenant.
        await inSavepoint(tx, async () => {
          await tx.query("SET LOCAL ROLE fsj_app");
          await withTenant(tx, randomUUID(), async () => {
            await expectInvariantViolation(
              tx,
              () => tx.query(`SELECT fsj.verificar_cadena($1, $2)`, [seed.tenantId, libroId]),
              "INV-L03",
            );
          });
          await withTenant(tx, seed.tenantId, async () => {
            expect(await verificar()).toBe("null");
          });
        });
      }),
    );
  });
});

// ============================================================================
// Migration 0018 -- B3: libro_rubricado official rubric data (DP-38).
// ============================================================================
describe.skipIf(dbTestSkipReason() !== null)("0018_legal_core_fixes -- B3 libro_rubricado rubric data is never invented (fsj schema)", () => {
  it("a new libro has NULL numero/fecha_rubrica/expediente_rubrica; each goes NULL -> value once; value -> other value / NULL is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "rubrica");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);

        const libros = await tx.query(
          `SELECT id, numero, fecha_rubrica, expediente_rubrica FROM fsj.libro_rubricado WHERE tenant_id = $1`,
          [tenantId],
        );
        expect(libros.rows).toHaveLength(3);
        for (const libro of libros.rows) {
          expect(libro.numero).toBeNull();
          expect(libro.fecha_rubrica).toBeNull();
          expect(libro.expediente_rubrica).toBeNull();
        }
        const libroId = await openLibroId(tx, tenantId, "RECETARIO");

        // NULL -> value, as the runtime role (fsj_app has a column grant for exactly this).
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async () => {
          await tx.query(
            `UPDATE fsj.libro_rubricado SET numero = 'R-2026-001', fecha_rubrica = '2026-09-01', expediente_rubrica = 'EXP-123' WHERE id = $1`,
            [libroId],
          );
          const after = await tx.query(
            `SELECT numero, to_char(fecha_rubrica, 'YYYY-MM-DD') AS fecha_rubrica, expediente_rubrica FROM fsj.libro_rubricado WHERE id = $1`,
            [libroId],
          );
          expect(after.rows[0]).toEqual({ numero: "R-2026-001", fecha_rubrica: "2026-09-01", expediente_rubrica: "EXP-123" });

          // value -> other value: rejected, for every column.
          for (const set of [`numero = 'R-OTRO'`, `fecha_rubrica = '2026-09-02'`, `expediente_rubrica = 'EXP-OTRO'`]) {
            await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.libro_rubricado SET ${set} WHERE id = $1`, [libroId]), "INV-LIB-001");
          }
          // value -> NULL: rejected too.
          for (const set of [`numero = NULL`, `fecha_rubrica = NULL`, `expediente_rubrica = NULL`]) {
            await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.libro_rubricado SET ${set} WHERE id = $1`, [libroId]), "INV-LIB-001");
          }
        });
      }),
    );
  });

  it("each rubric field can be filled independently (one NULL -> value per column, not all-at-once)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "rubricaParcial");
        const sistema = await createSistemaUser(tx, tenantId);
        await crearLibrosRubricados(tx, tenantId, sistema);
        const libroId = await openLibroId(tx, tenantId, "PSICOTROPICO");

        await tx.query(`UPDATE fsj.libro_rubricado SET numero = 'P-1' WHERE id = $1`, [libroId]);
        await tx.query(`UPDATE fsj.libro_rubricado SET fecha_rubrica = '2026-01-15' WHERE id = $1`, [libroId]);
        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.libro_rubricado SET numero = 'P-2' WHERE id = $1`, [libroId]), "INV-LIB-001");
        await tx.query(`UPDATE fsj.libro_rubricado SET expediente_rubrica = 'E-9' WHERE id = $1`, [libroId]);

        const row = await tx.query(`SELECT numero, expediente_rubrica FROM fsj.libro_rubricado WHERE id = $1`, [libroId]);
        expect(row.rows[0]).toEqual({ numero: "P-1", expediente_rubrica: "E-9" });
      }),
    );
  });
});

// ============================================================================
// Migration 0018 -- N2/N3: jornada at the Mendoza (UTC-3) day boundary.
// ============================================================================
describe.skipIf(dbTestSkipReason() !== null)("0018_legal_core_fixes -- N2/N3 fsj.jornada_de (fsj schema)", () => {
  it("fsj.jornada_de puts the Mendoza day boundary at 03:00Z", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const cases: Array<[string, string]> = [
          ["2026-09-21 23:30:00-03", "2026-09-21"], // 23:30 local
          ["2026-09-22 02:30:00+00", "2026-09-21"], // still 23:30 local
          ["2026-09-22 02:59:59.999999+00", "2026-09-21"], // last instant of the jornada
          ["2026-09-22 03:00:00+00", "2026-09-22"], // local midnight
        ];
        for (const [instante, esperado] of cases) {
          const r = await tx.query(`SELECT to_char(fsj.jornada_de($1::timestamptz, 'America/Argentina/Mendoza'), 'YYYY-MM-DD') AS j`, [instante]);
          expect(r.rows[0].j, instante).toBe(esperado);
        }
        // Independent of the session TimeZone.
        await tx.query(`SET LOCAL TimeZone = 'Pacific/Kiritimati'`);
        const r = await tx.query(`SELECT to_char(fsj.jornada_de('2026-09-22 02:30:00+00', 'America/Argentina/Mendoza'), 'YYYY-MM-DD') AS j`);
        expect(r.rows[0].j).toBe("2026-09-21");
      }),
    );
  });

  it("fsj.jornada_actual delegates to fsj.jornada_de(<instant>, tenant.zona_horaria), instant = now() with no reloj_prueba override", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "jornadaActual");
        // No fsj.reloj_prueba set in this transaction -- every zone below
        // must resolve through the real now() (fsj.instante_actual()'s ELSE
        // branch, migration 0026), same as before migrations 0024/0026 existed.
        for (const zona of ["America/Argentina/Mendoza", "Etc/GMT+12", "Pacific/Kiritimati"]) {
          await tx.query(`UPDATE fsj.tenant SET zona_horaria = $2 WHERE id = $1`, [tenantId, zona]);
          const r = await tx.query(
            `SELECT fsj.jornada_actual($1) = fsj.jornada_de(now(), $2) AS igual`,
            [tenantId, zona],
          );
          expect(r.rows[0].igual, zona).toBe(true);
        }
        // Migration 0026 (instante_actual) extracted the "resolve now(),
        // honouring the fsj.reloj_prueba override" CASE out of
        // fsj.jornada_actual into its own fsj.instante_actual() (testable by
        // fsj_app directly, with no tenant row needed -- see that
        // migration's header and tests/db/jornada-reloj-prueba.test.ts for
        // the override's own dedicated coverage, including the security
        // test). Assert the one structural fact this test cares about: it
        // still delegates to fsj.jornada_de via fsj.instante_actual().
        const def = await tx.query(`SELECT pg_get_functiondef('fsj.jornada_actual(uuid)'::regprocedure) AS d`);
        expect(def.rows[0].d).toContain("fsj.jornada_de(fsj.instante_actual()");
      }),
    );
  });
});

// ============================================================================
// Migration 0033 -- D1: fsj.rectificacion_asiento (INV-L21, both directions).
// ============================================================================
describe.skipIf(dbTestSkipReason() !== null)("0033_rectificacion_asiento -- INV-L21 (fsj schema)", () => {
  /** Signs seed.asientoId's jornada and returns the DT id/designacionId + the RECTIFICATIVO-eligible fecha. Mirrors the "rectificativo" test in the 0014 describe block above. */
  async function firmarJornadaDeSeed(tx: Client, seed: AsientoSistemaResult): Promise<{ dtId: string; designacionId: string }> {
    const dtUser = await tx.query(
      `INSERT INTO fsj.usuario (tenant_id, email, nombre, apellido, dni, estado, creado_por_id) VALUES ($1,$2,'D','T',$3,'ACTIVO',$4) RETURNING id`,
      [seed.tenantId, `dt-${randomUUID()}@example.com`, `DNI-${randomUUID()}`, seed.sistema],
    );
    const dtId = dtUser.rows[0].id as string;
    const rolResult = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'DIRECTOR_TECNICO'`);
    await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
      seed.tenantId,
      dtId,
      rolResult.rows[0].id,
      seed.sistema,
    ]);
    const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema);
    const asientoOriginal = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
    await tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, asientoOriginal.rows[0].fecha_asiento, dtId, designacionId]);
    return { dtId, designacionId };
  }

  it("a RECTIFICATIVO asiento with NO rectificacion_asiento fails at commit (INV-L21, asiento side)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "l21NoAuth");
        await firmarJornadaDeSeed(tx, seed);
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");

        const rectificativo = await tx.query(
          `INSERT INTO fsj.asiento_recetario (tenant_id, origen, asiento_original_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
           VALUES ($1, 'RECTIFICATIVO', $2, 'Paciente', 'Medico - MAT-1', 'Formula corregida', $3) RETURNING id`,
          [seed.tenantId, seed.asientoId, seed.sistema],
        );

        // No fsj.rectificacion_asiento row was inserted -- forcing the
        // deferred check NOW (instead of waiting for a COMMIT this suite
        // never performs) must reject it.
        await expectInvariantViolation(tx, () => tx.query(`SET CONSTRAINTS ALL IMMEDIATE`), "INV-L21");
        void rectificativo;
      }),
    );
  });

  it("a rectificacion_asiento pointing at a non-RECTIFICATIVO asiento is rejected immediately (INV-L21, rectificacion side)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "l21WrongOrigen");
        const dtId = await crearDtVigente(tx, seed);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.rectificacion_asiento (tenant_id, asiento_rectificativo_id, motivo, autorizado_por_id, registrado_por_id)
               VALUES ($1, $2, 'motivo', $3, $4)`,
              // seed.asientoId is SISTEMA, not RECTIFICATIVO.
              [seed.tenantId, seed.asientoId, dtId, seed.sistema],
            ),
          "INV-L21",
        );
      }),
    );
  });

  it("rectificacion_asiento.autorizado_por_id must be a DT vigente today (INV-U05)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "l21NoDt");
        await firmarJornadaDeSeed(tx, seed);
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");

        const rectificativo = await tx.query(
          `INSERT INTO fsj.asiento_recetario (tenant_id, origen, asiento_original_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
           VALUES ($1, 'RECTIFICATIVO', $2, 'Paciente', 'Medico - MAT-1', 'Formula corregida', $3) RETURNING id`,
          [seed.tenantId, seed.asientoId, seed.sistema],
        );

        // seed.sistema is NOT a DT vigente.
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.rectificacion_asiento (tenant_id, asiento_rectificativo_id, motivo, autorizado_por_id, registrado_por_id)
               VALUES ($1, $2, 'motivo', $3, $4)`,
              [seed.tenantId, rectificativo.rows[0].id, seed.sistema, seed.sistema],
            ),
          "INV-U05",
        );
      }),
    );
  });

  it("asiento + rectificacion_asiento inserted together (correct order) satisfy INV-L21 at commit -- and a SECOND rectificacion for the SAME rectificativo is rejected (unique, immediate)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await setRelojPrueba(tx, "2026-06-15T12:00:00-03:00");
        const seed = await seedAsientoSistema(tx, "l21Ok");
        const { dtId } = await firmarJornadaDeSeed(tx, seed);
        await setRelojPrueba(tx, "2026-06-16T12:00:00-03:00");

        const rectificativo = await tx.query(
          `INSERT INTO fsj.asiento_recetario (tenant_id, origen, asiento_original_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
           VALUES ($1, 'RECTIFICATIVO', $2, 'Paciente', 'Medico - MAT-1', 'Formula corregida', $3) RETURNING id`,
          [seed.tenantId, seed.asientoId, seed.sistema],
        );
        const rectificativoId = rectificativo.rows[0].id as string;

        await tx.query(
          `INSERT INTO fsj.rectificacion_asiento (tenant_id, asiento_rectificativo_id, motivo, autorizado_por_id, registrado_por_id)
           VALUES ($1, $2, 'error de dato', $3, $4)`,
          [seed.tenantId, rectificativoId, dtId, seed.sistema],
        );

        // Forcing the deferred check now: the pair together satisfy INV-L21.
        await tx.query(`SET CONSTRAINTS ALL IMMEDIATE`);

        // A second authorization for the SAME rectificativo is rejected --
        // plain UNIQUE, checked immediately regardless of deferral.
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.rectificacion_asiento (tenant_id, asiento_rectificativo_id, motivo, autorizado_por_id, registrado_por_id)
               VALUES ($1, $2, 'otra vez', $3, $4)`,
              [seed.tenantId, rectificativoId, dtId, seed.sistema],
            ),
          "23505",
        );

        // Immutable: no UPDATE/DELETE grant.
        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(
          tx,
          () => tx.query(`UPDATE fsj.rectificacion_asiento SET motivo = 'x' WHERE tenant_id = $1`, [seed.tenantId]),
          "42501",
        );
      }),
    );
  });
});
