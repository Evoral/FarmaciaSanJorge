/**
 * `crearDroga` (M06, FASE 4 point 4.2, INV-F03/droga_es_controlada_check).
 * FAR/DT/ADM (plan §7). `unidadBaseId` must reference an existing,
 * non-baja unidad de medida -- the DB's FK only requires "exists" (any
 * unidad, even one already given de baja); this command additionally
 * rejects a baja unidad with a clear Spanish message rather than letting
 * the picker's own filtering (UI-only) be the sole defense. `clase`
 * (migration 0063) defaults to DROGA; an insumo cannot be controlled.
 * The name must be free after normalization: no vigente droga and no vigente
 * synonym may already hold it (docs/specs/sinonimos-droga.md; the DB
 * re-checks: migration 0067).
 *
 * `sinonimos` lets the alta register the droga's other names in the same
 * transaction. Positional: entry `i` is the form field `sinonimo-i`, so a
 * rejected one is marked on its own input; blank entries are skipped. Each is
 * checked like `agregarSinonimo` (not the new name, not repeated, not held by
 * any vigente droga or synonym) BEFORE the droga is inserted, and audited as
 * its own `droga_alias` row.
 *
 * With the contralor digital activo, a controlled droga's alta also writes its
 * APERTURA asiento with `saldoAperturaContralor` -- the manual libro's saldo, 0
 * if the pharmacy never had it (docs/specs/existencia-inicial.md R12). Without
 * it every later movement of the droga would be refused (INV-L15).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { nonEmptyString, uuid } from "@/shared/validation";
import { CLASES_DROGA, MENSAJE_INSUMO_CONTROLADO, TIPOS_CONTROL, claseValida, tipoControlValido, nonNegativeDecimalString } from "../domain/droga";
import { normalizarTexto } from "../domain/normalizar";
import { SINONIMO_MAX_LARGO, limpiarSinonimo, mensajeConflictoNombre } from "../domain/sinonimo";
import { existeNombreVigente, insertDroga } from "../infrastructure/droga-repository";
import { insertSinonimo } from "../infrastructure/sinonimo-repository";
import { registrarAperturaContralorEnTx, requiereAperturaContralorEnTx } from "@/modules/libro/application/registrar-apertura-contralor";

const crearDrogaInput = z.object({
  nombre: nonEmptyString,
  unidadBaseId: uuid,
  esControlada: z.boolean().optional(),
  tipoControl: z.enum(TIPOS_CONTROL).default("NINGUNO"),
  clase: z.enum(CLASES_DROGA).default("DROGA"),
  stockMinimo: nonNegativeDecimalString,
  sinonimos: z.array(z.string().max(SINONIMO_MAX_LARGO, `Como máximo ${SINONIMO_MAX_LARGO} caracteres.`)).max(20).default([]),
  /** Required only for a controlled droga with the contralor activo (R12); ignored otherwise. */
  saldoAperturaContralor: nonNegativeDecimalString.optional(),
});

/** PRE-parse shape -- see modules/unidades/application/crear-unidad.ts's `CrearUnidadInput` doc comment for why this is hand-written (stockMinimo is a raw string here, a `Decimal` only after the zod schema's own transform). */
export interface CrearDrogaInput {
  nombre: string;
  unidadBaseId: string;
  esControlada?: boolean;
  tipoControl?: string;
  clase?: string;
  stockMinimo: string;
  /** Other names of the droga, positional (entry `i` = form field `sinonimo-i`); blanks are skipped. */
  sinonimos?: string[];
  /** The manual libro contralor's saldo (unidad base): asked only for a controlled droga with the contralor activo. */
  saldoAperturaContralor?: string;
}

