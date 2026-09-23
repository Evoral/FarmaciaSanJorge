/**
 * DB tests for prisma/migrations/*_0005_designacion_director_tecnico.
 * See tests/db/helpers.ts for the rollback-transaction safety model and
 * tests/db/tenant-parametro.test.ts for the `SET LOCAL ROLE fsj_app`
 * technique used by the fsj.es_dt_vigente() tests (RLS-dependent function).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";
import { seedAsientoSistema, designarDt } from "./fixtures";

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

/**
 * `estado` defaults to `ACTIVO` -- NOT the schema's own DEFAULT
 * (`PENDIENTE_ACTIVACION`, migration 0002). See the identical helper in
 * tests/db/fixtures.ts for why. Pass `estado` explicitly for the
 * INV-DT-005 / es_dt_vigente tests below that specifically need a
 * non-active user.
 */
async function createUserWithRole(
  tx: Client,
  tenantId: string,
  rolCodigo: string,
  sistema: string,
  suffix: string,
  estado: "PENDIENTE_ACTIVACION" | "ACTIVO" | "SUSPENDIDO" | "BAJA" = "ACTIVO",
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5,$6)`,
    [id, tenantId, `${suffix}-${Date.now()}@example.com`, `DNI-${suffix}-${Date.now()}`, estado, sistema],
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

describe.skipIf(dbTestSkipReason() !== null)("0005_designacion_director_tecnico migration (fsj schema)", () => {
  it("INV-DT-001: designating a user without role DIRECTOR_TECNICO is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt001a");
        const sistema = await createSistemaUser(tx, tenantId);
        const farmaceutico = await createUserWithRole(tx, tenantId, "FARMACEUTICO", sistema, "far");

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
               VALUES ($1, $2, 'TITULAR', 'MAT-1', '2026-01-01', $3)`,
              [tenantId, farmaceutico, sistema],
            ),
          "INV-DT-001",
        );
      }),
    );
  });

  it("INV-DT-001: designating a user WITH role DIRECTOR_TECNICO succeeds", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt001b");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt");

        const result = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-2', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        expect(result.rows).toHaveLength(1);
      }),
    );
  });

  it("INV-DT-002: two overlapping TITULAR periods in the same tenant are rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt002");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt1 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt1");
        const dt2 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt2");

        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-A', '2026-01-01', '2026-06-30', $3)`,
          [tenantId, dt1, sistema],
        );
        await expectDbRejection(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
               VALUES ($1, $2, 'TITULAR', 'MAT-B', '2026-06-01', '2026-12-31', $3)`,
              [tenantId, dt2, sistema],
            ),
          "23P01",
        );
      }),
    );
  });

  it("INV-DT-002: back-to-back (non-overlapping) TITULAR periods are allowed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt002b");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt1 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt1b");
        const dt2 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt2b");

        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-C', '2026-01-01', '2026-05-31', $3)`,
          [tenantId, dt1, sistema],
        );
        // Starts the day after the previous one ends -- no overlap.
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-D', '2026-06-01', '2026-12-31', $3)`,
          [tenantId, dt2, sistema],
        );
      }),
    );
  });

  it("DP-11: overlapping SUPLENTE periods are NOT constrained (only TITULAR is)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt011");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt1 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "sup1");
        const dt2 = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "sup2");

        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'SUPLENTE', 'MAT-E', '2026-01-01', '2026-12-31', $3)`,
          [tenantId, dt1, sistema],
        );
        // Fully overlapping SUPLENTE period -- must succeed (DP-11 pending).
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'SUPLENTE', 'MAT-F', '2026-01-01', '2026-12-31', $3)`,
          [tenantId, dt2, sistema],
        );
      }),
    );
  });

  it("INV-DT-002: overlapping TITULAR periods in DIFFERENT tenants are allowed (exclusion is per-tenant)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantA = await insertTenant(tx, "dt002cA");
        const tenantB = await insertTenant(tx, "dt002cB");
        const sistemaA = await createSistemaUser(tx, tenantA);
        const sistemaB = await createSistemaUser(tx, tenantB);
        const dtA = await createUserWithRole(tx, tenantA, "DIRECTOR_TECNICO", sistemaA, "dtA");
        const dtB = await createUserWithRole(tx, tenantB, "DIRECTOR_TECNICO", sistemaB, "dtB");

        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-G', '2026-01-01', '2026-12-31', $3)`,
          [tenantA, dtA, sistemaA],
        );
        // Same dates, different tenant -- must succeed.
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-H', '2026-01-01', '2026-12-31', $3)`,
          [tenantB, dtB, sistemaB],
        );
      }),
    );
  });

  it("INV-DT-003: vigente_desde and matricula are immutable", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt003");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt003");
        const row = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-I', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        const id = row.rows[0].id;

        // Each violation is wrapped in its own savepoint (via
        // expectInvariantViolation) so the second assertion below actually
        // exercises the matricula immutability check, instead of just
        // observing the first violation's aborted transaction -- see the
        // aborted-transaction rule in tests/db/helpers.ts.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.designacion_director_tecnico SET vigente_desde = '2026-02-01' WHERE id = $1`, [id]),
          "INV-DT-003",
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.designacion_director_tecnico SET matricula = 'MAT-CHANGED' WHERE id = $1`, [id]),
          "INV-DT-003",
        );
      }),
    );
  });

  it("INV-DT-003: cese sets vigente_hasta + motivo_cese (allowed), but is final (cannot change again)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt003b");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt003b");
        const row = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-J', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        const id = row.rows[0].id;

        // Cese: allowed.
        await tx.query(
          `UPDATE fsj.designacion_director_tecnico SET vigente_hasta = '2026-06-30', motivo_cese = 'renuncia' WHERE id = $1`,
          [id],
        );

        // Changing vigente_hasta again afterwards: rejected (cese is final).
        // Savepoint-wrapped (via expectInvariantViolation) so the second
        // assertion below still genuinely exercises the motivo_cese check.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.designacion_director_tecnico SET vigente_hasta = '2026-07-31' WHERE id = $1`, [id]),
          "INV-DT-003",
        );

        // Rewriting motivo_cese alone afterwards: also rejected.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.designacion_director_tecnico SET motivo_cese = 'otro motivo' WHERE id = $1`, [id]),
          "INV-DT-003",
        );
      }),
    );
  });

  it("INV-DT-003: motivo_cese without vigente_hasta is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt003c");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt003c");
        const row = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-L', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(`UPDATE fsj.designacion_director_tecnico SET motivo_cese = 'sin fecha' WHERE id = $1`, [
              row.rows[0].id,
            ]),
          "INV-DT-003",
        );
      }),
    );
  });

  it("designacion_director_tecnico rows are never deleted (generic forbid_delete)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dtdel");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dtdel");
        const row = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-K', '2026-01-01', $3) RETURNING id`,
          [tenantId, dt, sistema],
        );
        await expectInvariantViolation(
          tx,
          () => tx.query(`DELETE FROM fsj.designacion_director_tecnico WHERE id = $1`, [row.rows[0].id]),
          "INV-IMMUTABLE",
        );
      }),
    );
  });

  it("fsj.es_dt_vigente() is true within [vigente_desde, vigente_hasta] and false at the boundaries outside it", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "esdt");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "esdt");
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-L', '2026-03-01', '2026-03-31', $3)`,
          [tenantId, dt, sistema],
        );

        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          const before = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-02-28') AS v`, [dt]);
          expect(before.rows[0].v).toBe(false);

          const startBoundary = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-03-01') AS v`, [dt]);
          expect(startBoundary.rows[0].v).toBe(true);

          const endBoundary = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-03-31') AS v`, [dt]);
          expect(endBoundary.rows[0].v).toBe(true);

          const after = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-04-01') AS v`, [dt]);
          expect(after.rows[0].v).toBe(false);
        });
      }),
    );
  });

  it("fsj.es_dt_vigente() with no app.tenant_id set returns false regardless of data (RLS)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "esdtnotenant");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "esdtnotenant");
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-M', '2026-01-01', $3)`,
          [tenantId, dt, sistema],
        );

        await tx.query("SET LOCAL ROLE fsj_app");
        const result = await tx.query(`SELECT fsj.es_dt_vigente($1, '2026-06-01') AS v`, [dt]);
        expect(result.rows[0].v).toBe(false);
      }),
    );
  });
});

