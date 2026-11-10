/**
 * Migration 0126 (openspec/changes/plataforma-superadmin P13-P16): cargos and pagos are append-only, anulados once,
 * the saldo ignores anulados, a repeated envio_id writes nothing, and a future fecha is refused.
 * Runs the platform functions as fsj_app with a real platform session created as owner.
 */
import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, inSavepoint, expectInvariantViolation } from "./helpers";
import { insertTenant } from "./fixtures";

const TOKEN_HASH = createHash("sha256").update(`token-${randomUUID()}`).digest("hex");

async function prepararSesion(tx: Client): Promise<void> {
  const { rows } = await tx.query(`INSERT INTO fsj.superadmin (email, nombre, password_hash) VALUES ($1, 'Ops', 'h') RETURNING id`, [`ops-${randomUUID()}@plataforma.test`]);
  await tx.query(`INSERT INTO fsj.superadmin_sesion (superadmin_id, token_hash, expira_en) VALUES ($1, $2, now() + interval '1 hour')`, [rows[0].id, TOKEN_HASH]);
}

async function saldo(tx: Client, tenantId: string): Promise<string> {
  const { rows } = await tx.query(`SELECT fsj.plataforma_saldo($1, $2)::text AS saldo`, [TOKEN_HASH, tenantId]);
  return rows[0].saldo as string;
}

async function pago(tx: Client, tenantId: string, monto: string, envioId = randomUUID(), fecha = "2026-01-15"): Promise<string> {
  const { rows } = await tx.query(`SELECT fsj.plataforma_registrar_pago($1, $2, $3::date, $4::numeric, 'TRANSFERENCIA', NULL, $5, NULL, NULL) AS id`, [
    TOKEN_HASH,
    tenantId,
    fecha,
    monto,
    envioId,
  ]);
  return rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("0126 cuenta corriente", () => {
  it("saldo = cargos - pagos, anulados excluded; anular twice, edit or delete is refused", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, randomUUID().slice(0, 8));
        await prepararSesion(tx);
        await tx.query("SET LOCAL ROLE fsj_app");

        expect(await saldo(tx, tenantId)).toBe("0.00");
        await tx.query(`SELECT fsj.plataforma_registrar_cargo($1, $2, '2026-01-20', 10000, 'Abono', NULL, NULL)`, [TOKEN_HASH, tenantId]);
        const pagoId = await pago(tx, tenantId, "4000");
        expect(await saldo(tx, tenantId)).toBe("6000.00");

        await tx.query(`SELECT fsj.plataforma_anular_movimiento($1, 'PAGO', $2, 'error de carga', NULL, NULL)`, [TOKEN_HASH, pagoId]);
        expect(await saldo(tx, tenantId)).toBe("10000.00");
        await expectInvariantViolation(tx, () => tx.query(`SELECT fsj.plataforma_anular_movimiento($1, 'PAGO', $2, 'otra vez', NULL, NULL)`, [TOKEN_HASH, pagoId]), "INV-PLAT-ANULADO");

        const movimientos = await tx.query(`SELECT tipo, anulado_por, motivo_anulacion FROM fsj.plataforma_cuenta_corriente($1, $2) ORDER BY tipo`, [TOKEN_HASH, tenantId]);
        expect(movimientos.rows).toEqual([
          { tipo: "CARGO", anulado_por: null, motivo_anulacion: null },
          { tipo: "PAGO", anulado_por: "Ops", motivo_anulacion: "error de carga" },
        ]);

        await tx.query("RESET ROLE");
        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.plataforma_pago SET monto = 1 WHERE id = $1`, [pagoId]), "INV-PLAT-ANULADO");
        await expectInvariantViolation(tx, () => tx.query(`DELETE FROM fsj.plataforma_pago WHERE id = $1`, [pagoId]), "INV-IMMUTABLE");
        await expectInvariantViolation(tx, () => tx.query(`UPDATE fsj.plataforma_cargo SET monto = 1 WHERE tenant_id = $1`, [tenantId]), "INV-PLAT-INMUTABLE");
      }),
    );
  });

  it("a duplicate cargo, a repeated envio_id and a future fecha", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, randomUUID().slice(0, 8));
        await prepararSesion(tx);
        await tx.query("SET LOCAL ROLE fsj_app");

        await tx.query(`SELECT fsj.plataforma_registrar_cargo($1, $2, '2026-02-01', 100, 'Abono', NULL, NULL)`, [TOKEN_HASH, tenantId]);
        await expectInvariantViolation(
          tx,
          () => tx.query(`SELECT fsj.plataforma_registrar_cargo($1, $2, '2026-02-15', 100, ' abono ', NULL, NULL)`, [TOKEN_HASH, tenantId]),
          "INV-PLAT-CARGO-DUPLICADO",
        );

        const envioId = randomUUID();
        const primero = await pago(tx, tenantId, "50", envioId);
        const segundo = await pago(tx, tenantId, "50", envioId);
        expect(segundo).toBe(primero);
        expect(await saldo(tx, tenantId)).toBe("50.00");

        await expectInvariantViolation(tx, () => pago(tx, tenantId, "1", randomUUID(), "2999-01-01"), "INV-PLAT-FECHA-FUTURA");
        await inSavepoint(tx, async () => {
          await expectInvariantViolation(tx, () => tx.query(`SELECT fsj.plataforma_saldo('otro-token', $1)`, [tenantId]), "INV-PLAT-AUTH");
        });
      }),
    );
  });
});