export const crearDrogaCommand = defineCommand({
  name: "drogas.crear",
  permiso: "drogas.crear",
  input: crearDrogaInput,
  audit: { entidad: "droga", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    // When omitted, derived from tipoControl (same rule as the DB CHECK).
    const esControlada = input.esControlada ?? input.tipoControl !== "NINGUNO";
    if (!tipoControlValido(esControlada, input.tipoControl)) {
      throw new ValidationError('El tipo de control debe ser "Ninguno" si y solo si la droga no es controlada.');
    }
    if (!claseValida(input.clase, input.tipoControl)) throw new ValidationError(MENSAJE_INSUMO_CONTROLADO, { fields: ["clase", "tipoControl"] });

    const unidad = await tx.unidadMedida.findUnique({ where: { id: input.unidadBaseId }, select: { id: true, nombre: true, simbolo: true, fechaBaja: true } });
    if (!unidad) throw new NotFoundError("Unidad de medida no encontrada.");
    if (unidad.fechaBaja !== null) throw new DomainError("La unidad de medida elegida está dada de baja.");

    // Accent/case-insensitive, against vigente drogas AND synonyms (docs/specs/sinonimos-droga.md): another
    // name for an existing substance is a synonym of that droga, never a second droga.
    const conflicto = await existeNombreVigente(tx, session.tenantId, input.nombre);
    if (conflicto) throw new ValidationError(mensajeConflictoNombre(conflicto), { fields: ["nombre"] });

    const requiereApertura = await requiereAperturaContralorEnTx(tx, session.tenantId, null, input.tipoControl);
    if (requiereApertura && input.saldoAperturaContralor === undefined) {
      throw new ValidationError(
        "El contralor está activo: cargá el saldo de apertura de la droga (el del libro manual, 0 si la farmacia nunca la tuvo).",
        { fields: ["saldoAperturaContralor"] },
      );
    }

    const nombreNormalizado = normalizarTexto(input.nombre);
    const sinonimos: { texto: string; aliasNormalizado: string }[] = [];
    for (const [i, crudo] of input.sinonimos.entries()) {
      const texto = limpiarSinonimo(crudo);
      const aliasNormalizado = normalizarTexto(texto);
      if (aliasNormalizado.length === 0) continue;
      const campo = [`sinonimo-${i}`];
      if (aliasNormalizado === nombreNormalizado) throw new ValidationError(`«${texto}» es el mismo nombre principal de la droga.`, { fields: campo });
      if (sinonimos.some((s) => s.aliasNormalizado === aliasNormalizado)) throw new ValidationError(`«${texto}» está repetido.`, { fields: campo });
      const ocupado = await existeNombreVigente(tx, session.tenantId, texto);
      if (ocupado) throw new ValidationError(mensajeConflictoNombre(ocupado), { fields: campo });
      sinonimos.push({ texto, aliasNormalizado });
    }

    const nueva = await insertDroga(tx, {
      tenantId: session.tenantId,
      nombre: input.nombre,
      unidadBaseId: input.unidadBaseId,
      esControlada,
      tipoControl: input.tipoControl,
      clase: input.clase,
      stockMinimo: input.stockMinimo.toString(),
    });

    if (requiereApertura && input.saldoAperturaContralor !== undefined && input.tipoControl !== "NINGUNO") {
      await registrarAperturaContralorEnTx(tx, session, {
        drogaId: nueva.id,
        drogaNombre: input.nombre,
        tipoControl: input.tipoControl,
        saldo: input.saldoAperturaContralor.toString(),
        unidadMedidaId: input.unidadBaseId,
      });
    }

    for (const sinonimo of sinonimos) {
      const alias = await insertSinonimo(tx, { tenantId: session.tenantId, drogaId: nueva.id, ...sinonimo, creadoPorId: session.usuario.id });
      await auditRecord(tx, {
        tenantId: session.tenantId,
        usuarioId: session.usuario.id,
        entidad: "droga_alias",
        entidadId: alias.id,
        accion: TipoAccion.CREAR,
        valorNuevo: { sinonimo: sinonimo.texto, aliasNormalizado: sinonimo.aliasNormalizado, drogaId: nueva.id, droga: input.nombre },
      });
    }

    return {
      output: { id: nueva.id, nombre: input.nombre, unidadBaseId: input.unidadBaseId, sinonimos: sinonimos.map((s) => s.texto) },
      audit: {
        entidadId: nueva.id,
        valorNuevo: {
          nombre: input.nombre,
          unidadBaseId: input.unidadBaseId,
          unidadBase: `${unidad.nombre} (${unidad.simbolo})`,
          esControlada,
          tipoControl: input.tipoControl,
          clase: input.clase,
          stockMinimo: input.stockMinimo.toString(),
          ...(sinonimos.length > 0 ? { sinonimos: sinonimos.map((s) => s.texto) } : {}),
          ...(requiereApertura && input.saldoAperturaContralor !== undefined ? { saldoAperturaContralor: input.saldoAperturaContralor.toString() } : {}),
        },
      },
    };
  },
});

/** `nombre` as stored (trimmed); `sinonimos` = the other names registered with it, as stored (for the success message). */
export async function crearDroga(input: CrearDrogaInput): Promise<{ id: string; nombre: string; unidadBaseId: string; sinonimos: string[] }> {
  return crearDrogaCommand.execute(input);
}
