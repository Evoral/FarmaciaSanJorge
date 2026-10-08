/**
 * `crearReceta` (M09, FASE 6 point 6.1). ATP/FAR/DT share ONE permiso,
 * `recetas.crear` (migration 0002's seed, plan §7 "recetas.*"). Alta:
 * paciente + médico (already existing rows -- quick-create is a SEPARATE
 * use case, modules/pacientes'/modules/medicos' own `crearPaciente`/
 * `crearMedico`, reused directly by modules/recetas/ui/actions.ts) +
 * fecha de prescripción (not future) + origen (PRESENCIAL: a digital
 * receta only enters through the PDF import, see domain/receta.ts's
 * `validarOrigenCargaManual`) + optional diagnóstico (CIE-10) + optional domicilio del paciente (migration 0070) + optional "pagada" (migration 0071) + one or more
 * ítems, each with >= 1 componente (optional posología/duración). Everything in ONE transaction (insertRecetaConItems).
 *
 * V1-V9 (minus V5, see domain/receta.ts's doc comment) are enforced here
 * BEFORE the DB, with clear Spanish messages; the DB's CHECKs/deferred
 * constraint triggers (migration 0011) remain the real backstop. Whether a
 * componente is a principio activo is not an input: it is the droga's
 * clase = DROGA (migration 0063), read with the drogas' validity check.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import {
  FORMAS_FARMACEUTICAS,
  MODOS_EXPRESION,
  ORIGENES_RECETA,
  diagnosticoCodigoOpcional,
  domicilioPacienteOpcional,
  duracionTratamientoDiasOpcional,
  esFechaPrescripcionValida,
  esFechaPrescripcionVigente,
  resumirItemsReceta,
  validarItemsReceta,
  validarOrigenCargaManual,
} from "../domain/receta";
import type { ComponenteInput, ItemInput } from "../domain/receta";
import {
  clasificarDrogasDeReceta,
  getMedicoRefParaReceta,
  getNombresParaResumen,
  getPacienteRefParaReceta,
  insertRecetaConItems,
  jornadaActualTenant,
  unidadesInvalidas,
} from "../infrastructure/receta-repository";
import { validarSinonimosDeComponentes } from "./sinonimos-componentes";

/** Shared with importar-receta.ts. */
export const textoOpcional = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v && v.length > 0 ? v : null));

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
  /** The synonym of the droga it was picked by (migration 0069), validated by `validarSinonimosDeComponentes`. */
  drogaAliasId: uuid.nullable().optional(),
});

/** One ítem of the receta (with its componentes) -- shared with importar-receta.ts. */
export const itemInput = z.object({
  descripcion: textoOpcional,
  formaFarmaceutica: z.enum(FORMAS_FARMACEUTICAS),
  cantidadUnidades: z.number().int(),
  fraccionDosisPorUnidad: z.string().trim().min(1).default("1"),
  cantidadTotal: decimalOpcional,
  unidadTotalId: uuid.optional().nullable(),
  observaciones: textoOpcional,
  posologia: textoOpcional,
  duracionTratamientoDias: duracionTratamientoDiasOpcional,
  componentes: z.array(componenteInput).min(1, "Cada ítem debe tener al menos un componente."),
});

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe ser una fecha en formato AAAA-MM-DD.");

