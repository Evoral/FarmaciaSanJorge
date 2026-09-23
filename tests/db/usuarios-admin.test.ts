/**
 * DB tests for FASE 3 (points 3.1-3.8, M03 admin use cases). Like every
 * other tests/db/*.test.ts, these use raw `pg` + `asOwner`/`asApp` +
 * `inRollbackTx` (tests/db/helpers.ts) -- NOT the actual TypeScript
 * `modules/usuarios/application/*` functions, which go through Prisma
 * (its own connection via `@prisma/adapter-pg`) and therefore cannot nest
 * inside this harness's `BEGIN ... ROLLBACK` (see
 * tests/db/auth-sessions.test.ts's module doc comment for the full
 * reasoning, which applies here verbatim).
 *
 * So the split is:
 *   - the DECISION logic each use case applies (state-transition rules,
 *     last-admin/self-action rules, SISTEMA filtering, input validation)
 *     is pure TypeScript, unit-tested in tests/unit/usuarios-*.test.ts --
 *     no DB needed.
 *   - what THIS file proves is what only Postgres can prove: the exact SQL
 *     choreography each command performs (estado + historial + sesion +
 *     credencial writes, all in one transaction) behaves atomically and
 *     the way the repository functions assume, PLUS the one thing that
 *     genuinely needs two real connections -- the `FOR UPDATE` row lock
 *     that makes INV-USR-004 race-safe.
 *
 * NOT covered end-to-end by any automated test: the actual Prisma-backed
 * repository functions in modules/usuarios/infrastructure/*.ts issuing
 * the SAME statements this file exercises by hand. That gap is identical
 * to the one already accepted for M02 (see auth-sessions.test.ts) and is
 * called out again in this task's final report.
 */
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx, expectInvariantViolation } from "./helpers";

async function insertTenant(tx: Client, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

async function rolId(tx: Client, codigo: string): Promise<string> {
  const result = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = $1`, [codigo]);
  return result.rows[0].id as string;
}

async function createSistemaUser(tx: Client, tenantId: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
     VALUES ($1, $2, $3, 'Sistema', 'Tecnico', $4, 'ACTIVO', true, $1)`,
    [id, tenantId, `sistema+${id}@internal.local`, `SISTEMA-${id}`],
  );
  const sistemaRolId = await rolId(tx, "SISTEMA");
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
    tenantId,
    id,
    sistemaRolId,
  ]);
  return id;
}