/**
 * DB tests for prisma/migrations/*_0022_dt_usuario_activo (FASE 3 point
 * 3.9 review finding M1): `usuario.estado` now gates both designation
 * (INV-DT-005, a CREATE OR REPLACE of migration 0005's INV-DT-001 trigger
 * function) and vigency (`fsj.es_dt_vigente`, also CREATE OR REPLACE'd).
 * `createUserWithRole` here defaults `estado` to `ACTIVO` (see that
 * helper's doc comment) -- these tests pass `"SUSPENDIDO"` explicitly.
 */
describe.skipIf(dbTestSkipReason() !== null)("0022_dt_usuario_activo migration (fsj schema)", () => {
  it("INV-DT-005: designating a SUSPENDIDO user who holds role DIRECTOR_TECNICO is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt005a");
        const sistema = await createSistemaUser(tx, tenantId);
        const suspendido = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt005susp", "SUSPENDIDO");

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
               VALUES ($1, $2, 'TITULAR', 'MAT-DT005A', '2026-01-01', $3)`,
              [tenantId, suspendido, sistema],
            ),
          "INV-DT-005",
        );
      }),
    );
  });

  it("INV-DT-005: designating an ACTIVO user who holds role DIRECTOR_TECNICO succeeds", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt005b");
        const sistema = await createSistemaUser(tx, tenantId);
        const activo = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt005act");

        const result = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-DT005B', '2026-01-01', $3) RETURNING id`,
          [tenantId, activo, sistema],
        );
        expect(result.rows).toHaveLength(1);
      }),
    );
  });

  it("fsj.es_dt_vigente() is false for a SUSPENDIDO user whose designation covers the date, and true again once the user is ACTIVO", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "dt005c");
        const sistema = await createSistemaUser(tx, tenantId);
        const dt = await createUserWithRole(tx, tenantId, "DIRECTOR_TECNICO", sistema, "dt005c");
        await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, vigente_hasta, registrado_por_id)
           VALUES ($1, $2, 'TITULAR', 'MAT-DT005C', '2026-03-01', '2026-03-31', $3)`,
          [tenantId, dt, sistema],
        );

        // While ACTIVO: vigente.
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          const vigenteActivo = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-03-15') AS v`, [dt]);
          expect(vigenteActivo.rows[0].v).toBe(true);
        });
        await tx.query("RESET ROLE");

        // Suspended (still owner role, which can write usuario.estado
        // directly -- the app's cambiarEstadoUsuario flow is out of scope
        // for this DB-level test): no longer vigente, despite the
        // designation itself still covering the date.
        await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [dt]);
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          const vigenteSuspendido = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-03-15') AS v`, [dt]);
          expect(vigenteSuspendido.rows[0].v).toBe(false);
        });
        await tx.query("RESET ROLE");

        // ACTIVO again (a valid SUSPENDIDO -> ACTIVO transition, INV-USR-006):
        // vigente again, same designation, untouched.
        await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [dt]);
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async (c) => {
          const vigenteDeNuevo = await c.query(`SELECT fsj.es_dt_vigente($1, '2026-03-15') AS v`, [dt]);
          expect(vigenteDeNuevo.rows[0].v).toBe(true);
        });
      }),
    );
  });
});

