import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineCommand } from "@/shared/usecase";
import { record as auditRecord, TipoAccion } from "@/shared/audit";
import { DomainError, NotFoundError } from "@/shared/errors";
import { dec } from "@/shared/decimal";
import { uuid } from "@/shared/validation";
import {
  campoFaltanteFila,
  conflictosGrupo,
  MENSAJE_RELEVAMIENTO_CERRADO,
  type DrogaContexto,
  type FilaPlanillaInput,
} from "../domain/existencia-inicial";
import {
  lockFilasRelevamiento,
  deleteFilasRelevamiento,
  findPartidaPorDrogaLoteProveedor,
  getCostoVigenteSugerido,
} from "../infrastructure/relevamiento-fila-repository";
import {
  lockTenantRelevamientoCompartido,
  relevamientoInicialAbierto,
} from "../infrastructure/existencia-inicial-repository";
import {
  getDrogaParaIngreso,
  convertirUnidad,
  insertCorreccionInicialSuma,
} from "../infrastructure/partida-repository";
import { registrarPartidaCompra } from "./ingresar-partida";

const pasarGrupoAStockInput = z.object({
  filaIds: z.array(uuid).min(1, "Debe indicar al menos una fila."),
});

export type PasarGrupoAStockInput = z.infer<typeof pasarGrupoAStockInput>;

export interface PasarGrupoAStockOutput {
  partidaId: string;
  nueva: boolean;
  cantidadBase: string;
}