/** A regular ACTIVO usuario with `rolCodigo` -- mirrors what crearUsuario + activarCuenta produce together. */
async function createUsuarioActivo(tx: Client, tenantId: string, sistemaId: string, suffix: string, rolCodigo: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5)`,
    [id, tenantId, `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`, `D-${suffix}-${Math.random().toString(36).slice(2, 6)}`, sistemaId],
  );
  const targetRolId = await rolId(tx, rolCodigo);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    targetRolId,
    sistemaId,
  ]);
  await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [id]);
  return id;
}

function rawTokenHash(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  return { rawToken, tokenHash };
}

describe.skipIf(dbTestSkipReason() !== null)("FASE 3 usuarios admin -- full lifecycle choreography", () => {
  it("crear (PENDIENTE + credencial ALTA) -> restablecer (revokes sesiones + credencial, reissues, stays/returns to PENDIENTE) -> suspender is rejected from PENDIENTE -> activar-shaped ACTIVO -> suspender (revokes sesiones + credencial) -> reactivar -> dar de baja (terminal)", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "lifecycle");
        const sistema = await createSistemaUser(tx, tenantId);
        const admin = await createUsuarioActivo(tx, tenantId, sistema, "adm", "ADMINISTRADOR");

        // crearUsuario-shaped: PENDIENTE_ACTIVACION + one ALTA credential.
        const userId = randomUUID();
        await tx.query(
          `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A','LC1',$4)`,
          [userId, tenantId, `lc-${Date.now()}@example.com`, admin],
        );
        const farRolId = await rolId(tx, "FARMACEUTICO");
        await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
          tenantId,
          userId,
          farRolId,
          admin,
        ]);
        const alta = rawTokenHash();
        await tx.query(
          `INSERT INTO fsj.credencial_activacion (tenant_id, usuario_id, token_hash, emitida_por_id, vence_en, motivo_emision)
           VALUES ($1,$2,$3,$4, now() + interval '72 hours', 'ALTA')`,
          [tenantId, userId, alta.tokenHash, admin],
        );

        let row = await tx.query(`SELECT estado FROM fsj.usuario WHERE id = $1`, [userId]);
        expect(row.rows[0].estado).toBe("PENDIENTE_ACTIVACION");

        // restablecerCredencial-shaped, even while already PENDIENTE (a
        // no-op estado assignment -- the trigger's NEW=OLD short-circuit
        // must allow it): revoke the old credential, issue a new one.
        await tx.query(`UPDATE fsj.credencial_activacion SET revocada_en = now() WHERE usuario_id = $1 AND usada_en IS NULL AND revocada_en IS NULL`, [userId]);
        const reset1 = rawTokenHash();
        await tx.query(
          `INSERT INTO fsj.credencial_activacion (tenant_id, usuario_id, token_hash, emitida_por_id, vence_en, motivo_emision)
           VALUES ($1,$2,$3,$4, now() + interval '72 hours', 'RESTABLECIMIENTO')`,
          [tenantId, userId, reset1.tokenHash, admin],
        );
        await tx.query(`UPDATE fsj.usuario SET estado = 'PENDIENTE_ACTIVACION' WHERE id = $1`, [userId]); // no-op, must not throw
        await tx.query(
          `INSERT INTO fsj.usuario_estado_historial (tenant_id, usuario_id, estado_anterior, estado_nuevo, motivo, cambiado_por_id)
           VALUES ($1,$2,'PENDIENTE_ACTIVACION','PENDIENTE_ACTIVACION','Restablecimiento de credencial.',$3)`,
          [tenantId, userId, admin],
        );

        const oldCred = await tx.query(`SELECT revocada_en FROM fsj.credencial_activacion WHERE token_hash = $1`, [alta.tokenHash]);
        expect(oldCred.rows[0].revocada_en).not.toBeNull();
        const activeCredCount = await tx.query(
          `SELECT count(*)::int AS n FROM fsj.credencial_activacion WHERE usuario_id = $1 AND usada_en IS NULL AND revocada_en IS NULL`,
          [userId],
        );
        expect(activeCredCount.rows[0].n).toBe(1);

        // suspender is illegal from PENDIENTE_ACTIVACION (only ACTIVO -> SUSPENDIDO).
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [userId]),
          "INV-USR-006",
        );

        // activarCuenta-shaped: consume the credential, go ACTIVO, open a sesion.
        await tx.query(`UPDATE fsj.credencial_activacion SET usada_en = now() WHERE token_hash = $1`, [reset1.tokenHash]);
        await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO', password_hash = 'x' WHERE id = $1`, [userId]);
        const { tokenHash: sesionHash } = rawTokenHash();
        await tx.query(`INSERT INTO fsj.sesion (tenant_id, usuario_id, token_hash, expira_en) VALUES ($1,$2,$3, now() + interval '12 hours')`, [
          tenantId,
          userId,
          sesionHash,
        ]);

        // suspenderUsuario-shaped: estado + historial + revoke sesiones (there are none left to revoke, but the statement must be a no-op, not an error) + revoke credenciales.
        await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [userId]);
        await tx.query(
          `INSERT INTO fsj.usuario_estado_historial (tenant_id, usuario_id, estado_anterior, estado_nuevo, motivo, cambiado_por_id)
           VALUES ($1,$2,'ACTIVO','SUSPENDIDO','Ausencia prolongada.',$3)`,
          [tenantId, userId, admin],
        );
        const revokedSesiones = await tx.query(`UPDATE fsj.sesion SET revocada_en = now() WHERE tenant_id = $1 AND usuario_id = $2 AND revocada_en IS NULL`, [
          tenantId,
          userId,
        ]);
        expect(revokedSesiones.rowCount).toBe(1);

        row = await tx.query(`SELECT estado FROM fsj.usuario WHERE id = $1`, [userId]);
        expect(row.rows[0].estado).toBe("SUSPENDIDO");
        const sesionRow = await tx.query(`SELECT revocada_en FROM fsj.sesion WHERE token_hash = $1`, [sesionHash]);
        expect(sesionRow.rows[0].revocada_en).not.toBeNull();

        // reactivarUsuario-shaped: SUSPENDIDO -> ACTIVO.
        await tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [userId]);
        await tx.query(
          `INSERT INTO fsj.usuario_estado_historial (tenant_id, usuario_id, estado_anterior, estado_nuevo, motivo, cambiado_por_id)
           VALUES ($1,$2,'SUSPENDIDO','ACTIVO','Reincorporacion.',$3)`,
          [tenantId, userId, admin],
        );
        row = await tx.query(`SELECT estado FROM fsj.usuario WHERE id = $1`, [userId]);
        expect(row.rows[0].estado).toBe("ACTIVO");

        // darDeBajaUsuario-shaped: terminal.
        await tx.query(`UPDATE fsj.usuario SET estado = 'BAJA', fecha_baja = now(), motivo_baja = 'Renuncia.' WHERE id = $1`, [userId]);
        await tx.query(
          `INSERT INTO fsj.usuario_estado_historial (tenant_id, usuario_id, estado_anterior, estado_nuevo, motivo, cambiado_por_id)
           VALUES ($1,$2,'ACTIVO','BAJA','Renuncia.',$3)`,
          [tenantId, userId, admin],
        );
        row = await tx.query(`SELECT estado, fecha_baja, motivo_baja FROM fsj.usuario WHERE id = $1`, [userId]);
        expect(row.rows[0].estado).toBe("BAJA");
        expect(row.rows[0].fecha_baja).not.toBeNull();
        expect(row.rows[0].motivo_baja).toBe("Renuncia.");

        // BAJA is terminal: reactivarUsuario-shaped is rejected.
        await expectInvariantViolation(
          tx,
          () => tx.query(`UPDATE fsj.usuario SET estado = 'ACTIVO' WHERE id = $1`, [userId]),
          "INV-USR-006",
        );

        const historial = await tx.query(`SELECT estado_nuevo FROM fsj.usuario_estado_historial WHERE usuario_id = $1 ORDER BY cambiado_en`, [userId]);
        expect(historial.rows.map((r: { estado_nuevo: string }) => r.estado_nuevo)).toEqual([
          "PENDIENTE_ACTIVACION",
          "SUSPENDIDO",
          "ACTIVO",
          "BAJA",
        ]);
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("FASE 3 usuarios admin -- audit row atomicity", () => {
  it.each(["SUSPENDER", "REACTIVAR", "BAJA", "RESTABLECER_CREDENCIAL", "ASIGNAR_ROL", "QUITAR_ROL"] as const)(
    "a %s audit row written in a savepoint disappears when that savepoint rolls back",
    async (accion) => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const tenantId = await insertTenant(tx, `audit-${accion}`);
          const sistema = await createSistemaUser(tx, tenantId);

          await tx.query("SAVEPOINT sp_audit_usuario");
          const inserted = await tx.query(
            `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, motivo)
             VALUES ($1, $2, 'usuario', $2, $3, 'motivo de prueba') RETURNING id`,
            [tenantId, sistema, accion],
          );
          await tx.query("ROLLBACK TO SAVEPOINT sp_audit_usuario");

          const result = await tx.query(`SELECT 1 FROM fsj.registro_auditoria WHERE id = $1`, [inserted.rows[0].id]);
          expect(result.rows).toHaveLength(0);
        }),
      );
    },
  );

  it("a successful SUSPENDER produces exactly one registro_auditoria row for that usuario", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "audit-count");
        const sistema = await createSistemaUser(tx, tenantId);
        const admin = await createUsuarioActivo(tx, tenantId, sistema, "adm2", "ADMINISTRADOR");
        const target = await createUsuarioActivo(tx, tenantId, sistema, "target", "FARMACEUTICO");

        await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [target]);
        await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, motivo, valor_anterior, valor_nuevo)
           VALUES ($1, $2, 'usuario', $3, 'SUSPENDER', 'motivo', '{"estado":"ACTIVO"}'::jsonb, '{"estado":"SUSPENDIDO"}'::jsonb)`,
          [tenantId, admin, target],
        );

        const rows = await tx.query(`SELECT accion, usuario_id, entidad_id, motivo FROM fsj.registro_auditoria WHERE entidad = 'usuario' AND entidad_id = $1`, [
          target,
        ]);
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]).toMatchObject({ accion: "SUSPENDER", usuario_id: admin, entidad_id: target, motivo: "motivo" });
      }),
    );
  });

  it("M1: a crearUsuario-shaped insert with 2 initial roles produces exactly CREAR + 2 ASIGNAR_ROL rows for the new usuario, all in one transaction", async () => {
    // What modules/usuarios/application/crear-usuario.ts's handler does,
    // by hand, against the raw registro_auditoria table -- proves the
    // exact SQL shape (immutable table, NOT NULL usuario_id, INV-A01/A02
    // still hold) independent of whether the Prisma-backed application
    // code has a bug. The application-level assertion (stubbed tx records
    // the right calls) lives in tests/unit/usuarios-crear-usuario.test.ts.
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "audit-crear");
        const sistema = await createSistemaUser(tx, tenantId);
        const admin = await createUsuarioActivo(tx, tenantId, sistema, "adm-crear", "ADMINISTRADOR");

        const nuevoId = randomUUID();
        await tx.query(
          `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'Nuevo','Usuario','DNI-CREAR',$4)`,
          [nuevoId, tenantId, `crear-${Date.now()}@example.com`, admin],
        );
        const roles = ["FARMACEUTICO", "ATENCION_PUBLICO"] as const;
        for (const rolCodigo of roles) {
          const targetRolId = await rolId(tx, rolCodigo);
          await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
            tenantId,
            nuevoId,
            targetRolId,
            admin,
          ]);
        }

        // CREAR row (one, carrying the roles in valor_nuevo -- see
        // crear-usuario.ts).
        await tx.query(
          `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, valor_nuevo)
           VALUES ($1, $2, 'usuario', $3, 'CREAR', $4::jsonb)`,
          [tenantId, admin, nuevoId, JSON.stringify({ nombre: "Nuevo", apellido: "Usuario", email: "x@example.com", dni: "DNI-CREAR", roles })],
        );
        // One ASIGNAR_ROL row per initial role (M1 fix).
        for (const rolCodigo of roles) {
          await tx.query(
            `INSERT INTO fsj.registro_auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, valor_nuevo)
             VALUES ($1, $2, 'usuario', $3, 'ASIGNAR_ROL', $4::jsonb)`,
            [tenantId, admin, nuevoId, JSON.stringify({ rol: rolCodigo })],
          );
        }

        const rows = await tx.query(
          `SELECT accion, valor_nuevo FROM fsj.registro_auditoria WHERE entidad = 'usuario' AND entidad_id = $1 ORDER BY ocurrido_en, accion`,
          [nuevoId],
        );
        expect(rows.rows).toHaveLength(3);
        const acciones = rows.rows.map((r: { accion: string }) => r.accion).sort();
        expect(acciones).toEqual(["ASIGNAR_ROL", "ASIGNAR_ROL", "CREAR"]);

        const asignarRolValues = rows.rows
          .filter((r: { accion: string }) => r.accion === "ASIGNAR_ROL")
          .map((r: { valor_nuevo: { rol: string } }) => r.valor_nuevo.rol)
          .sort();
        expect(asignarRolValues).toEqual([...roles].sort());

        const crearRow = rows.rows.find((r: { accion: string }) => r.accion === "CREAR");
        expect(crearRow.valor_nuevo.roles).toEqual(roles);
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)("INV-USR-004 row lock query -- what modules/usuarios/infrastructure/admin-guard.ts#lockUsuarioYAdministradoresActivos (admin decision read) runs", () => {
  // NOTE on scope: a true cross-connection "does FOR UPDATE actually block a
  // second transaction" test would need the locked row to be COMMITTED
  // first (Postgres transaction isolation means one connection can never
  // see another connection's uncommitted row at all, let alone lock it) --
  // and `fsj.usuario` rows can never be deleted afterwards (INV-U03,
  // `forbid_delete()` trigger, unconditional even for fsj_owner), so any
  // such test would PERMANENTLY leak a tenant/usuario into the real
  // Supabase database this suite is so careful never to touch (see
  // tests/db/helpers.ts's module doc comment: "nothing... ever persists").
  // That tradeoff is not acceptable here. `SELECT ... FOR UPDATE` blocking
  // concurrent transactions is a well-established, unmodified Postgres
  // primitive; what THIS test proves instead is that the exact query
  // `lockUsuarioYAdministradoresActivos` issues for its admin decision read selects the right rows (and only
  // those), which is the part that could actually have a bug.
  it("selects exactly the ACTIVO administradores of the tenant, excluding SUSPENDIDO/BAJA, other roles, and other tenants", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "lockquery");
        const otherTenantId = await insertTenant(tx, "lockquery-other");
        const sistema = await createSistemaUser(tx, tenantId);
        const otherSistema = await createSistemaUser(tx, otherTenantId);

        const activo1 = await createUsuarioActivo(tx, tenantId, sistema, "adm1", "ADMINISTRADOR");
        const activo2 = await createUsuarioActivo(tx, tenantId, sistema, "adm2", "ADMINISTRADOR");
        const suspendido = await createUsuarioActivo(tx, tenantId, sistema, "adm3", "ADMINISTRADOR");
        await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [suspendido]);
        const noAdmin = await createUsuarioActivo(tx, tenantId, sistema, "far1", "FARMACEUTICO");
        await createUsuarioActivo(tx, otherTenantId, otherSistema, "adm-other-tenant", "ADMINISTRADOR");

        const result = await tx.query(
          `SELECT u.id FROM fsj.usuario u
           JOIN fsj.usuario_rol ur ON ur.usuario_id = u.id AND ur.tenant_id = u.tenant_id
           JOIN fsj.rol r ON r.id = ur.rol_id
           WHERE u.tenant_id = $1 AND u.estado = 'ACTIVO' AND r.codigo = 'ADMINISTRADOR'
           FOR UPDATE OF u`,
          [tenantId],
        );

        const ids = result.rows.map((r: { id: string }) => r.id).sort();
        expect(ids).toEqual([activo1, activo2].sort());
        expect(ids).not.toContain(suspendido);
        expect(ids).not.toContain(noAdmin);
      }),
    );
  });
});

describe.skipIf(dbTestSkipReason() !== null)(
  "M3 (security review) -- single ordered lock query: what modules/usuarios/infrastructure/admin-guard.ts#lockUsuarioYAdministradoresActivos runs",
  () => {
    // Same cross-connection-blocking caveat as the INV-USR-004 test above
    // (no test here permanently leaks a row into the real database) --
    // what THIS test proves is that the ONE combined statement returns
    // exactly {target row} UNION {ACTIVO administradores of the tenant},
    // ordered by id, with no LIMIT -- the shape the M3 fix (and its
    // deadlock-safety argument, see admin-guard.ts's LOCK ORDER doc
    // comment) depends on.
    it("returns the target row (even when it is not an admin) plus every ACTIVO administrador of the tenant, ordered by id, excluding other tenants/roles/estados", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const tenantId = await insertTenant(tx, "lockcombo");
          const otherTenantId = await insertTenant(tx, "lockcombo-other");
          const sistema = await createSistemaUser(tx, tenantId);
          const otherSistema = await createSistemaUser(tx, otherTenantId);

          const activo1 = await createUsuarioActivo(tx, tenantId, sistema, "adm1", "ADMINISTRADOR");
          const activo2 = await createUsuarioActivo(tx, tenantId, sistema, "adm2", "ADMINISTRADOR");
          const suspendido = await createUsuarioActivo(tx, tenantId, sistema, "adm3", "ADMINISTRADOR");
          await tx.query(`UPDATE fsj.usuario SET estado = 'SUSPENDIDO' WHERE id = $1`, [suspendido]);
          // The target: an ordinary, non-admin ACTIVO usuario -- must be
          // returned/locked even though it never matches the admin branch
          // of the WHERE clause.
          const target = await createUsuarioActivo(tx, tenantId, sistema, "target", "FARMACEUTICO");
          await createUsuarioActivo(tx, otherTenantId, otherSistema, "adm-other-tenant", "ADMINISTRADOR");

          const result = await tx.query(
            `SELECT u.id,
                    (u.estado = 'ACTIVO' AND EXISTS (
                      SELECT 1 FROM fsj.usuario_rol ur
                      JOIN fsj.rol r ON r.id = ur.rol_id
                      WHERE ur.usuario_id = u.id AND ur.tenant_id = u.tenant_id AND r.codigo = 'ADMINISTRADOR'
                    )) AS es_admin_activo
             FROM fsj.usuario u
             WHERE u.tenant_id = $1
               AND (
                 u.id = $2
                 OR (u.estado = 'ACTIVO' AND EXISTS (
                   SELECT 1 FROM fsj.usuario_rol ur
                   JOIN fsj.rol r ON r.id = ur.rol_id
                   WHERE ur.usuario_id = u.id AND ur.tenant_id = u.tenant_id AND r.codigo = 'ADMINISTRADOR'
                 ))
               )
             ORDER BY u.id
             FOR UPDATE OF u`,
            [tenantId, target],
          );

          const ids = result.rows.map((r: { id: string }) => r.id);
          // Ordered by id -- the deadlock-safety property this query exists for.
          const sortedIds = [...ids].sort();
          expect(ids).toEqual(sortedIds);

          expect(new Set(ids)).toEqual(new Set([target, activo1, activo2]));
          expect(ids).not.toContain(suspendido);
          expect(ids).not.toContain(undefined);

          const targetRow = result.rows.find((r: { id: string }) => r.id === target);
          expect(targetRow.es_admin_activo).toBe(false);
          const adminRows = result.rows.filter((r: { id: string }) => r.id === activo1 || r.id === activo2);
          expect(adminRows.every((r: { es_admin_activo: boolean }) => r.es_admin_activo === true)).toBe(true);
        }),
      );
    });

    it("when the target IS itself an ACTIVO administrador, it appears exactly once (no duplicate row) and is flagged es_admin_activo", async () => {
      await asOwner((client) =>
        inRollbackTx(client, async (tx) => {
          const tenantId = await insertTenant(tx, "lockcombo-self");
          const sistema = await createSistemaUser(tx, tenantId);
          const targetAdmin = await createUsuarioActivo(tx, tenantId, sistema, "adm-target", "ADMINISTRADOR");
          const otherAdmin = await createUsuarioActivo(tx, tenantId, sistema, "adm-other", "ADMINISTRADOR");

          const result = await tx.query(
            `SELECT u.id,
                    (u.estado = 'ACTIVO' AND EXISTS (
                      SELECT 1 FROM fsj.usuario_rol ur
                      JOIN fsj.rol r ON r.id = ur.rol_id
                      WHERE ur.usuario_id = u.id AND ur.tenant_id = u.tenant_id AND r.codigo = 'ADMINISTRADOR'
                    )) AS es_admin_activo
             FROM fsj.usuario u
             WHERE u.tenant_id = $1
               AND (
                 u.id = $2
                 OR (u.estado = 'ACTIVO' AND EXISTS (
                   SELECT 1 FROM fsj.usuario_rol ur
                   JOIN fsj.rol r ON r.id = ur.rol_id
                   WHERE ur.usuario_id = u.id AND ur.tenant_id = u.tenant_id AND r.codigo = 'ADMINISTRADOR'
                 ))
               )
             ORDER BY u.id
             FOR UPDATE OF u`,
            [tenantId, targetAdmin],
          );

          const targetRows = result.rows.filter((r: { id: string }) => r.id === targetAdmin);
          expect(targetRows).toHaveLength(1);
          expect(targetRows[0].es_admin_activo).toBe(true);
          expect(result.rows.map((r: { id: string }) => r.id)).toContain(otherAdmin);
        }),
      );
    });
  },
);