/** Shared with editar-receta.ts, which derives its own input from it (one header + ítem shape for both screens). */
export const crearRecetaInput = z.object({
  pacienteId: uuid,
  medicoId: uuid,
  fechaPrescripcion: isoDate,
  fechaValidaDesde: isoDate.optional().nullable().transform((v) => v ?? null),
  origen: z.enum(ORIGENES_RECETA),
  diagnosticoCodigo: diagnosticoCodigoOpcional,
  diagnosticoDescripcion: textoOpcional,
  domicilioPaciente: domicilioPacienteOpcional,
  /** Migration 0071: the receta is created already paid. The server sets who and when (`pagadaEn`/`pagadaPorId`), never the client. */
  pagada: z.boolean().default(false),
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
    posologia: item.posologia,
    duracionTratamientoDias: item.duracionTratamientoDias,
    componentes: item.componentes.map(
      (c): ComponenteInput => ({
        drogaId: c.drogaId,
        cantidad: c.cantidad,
        unidadMedidaId: c.unidadMedidaId,
        modoExpresion: c.modoExpresion,
        drogaAliasId: c.drogaAliasId ?? null,
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
    validarOrigenCargaManual(input.origen, null);

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
    if (input.fechaValidaDesde !== null && input.fechaValidaDesde < input.fechaPrescripcion) {
      throw new ValidationError("La fecha de validez no puede ser anterior a la fecha de prescripción.");
    }
    if (!esFechaPrescripcionVigente(input.fechaValidaDesde ?? input.fechaPrescripcion, jornadaActual)) {
      throw new ValidationError(input.fechaValidaDesde ? "La receta está vencida: pasó más de un mes desde su fecha de validez." : "La receta está vencida: tiene más de un mes desde su prescripción.");
    }

    const itemsDominio = toItemsInput(input.items);
    validarItemsReceta(itemsDominio);

    const drogaIds = itemsDominio.flatMap((item) => item.componentes.map((c) => c.drogaId));
    const drogas = await clasificarDrogasDeReceta(tx, session.tenantId, drogaIds);
    if (drogas.invalidas.length > 0) {
      throw new ValidationError("Una o más drogas seleccionadas no existen o están dadas de baja.");
    }
    const sinonimos = await validarSinonimosDeComponentes(tx, session.tenantId, itemsDominio.flatMap((item) => item.componentes));

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
      fechaValidaDesde: input.fechaValidaDesde,
      origen: input.origen,
      registradaPorId: session.usuario.id,
      diagnosticoCodigo: input.diagnosticoCodigo,
      diagnosticoDescripcion: input.diagnosticoDescripcion,
      domicilioPaciente: input.domicilioPaciente,
      pagada: input.pagada,
      items: input.items.map((item) => ({
        descripcion: item.descripcion,
        formaFarmaceutica: item.formaFarmaceutica,
        cantidadUnidades: item.cantidadUnidades,
        fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
        cantidadTotal: item.cantidadTotal,
        unidadTotalId: item.unidadTotalId ?? null,
        observaciones: item.observaciones,
        posologia: item.posologia,
        duracionTratamientoDias: item.duracionTratamientoDias,
        componentes: item.componentes.map((c) => ({
          drogaId: c.drogaId,
          cantidad: c.cantidad,
          unidadMedidaId: c.unidadMedidaId,
          modoExpresion: c.modoExpresion,
          esPrincipioActivo: drogas.principiosActivos.has(c.drogaId),
          drogaAliasId: c.drogaAliasId ?? null,
        })),
      })),
    });

    const nombres = { ...(await getNombresParaResumen(tx, session.tenantId, drogaIds, unidadIds)), sinonimos };

    return {
      output: { id: nueva.id, numeroInterno: nueva.numeroInterno },
      audit: {
        entidadId: nueva.id,
        valorNuevo: {
          pacienteId: input.pacienteId,
          paciente: `${paciente.apellido}, ${paciente.nombre}`,
          medicoId: input.medicoId,
          medico: `${medico.apellido}, ${medico.nombre} — matrícula ${medico.matricula}`,
          fechaPrescripcion: input.fechaPrescripcion,
          origen: input.origen,
          diagnosticoCodigo: input.diagnosticoCodigo,
          diagnosticoDescripcion: input.diagnosticoDescripcion,
          domicilioPaciente: input.domicilioPaciente,
          pagada: input.pagada,
          numeroInterno: nueva.numeroInterno,
          items: input.items,
          itemsResumen: resumirItemsReceta(itemsDominio, nombres),
        },
      },
    };
  },
});

export async function crearReceta(input: CrearRecetaWireInput): Promise<{ id: string; numeroInterno: string }> {
  return crearRecetaCommand.execute(input);
}
