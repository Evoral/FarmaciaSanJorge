/**
 * `editarReceta` (M09, FASE 6 point 6.3). Same permiso as alta,
 * `recetas.crear`... no -- migration 0002's seed grants `recetas.editar`
 * (ATP/FAR/DT, identical role set to `recetas.crear`) for this action.
 * Only while `esEstadoEditable(estado)` (PENDIENTE_PREPARACION) AND no
 * ficha_tecnica generated from any of the receta's items has a LIVE
 * (INICIADA/CONFIRMADA) preparación (domain/receta.ts + infrastructure's
 * `existeFichaConPreparacionParaReceta` -- mirrors INV-R11, migrations
 * 0030/0072). A DESCARTADA preparación (e.g. a released reserva de stock,
 * docs/specs/reserva-stock-preparacion.md) does not block it: the receta is
 * still PENDIENTE_PREPARACION (it only moves at the first confirmation) and
 * the discarded preparación keeps pointing at its old ficha version.
 *
 * Lock BEFORE any decision read (M3 discipline, same as every other
 * module): `lockRecetaParaAccion` first, then a FRESH read. Header fields
 * (paciente/médico/fecha/origen/diagnóstico/domicilio del paciente) use optimistic concurrency (compare-and-swap,
 * same shape as modules/pacientes/application/editar-paciente.ts).
 * Items/componentes use a SEPARATE conflict check: the client submits the
 * ids of the items it started editing from (`itemsVersion`) -- if the
 * receta's CURRENT item set (post-lock) differs, someone else added/removed
 * an item concurrently -> ConflictError, instead of silently clobbering
 * their change.
 *
 * Removing an item that already has a ficha técnica (or a cotización) is
 * refused with a ValidationError (docs/specs/presupuesto-receta.md, "Edición"):
 * fichas/cotizaciones are insert-only and reference the item, and since
 * confirming a receta generates them automatically, almost every item has
 * one. Editing an existing item's content is unaffected (a new ficha
 * version is generated afterwards).
 *
 * As in the alta, `es_principio_activo` is not an input: every componente
 * written gets the droga's current clase = DROGA (migration 0063).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import {
  ORIGENES_RECETA,
  esEstadoEditable,
  resumirItemsReceta,
  validarItemsReceta,
  validarOrigenCargaManual,
} from "../domain/receta";
import type { ComponenteInput, ItemInput } from "../domain/receta";
import {
  clasificarDrogasDeReceta,
  existeFichaConPreparacionParaReceta,
  getMedicoRefParaReceta,
  itemsConFichaOCotizacion,
  getNombresParaResumen,
  getPacienteRefParaReceta,
  getRecetaParaAccion,
  listItemIds,
  listSinonimosGuardadosDeReceta,
  lockRecetaParaAccion,
  reemplazarItemsReceta,
  unidadesInvalidas,
  updateRecetaHeader,
} from "../infrastructure/receta-repository";
import { crearRecetaInput, isoDate, itemInput as itemInputAlta } from "./crear-receta";
import { validarSinonimosDeComponentes } from "./sinonimos-componentes";

/** The same ítem as the alta (crear-receta.ts), plus the id of an existing one: one schema, so both screens accept the same draft. */
const itemInput = itemInputAlta.extend({ id: uuid.optional() });

/**
 * The alta's input (header + ítems), so a field added there reaches the edit too. `fechaValidaDesde` is
 * alta-only (an edit never changes the receta's validity) -- omitted explicitly, so a new alta-only field
 * is a decision here, not a silent drift. `version` stays hand-written on purpose: it carries the RAW stored
 * values for the compare-and-swap, without the alta's transforms. `pagada` is alta-only too: the payment
 * is changed from the receta's detail (`marcarPagoReceta`), never as a side effect of an edit.
 */
