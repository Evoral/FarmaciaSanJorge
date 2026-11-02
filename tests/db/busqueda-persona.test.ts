/**
 * DB tests for persona search (shared/db/busqueda-persona.ts).
 *
 * Verifies that:
 * - A paciente "Juan Pérez" is found by:
 *     - "juan perez"
 *     - "PEREZ juan"
 *     - "pérez"
 *     - "jua"
 * - Not found by:
 *     - "juan gomez"
 * - A médico likewise.
 * - A paciente found by DNI and a médico by matrícula still work.
 * - The envíos listing finds a receta by its paciente's nombre and apellido.
 * - "%" and "_" are literal, not LIKE wildcards.
 *
 * Runs inside a rolled-back Prisma interactive transaction (same safety net as
 * tests/db/prisma-relation-loading-concurrency.test.ts and stock-contralor-camino-real.test.ts).
 * Zero rows persist.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import { createSistemaUser, insertReceta, insertTenant } from "./fixtures";
import { buscarPersonasPorNombre } from "@/shared/db/busqueda-persona";
import { listPacientes } from "@/modules/pacientes/infrastructure/paciente-repository";
import { listMedicos } from "@/modules/medicos/infrastructure/medico-repository";
import { listEntregasPendientes } from "@/modules/entregas/infrastructure/entrega-repository";

class RollbackSentinel extends Error {}

function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

describe.skipIf(dbTestSkipReason() !== null)("DB tests: persona search (shared/db/busqueda-persona)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("paciente and médico search: found by words in any order, accent- and case-insensitive, and DNI search works", async () => {
    let completed = false;

    try {
      await prisma.$transaction(
        async (tx) => {
          const c = fixtureClient(tx);
          const tenantId = await insertTenant(c, "busq-per");

          // Insert target paciente "Juan Pérez"
          const resPac = await c.query(
            `INSERT INTO fsj.paciente (tenant_id, nombre, apellido, dni)
             VALUES ($1, 'Juan', 'Pérez', '12345678')
             RETURNING id`,
            [tenantId],
          );
          const pacienteId = resPac.rows[0].id as string;

          // Insert control/distractor paciente
          const resPacDistractor = await c.query(
            `INSERT INTO fsj.paciente (tenant_id, nombre, apellido, dni)
             VALUES ($1, 'Carlos', 'Gómez', '87654321')
             RETURNING id`,
            [tenantId],
          );
          const distractorPacienteId = resPacDistractor.rows[0].id as string;

          // Insert target médico "Juan Pérez"
          const resMed = await c.query(
            `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula)
             VALUES ($1, 'Juan', 'Pérez', 'MAT-9999')
             RETURNING id`,
            [tenantId],
          );
          const medicoId = resMed.rows[0].id as string;

          // Insert control/distractor médico
          const resMedDistractor = await c.query(
            `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula)
             VALUES ($1, 'Carlos', 'Gómez', 'MAT-8888')
             RETURNING id`,
            [tenantId],
          );
          const distractorMedicoId = resMedDistractor.rows[0].id as string;

          // One receta per paciente, for the envíos listing (listEntregasPendientes).
          const sistema = await createSistemaUser(c, tenantId);
          const recetaId = await insertReceta(c, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
          const distractorRecetaId = await insertReceta(c, { tenantId, pacienteId: distractorPacienteId, medicoId, registradaPorId: sistema });

          // Switch session context to fsj_app with the tenant set
          await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

          // ------------------------------------------------------------------
          // 1. Direct buscarPersonasPorNombre for paciente
          // ------------------------------------------------------------------
          const pacJuanPerez = await buscarPersonasPorNombre(tx, "paciente", tenantId, "juan perez");
          expect(pacJuanPerez).toContain(pacienteId);
          expect(pacJuanPerez).not.toContain(distractorPacienteId);

          const pacPerezJuan = await buscarPersonasPorNombre(tx, "paciente", tenantId, "PEREZ juan");
          expect(pacPerezJuan).toContain(pacienteId);
          expect(pacPerezJuan).not.toContain(distractorPacienteId);

          const pacPerez = await buscarPersonasPorNombre(tx, "paciente", tenantId, "pérez");
          expect(pacPerez).toContain(pacienteId);
          expect(pacPerez).not.toContain(distractorPacienteId);

          const pacJua = await buscarPersonasPorNombre(tx, "paciente", tenantId, "jua");
          expect(pacJua).toContain(pacienteId);
          expect(pacJua).not.toContain(distractorPacienteId);

          const pacJuanGomez = await buscarPersonasPorNombre(tx, "paciente", tenantId, "juan gomez");
          expect(pacJuanGomez).not.toContain(pacienteId);
          expect(pacJuanGomez).not.toContain(distractorPacienteId);

          // ------------------------------------------------------------------
          // 2. Direct buscarPersonasPorNombre for médico
          // ------------------------------------------------------------------
          const medJuanPerez = await buscarPersonasPorNombre(tx, "medico", tenantId, "juan perez");
          expect(medJuanPerez).toContain(medicoId);
          expect(medJuanPerez).not.toContain(distractorMedicoId);

          const medPerezJuan = await buscarPersonasPorNombre(tx, "medico", tenantId, "PEREZ juan");
          expect(medPerezJuan).toContain(medicoId);
          expect(medPerezJuan).not.toContain(distractorMedicoId);

          const medPerez = await buscarPersonasPorNombre(tx, "medico", tenantId, "pérez");
          expect(medPerez).toContain(medicoId);
          expect(medPerez).not.toContain(distractorMedicoId);

          const medJua = await buscarPersonasPorNombre(tx, "medico", tenantId, "jua");
          expect(medJua).toContain(medicoId);
          expect(medJua).not.toContain(distractorMedicoId);

          const medJuanGomez = await buscarPersonasPorNombre(tx, "medico", tenantId, "juan gomez");
          expect(medJuanGomez).not.toContain(medicoId);
          expect(medJuanGomez).not.toContain(distractorMedicoId);

          // ------------------------------------------------------------------
          // 3. listPacientes (repository layer)
          // ------------------------------------------------------------------
          const listPac1 = await listPacientes(tx, { tenantId, search: "juan perez", page: 1, pageSize: 10 });
          expect(listPac1.items.map((p) => p.id)).toContain(pacienteId);

          const listPac2 = await listPacientes(tx, { tenantId, search: "PEREZ juan", page: 1, pageSize: 10 });
          expect(listPac2.items.map((p) => p.id)).toContain(pacienteId);

          const listPac3 = await listPacientes(tx, { tenantId, search: "pérez", page: 1, pageSize: 10 });
          expect(listPac3.items.map((p) => p.id)).toContain(pacienteId);

          const listPac4 = await listPacientes(tx, { tenantId, search: "jua", page: 1, pageSize: 10 });
          expect(listPac4.items.map((p) => p.id)).toContain(pacienteId);

          const listPac5 = await listPacientes(tx, { tenantId, search: "juan gomez", page: 1, pageSize: 10 });
          expect(listPac5.items.map((p) => p.id)).not.toContain(pacienteId);

          // Paciente found by DNI still works
          const listPacDni = await listPacientes(tx, { tenantId, search: "12345678", page: 1, pageSize: 10 });
          expect(listPacDni.items.map((p) => p.id)).toContain(pacienteId);
          expect(listPacDni.items.map((p) => p.id)).not.toContain(distractorPacienteId);

          // ------------------------------------------------------------------
          // 4. listMedicos (repository layer)
          // ------------------------------------------------------------------
          const listMed1 = await listMedicos(tx, { tenantId, search: "juan perez", page: 1, pageSize: 10 });
          expect(listMed1.items.map((m) => m.id)).toContain(medicoId);

          const listMed2 = await listMedicos(tx, { tenantId, search: "PEREZ juan", page: 1, pageSize: 10 });
          expect(listMed2.items.map((m) => m.id)).toContain(medicoId);

          const listMed3 = await listMedicos(tx, { tenantId, search: "pérez", page: 1, pageSize: 10 });
          expect(listMed3.items.map((m) => m.id)).toContain(medicoId);

          const listMed4 = await listMedicos(tx, { tenantId, search: "jua", page: 1, pageSize: 10 });
          expect(listMed4.items.map((m) => m.id)).toContain(medicoId);

          const listMed5 = await listMedicos(tx, { tenantId, search: "juan gomez", page: 1, pageSize: 10 });
          expect(listMed5.items.map((m) => m.id)).not.toContain(medicoId);

          // Médico found by matrícula still works
          const listMedMatricula = await listMedicos(tx, { tenantId, search: "MAT-9999", page: 1, pageSize: 10 });
          expect(listMedMatricula.items.map((m) => m.id)).toContain(medicoId);
          expect(listMedMatricula.items.map((m) => m.id)).not.toContain(distractorMedicoId);

          // ------------------------------------------------------------------
          // 5. listEntregasPendientes: the paciente of the receta (the recetas
          //    are just loaded, so the listing is asked for that estado)
          // ------------------------------------------------------------------
          const entregas = await listEntregasPendientes(tx, {
            tenantId,
            search: "perez juan",
            estado: "PENDIENTE_PREPARACION",
            page: 1,
            pageSize: 10,
            conPrecio: false,
          });
          expect(entregas.items.map((r) => r.id)).toContain(recetaId);
          expect(entregas.items.map((r) => r.id)).not.toContain(distractorRecetaId);

          // ------------------------------------------------------------------
          // 6. LIKE wildcards are literal: "%" and "_" match nobody
          // ------------------------------------------------------------------
          for (const comodin of ["%", "_"]) {
            const pacientes = await buscarPersonasPorNombre(tx, "paciente", tenantId, comodin);
            expect(pacientes).not.toContain(pacienteId);
            expect(pacientes).not.toContain(distractorPacienteId);
          }

          completed = true;
          throw new RollbackSentinel();
        },
        { maxWait: 20_000, timeout: 25_000 },
      );
    } catch (e) {
      if (!(e instanceof RollbackSentinel)) throw e;
    }

    expect(completed).toBe(true);
  });
});
