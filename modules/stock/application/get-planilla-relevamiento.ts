/**
 * `getPlanillaRelevamiento` (openspec/changes/planilla-existencia-inicial).
 * Query `stock.ver`.
 * Returns the planilla rows with their derived states, partidas already passed
 * (with "sin costo" = costo 0), counters, and Faltan cargar (R16).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { dec, type Decimal } from "@/shared/decimal";
import {
  estadoFila,
  claveGrupo,
  type DrogaContexto,
  type EstadoFilaResultado,
  type EstadoRelevamientoInicial,
  type FilaPlanillaInput,
  type PartidaExistenteContexto,
} from "../domain/existencia-inicial";
import {
  getEstadoRelevamientoInicial,
} from "../infrastructure/existencia-inicial-repository";
import { jornadaActualTenant } from "../infrastructure/partida-repository";
import {
  listDrogasFaltanCargar,
  listFilasRelevamiento,
  listPartidasCoincidentesFilas,
  listPartidasExistenciaInicial,
  type DrogaFaltanCargarRaw,
} from "../infrastructure/relevamiento-fila-repository";

export type { DrogaFaltanCargarRaw };

export interface FilaPlanillaConEstado {
  id: string;
  drogaId: string | null;
  drogaNombre: string | null;
  drogaClase: string | null;
  lote: string | null;
  fechaVencimiento: string | null;
  cantidad: string | null;
  cantidadBase: string | null;
  unidadMedidaId: string | null;
  unidadSimbolo: string | null;
  unidadBaseSimbolo: string | null;
  potenciaDeclarada: string | null;
  costoUnitario: string | null;
  proveedorId: string | null;
  proveedorRazonSocial: string | null;
  textoDroga: string | null;
  creadoPorNombre: string;
  creadoPorApellido: string;
  creadoEn: Date;
  actualizadoEn: Date;
  estado: EstadoFilaResultado;
}

export interface PartidaExistenciaInicialView {
  id: string;
  drogaId: string;
  drogaNombre: string;
  drogaClase: string;
  tipoControl: string | null;
  unidadBaseId: string;
  unidadSimbolo: string;
  lote: string;
  proveedorId: string | null;
  proveedorRazonSocial: string | null;
  fechaIngreso: Date;
  fechaVencimiento: string | null;
  fechaVencimientoVigente: string | null;
  cantidadInicial: string;
  cantidadDisponible: string;
  costoUnitario: string;
  sinCosto: boolean;
  potenciaDeclarada: string | null;
  fechaApertura: Date | null;
  usada: boolean;
  anulada: boolean;
}

export interface PlanillaRelevamientoResultado {
  estado: EstadoRelevamientoInicial;
  jornadaActual: string;
  filas: FilaPlanillaConEstado[];
  partidas: PartidaExistenciaInicialView[];
  faltanCargar: DrogaFaltanCargarRaw[];
  contadores: {
    totalFilas: number;
    filasListas: number;
    filasIncompletas: number;
    filasEnConflicto: number;
    partidasPasadas: number;
    partidasSinCosto: number;
    faltanCargar: number;
  };
}

export const getPlanillaRelevamientoQuery = defineQuery({
  name: "stock.relevamiento.planilla.ver",
  permiso: "stock.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<PlanillaRelevamientoResultado> => {
    const [estado, filasRaw, partidasRaw, faltanCargar, partidasCoincidentes, unidadesRaw, jornadaActual] = await Promise.all([
      getEstadoRelevamientoInicial(tx, session.tenantId),
      listFilasRelevamiento(tx, session.tenantId),
      listPartidasExistenciaInicial(tx, session.tenantId),
      listDrogasFaltanCargar(tx, session.tenantId),
      listPartidasCoincidentesFilas(tx, session.tenantId),
      tx.unidadMedida.findMany({
        select: { id: true, simbolo: true, tipoMagnitud: true, factorABase: true },
      }),
      jornadaActualTenant(tx, session.tenantId),
    ]);

    const unidadMap = new Map(
      unidadesRaw.map((u) => [u.id, { simbolo: u.simbolo, tipoMagnitud: u.tipoMagnitud, factorABase: dec(u.factorABase) }]),
    );

    // Index existing partidas by (drogaId, lote, proveedorId)
    const partidaIndex = new Map<string, PartidaExistenteContexto>();
    for (const p of partidasCoincidentes) {
      const clave = claveGrupo(p.droga_id, p.lote, p.proveedor_id);
      partidaIndex.set(clave, {
        id: p.id,
        drogaId: p.droga_id,
        lote: p.lote,
        proveedorId: p.proveedor_id,
        origen: p.origen,
        fechaVencimiento: p.fecha_vencimiento,
        potenciaDeclarada: p.potencia_declarada,
        costoUnitario: p.costo_unitario,
      });
    }

    // Group rows by group key to evaluate sibling conflicts and "se_suma"
    const filasPorGrupo = new Map<string, FilaPlanillaInput[]>();
    for (const r of filasRaw) {
      if (r.droga_id && r.lote) {
        const clave = claveGrupo(r.droga_id, r.lote, r.proveedor_id);
        const grupo = filasPorGrupo.get(clave) ?? [];
        grupo.push({
          id: r.id,
          drogaId: r.droga_id,
          lote: r.lote,
          fechaVencimiento: r.fecha_vencimiento,
          cantidad: r.cantidad,
          unidadMedidaId: r.unidad_medida_id,
          potenciaDeclarada: r.potencia_declarada,
          costoUnitario: r.costo_unitario,
          proveedorId: r.proveedor_id,
          textoDroga: r.texto_droga,
        });
        filasPorGrupo.set(clave, grupo);
      }
    }

    let filasListas = 0;
    let filasIncompletas = 0;
    let filasEnConflicto = 0;

    const filasConEstado: FilaPlanillaConEstado[] = filasRaw.map((r) => {
      const inputFila: FilaPlanillaInput = {
        id: r.id,
        drogaId: r.droga_id,
        lote: r.lote,
        fechaVencimiento: r.fecha_vencimiento,
        cantidad: r.cantidad,
        unidadMedidaId: r.unidad_medida_id,
        potenciaDeclarada: r.potencia_declarada,
        costoUnitario: r.costo_unitario,
        proveedorId: r.proveedor_id,
        textoDroga: r.texto_droga,
      };

      let drogaContexto: DrogaContexto | null = null;
      if (r.droga_id && r.droga_nombre && r.droga_clase && r.droga_unidad_base_id) {
        drogaContexto = {
          id: r.droga_id,
          nombre: r.droga_nombre,
          clase: r.droga_clase as DrogaContexto["clase"],
          unidadBaseId: r.droga_unidad_base_id,
        };
      }

      let clave: string | null = null;
      if (r.droga_id && r.lote) {
        clave = claveGrupo(r.droga_id, r.lote, r.proveedor_id);
      }

      const filasDelGrupo = clave ? filasPorGrupo.get(clave) : undefined;
      const partidaExistente = clave ? partidaIndex.get(clave) : null;

      const getFactorABase = (unidadMedidaId: string): Decimal | null => {
        if (!r.droga_unidad_base_id) return null;
        const baseU = unidadMap.get(r.droga_unidad_base_id);
        const u = unidadMap.get(unidadMedidaId);
        if (!baseU || !u) return null;
        if (u.tipoMagnitud !== baseU.tipoMagnitud) return null;
        return u.factorABase.gt(0) ? u.factorABase : null;
      };

      const estado = estadoFila(inputFila, {
        droga: drogaContexto,
        filasDelGrupo,
        partidaExistente,
        factorABase: getFactorABase,
      });

      if (estado.tipo === "incompleta") {
        filasIncompletas++;
      } else if (estado.tipo === "en_conflicto") {
        filasEnConflicto++;
      } else {
        filasListas++;
      }

      let cantidadBase: string | null = null;
      if (r.cantidad && r.unidad_medida_id && r.droga_unidad_base_id) {
        try {
          const baseU = unidadMap.get(r.droga_unidad_base_id);
          const u = unidadMap.get(r.unidad_medida_id);
          if (
            baseU &&
            u &&
            u.tipoMagnitud === baseU.tipoMagnitud &&
            baseU.factorABase.gt(0) &&
            u.factorABase.gt(0)
          ) {
            cantidadBase = dec(r.cantidad).mul(u.factorABase).div(baseU.factorABase).toString();
          }
        } catch {
          cantidadBase = null;
        }
      }
      const unidadBaseSimbolo = r.droga_unidad_base_id
        ? (unidadMap.get(r.droga_unidad_base_id)?.simbolo ?? null)
        : null;

      return {
        id: r.id,
        drogaId: r.droga_id,
        drogaNombre: r.droga_nombre,
        drogaClase: r.droga_clase,
        lote: r.lote,
        fechaVencimiento: r.fecha_vencimiento,
        cantidad: r.cantidad,
        cantidadBase,
        unidadMedidaId: r.unidad_medida_id,
        unidadSimbolo: r.unidad_simbolo,
        unidadBaseSimbolo,
        potenciaDeclarada: r.potencia_declarada,
        costoUnitario: r.costo_unitario,
        proveedorId: r.proveedor_id,
        proveedorRazonSocial: r.proveedor_razon_social,
        textoDroga: r.texto_droga,
        creadoPorNombre: r.creado_por_nombre,
        creadoPorApellido: r.creado_por_apellido,
        creadoEn: r.creado_en,
        actualizadoEn: r.actualizado_en,
        estado,
      };
    });

    let partidasSinCosto = 0;
    const partidasView: PartidaExistenciaInicialView[] = partidasRaw.map((p) => {
      const sinCosto = !p.costo_unitario || dec(p.costo_unitario).isZero();
      if (sinCosto) partidasSinCosto++;
      const anulada = dec(p.cantidad_inicial).isZero();
      return {
        id: p.id,
        drogaId: p.droga_id,
        drogaNombre: p.droga_nombre,
        drogaClase: p.droga_clase,
        tipoControl: p.tipo_control,
        unidadBaseId: p.droga_unidad_base_id,
        unidadSimbolo: p.unidad_simbolo,
        lote: p.lote,
        proveedorId: p.proveedor_id,
        proveedorRazonSocial: p.proveedor_razon_social,
        fechaIngreso: p.fecha_ingreso,
        fechaVencimiento: p.fecha_vencimiento,
        fechaVencimientoVigente: p.fecha_vencimiento_vigente,
        cantidadInicial: p.cantidad_inicial,
        cantidadDisponible: p.cantidad_disponible,
        costoUnitario: p.costo_unitario,
        sinCosto,
        potenciaDeclarada: p.potencia_declarada,
        fechaApertura: p.fecha_apertura,
        usada: p.usada,
        anulada,
      };
    });

    return {
      estado,
      jornadaActual,
      filas: filasConEstado,
      partidas: partidasView,
      faltanCargar,
      contadores: {
        totalFilas: filasRaw.length,
        filasListas,
        filasIncompletas,
        filasEnConflicto,
        partidasPasadas: partidasRaw.length,
        partidasSinCosto,
        faltanCargar: faltanCargar.length,
      },
    };
  },
});

export async function getPlanillaRelevamiento(): Promise<PlanillaRelevamientoResultado> {
  return getPlanillaRelevamientoQuery.execute({});
}