const editarRecetaInput = crearRecetaInput.omit({ fechaValidaDesde: true, pagada: true }).extend({
  id: uuid,
  items: z.array(itemInput).min(1, "La receta debe tener al menos un ítem."),
  version: z.object({
    pacienteId: uuid,
    medicoId: uuid,
    fechaPrescripcion: isoDate,
    origen: z.enum(ORIGENES_RECETA),
    diagnosticoCodigo: z.string().nullable().default(null),
    diagnosticoDescripcion: z.string().nullable().default(null),
    domicilioPaciente: z.string().nullable().default(null),
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
      throw new DomainError("La receta no se puede editar: tiene una preparación en curso o confirmada (si es una reserva de stock, liberala primero).");
    }

    const actualFechaISO = actual.fechaPrescripcion.toISOString().slice(0, 10);
    const versionMatches =
      actual.pacienteId === input.version.pacienteId &&
      actual.medicoId === input.version.medicoId &&
      actualFechaISO === input.version.fechaPrescripcion &&
      actual.origen === input.version.origen &&
      actual.diagnosticoCodigo === input.version.diagnosticoCodigo &&
      actual.diagnosticoDescripcion === input.version.diagnosticoDescripcion &&
      actual.domicilioPaciente === input.version.domicilioPaciente;
    if (!versionMatches) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    const idsActuales = await listItemIds(tx, session.tenantId, input.id);
    if (!mismoConjunto(idsActuales, input.itemsVersion)) {
      throw new ConflictError(CONCURRENCY_MESSAGE);
    }

    // "Ítem N" = position in the receta as its detail page lists it (same unordered-by-column read as getRecetaConItems).
    const idsEnviados = new Set(input.items.flatMap((item) => (item.id ? [item.id] : [])));
    const aQuitar = idsActuales.filter((id) => !idsEnviados.has(id));
    if (aQuitar.length > 0) {
      const conFicha = await itemsConFichaOCotizacion(tx, session.tenantId, aQuitar);
      const primero = idsActuales.findIndex((id) => conFicha.has(id));
      if (primero >= 0) {
        throw new ValidationError(
          `No se puede quitar el ítem ${primero + 1} porque ya tiene ficha técnica. Si la receta se cargó mal, anulala y cargala de nuevo.`,
        );
      }
    }

    validarOrigenCargaManual(input.origen, actual.origen);

    const paciente = await getPacienteRefParaReceta(tx, session.tenantId, input.pacienteId);
    if (!paciente) throw new NotFoundError("Paciente no encontrado.");
    if (paciente.fechaBaja !== null) throw new DomainError("El paciente está dado de baja.");

    const medico = await getMedicoRefParaReceta(tx, session.tenantId, input.medicoId);
    if (!medico) throw new NotFoundError("Médico no encontrado.");
    if (medico.fechaBaja !== null) throw new DomainError("El médico está dado de baja.");

    const itemsDominio = toItemsInput(input.items);
    validarItemsReceta(itemsDominio);

    const drogaIds = itemsDominio.flatMap((item) => item.componentes.map((c) => c.drogaId));
    const drogas = await clasificarDrogasDeReceta(tx, session.tenantId, drogaIds);
    if (drogas.invalidas.length > 0) {
      throw new ValidationError("Una o más drogas seleccionadas no existen o están dadas de baja.");
    }
    if (drogas.materiales.length > 0) {
      throw new ValidationError(`Los materiales no se cargan como componentes de la receta: ${drogas.materiales.join(", ")}.`);
    }
    // A synonym removed since the receta was loaded may stay on the componentes that already had it (read before the replace).
    const sinonimos = await validarSinonimosDeComponentes(tx, session.tenantId, itemsDominio.flatMap((item) => item.componentes), () =>
      listSinonimosGuardadosDeReceta(tx, session.tenantId, input.id),
    );
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
      {
        id: input.id,
        pacienteId: input.pacienteId,
        medicoId: input.medicoId,
        fechaPrescripcion: input.fechaPrescripcion,
        origen: input.origen,
        diagnosticoCodigo: input.diagnosticoCodigo,
        diagnosticoDescripcion: input.diagnosticoDescripcion,
        domicilioPaciente: input.domicilioPaciente,
      },
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
    );

    // Readable names for the audit row, taken NOW: later renames must not rewrite history.
    const pacienteAnterior = actual.pacienteId === paciente.id ? paciente : await getPacienteRefParaReceta(tx, session.tenantId, actual.pacienteId);
    const medicoAnterior = actual.medicoId === medico.id ? medico : await getMedicoRefParaReceta(tx, session.tenantId, actual.medicoId);
    const nombrePaciente = (p: { nombre: string; apellido: string } | null) => (p ? `${p.apellido}, ${p.nombre}` : null);
    const nombreMedico = (m: { nombre: string; apellido: string; matricula: string } | null) =>
      m ? `${m.apellido}, ${m.nombre} — matrícula ${m.matricula}` : null;
    const nombres = { ...(await getNombresParaResumen(tx, session.tenantId, drogaIds, unidadIds)), sinonimos };

    return {
      output: { id: input.id },
      audit: {
        entidadId: input.id,
        valorAnterior: {
          pacienteId: actual.pacienteId,
          paciente: nombrePaciente(pacienteAnterior),
          medicoId: actual.medicoId,
          medico: nombreMedico(medicoAnterior),
          fechaPrescripcion: actualFechaISO,
          origen: actual.origen,
          diagnosticoCodigo: actual.diagnosticoCodigo,
          diagnosticoDescripcion: actual.diagnosticoDescripcion,
          domicilioPaciente: actual.domicilioPaciente,
        },
        valorNuevo: {
          pacienteId: input.pacienteId,
          paciente: nombrePaciente(paciente),
          medicoId: input.medicoId,
          medico: nombreMedico(medico),
          fechaPrescripcion: input.fechaPrescripcion,
          origen: input.origen,
          diagnosticoCodigo: input.diagnosticoCodigo,
          diagnosticoDescripcion: input.diagnosticoDescripcion,
          domicilioPaciente: input.domicilioPaciente,
          items: input.items,
          itemsResumen: resumirItemsReceta(itemsDominio, nombres),
        },
      },
    };
  },
});

export async function editarReceta(input: EditarRecetaWireInput): Promise<{ id: string }> {
  return editarRecetaCommand.execute(input);
}
