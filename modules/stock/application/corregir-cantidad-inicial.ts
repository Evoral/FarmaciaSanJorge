/**
 * `corregirCantidadInicial` (openspec/changes/planilla-existencia-inicial R17).
 * Allows correcting the cantidad inicial of a partida de existencia inicial while the relevamiento is open.
 * Positive delta creates a CORRECCION_INICIAL_SUMA movement; negative delta creates a CORRECCION_INICIAL_RESTA movement.
 * Downward correction on a controlled droga requires the DT's co-firma (verificarCoFirmaDt).
 * Permiso: stock.partida.ingresar.
 */
import { z } from "zod";
import { defineCommand, TipoAccion, type ExecuteOptions } from "@/shared/usecase";
import { dec, Decimal } from "@/shared/decimal";
import { nonNegativeDecimalString, uuid } from "@/shared/validation";
import { DomainError, NotFoundError } from "@/shared/errors";
import {
  deltaCorreccion,
  MENSAJE_RELEVAMIENTO_CERRADO,
} from "../domain/existencia-inicial";
import {
  lockTenantRelevamientoCompartido,
  relevamientoInicialAbierto,
} from "../infrastructure/existencia-inicial-repository";
import {
  convertirUnidad,
  getPartidaParaAccion,
  insertCorreccionInicialResta,
  insertCorreccionInicialSuma,
  lockPartidaParaAccion,
  reservadoPorPartida,
} from "../infrastructure/partida-repository";
import { verificarCoFirmaDtEnTx } from "./verificar-co-firma-dt";

export const corregirCantidadInicialInput = z.object({
  partidaId: uuid,
  cantidad: nonNegativeDecimalString,
  unidadId: uuid,
  observacion: z.string().trim().max(500).optional().nullable(),
  dtUsuarioId: uuid.optional().nullable(),
  dtPassword: z.string().optional().nullable(),
});

export type CorregirCantidadInicialInput = z.input<typeof corregirCantidadInicialInput>;

export interface CorregirCantidadInicialOutput {
  id: string;
  cantidadInicial: string;
  movimientoId: string;
  tipo: "SUMA" | "RESTA";
}

export const corregirCantidadInicialCommand = defineCommand({
  name: "stock.partida.corregirCantidadInicial",
  permiso: "stock.partida.ingresar",
  input: corregirCantidadInicialInput,
  audit: { entidad: "partida", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    await lockTenantRelevamientoCompartido(tx, session.tenantId);

    const abierto = await relevamientoInicialAbierto(tx, session.tenantId);
    if (!abierto) {
      throw new DomainError(MENSAJE_RELEVAMIENTO_CERRADO);
    }

    const locked = await lockPartidaParaAccion(tx, session.tenantId, input.partidaId);
    if (!locked) {
      throw new NotFoundError("Partida no encontrada.");
    }

    const partida = await getPartidaParaAccion(tx, session.tenantId, input.partidaId);
    if (!partida) {
      throw new NotFoundError("Partida no encontrada.");
    }

    if (partida.origen !== "EXISTENCIA_INICIAL") {
      throw new DomainError("Solo se pueden corregir partidas de existencia inicial.");
    }

    const cantidadParsed = dec(input.cantidad);
    if (cantidadParsed.lessThan(0)) {
      throw new DomainError("La cantidad inicial no puede ser negativa.", {
        fields: ["cantidad"],
      });
    }

    const cantidadEnBase = await convertirUnidad(
      tx,
      cantidadParsed.toString(),
      input.unidadId,
      partida.unidadBaseId,
    );

    const delta = deltaCorreccion(partida.cantidadInicial, cantidadEnBase);
    if (delta.tipo === null || delta.cantidad.isZero()) {
      throw new DomainError("La cantidad es la misma.", {
        fields: ["cantidad"],
      });
    }

    let autorizadoPorId: string | null = null;

    if (delta.tipo === "RESTA") {
      const reservadoMap = await reservadoPorPartida(tx, session.tenantId, [partida.id]);
      const reservado = dec(reservadoMap.get(partida.id) ?? "0");
      const nuevoDisponible = dec(partida.cantidadDisponible).minus(delta.cantidad);

      if (nuevoDisponible.lessThan(reservado) || nuevoDisponible.lessThan(0)) {
        const consumido = dec(partida.cantidadInicial).minus(dec(partida.cantidadDisponible));
        const minimoPermitido = consumido.plus(Decimal.max(reservado, 0));
        throw new DomainError(
          `No se puede reducir la cantidad inicial por debajo del stock reservado o consumido. La cantidad inicial mínima permitida es ${minimoPermitido.toString()} ${partida.unidadBaseSimbolo}.`,
          { fields: ["cantidad"] },
        );
      }

      if (partida.tipoControl && partida.tipoControl !== "NINGUNO") {
        if (!input.dtUsuarioId || !input.dtPassword) {
          throw new DomainError(
            "Se requiere la co-firma del Director Técnico para disminuir la existencia inicial de una droga controlada.",
            { fields: ["dtUsuarioId", "dtPassword"] },
          );
        }

        const coFirma = await verificarCoFirmaDtEnTx(tx, session, {
          dtUsuarioId: input.dtUsuarioId,
          password: input.dtPassword,
        });

        if (!coFirma.ok) {
          throw new DomainError(coFirma.message);
        }

        autorizadoPorId = coFirma.dtUsuarioId;
      }
    }

    let movimientoId: string;
    if (delta.tipo === "SUMA") {
      const mov = await insertCorreccionInicialSuma(tx, {
        tenantId: session.tenantId,
        partidaId: partida.id,
        cantidad: delta.cantidad.toString(),
        observacion: input.observacion ?? undefined,
        registradoPorId: session.usuario.id,
      });
      movimientoId = mov.id;
    } else {
      const mov = await insertCorreccionInicialResta(tx, {
        tenantId: session.tenantId,
        partidaId: partida.id,
        cantidad: delta.cantidad.toString(),
        observacion: input.observacion ?? undefined,
        registradoPorId: session.usuario.id,
        autorizadoPorId,
      });
      movimientoId = mov.id;
    }

    return {
      output: {
        id: partida.id,
        cantidadInicial: cantidadEnBase,
        movimientoId,
        tipo: delta.tipo,
      },
      audit: {
        entidadId: partida.id,
        valorAnterior: {
          cantidadInicial: partida.cantidadInicial,
        },
        valorNuevo: {
          cantidadInicial: cantidadEnBase,
          movimientoId,
          movimientoTipo:
            delta.tipo === "SUMA"
              ? "CORRECCION_INICIAL_SUMA"
              : "CORRECCION_INICIAL_RESTA",
          deltaCantidad: delta.cantidad.toString(),
          observacion: input.observacion ?? undefined,
        },
        ...(autorizadoPorId ? { autorizadoPorId } : {}),
      },
    };
  },
});

export async function corregirCantidadInicial(
  input: CorregirCantidadInicialInput,
  options?: ExecuteOptions,
): Promise<CorregirCantidadInicialOutput> {
  return corregirCantidadInicialCommand.execute(input, options);
}