export const pasarGrupoAStockCommand = defineCommand({
  name: "stock.partida.pasar_grupo_a_stock",
  permiso: "stock.partida.ingresar",
  input: pasarGrupoAStockInput,
  audit: {
    skip: true,
    reason: "Audited manually as CREAR (new partida) or MODIFICAR (correccion inicial suma) per Spec R5",
  },
  handler: async ({ tx, session, input }) => {
    // 1. Lock tenant relevamiento compartido and ensure window is open
    await lockTenantRelevamientoCompartido(tx, session.tenantId);
    const abierto = await relevamientoInicialAbierto(tx, session.tenantId);
    if (!abierto) {
      throw new DomainError(MENSAJE_RELEVAMIENTO_CERRADO);
    }

    // 2. Lock the group's rows
    const filas = await lockFilasRelevamiento(tx, session.tenantId, input.filaIds);
    if (filas.length !== input.filaIds.length) {
      throw new DomainError("Las filas ya fueron pasadas a stock o eliminadas.");
    }

    // 3. Ensure all rows belong to the same group: droga, lote, proveedor
    const primera = filas[0]!;
    if (!primera.droga_id) {
      throw new DomainError("La fila no tiene droga asignada.");
    }
    if (!primera.lote || primera.lote.trim() === "") {
      throw new DomainError("La fila no tiene lote asignado.");
    }

    const primeraLoteTrim = primera.lote.trim();
    const primeraProveedorId = primera.proveedor_id ?? null;

    for (const f of filas) {
      if (
        f.droga_id !== primera.droga_id ||
        !f.lote ||
        f.lote.trim() !== primeraLoteTrim ||
        (f.proveedor_id ?? null) !== primeraProveedorId
      ) {
        throw new DomainError("Las filas no pertenecen al mismo grupo de droga, lote y proveedor.");
      }
    }

    // 4. Retrieve droga and verify it is active
    const droga = await getDrogaParaIngreso(tx, session.tenantId, primera.droga_id);
    if (!droga) throw new NotFoundError("Droga no encontrada.");
    if (droga.fechaBaja !== null) {
      throw new DomainError(`La droga ${droga.nombre} está dada de baja.`);
    }

    const drogaCtx: DrogaContexto = {
      id: droga.id,
      nombre: droga.nombre,
      clase: droga.clase,
      unidadBaseId: droga.unidadBaseId,
    };

    // 5. Verify completeness of all rows in group
    for (const f of filas) {
      const faltante = campoFaltanteFila(
        {
          id: f.id,
          drogaId: f.droga_id,
          lote: f.lote,
          fechaVencimiento: f.fecha_vencimiento,
          cantidad: f.cantidad,
          unidadMedidaId: f.unidad_medida_id,
          potenciaDeclarada: f.potencia_declarada,
          costoUnitario: f.costo_unitario,
          proveedorId: f.proveedor_id,
        },
        drogaCtx,
      );
      if (faltante) {
        throw new DomainError(`La fila está incompleta: ${faltante.motivo}.`);
      }
    }

    // 6. Look up existing partida by droga, lote and proveedor (locked FOR UPDATE)
    const partidaExistente = await findPartidaPorDrogaLoteProveedor(
      tx,
      session.tenantId,
      primera.droga_id,
      primeraLoteTrim,
      primeraProveedorId,
    );

    // 7. A row's costo is typed per ITS unit (the price of a kg, as on the
    // invoice), but partida.costo_unitario is per the droga's unidad base:
    // divide by the same fsj.convertir factor the invoice import uses
    // (registrarPartidaCompra's porUnidadCompra) before comparing or storing.
    const costoBasePorFila = new Map<string, string>();
    for (const f of filas) {
      if (!f.costo_unitario || f.costo_unitario.trim() === "") continue;
      const factor = await convertirUnidad(tx, "1", f.unidad_medida_id!, droga.unidadBaseId);
      costoBasePorFila.set(f.id, dec(f.costo_unitario.trim()).dividedBy(factor).toDecimalPlaces(6).toString());
    }

    // Check for conflicts within group and against existing partida
    const filasInput: FilaPlanillaInput[] = filas.map((f) => ({
      id: f.id,
      drogaId: f.droga_id,
      lote: f.lote,
      fechaVencimiento: f.fecha_vencimiento,
      cantidad: f.cantidad,
      unidadMedidaId: f.unidad_medida_id,
      potenciaDeclarada: f.potencia_declarada,
      costoUnitario: costoBasePorFila.get(f.id) ?? null,
      proveedorId: f.proveedor_id,
    }));

    const conflictos = conflictosGrupo(
      filasInput,
      partidaExistente
        ? {
            id: partidaExistente.id,
            drogaId: primera.droga_id,
            lote: partidaExistente.lote,
            proveedorId: primeraProveedorId,
            origen: partidaExistente.origen,
            fechaVencimiento: partidaExistente.fechaVencimiento,
            potenciaDeclarada: partidaExistente.potenciaDeclarada,
            costoUnitario: partidaExistente.costoUnitario,
          }
        : null,
    );

    if (conflictos.length > 0) {
      throw new DomainError(`No se puede pasar a stock: ${conflictos.join(". ")}`);
    }

    // 8. Sum quantities converted to the droga's base unit
    let totalCantidadBase = dec(0);
    for (const f of filas) {
      const cantBase = await convertirUnidad(
        tx,
        f.cantidad!,
        f.unidad_medida_id!,
        droga.unidadBaseId,
      );
      totalCantidadBase = totalCantidadBase.plus(cantBase);
    }

    let partidaId: string;
    const esNueva = !partidaExistente;

    if (!partidaExistente) {
      // Resolve costo: row costo -> vigente costo sugerido -> "0"
      const filaConCosto = filas.find((f) => costoBasePorFila.has(f.id));
      let costoFinal: string;
      if (filaConCosto) {
        costoFinal = costoBasePorFila.get(filaConCosto.id)!;
      } else {
        const sugerido = await getCostoVigenteSugerido(
          tx,
          session.tenantId,
          primera.droga_id,
          primeraProveedorId,
        );
        costoFinal = sugerido ?? "0";
      }

      const vencimiento = filas.find((f) => f.fecha_vencimiento)?.fecha_vencimiento ?? null;
      const potencia = filas.find((f) => f.potencia_declarada)?.potencia_declarada ?? null;

      const resultadoAlta = await registrarPartidaCompra(tx, session, {
        origen: "EXISTENCIA_INICIAL",
        drogaId: primera.droga_id,
        proveedorId: primeraProveedorId,
        lote: primeraLoteTrim,
        fechaVencimiento: vencimiento ?? undefined,
        cantidadCompra: totalCantidadBase.toFixed(),
        unidadCompraId: droga.unidadBaseId,
        costo: { porUnidadBase: costoFinal },
        potenciaDeclarada: potencia ?? undefined,
      });

      partidaId = resultadoAlta.id;

      await auditRecord(tx, {
        tenantId: session.tenantId,
        usuarioId: session.usuario.id,
        entidad: "partida",
        entidadId: partidaId,
        accion: TipoAccion.CREAR,
        valorNuevo: resultadoAlta.valorNuevo,
      });
    } else {
      // Existing partida de existencia inicial is already locked FOR UPDATE by findPartidaPorDrogaLoteProveedor
      partidaId = partidaExistente.id;

      await insertCorreccionInicialSuma(tx, {
        tenantId: session.tenantId,
        partidaId,
        cantidad: totalCantidadBase.toFixed(),
        observacion: "Frasco adicional del relevamiento",
        registradoPorId: session.usuario.id,
      });

      const valorNuevo: Prisma.InputJsonObject = {
        origen: "EXISTENCIA_INICIAL",
        movimiento: "CORRECCION_INICIAL_SUMA",
        cantidadAgregada: totalCantidadBase.toFixed(),
        observacion: "Frasco adicional del relevamiento",
      };

      await auditRecord(tx, {
        tenantId: session.tenantId,
        usuarioId: session.usuario.id,
        entidad: "partida",
        entidadId: partidaId,
        accion: TipoAccion.MODIFICAR,
        valorNuevo,
      });
    }

    // 9. Delete the processed rows in the same transaction
    await deleteFilasRelevamiento(tx, session.tenantId, input.filaIds);

    return {
      output: {
        partidaId,
        nueva: esNueva,
        cantidadBase: totalCantidadBase.toFixed(),
      },
    };
  },
});

export async function pasarGrupoAStock(
  input: PasarGrupoAStockInput,
): Promise<PasarGrupoAStockOutput> {
  return pasarGrupoAStockCommand.execute(input);
}
