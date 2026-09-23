/**
 * `editarReceta` (M09, FASE 6 point 6.3). Same permiso as alta,
 * `recetas.crear`... no -- migration 0002's seed grants `recetas.editar`
 * (ATP/FAR/DT, identical role set to `recetas.crear`) for this action.
 * Only while `esEstadoEditable(estado)` (PENDIENTE_PREPARACION) AND no
 * ficha_tecnica generated from any of the receta's items has a
 * preparación yet (domain/receta.ts + infrastructure's
 * `existeFichaConPreparacionParaReceta` -- mirrors migration 0030's
 * INV-R11 DB backstop).
 *
 * Lock BEFORE any decision read (M3 discipline, same as every other
 * module): `lockRecetaParaAccion` first, then a FRESH read. Header fields
 * (paciente/médico/fecha/origen) use optimistic concurrency (compare-and-swap,
 * same shape as modules/pacientes/application/editar-paciente.ts).
 * Items/componentes use a SEPARATE conflict check: the client submits the
 * ids of the items it started editing from (`itemsVersion`) -- if the
 * receta's CURRENT item set (post-lock) differs, someone else added/removed
 * an item concurrently -> ConflictError, instead of silently clobbering
 * their change.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { FORMAS_FARMACEUTICAS, MODOS_EXPRESION, ORIGENES_RECETA, esEstadoEditable, validarItemsReceta, validarOrigenHabilitado } from "../domain/receta";
import type { ComponenteInput, ItemInput } from "../domain/receta";
import {
  drogasInvalidas,
  existeFichaConPreparacionParaReceta,
  getMedicoRefParaReceta,
  getPacienteRefParaReceta,
  getRecetaParaAccion,
  listItemIds,
  lockRecetaParaAccion,
  reemplazarItemsReceta,
  unidadesInvalidas,
  updateRecetaHeader,
} from "../infrastructure/receta-repository";

const decimalOpcional = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v && v.length > 0 ? v : null));

const componenteInput = z.object({
  drogaId: uuid,
  cantidad: decimalOpcional,
  unidadMedidaId: uuid,
  modoExpresion: z.enum(MODOS_EXPRESION),
  esPrincipioActivo: z.boolean().default(false),
});

const itemInput = z.object({
  id: uuid.optional(),
  descripcion: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  formaFarmaceutica: z.enum(FORMAS_FARMACEUTICAS),
  cantidadUnidades: z.number().int(),
  fraccionDosisPorUnidad: z.string().trim().min(1).default("1"),
  cantidadTotal: decimalOpcional,
  unidadTotalId: uuid.optional().nullable(),
  observaciones: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  componentes: z.array(componenteInput).min(1, "Cada ítem debe tener al menos un componente."),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.");

const editarRecetaInput = z.object({
  id: uuid,
  pacienteId: uuid,
  medicoId: uuid,
  fechaPrescripcion: isoDate,
  origen: z.enum(ORIGENES_RECETA),
  items: z.array(itemInput).min(1, "La receta debe tener al menos un ítem."),
  version: z.object({
    pacienteId: uuid,
    medicoId: uuid,
    fechaPrescripcion: isoDate,
    origen: z.enum(ORIGENES_RECETA),
  }),
  /** ids of the items the client started editing from (existing items only) -- see module doc comment. */
  itemsVersion: z.array(uuid),
});

export type EditarRecetaInput = z.infer<typeof editarRecetaInput>;
export type EditarRecetaWireInput = z.input<typeof editarRecetaInput>;

export const CONCURRENCY_MESSAGE = "La receta fue modificada por otra persona, recargá.";

function toItemsInput(items: EditarRecetaInput["items"]): ItemInput[] {
  return items.map((item) => ({
    descripcion: item.descripcion,
    formaFarmaceutica: item.formaFarmaceutica,
    cantidadUnidades: item.cantidadUnidades,
    fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
    cantidadTotal: item.cantidadTotal,
    unidadTotalId: item.unidadTotalId ?? null,
    observaciones: item.observaciones,
    componentes: item.componentes.map(
      (c): ComponenteInput => ({
        drogaId: c.drogaId,
        cantidad: c.cantidad,
        unidadMedidaId: c.unidadMedidaId,
        modoExpresion: c.modoExpresion,
        esPrincipioActivo: c.esPrincipioActivo,
      }),
    ),
  }));
}

