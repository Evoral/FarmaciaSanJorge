/**
 * `calcularCotizacionItem` (M10, FASE 7 point 7.4, DP-09 RESUELTA). ATP,
 * FAR, DT (plan §7: `cotizaciones.calcular`).
 *
 * INV-R02 ("sin efectos"): this handler NEVER writes to
 * movimiento_stock/asiento_recetario/contador_correlativo, never takes a
 * `FOR UPDATE` lock on any partida, and never reserves anything --
 * `getPartidasElegiblesDeDroga` (cotizacion-repository.ts) is a plain
 * `SELECT`. See tests/db/regla-precio-cotizacion.test.ts for the
 * before/after row-count proof, same style as
 * tests/db/fichas-tecnicas-generacion.test.ts's INV-R02 test.
 *
 * NOT audited: plan §14 explicitly excludes cotizaciones from
 * registro_auditoria (INV-A01) -- see the `audit: { skip: true, ... }`
 * declaration below.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { calcularCotizacion } from "../domain/calcular-cotizacion";
import type { LineaCosteoInput, PartidaCosteo } from "../domain/calcular-cotizacion";
import {
  getItemParaCotizar,
  getUltimaFichaConLineas,
  getPartidasElegiblesDeDroga,
  jornadaActualTenant,
  insertCotizacion,
} from "../infrastructure/cotizacion-repository";
import { getReglaVigente } from "../infrastructure/regla-precio-repository";

const calcularCotizacionInput = z.object({ itemRecetaId: uuid });

export interface CalcularCotizacionInput {
  itemRecetaId: string;
}

export interface CalcularCotizacionOutput {
  id: string;
  costoInsumos: string;
  margenAplicado: string;
  precioFinal: string;
  esParcial: boolean;
  esIncompleta: boolean;
  calculadaEn: string;
}

export const calcularCotizacionCommand = defineCommand({
  name: "cotizaciones.calcular",
  permiso: "cotizaciones.calcular",
  input: calcularCotizacionInput,
  audit: {
    skip: true,
    reason:
      "INV-A01 / plan §14: cotizaciones están explícitamente excluidas de la auditoría, igual que las fichas técnicas -- ver modules/elaboracion/application/generar-ficha-tecnica.ts para el mismo razonamiento aplicado a fichas.",
  },
  handler: async ({ tx, session, input }) => {
    const item = await getItemParaCotizar(tx, session.tenantId, input.itemRecetaId);
    if (!item) throw new NotFoundError("Ítem de receta no encontrado.");

    const ficha = await getUltimaFichaConLineas(tx, session.tenantId, input.itemRecetaId);
    if (!ficha) {
      throw new DomainError("Este ítem no tiene ficha técnica generada todavía. Generá la ficha técnica antes de cotizar.");
    }

    const regla = await getReglaVigente(tx, session.tenantId);
    if (!regla) {
      throw new DomainError("No hay una regla de precio configurada. Pedile a un administrador que configure el margen antes de cotizar.");
    }

    const jornadaActual = await jornadaActualTenant(tx, session.tenantId);

    const drogaIds = [...new Set(ficha.lineas.filter((l) => !l.esEnraseManual).map((l) => l.drogaId))];
    const partidasPorDrogaMap = new Map<string, PartidaCosteo[]>();
    for (const drogaId of drogaIds) {
      partidasPorDrogaMap.set(drogaId, await getPartidasElegiblesDeDroga(tx, session.tenantId, drogaId));
    }

    const lineasInput: LineaCosteoInput[] = ficha.lineas.map((l) => ({
      drogaId: l.drogaId,
      drogaNombre: l.drogaNombre,
      unidadSimbolo: l.unidadSimbolo,
      cantidadAPesar: l.cantidadAPesar,
      esEnraseManual: l.esEnraseManual,
      orden: l.orden,
    }));

    const resultado = calcularCotizacion(
      lineasInput,
      (drogaId) => partidasPorDrogaMap.get(drogaId) ?? [],
      jornadaActual,
      regla.margen,
    );

    const nueva = await insertCotizacion(tx, {
      tenantId: session.tenantId,
      itemRecetaId: input.itemRecetaId,
      costoInsumos: resultado.costoInsumos.toString(),
      margenAplicado: resultado.margenAplicado.toString(),
      precioFinal: resultado.precioFinal.toString(),
      reglaPrecioId: regla.id,
      esParcial: resultado.esParcial,
      esIncompleta: resultado.esIncompleta,
      // CotizacionDetalle is a plain, JSON-serializable shape (strings,
      // booleans, null, nested arrays/objects only) -- the cast is only
      // needed because TS interfaces don't structurally satisfy Prisma's
      // indexed InputJsonObject without one; there is no runtime risk of a
      // non-JSON value slipping through.
      detalle: resultado.detalle as unknown as Prisma.InputJsonValue,
      calculadaPorId: session.usuario.id,
    });

    return {
      output: {
        id: nueva.id,
        costoInsumos: resultado.costoInsumos.toString(),
        margenAplicado: resultado.margenAplicado.toString(),
        precioFinal: resultado.precioFinal.toString(),
        esParcial: resultado.esParcial,
        esIncompleta: resultado.esIncompleta,
        calculadaEn: nueva.calculadaEn.toISOString(),
      },
    };
  },
});

export async function calcularCotizacionItem(input: CalcularCotizacionInput): Promise<CalcularCotizacionOutput> {
  return calcularCotizacionCommand.execute(input);
}
