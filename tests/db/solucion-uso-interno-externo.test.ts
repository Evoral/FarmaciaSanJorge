/**
 * DB tests for migration 0135 (`SOLUCION` -> `SOLUCION_USO_INTERNO` + `SOLUCION_USO_EXTERNO`)
 * and `etiqueta_hoja.formas_fondo_rojo` / `colorFondoEtiqueta`:
 *   - Enum `fsj.forma_farmaceutica` has both values and no `SOLUCION`.
 *   - `fsj.item_receta` accepts `SOLUCION_USO_EXTERNO`.
 *   - `fsj.etiqueta_hoja.formas_fondo_rojo` accepts `SOLUCION_USO_EXTERNO`, and `colorFondoEtiqueta`
 *     paints only the external one red while leaving `SOLUCION_USO_INTERNO` white (`null`).
 *
 * Runs inside rolled-back transactions; zero rows persist.
 */
import { describe, it, expect } from "vitest";
import { dbTestSkipReason } from "./env";
import { asOwner, inRollbackTx } from "./helpers";
import {
  createSistemaUser,
  insertItemReceta,
  insertMedico,
  insertPaciente,
  insertReceta,
  insertTenant,
  insertUnidad,
} from "./fixtures";
import { colorFondoEtiqueta, type TonoFondoRojoKey } from "@/modules/etiqueta-tamanos/domain/etiqueta-fondo";
import type { FormaFarmaceutica } from "@/modules/recetas/domain/receta";

describe.skipIf(dbTestSkipReason() !== null)("Solución uso interno / externo (0135)", () => {
  it("enum fsj.forma_farmaceutica has SOLUCION_USO_INTERNO and SOLUCION_USO_EXTERNO and no SOLUCION", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const res = await tx.query<{ enumlabel: string }>(
          `SELECT e.enumlabel
           FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'fsj' AND t.typname = 'forma_farmaceutica'
           ORDER BY e.enumsortorder`,
        );
        const labels = res.rows.map((r) => r.enumlabel);
        expect(labels).toContain("SOLUCION_USO_INTERNO");
        expect(labels).toContain("SOLUCION_USO_EXTERNO");
        expect(labels).not.toContain("SOLUCION");
      }),
    );
  });

  it("item_receta and etiqueta_hoja.formas_fondo_rojo accept SOLUCION_USO_EXTERNO, and colorFondoEtiqueta paints only external red", async () => {
    await asOwner((client) =>
      inRollbackTx(client, async (tx) => {
        const tenantId = await insertTenant(tx, "sol_ext");
        const sistema = await createSistemaUser(tx, tenantId);
        const pacienteId = await insertPaciente(tx, tenantId);
        const medicoId = await insertMedico(tx, tenantId);
        const unidadMl = await insertUnidad(tx, "sol_ext_ml", "VOLUMEN", 1);
        const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });

        const itemId = await insertItemReceta(tx, {
          tenantId,
          recetaId,
          formaFarmaceutica: "SOLUCION_USO_EXTERNO",
          cantidadUnidades: 1,
          cantidadTotal: 100,
          unidadTotalId: unidadMl,
        });

        const itemRes = await tx.query<{ forma_farmaceutica: string }>(
          `SELECT forma_farmaceutica::text FROM fsj.item_receta WHERE id = $1`,
          [itemId],
        );
        expect(itemRes.rows[0]!.forma_farmaceutica).toBe("SOLUCION_USO_EXTERNO");

        await tx.query(
          `INSERT INTO fsj.etiqueta_hoja (tenant_id, ancho_mm, alto_mm, margen_mm, formas_fondo_rojo, tono_fondo_rojo)
           VALUES ($1, 210, 297, 5, ARRAY['SOLUCION_USO_EXTERNO']::fsj.forma_farmaceutica[], 'suave')`,
          [tenantId],
        );

        const hojaRes = await tx.query<{ formas_fondo_rojo: string[]; tono_fondo_rojo: string }>(
          `SELECT formas_fondo_rojo::text[], tono_fondo_rojo FROM fsj.etiqueta_hoja WHERE tenant_id = $1`,
          [tenantId],
        );
        const config = {
          formasFondoRojo: hojaRes.rows[0]!.formas_fondo_rojo as FormaFarmaceutica[],
          tonoFondoRojo: hojaRes.rows[0]!.tono_fondo_rojo as TonoFondoRojoKey,
        };
        expect(config.formasFondoRojo).toEqual(["SOLUCION_USO_EXTERNO"]);
        expect(colorFondoEtiqueta("SOLUCION_USO_EXTERNO", config)).toBe("#fca5a5");
        expect(colorFondoEtiqueta("SOLUCION_USO_INTERNO", config)).toBeNull();
      }),
    );
  });
});