function mismoConjunto(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

export const editarRecetaCommand = defineCommand({
  name: "recetas.editar",
  permiso: "recetas.editar",
  input: editarRecetaInput,
  audit: { entidad: "receta", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const locked = await lockRecetaParaAccion(tx, session.tenantId, input.id);
    if (!locked) throw new NotFoundError("Receta no encontrada.");

    const actual = await getRecetaParaAccion(tx, session.tenantId, input.id);
    if (!actual) throw new NotFoundError("Receta no encontrada.");

    if (!esEstadoEditable(actual.estado)) {
      throw new DomainError(`La receta no se puede editar en su estado actual (${actual.estado}). Solo es editable mientras está pendiente de preparación.`);
    }
    if (await existeFichaConPreparacionParaReceta(tx, session.tenantId, input.id)) {
      throw new DomainError("La receta no se puede editar: ya tiene una ficha técnica con una preparación.");
    }

    const actualFechaISO = actual.fechaPrescripcion.toISOString().slice(0, 10);
    const versionMatches =
      actual.pacienteId === input.version.pacienteId &&
      actual.medicoId === input.version.medicoId &&
      actualFechaISO === input.version.fechaPrescripcion &&
      actual.origen === input.version.origen;
    if (!versionMatches) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    const idsActuales = await listItemIds(tx, session.tenantId, input.id);
    if (!mismoConjunto(idsActuales, input.itemsVersion)) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    validarOrigenHabilitado(input.origen);

    const paciente = await getPacienteRefParaReceta(tx, session.tenantId, input.pacienteId);
    if (!paciente) throw new NotFoundError("Paciente no encontrado.");
    if (paciente.fechaBaja !== null) throw new DomainError("El paciente está dado de baja.");

    const medico = await getMedicoRefParaReceta(tx, session.tenantId, input.medicoId);
    if (!medico) throw new NotFoundError("Médico no encontrado.");
    if (medico.fechaBaja !== null) throw new DomainError("El médico está dado de baja.");

    const itemsDominio = toItemsInput(input.items);
    validarItemsReceta(itemsDominio);

    const drogaIds = itemsDominio.flatMap((item) => item.componentes.map((c) => c.drogaId));
    if ((await drogasInvalidas(tx, session.tenantId, drogaIds)).length > 0) {
      throw new ValidationError("Una o más drogas seleccionadas no existen o están dadas de baja.");
    }
    const unidadIds = [
      ...itemsDominio.flatMap((item) => item.componentes.map((c) => c.unidadMedidaId)),
      ...itemsDominio.flatMap((item) => (item.unidadTotalId ? [item.unidadTotalId] : [])),
    ];
    if ((await unidadesInvalidas(tx, unidadIds)).length > 0) {
      throw new ValidationError("Una o más unidades de medida seleccionadas no existen o están dadas de baja.");
    }

    const headerUpdated = await updateRecetaHeader(
      tx,
      session.tenantId,
      { id: input.id, pacienteId: input.pacienteId, medicoId: input.medicoId, fechaPrescripcion: input.fechaPrescripcion, origen: input.origen },
      input.version,
    );
    if (!headerUpdated) throw new ConflictError(CONCURRENCY_MESSAGE);

    await reemplazarItemsReceta(
      tx,
      session.tenantId,
      input.id,
      input.items.map((item) => ({
        id: item.id,
        descripcion: item.descripcion,
        formaFarmaceutica: item.formaFarmaceutica,
        cantidadUnidades: item.cantidadUnidades,
        fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
        cantidadTotal: item.cantidadTotal,
        unidadTotalId: item.unidadTotalId ?? null,
        observaciones: item.observaciones,
        componentes: item.componentes.map((c) => ({
          drogaId: c.drogaId,
          cantidad: c.cantidad,
          unidadMedidaId: c.unidadMedidaId,
          modoExpresion: c.modoExpresion,
          esPrincipioActivo: c.esPrincipioActivo,
        })),
      })),
    );

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: { pacienteId: actual.pacienteId, medicoId: actual.medicoId, fechaPrescripcion: actualFechaISO, origen: actual.origen },
        valorNuevo: { pacienteId: input.pacienteId, medicoId: input.medicoId, fechaPrescripcion: input.fechaPrescripcion, origen: input.origen, items: input.items },
      },
    };
  },
});

export async function editarReceta(input: EditarRecetaWireInput): Promise<{ id: string }> {
  return editarRecetaCommand.execute(input);
}
