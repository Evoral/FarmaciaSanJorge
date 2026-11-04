/**
 * `getConfirmacionDeFicha`: what the toma workspace's pesada en la ficha
 * (ui/pesaje-en-toma.tsx: lots, real weighing, then "Marcar como preparada")
 * needs for an ítem's ficha técnica BEFORE any preparación exists -- the same data
 * `/preparaciones/[id]` shows for an INICIADA one (shared builder,
 * ./datos-confirmacion.ts). Read-only, `preparaciones.iniciar` (same as
 * `preparaciones.pantalla`): opening the dialog persists nothing; the
 * preparación is created together with its reserva de stock by
 * `reservarStockPreparacion` (./reservar-stock-preparacion.ts) with the same
 * automatic plan. Stock reserved by other preparaciones is not available.
 * Each línea carries its pesada en borrador (migration 0090,
 * ./guardar-borrador-pesada.ts) as `reserva`, which prefills the fields; plus
 * the excipientes to choose from and the excipiente's draft (migration 0092), and the material / insumos
 * adicionales to choose from, their draft and the cápsulas' pre-fill (migration 0110).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { unidadesDelItem } from "../domain/excipiente-por-unidad";
import { cantidadCapsulas } from "../domain/insumo";
import {
  getBorradoresDeFicha,
  getExcipienteBorrador,
  getFichaParaIniciar,
  getFormaDeItemDeFicha,
  listExcipientesParaToma,
  listInsumosBorrador,
  listInsumosParaToma,
} from "../infrastructure/preparacion-repository";
import { construirDatosConfirmacion, type DatosConfirmacion } from "./datos-confirmacion";

const getConfirmacionDeFichaInput = z.object({ fichaTecnicaId: uuid });

export const getConfirmacionDeFichaQuery = defineQuery({
  name: "preparaciones.confirmacionDeFicha",
  permiso: "preparaciones.iniciar",
  input: getConfirmacionDeFichaInput,
  handler: async ({ tx, session, input }): Promise<DatosConfirmacion> => {
    const ficha = await getFichaParaIniciar(tx, session.tenantId, input.fichaTecnicaId);
    if (!ficha) throw new NotFoundError("Ficha técnica no encontrada.");
    const datos = await construirDatosConfirmacion(tx, session.tenantId, ficha.id);
    const borradores = await getBorradoresDeFicha(tx, session.tenantId, ficha.id);
    const forma = await getFormaDeItemDeFicha(tx, session.tenantId, ficha.id);
    return {
      ...datos,
      puedeElaborarLote: can(session, "stock.lote.elaborar"),
      lineas: datos.lineas.map((linea) => ({ ...linea, reserva: borradores.get(linea.id) ?? null })),
      excipiente: {
        opciones: await listExcipientesParaToma(tx, session.tenantId, datos.jornadaActual),
        borrador: await getExcipienteBorrador(tx, session.tenantId, ficha.id),
        unidades: unidadesExcipiente(forma),
      },
      insumos: { opciones: await listInsumosParaToma(tx, session.tenantId, datos.jornadaActual), borrador: await listInsumosBorrador(tx, session.tenantId, ficha.id), capsulas: forma ? cantidadCapsulas(forma) : null },
    };
  },
});

/** The ítem's units for an excipiente typed per unidad, as plain values (they cross into a Client Component). */
function unidadesExcipiente(forma: Parameters<typeof unidadesDelItem>[0] | null): NonNullable<DatosConfirmacion["excipiente"]>["unidades"] {
  const unidades = forma ? unidadesDelItem(forma) : null;
  return unidades ? { cantidad: unidades.cantidad.toString(), dosis: unidades.dosis.toString(), singular: unidades.singular, plural: unidades.plural } : null;
}

export async function getConfirmacionDeFicha(fichaTecnicaId: string): Promise<DatosConfirmacion> {
  return getConfirmacionDeFichaQuery.execute({ fichaTecnicaId });
}
