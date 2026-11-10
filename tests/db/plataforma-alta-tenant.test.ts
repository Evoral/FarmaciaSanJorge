/**
 * Migrations 0124/0125 (openspec/changes/plataforma-superadmin, P2, P3, P10a, P11): the one alta function seeds what
 * scripts/create-tenant.ts seeded, rolls back completely on failure, and stays out of fsj_app's reach; the platform
 * tables are closed to fsj_app; a bogus platform token is refused.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, inSavepoint, expectDbRejection, expectInvariantViolation } from "./helpers";
import { PERMISOS_CON_PIN_POR_DEFECTO } from "@/modules/auth/domain/permisos";

const CREAR = `SELECT tenant_id, admin_id FROM fsj.crear_tenant_interno($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`;

function args(sufijo: string, adminEmail = `admin-${sufijo}@alta.test`): unknown[] {
  return [
    `Farmacia ${sufijo}`, `30-${sufijo}-9`, null, null, null, "America/Argentina/Mendoza",
    "Contacto", `contacto-${sufijo}@alta.test`, null,
    adminEmail, "Ana", "Admin", `DNI-${sufijo}`, "argon2-hash-de-prueba",
    "Estándar 100 × 42 mm", 100, 42, 210, 297, 5,
  ];
}

async function contar(tx: Client, tabla: string, tenantId: string): Promise<number> {
  const result = await tx.query(`SELECT count(*)::int AS n FROM fsj.${tabla} WHERE tenant_id = $1`, [tenantId]);
  return result.rows[0].n as number;
}

describe.skipIf(dbTestSkipReason() !== null)("plataforma: alta and closed platform tables", () => {
  it("crear_tenant_interno seeds every table the script seeded", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const sufijo = String(Date.now()).slice(-8);
        const { rows } = await tx.query(CREAR, args(sufijo));
        const { tenant_id: tenantId, admin_id: adminId } = rows[0];

        expect(await contar(tx, "usuario", tenantId)).toBe(2);
        expect(await contar(tx, "usuario_rol", tenantId)).toBe(2);
        expect(await contar(tx, "parametro", tenantId)).toBe(12);
        expect(await contar(tx, "etiqueta_tamano", tenantId)).toBe(1);
        expect(await contar(tx, "etiqueta_hoja", tenantId)).toBe(1);
        expect(await contar(tx, "libro_rubricado", tenantId)).toBe(3);
        expect(await contar(tx, "accion_con_pin", tenantId)).toBe(PERMISOS_CON_PIN_POR_DEFECTO.length);
        expect(await contar(tx, "rol", tenantId)).toBeGreaterThan(0);

        const admin = await tx.query(
          `SELECT u.estado::text, u.debe_cambiar_password, r.codigo FROM fsj.usuario u
           JOIN fsj.usuario_rol ur ON ur.usuario_id = u.id JOIN fsj.rol r ON r.id = ur.rol_id WHERE u.id = $1`,
          [adminId],
        );
        expect(admin.rows[0]).toEqual({ estado: "ACTIVO", debe_cambiar_password: true, codigo: "ADMINISTRADOR" });

        const tenant = await tx.query(`SELECT estado::text, contacto_email::text FROM fsj.tenant WHERE id = $1`, [tenantId]);
        expect(tenant.rows[0]).toEqual({ estado: "ACTIVO", contacto_email: `contacto-${sufijo}@alta.test` });
      }),
    );
  });

  it("a duplicate admin email creates nothing, not even the tenant", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const sufijo = String(Date.now()).slice(-8);
        await tx.query(CREAR, args(sufijo));
        const otro = `${sufijo.slice(0, 7)}x`;
        await expectDbRejection(tx, () => tx.query(CREAR, args(otro, `admin-${sufijo}@alta.test`)), "23505");
        const quedo = await tx.query(`SELECT 1 FROM fsj.tenant WHERE cuit = $1`, [`30-${otro}-9`]);
        expect(quedo.rowCount).toBe(0);
      }),
    );
  });

  it("an email cannot be both a usuario and a superadmin", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const sufijo = String(Date.now()).slice(-8);
        await tx.query(CREAR, args(sufijo));
        await expectDbRejection(
          tx,
          () => tx.query(`INSERT INTO fsj.superadmin (email, nombre, password_hash) VALUES ($1, 'Ops', 'h')`, [`ADMIN-${sufijo}@alta.test`]),
          "23505",
        );
      }),
    );
  });

  it("fsj_app can neither run the alta nor read the platform tables", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await inSavepoint(tx, async () => {
          await tx.query("SET LOCAL ROLE fsj_app");
          await expectDbRejection(tx, () => tx.query(CREAR, args("00000000")), "42501");
          for (const tabla of ["superadmin", "superadmin_sesion", "plataforma_auditoria"]) {
            await expectDbRejection(tx, () => tx.query(`SELECT 1 FROM fsj.${tabla}`), "42501");
          }
          await expectDbRejection(tx, () => tx.query(`SELECT fsj.plataforma_actor('x')`), "42501");
        });
      }),
    );
  });

  it("a platform function refuses a bogus session token", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        await inSavepoint(tx, async () => {
          await tx.query("SET LOCAL ROLE fsj_app");
          await expectInvariantViolation(tx, () => tx.query(`SELECT * FROM fsj.plataforma_listar_tenants('no-such-token', NULL, 25, 0)`), "INV-PLAT-AUTH");
          const validar = await tx.query(`SELECT * FROM fsj.plataforma_validar_sesion('no-such-token')`);
          expect(validar.rowCount).toBe(0);
        });
      }),
    );
  });
});
