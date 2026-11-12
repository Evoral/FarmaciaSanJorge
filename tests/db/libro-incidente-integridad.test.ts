/**
 * Migration 0129 (openspec/changes/incidentes-integridad-plataforma, libro spec "Incidente de integridad" and
 * plataforma P18): the persisted integrity incidents.
 *
 * - fsj.libro_incidente_registrar is the whole state machine (ABIERTO / REPETIDO / CERRADO / SIN_CAMBIO; a moved
 *   number closes one and opens another), run as fsj_app so RLS and grants are the real ones.
 * - The table is guarded by the database: one open row per libro, no DELETE, no UPDATE of the identity columns,
 *   a resolved row is frozen (INV-L27), detecciones never decrease.
 * - fsj.plataforma_incidentes_integridad is the only platform door to the table and validates the session first.
 *
 * Not covered here: true two-connection concurrency ("Detecciones simultaneas"). The rolled-back harness runs in one
 * transaction; that scenario rests on the advisory lock in the function (serializes the same libro) and on the partial
 * unique index (backstop), both asserted structurally below.
 */
import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, withTenant, expectInvariantViolation, expectDbRejection } from "./helpers";
import { insertTenant, createSistemaUser, crearLibrosRubricados } from "./fixtures";

const TOKEN_HASH = createHash("sha256").update(`token-${randomUUID()}`).digest("hex");

interface Escenario {
  tenantId: string;
  recetarioId: string;
  contralorId: string;
}

async function prepararTenant(tx: Client): Promise<Escenario> {
  const tenantId = await insertTenant(tx, randomUUID().slice(0, 8));
  const sistema = await createSistemaUser(tx, tenantId);
  await crearLibrosRubricados(tx, tenantId, sistema);
  const libros = await tx.query(`SELECT id, tipo::text AS tipo FROM fsj.libro_rubricado WHERE tenant_id = $1`, [tenantId]);
  const idDe = (tipo: string) => libros.rows.find((l) => l.tipo === tipo)!.id as string;
  return { tenantId, recetarioId: idDe("RECETARIO"), contralorId: idDe("PSICOTROPICO") };
}

async function prepararSesion(tx: Client): Promise<void> {
  const { rows } = await tx.query(`INSERT INTO fsj.superadmin (email, nombre, password_hash) VALUES ($1, 'Ops', 'h') RETURNING id`, [`ops-${randomUUID()}@plataforma.test`]);
  await tx.query(`INSERT INTO fsj.superadmin_sesion (superadmin_id, token_hash, expira_en) VALUES ($1, $2, now() + interval '1 hour')`, [rows[0].id, TOKEN_HASH]);
}

async function registrar(tx: Client, libroId: string, quiebre: number | null): Promise<{ transicion: string; incidente_id: string | null }> {
  const { rows } = await tx.query(`SELECT transicion, incidente_id FROM fsj.libro_incidente_registrar($1, $2)`, [libroId, quiebre]);
  return rows[0];
}

async function filas(tx: Client, libroId: string): Promise<Array<{ n: string; detecciones: number; abierto: boolean }>> {
  const { rows } = await tx.query(
    `SELECT primer_quiebre_numero::text AS n, detecciones, (resuelto_en IS NULL) AS abierto
     FROM fsj.libro_incidente_integridad WHERE libro_id = $1 ORDER BY primer_quiebre_numero, (resuelto_en IS NULL)`,
    [libroId],
  );
  return rows;
}

