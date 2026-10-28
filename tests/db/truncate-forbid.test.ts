/**
 * DB tests for security audit finding P3-06 (migration 0104_forbid_truncate).
 *
 * Verifies that BEFORE TRUNCATE statement triggers (trg_<table_name>_forbid_truncate)
 * block TRUNCATE commands even when executed by the owner / admin role (asOwner)
 * on immutable append-only tables such as fsj.registro_auditoria and fsj.asiento_recetario.
 *
 * Rejection code: P0001 ("INV-IMMUTABLE: table <tabla> is immutable, TRUNCATE is not allowed").
 */
import { describe, it } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation } from "./helpers";

describe.skipIf(dbTestSkipReason() !== null)("P3-06: forbid TRUNCATE on immutable tables (0104)", () => {
  it("rejects TRUNCATE on fsj.registro_auditoria even as owner", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await expectInvariantViolation(
          tx,
          () => tx.query("TRUNCATE TABLE fsj.registro_auditoria"),
          "INV-IMMUTABLE: table registro_auditoria is immutable, TRUNCATE is not allowed",
        );
      }),
    );
  });

  it("rejects TRUNCATE on fsj.asiento_recetario even as owner", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await expectInvariantViolation(
          tx,
          () => tx.query("TRUNCATE TABLE fsj.asiento_recetario CASCADE"),
          "INV-IMMUTABLE: table asiento_recetario is immutable, TRUNCATE is not allowed",
        );
      }),
    );
  });
});
