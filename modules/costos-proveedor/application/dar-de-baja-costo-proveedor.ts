/**
 * `darDeBajaCostoProveedor` (docs/specs/costos-proveedor.md R11): closes the
 * vigente costo of a (droga, proveedor) pair WITHOUT a replacement, so that
 * pair has no costo de proveedor and cotizaciones fall back to partida costing
 * (R27). Motivo required. Nothing is deleted or updated but `vigente_hasta`
 * (R2): the costo row's own `motivo` is immutable, so the baja's motivo lives
 * in its audit record (`BAJA` on `costo_proveedor`), which the history reads.
 *
 * `costoProveedorId` is the id of the vigente costo the user saw. The row is
 * locked FIRST and its state read under the lock (R23): a costo that was
 * replaced or given de baja in the meantime is refused, never closed twice.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import {
  ahoraServidor,
  cerrarVigente,
  getDrogasParaCosto,
  getProveedorParaCosto,
  getUnidadesParaCosto,
  lockCostoPorId,
} from "../infrastructure/costo-proveedor-repository";

const darDeBajaCostoProveedorInput = z.object({
  costoProveedorId: uuid,
  motivo: nonEmptyString,
});

export type DarDeBajaCostoProveedorInput = z.input<typeof darDeBajaCostoProveedorInput>;

export const darDeBajaCostoProveedorCommand = defineCommand({
  name: "costos-proveedor.baja",
  permiso: "costos.proveedor.gestionar",
  input: darDeBajaCostoProveedorInput,
  audit: { entidad: "costo_proveedor", accion: "BAJA" },
  handler: async ({ tx, session, input }) => {
    const costo = await lockCostoPorId(tx, session.tenantId, input.costoProveedorId);
    if (!costo) throw new NotFoundError("Costo de proveedor no encontrado.");
    if (costo.vigenteHasta !== null) {
      throw new DomainError("Este costo ya no está vigente: se reemplazó o se dio de baja mientras lo mirabas. Volvé a cargar la página.");
    }

    // Names for the audit diff (the ids alone would not read without a join).
    const drogas = await getDrogasParaCosto(tx, session.tenantId, [costo.drogaId]);
    const proveedor = await getProveedorParaCosto(tx, session.tenantId, costo.proveedorId);
    const unidades = await getUnidadesParaCosto(tx, [costo.unidadPrecioId]);

    const ahora = await ahoraServidor(tx);
    await cerrarVigente(tx, session.tenantId, costo.id, ahora);

    return {
      output: { id: costo.id },
      audit: {
        entidadId: costo.id,
        motivo: input.motivo,
        valorAnterior: {
          droga: drogas.get(costo.drogaId)?.nombre ?? null,
          proveedor: proveedor?.razonSocial ?? null,
          precioInformado: costo.precioInformado,
          unidadPrecio: unidades.get(costo.unidadPrecioId)?.simbolo ?? null,
          costoUnitario: costo.costoUnitario,
          fechaPrecio: costo.fechaPrecio,
          vigenteHasta: null,
        },
        valorNuevo: { vigenteHasta: ahora.toISOString() },
      },
    };
  },
});

export async function darDeBajaCostoProveedor(input: DarDeBajaCostoProveedorInput): Promise<{ id: string }> {
  return darDeBajaCostoProveedorCommand.execute(input);
}