describe.skipIf(dbTestSkipReason() !== null)("0129 libro_incidente_integridad", () => {
  it("registrar: primer quiebre, repetido, el numero se corre, cerrado, sin cambio", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, recetarioId } = await prepararTenant(tx);
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async () => {
          expect(await registrar(tx, recetarioId, null)).toEqual({ transicion: "SIN_CAMBIO", incidente_id: null });

          const abierto = await registrar(tx, recetarioId, 120);
          expect(abierto.transicion).toBe("ABIERTO");
          expect(abierto.incidente_id).toEqual(expect.any(String));
          expect(await filas(tx, recetarioId)).toEqual([{ n: "120", detecciones: 1, abierto: true }]);

          const repetido = await registrar(tx, recetarioId, 120);
          expect(repetido).toEqual({ transicion: "REPETIDO", incidente_id: abierto.incidente_id });
          expect(await filas(tx, recetarioId)).toEqual([{ n: "120", detecciones: 2, abierto: true }]);

          const corrido = await registrar(tx, recetarioId, 130);
          expect(corrido.transicion).toBe("ABIERTO");
          expect(corrido.incidente_id).not.toBe(abierto.incidente_id);
          expect(await filas(tx, recetarioId)).toEqual([
            { n: "120", detecciones: 2, abierto: false },
            { n: "130", detecciones: 1, abierto: true },
          ]);

          const cerrado = await registrar(tx, recetarioId, null);
          expect(cerrado).toEqual({ transicion: "CERRADO", incidente_id: corrido.incidente_id });
          expect((await filas(tx, recetarioId)).every((f) => !f.abierto)).toBe(true);
          expect(await registrar(tx, recetarioId, null)).toEqual({ transicion: "SIN_CAMBIO", incidente_id: null });

          // Another quiebre after the close opens a NEW incident and leaves the resolved ones alone.
          const nuevo = await registrar(tx, recetarioId, 130);
          expect(nuevo.transicion).toBe("ABIERTO");
          expect(nuevo.incidente_id).not.toBe(corrido.incidente_id);
          expect((await filas(tx, recetarioId)).map((f) => [f.n, f.abierto])).toEqual([
            ["120", false],
            ["130", false],
            ["130", true],
          ]);
        });
      }),
    );
  });

  it("registrar: each libro is evaluated on its own", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, recetarioId, contralorId } = await prepararTenant(tx);
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async () => {
          await registrar(tx, recetarioId, 5);
          await registrar(tx, contralorId, 7);
          expect(await filas(tx, recetarioId)).toEqual([{ n: "5", detecciones: 1, abierto: true }]);
          expect(await filas(tx, contralorId)).toEqual([{ n: "7", detecciones: 1, abierto: true }]);
          // Closing one leaves the other open.
          await registrar(tx, recetarioId, null);
          expect((await filas(tx, contralorId))[0]!.abierto).toBe(true);
        });
      }),
    );
  });

  it("registrar without a tenant raises TN001", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { recetarioId } = await prepararTenant(tx);
        await tx.query("SET LOCAL ROLE fsj_app");
        await expectDbRejection(tx, () => registrar(tx, recetarioId, 3), "TN001");
      }),
    );
  });

  it("the function is SECURITY INVOKER, takes the advisory lock and is not executable by PUBLIC", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { rows } = await tx.query(
          `SELECT p.prosecdef, pg_get_functiondef(p.oid) AS def,
                  has_function_privilege('public', p.oid, 'EXECUTE') AS publico,
                  has_function_privilege('fsj_app', p.oid, 'EXECUTE') AS app
           FROM pg_proc p WHERE p.oid = 'fsj.libro_incidente_registrar(uuid,bigint)'::regprocedure`,
        );
        expect(rows[0].prosecdef).toBe(false);
        expect(rows[0].def).toContain("pg_advisory_xact_lock");
        expect(rows[0].def).toContain("search_path");
        expect(rows[0].publico).toBe(false);
        expect(rows[0].app).toBe(true);
      }),
    );
  });

  it("a second open row for the same libro fails on the partial unique index; a resolved one does not", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, recetarioId } = await prepararTenant(tx);
        const insertar = () =>
          tx.query(`INSERT INTO fsj.libro_incidente_integridad (tenant_id, libro_id, primer_quiebre_numero) VALUES ($1, $2, 9)`, [tenantId, recetarioId]);
        await insertar();
        await expectDbRejection(tx, () => insertar(), "23505");
        await tx.query(`UPDATE fsj.libro_incidente_integridad SET resuelto_en = now() WHERE libro_id = $1`, [recetarioId]);
        await insertar(); // the first one is resolved now: a new open one is fine
      }),
    );
  });

  it("fsj_app cannot DELETE nor UPDATE the identity columns; a resolved row is frozen; detecciones never decrease; INSERT with resuelto_en is refused", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, recetarioId, contralorId } = await prepararTenant(tx);
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, tenantId, async () => {
          await registrar(tx, recetarioId, 4);
          await registrar(tx, recetarioId, 4); // detecciones = 2
          await registrar(tx, contralorId, 8);
          await registrar(tx, contralorId, null); // resolved

          await expectDbRejection(tx, () => tx.query(`DELETE FROM fsj.libro_incidente_integridad WHERE libro_id = $1`, [recetarioId]), "42501");
          await expectDbRejection(tx, () => tx.query(`UPDATE fsj.libro_incidente_integridad SET libro_id = $2 WHERE libro_id = $1`, [recetarioId, contralorId]), "42501");
          await expectDbRejection(tx, () => tx.query(`UPDATE fsj.libro_incidente_integridad SET primer_quiebre_numero = 99 WHERE libro_id = $1`, [recetarioId]), "42501");
          await expectDbRejection(tx, () => tx.query(`UPDATE fsj.libro_incidente_integridad SET detectado_en = now() WHERE libro_id = $1`, [recetarioId]), "42501");

          await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.libro_incidente_integridad SET detecciones = 1 WHERE libro_id = $1`, [recetarioId]), "INV-L27");
          await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.libro_incidente_integridad SET detecciones = detecciones + 1 WHERE libro_id = $1`, [contralorId]), "INV-L27");
          await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.libro_incidente_integridad SET resuelto_en = NULL WHERE libro_id = $1`, [contralorId]), "INV-L27");
          await expectInvariantViolation(
            tx,
            () =>
              tx.query(
                `INSERT INTO fsj.libro_incidente_integridad (tenant_id, libro_id, primer_quiebre_numero, resuelto_en) VALUES ($1, $2, 1, now())`,
                [tenantId, recetarioId],
              ),
            "INV-L27",
          );

          // The row that was not touched is intact.
          expect(await filas(tx, recetarioId)).toEqual([{ n: "4", detecciones: 2, abierto: true }]);
        });
      }),
    );
  });

  it("as owner DELETE is still refused by the trigger", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const { tenantId, recetarioId } = await prepararTenant(tx);
        await tx.query(`INSERT INTO fsj.libro_incidente_integridad (tenant_id, libro_id, primer_quiebre_numero) VALUES ($1, $2, 2)`, [tenantId, recetarioId]);
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.libro_incidente_integridad WHERE libro_id = $1`, [recetarioId]), "INV-IMMUTABLE");
      }),
    );
  });

  it("RLS: another tenant sees no incident and cannot register one for a foreign libro", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const a = await prepararTenant(tx);
        const b = await prepararTenant(tx);
        await tx.query("SET LOCAL ROLE fsj_app");
        await withTenant(tx, a.tenantId, async () => {
          await registrar(tx, a.recetarioId, 11);
        });
        await withTenant(tx, b.tenantId, async () => {
          const visibles = await tx.query(`SELECT count(*)::int AS n FROM fsj.libro_incidente_integridad`);
          expect(visibles.rows[0].n).toBe(0);
          // The foreign libro does not exist for B: the insert hits the (tenant_id, libro_id) FK.
          await expectDbRejection(tx, () => registrar(tx, a.recetarioId, 11), "23503");
        });
        await withTenant(tx, a.tenantId, async () => {
          expect(await filas(tx, a.recetarioId)).toEqual([{ n: "11", detecciones: 1, abierto: true }]);
        });
      }),
    );
  });

  describe("fsj.plataforma_incidentes_integridad", () => {
    const LISTAR = `SELECT * FROM fsj.plataforma_incidentes_integridad($1, $2::uuid[], $3, $4)`;

    async function sembrar(tx: Client): Promise<Escenario> {
      const e = await prepararTenant(tx);
      await prepararSesion(tx);
      await tx.query("SET LOCAL ROLE fsj_app");
      await withTenant(tx, e.tenantId, async () => {
        await registrar(tx, e.recetarioId, 120);
        await registrar(tx, e.recetarioId, 120);
        await registrar(tx, e.recetarioId, 120);
        await registrar(tx, e.contralorId, 8);
        await registrar(tx, e.contralorId, null); // resolved
      });
      await tx.query("SELECT set_config('app.tenant_id', '', true)"); // the platform function must not need a tenant
      return e;
    }

    it("is VOLATILE (0130): it calls fsj.plataforma_actor, which may UPDATE the session", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { rows } = await tx.query(
            `SELECT provolatile FROM pg_proc WHERE oid = 'fsj.plataforma_incidentes_integridad(text,uuid[],boolean,integer)'::regprocedure`,
          );
          expect(rows[0].provolatile).toBe("v");
        }),
      );
    });

    it("returns open first, only the eight listed columns, and filters solo_abiertos", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const e = await sembrar(tx);
          const todos = await tx.query(LISTAR, [TOKEN_HASH, [e.tenantId], false, 50]);
          expect(Object.keys(todos.rows[0]).sort()).toEqual(
            ["detecciones", "detectado_en", "id", "libro_tipo", "primer_quiebre_numero", "resuelto_en", "tenant_id", "ultima_deteccion_en"].sort(),
          );
          expect(todos.rows.map((r) => [r.libro_tipo, String(r.primer_quiebre_numero), r.detecciones, r.resuelto_en === null])).toEqual([
            ["RECETARIO", "120", 3, true],
            ["PSICOTROPICO", "8", 1, false],
          ]);
          const abiertos = await tx.query(LISTAR, [TOKEN_HASH, [e.tenantId], true, 50]);
          expect(abiertos.rows).toHaveLength(1);
          expect(abiertos.rows[0].tenant_id).toBe(e.tenantId);
        }),
      );
    });

    it("unknown tenant id returns no rows; the limit is clamped to 1..200", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const e = await sembrar(tx);
          expect((await tx.query(LISTAR, [TOKEN_HASH, [randomUUID()], false, 50])).rows).toHaveLength(0);
          expect((await tx.query(LISTAR, [TOKEN_HASH, [e.tenantId], false, 0])).rows).toHaveLength(1); // clamped up to 1
          expect((await tx.query(LISTAR, [TOKEN_HASH, [e.tenantId], false, -5])).rows).toHaveLength(1);
          expect((await tx.query(LISTAR, [TOKEN_HASH, [e.tenantId], false, 100000])).rows).toHaveLength(2); // clamped down to 200
        }),
      );
    });

    it("more than 100 tenant ids is refused", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          await sembrar(tx);
          const ids = Array.from({ length: 101 }, () => randomUUID());
          await expectDbRejection(tx, () => tx.query(LISTAR, [TOKEN_HASH, ids, true, 50]), "22023");
          const justo = Array.from({ length: 100 }, () => randomUUID());
          expect((await tx.query(LISTAR, [TOKEN_HASH, justo, true, 50])).rows).toHaveLength(0);
        }),
      );
    });

    it("a bad token and a tenant session token raise INV-PLAT-AUTH", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const e = await sembrar(tx);
          await expectInvariantViolation(tx, () => tx.query(LISTAR, ["otro-token", [e.tenantId], false, 50]), "INV-PLAT-AUTH");
          // A pharmacy user's session token hash is not a platform session.
          const tenantToken = createHash("sha256").update(`tenant-${randomUUID()}`).digest("hex");
          await expectInvariantViolation(tx, () => tx.query(LISTAR, [tenantToken, [e.tenantId], false, 50]), "INV-PLAT-AUTH");
        }),
      );
    });

    it("is SECURITY DEFINER with a fixed search_path and PUBLIC has no EXECUTE", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const { rows } = await tx.query(
            `SELECT p.prosecdef, p.proconfig::text AS config,
                    has_function_privilege('public', p.oid, 'EXECUTE') AS publico,
                    has_function_privilege('fsj_app', p.oid, 'EXECUTE') AS app
             FROM pg_proc p WHERE p.oid = 'fsj.plataforma_incidentes_integridad(text,uuid[],boolean,integer)'::regprocedure`,
          );
          expect(rows[0].prosecdef).toBe(true);
          expect(rows[0].config).toContain("search_path=fsj, extensions");
          expect(rows[0].publico).toBe(false);
          expect(rows[0].app).toBe(true);
        }),
      );
    });
  });
});