/**
 * DB tests for prisma/migrations/*_0021_designacion_dt_cese_retroactivo_guard
 * (INV-DT-004). Reuses the signing fixtures from tests/db/fixtures.ts
 * (`seedAsientoSistema`/`designarDt`) and the "get a designacion's cierre
 * signed" technique from tests/db/cierre-diario.test.ts --
 * `fsj.cierre_diario_firmar(tenantId, fecha, dtId, designacionId)` links
 * `cierre_diario.designacion_id` to the designacion that signed it, which
 * is exactly what the trigger under test (`WHERE c.designacion_id =
 * OLD.id`) keys off.
 */
describe.skipIf(dbTestSkipReason() !== null)("0021_designacion_dt_cese_retroactivo_guard migration (fsj schema)", () => {
  it("INV-DT-004: a cese with vigente_hasta strictly before an already-signed cierre_diario that references this designacion is rejected", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "dt004a");
        const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dt004a");
        const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema);

        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        await tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]);

        const diaAnterior = await tx.query(`SELECT ($1::date - 1)::text AS f`, [fecha.rows[0].fecha_asiento]);

        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `UPDATE fsj.designacion_director_tecnico SET vigente_hasta = $1, motivo_cese = 'cese retroactivo' WHERE id = $2`,
              [diaAnterior.rows[0].f, designacionId],
            ),
          "INV-DT-004",
        );
      }),
    );
  });

  it("a cese dated ON the fecha of the last signed cierre_diario (not strictly before it) is allowed", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "dt004b");
        const dtId = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dt004b");
        const { designacionId } = await designarDt(tx, seed.tenantId, dtId, seed.sistema);

        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        await tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtId, designacionId]);

        const result = await tx.query(
          `UPDATE fsj.designacion_director_tecnico SET vigente_hasta = $1, motivo_cese = 'cese el mismo dia del cierre' WHERE id = $2
           RETURNING vigente_hasta::text`,
          [fecha.rows[0].fecha_asiento, designacionId],
        );
        expect(result.rows[0].vigente_hasta).toBe(fecha.rows[0].fecha_asiento);
      }),
    );
  });

  it("a retroactive cese of a designacion never referenced by any signed cierre is allowed (the guard is scoped by designacion_id, not just tenant+fecha)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const seed = await seedAsientoSistema(tx, "dt004c");

        // Designacion A signs the jornada -- this is the ONLY designacion the resulting cierre_diario.designacion_id references.
        const dtA = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dt004cA");
        const { designacionId: designacionAId } = await designarDt(tx, seed.tenantId, dtA, seed.sistema);
        const fecha = await tx.query(`SELECT fecha_asiento::text FROM fsj.asiento_recetario WHERE id = $1`, [seed.asientoId]);
        await tx.query(`SELECT fsj.cierre_diario_firmar($1, $2, $3, $4)`, [seed.tenantId, fecha.rows[0].fecha_asiento, dtA, designacionAId]);

        // Designacion B (a SEPARATE, unrelated SUPLENTE period, same tenant) was never used to sign anything.
        const dtB = await createUserWithRole(tx, seed.tenantId, "DIRECTOR_TECNICO", seed.sistema, "dt004cB");
        const designacionB = await tx.query(
          `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
           VALUES ($1, $2, 'SUPLENTE', 'MAT-DT004C', '2000-01-01', $3) RETURNING id`,
          [seed.tenantId, dtB, seed.sistema],
        );
        const designacionBId = designacionB.rows[0].id as string;

        // Cese of B dated BEFORE the signed cierre's fecha still succeeds: the
        // trigger's subquery is `WHERE c.designacion_id = OLD.id`, and no
        // cierre_diario row references designacionB.
        const diaAnterior = await tx.query(`SELECT ($1::date - 1)::text AS f`, [fecha.rows[0].fecha_asiento]);
        const result = await tx.query(
          `UPDATE fsj.designacion_director_tecnico SET vigente_hasta = $1, motivo_cese = 'sin conflicto: otra designacion' WHERE id = $2
           RETURNING vigente_hasta::text`,
          [diaAnterior.rows[0].f, designacionBId],
        );
        expect(result.rows[0].vigente_hasta).toBe(diaAnterior.rows[0].f);
      }),
    );
  });
});
