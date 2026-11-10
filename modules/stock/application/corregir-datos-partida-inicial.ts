/**
 * `corregirDatosPartidaInicial` (openspec/changes/planilla-existencia-inicial R18).
 * Allows correcting lote, fecha de vencimiento and proveedor of an UNUSED partida de existencia inicial
 * while the relevamiento is open.
 * Permiso: stock.partida.ingresar.
 */
import { z } from "zod";
import { defineCommand, TipoAccion, type ExecuteOptions } from "@/shared/usecase";
import { fechaIso, nonEmptyString, uuid } from "@/shared/validation";
import { AppError, DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { MENSAJE_RELEVAMIENTO_CERRADO } from "../domain/existencia-inicial";
import {
  lockTenantRelevamientoCompartido,
  relevamientoInicialAbierto,
} from "../infrastructure/existencia-inicial-repository";
import {
  getPartidaParaAccion,
  lockPartidaParaAccion,
} from "../infrastructure/partida-repository";

export const corregirDatosPartidaInicialInput = z.object({
  partidaId: uuid,
  lote: nonEmptyString,
  fechaVencimiento: fechaIso.optional().nullable(),
  proveedorId: uuid.optional().nullable(),
});

export type CorregirDatosPartidaInicialInput = z.infer<typeof corregirDatosPartidaInicialInput>;

export interface CorregirDatosPartidaInicialOutput {
  id: string;
  lote: string;
  fechaVencimiento: string | null;
  proveedorId: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as {
    code?: unknown;
    message?: unknown;
    meta?: { driverAdapterError?: { cause?: { code?: unknown } } };
  };
  if (e.code === "23505" || e.code === "P2002") return true;
  if (e.meta?.driverAdapterError?.cause?.code === "23505") return true;
  if (
    typeof e.message === "string" &&
    (e.message.includes("23505") ||
      e.message.includes("unique constraint") ||
      e.message.includes("partida_lote_unico") ||
      e.message.includes("uq_partida_lote_sin_proveedor"))
  ) {
    return true;
  }
  return false;
}

export const corregirDatosPartidaInicialCommand = defineCommand<
  CorregirDatosPartidaInicialInput,
  CorregirDatosPartidaInicialOutput
>({
  name: "stock.partida.corregirDatosInicial",
  permiso: "stock.partida.ingresar",
  input: corregirDatosPartidaInicialInput,
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
      throw new DomainError("Solo se pueden corregir datos de partidas de existencia inicial.");
    }

    const loteTrimmed = input.lote.trim();
    if (!loteTrimmed) {
      throw new DomainError("El lote no puede estar vacío.", { fields: ["lote"] });
    }

    const fechaVencimientoNormalizada = input.fechaVencimiento?.trim() || null;

    if (!fechaVencimientoNormalizada && partida.drogaClase === "DROGA") {
      throw new ValidationError(
        `Falta la fecha de vencimiento de ${partida.drogaNombre}: solo los excipientes y materiales pueden no vencer.`,
        { fields: ["fechaVencimiento"] },
      );
    }

    try {
      const rows = await tx.$queryRaw<
        {
          lote_anterior: string;
          fecha_vencimiento_anterior: string | null;
          proveedor_id_anterior: string | null;
        }[]
      >`
        SELECT
          lote_anterior,
          fecha_vencimiento_anterior::text,
          proveedor_id_anterior::text
        FROM fsj.partida_corregir_datos_inicial(
          ${session.tenantId}::uuid,
          ${input.partidaId}::uuid,
          ${loteTrimmed},
          ${fechaVencimientoNormalizada}::date,
          ${input.proveedorId ?? null}::uuid
        )
      `;

      const result = rows[0];
      if (!result) {
        throw new DomainError("No se pudieron corregir los datos de la partida.");
      }

      return {
        output: {
          id: input.partidaId,
          lote: loteTrimmed,
          fechaVencimiento: fechaVencimientoNormalizada,
          proveedorId: input.proveedorId ?? null,
        },
        audit: {
          entidadId: input.partidaId,
          valorAnterior: {
            lote: result.lote_anterior,
            // ISO, like valorNuevo: the close compares both and formats them for display.
            fechaVencimiento: result.fecha_vencimiento_anterior ?? null,
            proveedorId: result.proveedor_id_anterior,
          },
          valorNuevo: {
            lote: loteTrimmed,
            fechaVencimiento: fechaVencimientoNormalizada,
            proveedorId: input.proveedorId ?? null,
            correccion: "DATOS_INICIAL",
          },
        },
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(`Ya existe una partida con el lote "${loteTrimmed}".`, {
          fields: ["lote"],
        });
      }
      if (error instanceof AppError) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes("has already been opened") ||
        msg.includes("has non-initial stock movements") ||
        msg.includes("has active reservations") ||
        msg.includes("has reanalisis records")
      ) {
        throw new DomainError("La partida ya se usó: solo se pueden corregir la cantidad y el costo.");
      }
      if ((msg.includes("relevamiento inicial") && msg.includes("is closed")) || msg.includes("INV-S24")) {
        throw new DomainError(MENSAJE_RELEVAMIENTO_CERRADO);
      }
      if (msg.includes("expected EXISTENCIA_INICIAL") || msg.includes("has origen")) {
        throw new DomainError("Solo se pueden corregir datos de partidas de existencia inicial.");
      }
      throw error;
    }
  },
});

export async function corregirDatosPartidaInicial(
  input: CorregirDatosPartidaInicialInput,
  options?: ExecuteOptions,
): Promise<CorregirDatosPartidaInicialOutput> {
  return corregirDatosPartidaInicialCommand.execute(input, options);
}
