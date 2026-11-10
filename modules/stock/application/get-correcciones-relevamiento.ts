/**
 * `getCorreccionesRelevamiento` (openspec/changes/planilla-existencia-inicial R7).
 * Query `stock.ver`.
 * Returns every correction made during the relevamiento:
 * - Movement corrections (CORRECCION_INICIAL_SUMA and CORRECCION_INICIAL_RESTA)
 * - Data corrections (audited changes to lote, vencimiento, proveedor with correccion: "DATOS_INICIAL")
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";

export interface CorreccionMovimientoView {
  id: string;
  drogaNombre: string;
  lote: string;
  tipo: "CORRECCION_INICIAL_SUMA" | "CORRECCION_INICIAL_RESTA";
  cantidad: string;
  unidadSimbolo: string;
  observacion: string | null;
  registradoPor: string;
  registradoEn: Date;
}

export interface CorreccionDatosView {
  id: string;
  drogaNombre: string;
  loteActual: string;
  loteAnterior: string | null;
  loteNuevo: string | null;
  fechaVencimientoAnterior: string | null;
  fechaVencimientoNuevo: string | null;
  proveedorAnterior: string | null;
  proveedorNuevo: string | null;
  realizadoPor: string;
  ocurridoEn: Date;
}

export interface CorreccionesRelevamientoResult {
  movimientos: CorreccionMovimientoView[];
  datos: CorreccionDatosView[];
}

export const getCorreccionesRelevamientoQuery = defineQuery({
  name: "stock.relevamiento.correcciones.ver",
  permiso: "stock.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<CorreccionesRelevamientoResult> => {
    const tenantId = session.tenantId;

    const [movimientosRaw, datosRaw] = await Promise.all([
      tx.$queryRaw<
        {
          id: string;
          droga_nombre: string;
          lote: string;
          tipo: "CORRECCION_INICIAL_SUMA" | "CORRECCION_INICIAL_RESTA";
          cantidad: string;
          unidad_simbolo: string;
          observacion: string | null;
          registrado_por: string;
          registrado_en: Date;
        }[]
      >`
        SELECT
          ms.id::text,
          d.nombre::text AS droga_nombre,
          p.lote,
          ms.tipo::text,
          ms.cantidad::text,
          u.simbolo::text AS unidad_simbolo,
          ms.observacion,
          usr.apellido || ', ' || usr.nombre AS registrado_por,
          ms.registrado_en
        FROM fsj.movimiento_stock ms
        JOIN fsj.partida p ON p.tenant_id = ms.tenant_id AND p.id = ms.partida_id
        JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
        JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
        JOIN fsj.usuario usr ON usr.tenant_id = ms.tenant_id AND usr.id = ms.registrado_por_id
        WHERE ms.tenant_id = ${tenantId}::uuid
          AND ms.tipo::text IN ('CORRECCION_INICIAL_SUMA', 'CORRECCION_INICIAL_RESTA')
        ORDER BY ms.registrado_en DESC, ms.id DESC
      `,
      tx.$queryRaw<
        {
          id: string;
          droga_nombre: string;
          lote_actual: string;
          valor_anterior: {
            lote?: string;
            fechaVencimiento?: string | null;
            proveedorId?: string | null;
          } | null;
          valor_nuevo: {
            lote?: string;
            fechaVencimiento?: string | null;
            proveedorId?: string | null;
          } | null;
          realizado_por: string;
          ocurrido_en: Date;
        }[]
      >`
        SELECT
          ra.id::text,
          d.nombre::text AS droga_nombre,
          p.lote AS lote_actual,
          ra.valor_anterior,
          ra.valor_nuevo,
          usr.apellido || ', ' || usr.nombre AS realizado_por,
          ra.ocurrido_en
        FROM fsj.registro_auditoria ra
        JOIN fsj.partida p ON p.tenant_id = ra.tenant_id AND p.id = ra.entidad_id
        JOIN fsj.droga d ON d.tenant_id = p.tenant_id AND d.id = p.droga_id
        JOIN fsj.usuario usr ON usr.tenant_id = ra.tenant_id AND usr.id = ra.usuario_id
        WHERE ra.tenant_id = ${tenantId}::uuid
          AND ra.entidad = 'partida'
          AND ra.accion = 'MODIFICAR'
          AND ra.valor_nuevo->>'correccion' = 'DATOS_INICIAL'
        ORDER BY ra.ocurrido_en DESC, ra.id DESC
      `,
    ]);

    // Resolve proveedor IDs in audit records
    const proveedorIds = new Set<string>();
    for (const d of datosRaw) {
      if (d.valor_anterior?.proveedorId) proveedorIds.add(d.valor_anterior.proveedorId);
      if (d.valor_nuevo?.proveedorId) proveedorIds.add(d.valor_nuevo.proveedorId);
    }

    const proveedoresMap = new Map<string, string>();
    if (proveedorIds.size > 0) {
      const proveedores = await tx.proveedor.findMany({
        where: { tenantId, id: { in: Array.from(proveedorIds) } },
        select: { id: true, razonSocial: true },
      });
      for (const pr of proveedores) {
        proveedoresMap.set(pr.id, pr.razonSocial);
      }
    }

    const datosView: CorreccionDatosView[] = datosRaw.map((d) => {
      const prev = d.valor_anterior ?? {};
      const next = d.valor_nuevo ?? {};

      return {
        id: d.id,
        drogaNombre: d.droga_nombre,
        loteActual: d.lote_actual,
        loteAnterior: prev.lote ?? null,
        loteNuevo: next.lote ?? null,
        fechaVencimientoAnterior: prev.fechaVencimiento ?? null,
        fechaVencimientoNuevo: next.fechaVencimiento ?? null,
        proveedorAnterior: prev.proveedorId
          ? (proveedoresMap.get(prev.proveedorId) ?? prev.proveedorId)
          : null,
        proveedorNuevo: next.proveedorId
          ? (proveedoresMap.get(next.proveedorId) ?? next.proveedorId)
          : null,
        realizadoPor: d.realizado_por,
        ocurridoEn: d.ocurrido_en,
      };
    });

    const movimientosView: CorreccionMovimientoView[] = movimientosRaw.map((m) => ({
      id: m.id,
      drogaNombre: m.droga_nombre,
      lote: m.lote,
      tipo: m.tipo,
      cantidad: m.cantidad,
      unidadSimbolo: m.unidad_simbolo,
      observacion: m.observacion,
      registradoPor: m.registrado_por,
      registradoEn: m.registrado_en,
    }));

    return {
      movimientos: movimientosView,
      datos: datosView,
    };
  },
});

export async function getCorreccionesRelevamiento(): Promise<CorreccionesRelevamientoResult> {
  return getCorreccionesRelevamientoQuery.execute({});
}
