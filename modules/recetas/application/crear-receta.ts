/**
 * `crearReceta` (M09, FASE 6 point 6.1). ATP/FAR/DT share ONE permiso,
 * `recetas.crear` (migration 0002's seed, plan §7 "recetas.*"). Alta:
 * paciente + médico (already existing rows -- quick-create is a SEPARATE
 * use case, modules/pacientes'/modules/medicos' own `crearPaciente`/
 * `crearMedico`, reused directly by modules/recetas/ui/actions.ts) +
 * fecha de prescripción (not future) + origen (PRESENCIAL only for now,
 * DP-29/point 6.2 excluded) + one or more ítems, each with >= 1
 * componente. Everything in ONE transaction (insertRecetaConItems).
 *
 * V1-V9 (minus V5, see domain/receta.ts's doc comment) are enforced here
 * BEFORE the DB, with clear Spanish messages; the DB's CHECKs/deferred
 * constraint triggers (migration 0011) remain the real backstop.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import {
  FORMAS_FARMACEUTICAS,
  MODOS_EXPRESION,
  ORIGENES_RECETA,
  esFechaPrescripcionValida,
  validarItemsReceta,
  validarOrigenHabilitado,
} from "../domain/receta";
import type { ComponenteInput, ItemInput } from "../domain/receta";
import {
  drogasInvalidas,
  getMedicoRefParaReceta,
  getPacienteRefParaReceta,
  insertRecetaConItems,
  jornadaActualTenant,
  unidadesInvalidas,
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

const crearRecetaInput = z.object({
  pacienteId: uuid,
  medicoId: uuid,
  fechaPrescripcion: isoDate,
  origen: z.enum(ORIGENES_RECETA),
  recetaFisicaRecibida: z.boolean().default(false),
  items: z.array(itemInput).min(1, "La receta debe tener al menos un ítem."),
});

export type CrearRecetaInput = z.infer<typeof crearRecetaInput>;
/** Pre-transform wire shape (what modules/recetas/ui/actions.ts hands in after JSON.parse-ing the form's serialized items). */
export type CrearRecetaWireInput = z.input<typeof crearRecetaInput>;

function toItemsInput(items: CrearRecetaInput["items"]): ItemInput[] {
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

export const crearRecetaCommand = defineCommand({
  name: "recetas.crear",
  permiso: "recetas.crear",
  input: crearRecetaInput,
  audit: { entidad: "receta", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    validarOrigenHabilitado(input.origen);

    const paciente = await getPacienteRefParaReceta(tx, session.tenantId, input.pacienteId);
    if (!paciente) throw new NotFoundError("Paciente no encontrado.");
    if (paciente.fechaBaja !== null) throw new DomainError("El paciente está dado de baja.");

    const medico = await getMedicoRefParaReceta(tx, session.tenantId, input.medicoId);
    if (!medico) throw new NotFoundError("Médico no encontrado.");
    if (medico.fechaBaja !== null) throw new DomainError("El médico está dado de baja.");

    const jornadaActual = await jornadaActualTenant(tx, session.tenantId);
    if (!esFechaPrescripcionValida(input.fechaPrescripcion, jornadaActual)) {
      throw new ValidationError("La fecha de prescripción no puede ser futura.");
    }

    const itemsDominio = toItemsInput(input.items);
    validarItemsReceta(itemsDominio);

    const drogaIds = itemsDominio.flatMap((item) => item.componentes.map((c) => c.drogaId));
    const drogasMalas = await drogasInvalidas(tx, session.tenantId, drogaIds);
    if (drogasMalas.length > 0) {
      throw new ValidationError("Una o más drogas seleccionadas no existen o están dadas de baja.");
    }

    const unidadIds = [
      ...itemsDominio.flatMap((item) => item.componentes.map((c) => c.unidadMedidaId)),
      ...itemsDominio.flatMap((item) => (item.unidadTotalId ? [item.unidadTotalId] : [])),
    ];
    const unidadesMalas = await unidadesInvalidas(tx, unidadIds);
    if (unidadesMalas.length > 0) {
      throw new ValidationError("Una o más unidades de medida seleccionadas no existen o están dadas de baja.");
    }

    const nueva = await insertRecetaConItems(tx, {
      tenantId: session.tenantId,
      pacienteId: input.pacienteId,
      medicoId: input.medicoId,
      fechaPrescripcion: input.fechaPrescripcion,
      origen: input.origen,
      recetaFisicaRecibida: input.recetaFisicaRecibida,
      registradaPorId: session.usuario.id,
      items: input.items.map((item) => ({
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
    });

    return {
      output: { id: nueva.id, numeroInterno: nueva.numeroInterno },
      audit: {
        entidadId: nueva.id,
        valorNuevo: {
          pacienteId: input.pacienteId,
          medicoId: input.medicoId,
          fechaPrescripcion: input.fechaPrescripcion,
          origen: input.origen,
          recetaFisicaRecibida: input.recetaFisicaRecibida,
          numeroInterno: nueva.numeroInterno,
          items: input.items,
        },
      },
    };
  },
});

export async function crearReceta(input: CrearRecetaWireInput): Promise<{ id: string; numeroInterno: string }> {
  return crearRecetaCommand.execute(input);
}
