/**
 * DB tests for security audit finding T1-01 (migration 0101_security_definer_hardening).
 *
 * Verifies that fsj.cierre_diario_firmar (SECURITY DEFINER) strictly enforces that
 * the caller's session tenant (fsj.current_tenant_id()) matches p_tenant_id.
 * When called as fsj_app with app.tenant_id = tenantA, passing p_tenant_id = tenantB
 * is rejected with P0001 ("is not the current tenant").
 * When called without an active tenant (current_tenant_id() is null), it is also rejected.
 */
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { dbTestSkipReason } from "./env";
import { asApp, asOwner, inRollbackTx, withTenant, expectInvariantViolation } from "./helpers";
import { insertTenant, createSistemaUser, createUserWithRole, designarDt } from "./fixtures";

describe.skipIf(dbTestSkipReason() !== null)("T1-01: cierre_diario_firmar cross-tenant guard (0101)", () => {
  it("rejects fsj.cierre_diario_firmar when p_tenant_id differs from session current_tenant_id()", async () => {
    let tenantA!: string;
    let tenantB!: string;
    let dtBId!: string;
    let designacionBId!: string;

    // Seed tenants and DT B using asOwner inside a rolled-back transaction
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        tenantA = await insertTenant(tx, "Farmacia A");
        tenantB = await insertTenant(tx, "Farmacia B");
        await createSistemaUser(tx, tenantA);
        const sistemaB = await createSistemaUser(tx, tenantB);

        dtBId = await createUserWithRole(tx, tenantB, "DIRECTOR_TECNICO", sistemaB, "dt-b");
        const designacion = await designarDt(tx, tenantB, dtBId, sistemaB, "2020-01-01");
        designacionBId = designacion.designacionId;

        // Run as genuine application role fsj_app inside the same rollback tx
        await tx.query("SET LOCAL ROLE fsj_app");

        // Set session tenant to tenantA
        await withTenant(tx, tenantA, async () => {
          // Attempting to sign cierre for tenantB must be rejected
          await expectInvariantViolation(
            tx,
            () =>
              tx.query(
                `SELECT fsj.cierre_diario_firmar(
                  p_tenant_id := $1,
                  p_fecha := '2026-01-01'::date,
                  p_director_tecnico_id := $2,
                  p_designacion_id := $3
                )`,
                [tenantB, dtBId, designacionBId],
              ),
            "is not the current tenant",
          );
        });
      }),
    );
  });

  it("rejects fsj.cierre_diario_firmar when called as fsj_app without an active tenant session", async () => {
    await asApp((client) =>
      inRollbackTx(client, async (tx) => {
        const dummyTenantId = randomUUID();
        const dummyDtId = randomUUID();
        const dummyDesignacionId = randomUUID();

        // No withTenant -> current_tenant_id() is null
        await expectInvariantViolation(
          tx,
          () =>
            tx.query(
              `SELECT fsj.cierre_diario_firmar(
                p_tenant_id := $1,
                p_fecha := '2026-01-01'::date,
                p_director_tecnico_id := $2,
                p_designacion_id := $3
              )`,
              [dummyTenantId, dummyDtId, dummyDesignacionId],
            ),
          "is not the current tenant",
        );
      }),
    );
  });
});
