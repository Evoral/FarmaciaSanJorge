/**
 * DB tests for P7b -- Línea en otra magnitud (openspec/specs/pesada-real/spec.md "P7b"):
 * - getLineasParaPreparacion normalizes a non-manual línea whose unit is not mismaMagnitud with
 *   the droga's stock unit (e.g. prescribed 2,3 mL, stock in g, no density): esEnraseManual = true,
 *   cantidadAPesar = null, unit in the stock unit (g), and cantidadPrescripta = { cantidad: "2.3", simbolo: "mL" }.
 *   A línea in g and an already enrase manual línea come back unchanged with cantidadPrescripta null.
 * - P7b Scenarios:
 *   1. Typing 2,1 g reserves 2,1 g in the stock unit.
 *   2. Confirming descuenta 2,1 g, the libro's detalle records 2,1 g in g while the fórmula keeps 2,3 mL.
 *   3. Without a quantity, confirmar is refused with:
 *      "La línea <orden+1> (<drogaNombre>) se pesa en la balanza: falta la cantidad real registrada."
 *
 * Runs inside rolled-back interactive transactions (same pattern as excipiente-por-unidad.test.ts); zero rows persist.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { dbTestSkipReason, requireDbTestEnv } from "./env";
import {
  createSistemaUser,
  crearLibrosRubricados,
  insertMedico,
  insertPaciente,
  insertProveedor,
  insertReceta,
  insertItemReceta,
  insertComponente,
  insertFicha,
  insertLinea,
  crearPartidaConIngreso,
  insertTenant,
  FUTURO,
} from "./fixtures";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { dec } from "@/shared/decimal";
import {
  getLineasParaPreparacion,
  insertReservas,
  jornadaActualTenant,
} from "@/modules/preparaciones/infrastructure/preparacion-repository";
import {
  confirmarPreparacionEnTx,
  planificarConsumoEnTx,
} from "@/modules/preparaciones/application/confirmar-preparacion";
import { reservasDelPlan } from "@/modules/preparaciones/application/reservar-stock-preparacion";
import { registrarAsientoRecetaEnTx } from "@/modules/preparaciones/application/registrar-asiento-receta";

class RollbackSentinel extends Error {}

function fixtureClient(tx: Prisma.TransactionClient): Client {
  const facade = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
    }),
  };
  return facade as unknown as Client;
}

async function insertUnidadConSimbolo(
  tx: Client,
  suffix: string,
  simbolo: string,
  tipoMagnitud: string,
  factorABase = 1,
): Promise<string> {
  const codigo = `TEST-UM-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const result = await tx.query(
    `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
     VALUES ($1, $1, $2, $3, $4, false) RETURNING id`,
    [codigo, simbolo, tipoMagnitud, factorABase],
  );
  return result.rows[0].id as string;
}

async function insertDrogaConNombre(
  tx: Client,
  tenantId: string,
  nombre: string,
  unidadBaseId: string,
): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id, clase) VALUES ($1, $2, $3, 'DROGA') RETURNING id`,
    [tenantId, nombre, unidadBaseId],
  );
  return result.rows[0].id as string;
}

describe.skipIf(dbTestSkipReason() !== null)("P7b: pesada real en otra magnitud (spec: openspec/specs/pesada-real/spec.md)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    if (dbTestSkipReason() !== null) return;
    const { directUrl } = requireDbTestEnv();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("getLineasParaPreparacion normalizes a non-manual línea in mL of a droga in g to enrase manual in g with cantidadPrescripta", async () => {
    let completed = false;

    try {
      await prisma.$transaction(async (tx) => {
        const c = fixtureClient(tx);
        const tenantId = await insertTenant(c, "p7b-norm");
        const sistema = await createSistemaUser(c, tenantId);

        const unidadG = await insertUnidadConSimbolo(c, "g", "g", "MASA", 1);
        const unidadMl = await insertUnidadConSimbolo(c, "ml", "mL", "VOLUMEN", 1);

        const drogaCade = await insertDrogaConNombre(c, tenantId, "Aceite de cade", unidadG);
        const drogaActivoG = await insertDrogaConNombre(c, tenantId, "Activo en gramos", unidadG);
        const drogaExcipiente = await insertDrogaConNombre(c, tenantId, "Vaselina", unidadG);

        const pacienteId = await insertPaciente(c, tenantId);
        const medicoId = await insertMedico(c, tenantId);

        await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

        const recetaId = await insertReceta(c, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(c, { tenantId, recetaId, formaFarmaceutica: "CREMA" });

        await insertComponente(c, {
          tenantId,
          itemRecetaId,
          drogaId: drogaCade,
          unidadMedidaId: unidadMl,
          modoExpresion: "TOTAL",
          cantidad: 2.3,
        });
        await insertComponente(c, {
          tenantId,
          itemRecetaId,
          drogaId: drogaActivoG,
          unidadMedidaId: unidadG,
          modoExpresion: "TOTAL",
          cantidad: 5,
        });
        await insertComponente(c, {
          tenantId,
          itemRecetaId,
          drogaId: drogaExcipiente,
          unidadMedidaId: unidadG,
          modoExpresion: "CSP",
        });

        const fichaId = await insertFicha(c, { tenantId, itemRecetaId, generadaPorId: sistema });

        // Line 0: Aceite de cade in mL (stock in g), non-manual
        await insertLinea(c, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaCade,
          drogaNombre: "Aceite de cade",
          unidadMedidaId: unidadMl,
          cantidadTeorica: 2.3,
          cantidadAPesar: 2.3,
          esEnraseManual: false,
          orden: 0,
        });

        // Line 1: Activo in g (stock in g), non-manual
        await insertLinea(c, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaActivoG,
          drogaNombre: "Activo en gramos",
          unidadMedidaId: unidadG,
          cantidadTeorica: 5,
          cantidadAPesar: 5,
          esEnraseManual: false,
          orden: 1,
        });

        // Line 2: Vaselina (stock in g), enrase manual
        await insertLinea(c, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaExcipiente,
          drogaNombre: "Vaselina",
          unidadMedidaId: unidadG,
          cantidadTeorica: null,
          cantidadAPesar: null,
          esEnraseManual: true,
          orden: 2,
        });

        const lineas = await getLineasParaPreparacion(tx, tenantId, fichaId);

        expect(lineas).toHaveLength(3);

        // Línea 0: normalized to stock unit (g), esEnraseManual = true, cantidadAPesar = null, keeps cantidadPrescripta
        expect(lineas[0]).toMatchObject({
          drogaNombre: "Aceite de cade",
          esEnraseManual: true,
          cantidadAPesar: null,
          unidadMedidaId: unidadG,
          unidadSimbolo: "g",
          unidad: { factorABase: "1", tipoMagnitud: "MASA" },
          unidadStock: { id: unidadG, simbolo: "g", factorABase: "1", tipoMagnitud: "MASA" },
          cantidadPrescripta: { cantidad: "2.3", simbolo: "mL" },
          orden: 0,
        });

        // Línea 1: in g (same magnitude), unchanged with cantidadPrescripta null
        expect(lineas[1]).toMatchObject({
          drogaNombre: "Activo en gramos",
          esEnraseManual: false,
          unidadMedidaId: unidadG,
          unidadSimbolo: "g",
          cantidadPrescripta: null,
          orden: 1,
        });
        expect(Number(lineas[1]!.cantidadAPesar)).toBe(5);

        // Línea 2: already enrase manual, unchanged with cantidadPrescripta null
        expect(lineas[2]).toMatchObject({
          drogaNombre: "Vaselina",
          esEnraseManual: true,
          cantidadAPesar: null,
          unidadMedidaId: unidadG,
          unidadSimbolo: "g",
          cantidadPrescripta: null,
          orden: 2,
        });

        completed = true;
        throw new RollbackSentinel();
      });
    } catch (e) {
      if (!(e instanceof RollbackSentinel)) throw e;
    }

    expect(completed).toBe(true);
  });

  it("P7b scenarios: typing 2,1 g reserves 2,1 g, descuenta 2,1 g, detalle records 2,1 g and fórmula keeps 2,3 mL; missing quantity refuses", async () => {
    let completed = false;

    try {
      await prisma.$transaction(async (tx) => {
        const c = fixtureClient(tx);
        const tenantId = await insertTenant(c, "p7b-flow");
        const sistema = await createSistemaUser(c, tenantId);
        await crearLibrosRubricados(c, tenantId, sistema);

        const unidadG = await insertUnidadConSimbolo(c, "g", "g", "MASA", 1);
        const unidadMl = await insertUnidadConSimbolo(c, "ml", "mL", "VOLUMEN", 1);

        const drogaCade = await insertDrogaConNombre(c, tenantId, "Aceite de cade", unidadG);
        const drogaVaselina = await insertDrogaConNombre(c, tenantId, "Vaselina", unidadG);

        const proveedorId = await insertProveedor(c, tenantId);
        await crearPartidaConIngreso(c, {
          tenantId,
          drogaId: drogaCade,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 500,
          fechaVencimiento: FUTURO,
        });
        await crearPartidaConIngreso(c, {
          tenantId,
          drogaId: drogaVaselina,
          proveedorId,
          registradoPorId: sistema,
          cantidadInicial: 500,
          fechaVencimiento: FUTURO,
        });

        const pacienteId = await insertPaciente(c, tenantId);
        const medicoId = await insertMedico(c, tenantId);

        await tx.$executeRawUnsafe("SET LOCAL ROLE fsj_app");
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

        const session: AuthenticatedSession = {
          sesionId: `ses-${randomUUID()}`,
          tenantId,
          usuario: { id: sistema, email: "op@fsj.test", nombre: "Operador", apellido: "Test" },
          permisos: new Set(["preparaciones.iniciar", "preparaciones.confirmar"]),
        } as unknown as AuthenticatedSession;

        const recetaId = await insertReceta(c, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
        const itemRecetaId = await insertItemReceta(c, { tenantId, recetaId, formaFarmaceutica: "CREMA" });

        await insertComponente(c, {
          tenantId,
          itemRecetaId,
          drogaId: drogaCade,
          unidadMedidaId: unidadMl,
          modoExpresion: "TOTAL",
          cantidad: 2.3,
        });
        await insertComponente(c, {
          tenantId,
          itemRecetaId,
          drogaId: drogaVaselina,
          unidadMedidaId: unidadG,
          modoExpresion: "CSP",
        });

        const fichaId = await insertFicha(c, { tenantId, itemRecetaId, generadaPorId: sistema });

        const lineaCadeId = await insertLinea(c, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaCade,
          drogaNombre: "Aceite de cade",
          unidadMedidaId: unidadMl,
          cantidadTeorica: 2.3,
          cantidadAPesar: 2.3,
          esEnraseManual: false,
          orden: 0,
        });

        const lineaVaselinaId = await insertLinea(c, {
          tenantId,
          fichaTecnicaId: fichaId,
          drogaId: drogaVaselina,
          drogaNombre: "Vaselina",
          unidadMedidaId: unidadG,
          cantidadTeorica: null,
          cantidadAPesar: null,
          esEnraseManual: true,
          orden: 1,
        });

        const prepRes = await c.query(
          `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
          [tenantId, fichaId, sistema],
        );
        const preparacionId = prepRes.rows[0].id as string;

        const jornada = await jornadaActualTenant(tx, tenantId);

        // ----------------------------------------------------------------------
        // Scenario 3: Without a quantity, confirmar is refused:
        // - Línea en otra magnitud -> "se pesa en la balanza: falta la cantidad real registrada."
        // - Real enrase manual -> "es de enrase manual: falta la cantidad real registrada."
        // ----------------------------------------------------------------------
        await expect(
          confirmarPreparacionEnTx(tx, session, {
            preparacionId,
            seleccion: {
              modo: "automatica",
              entradas: [
                { lineaPesajeId: lineaCadeId },
                { lineaPesajeId: lineaVaselinaId, cantidadManual: dec("27.7") },
              ],
            },
            tipoVencimiento: "ESTANDAR",
          }),
        ).rejects.toThrow("La línea 1 (Aceite de cade) se pesa en la balanza: falta la cantidad real registrada.");

        await expect(
          confirmarPreparacionEnTx(tx, session, {
            preparacionId,
            seleccion: {
              modo: "automatica",
              entradas: [
                { lineaPesajeId: lineaCadeId, cantidadManual: dec("2.1") },
                { lineaPesajeId: lineaVaselinaId },
              ],
            },
            tipoVencimiento: "ESTANDAR",
          }),
        ).rejects.toThrow("La línea 2 (Vaselina) es de enrase manual: falta la cantidad real registrada.");

        // ----------------------------------------------------------------------
        // Scenario 1: Typing 2,1 g reserves 2,1 g in the stock unit
        // ----------------------------------------------------------------------
        const plan = await planificarConsumoEnTx(tx, tenantId, {
          preparacionId,
          fichaTecnicaId: fichaId,
          seleccion: {
            modo: "automatica",
            entradas: [
              { lineaPesajeId: lineaCadeId, cantidadManual: dec("2.1") },
              { lineaPesajeId: lineaVaselinaId, cantidadManual: dec("27.9") },
            ],
          },
          jornada,
        });

        await insertReservas(tx, {
          tenantId,
          preparacionId,
          reservadaPorId: sistema,
          reservas: reservasDelPlan(plan),
        });

        const reservasCade = await c.query(
          `SELECT cantidad FROM fsj.reserva_stock WHERE preparacion_id = $1 AND linea_pesaje_id = $2`,
          [preparacionId, lineaCadeId],
        );
        expect(reservasCade.rows).toHaveLength(1);
        expect(Number(reservasCade.rows[0].cantidad)).toBe(2.1);

        // ----------------------------------------------------------------------
        // Scenario 2: Confirming descuenta 2,1 g, detalle records 2,1 g while
        //             the libro's fórmula keeps 2,3 mL
        // ----------------------------------------------------------------------
        const itemConfirmado = await confirmarPreparacionEnTx(tx, session, {
          preparacionId,
          seleccion: {
            modo: "automatica",
            entradas: [
              { lineaPesajeId: lineaCadeId, cantidadManual: dec("2.1") },
              { lineaPesajeId: lineaVaselinaId, cantidadManual: dec("27.9") },
            ],
          },
          tipoVencimiento: "ESTANDAR",
        });

        await registrarAsientoRecetaEnTx(tx, session, {
          contexto: itemConfirmado.contexto,
          items: [
            {
              numero: 1,
              preparacionId: itemConfirmado.id,
              formulaTexto: itemConfirmado.formulaTexto,
              detalles: itemConfirmado.detalles,
              egresosControlados: itemConfirmado.egresosControlados,
            },
          ],
        });

        // 1. Stock movement: EGRESO_PREPARACION of 2.1 g
        const movRes = await c.query(
          `SELECT tipo, cantidad FROM fsj.movimiento_stock WHERE preparacion_id = $1 AND linea_pesaje_id = $2`,
          [preparacionId, lineaCadeId],
        );
        expect(movRes.rows).toHaveLength(1);
        expect(movRes.rows[0].tipo).toBe("EGRESO_PREPARACION");
        expect(Number(movRes.rows[0].cantidad)).toBe(2.1);

        // 2. Libro's detalle_asiento records 2.1 g
        const detRes = await c.query(
          `SELECT cantidad, unidad_texto FROM fsj.detalle_asiento WHERE linea_pesaje_id = $1`,
          [lineaCadeId],
        );
        expect(detRes.rows).toHaveLength(1);
        expect(Number(detRes.rows[0].cantidad)).toBe(2.1);
        expect(detRes.rows[0].unidad_texto).toBe("g");

        // 3. Libro's formula_texto keeps the prescribed "2,3 mL"
        const asientoRes = await c.query(
          `SELECT formula_texto FROM fsj.asiento_recetario WHERE receta_id = $1`,
          [recetaId],
        );
        expect(asientoRes.rows).toHaveLength(1);
        expect(asientoRes.rows[0].formula_texto).toMatch(/Aceite de cade 2,3 mL/);

        completed = true;
        throw new RollbackSentinel();
      }, { maxWait: 20_000, timeout: 30_000 });
    } catch (e) {
      if (!(e instanceof RollbackSentinel)) throw e;
    }

    expect(completed).toBe(true);
  });
});
