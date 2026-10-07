/**
 * `importarReceta` -- confirmation of a receta PDF import
 * (docs/specs/importacion-receta-pdf.md, "Confirmación -- comando
 * `recetas.importar`"). Permiso `recetas.crear`. ONE transaction:
 *
 *   1. paciente and médico: alta if new, otherwise complete ONLY their
 *      empty fields with the PDF's data (never overwrite);
 *   2. receta with origen DIGITAL_PDF + emisor/nro/url/diagnóstico + items,
 *      under the same V1-V9 validation as the manual alta (and, like it,
 *      each componente's principio activo flag from the droga's clase);
 *   3. the droga aliases the user chose to remember -- written BEFORE the
 *      receta, so the componentes they came from are loaded with them
 *      (`drogaAliasId`, migration 0069; see below);
 *   4. one audit row per alta/modificación (INV-A01).
 *
 * The client only sends back what the preview showed plus the user's
 * Synonyms of the componentes (docs/specs/sinonimos-droga.md, "Nombre
 * elegido al cargar"): a componente the preview matched through a synonym
 * arrives with that `drogaAliasId` (validated like the manual alta). For
 * "recordar esta equivalencia", the client also says which componentes
 * showed that text (`equivalencias[].componentes`, positions in `items`):
 * once the synonym exists (new, or already a synonym of the same droga), each
 * of those componentes still without a synonym and with that droga is loaded
 * with it. A text that is the droga's own name is never a synonym, so those
 * componentes keep the canonical name.
 *
 * choices; everything is re-derived here: the paciente/médico are matched
 * AGAIN by CUIL/DNI and (jurisdicción, matrícula) -- if that no longer
 * gives what the preview showed (`existenteId`), the data changed since
 * the reading and the user must read the PDF again; the receta is checked
 * again for a previous import; drogas/unidades are checked vigentes.
 *
 * `fuente` ("PDF" | "QR", default "PDF") says where the receta was read
 * from; it is audit-only and rides in every audit row's `contexto`. It is
 * asserted by the client (echoed from the preview) and carries NO
 * authorization meaning: nothing branches on it, and the same checks run
 * whatever it says.
 *
 * Audit: `defineCommand`'s built-in `audit` writes exactly ONE row, and
 * this command writes one per affected entity -- so, like
 * modules/usuarios/application/crear-usuario.ts, it declares
 * `audit: { skip: true, reason }` and records every row itself with
 * `audit.record`, inside the same transaction (a rollback takes them all).
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import type { AuthenticatedSession } from "@/shared/auth/session";
import type { Prisma } from "@/generated/prisma/client";
import { record as auditRecord } from "@/shared/audit";
import { ConflictError, DomainError, ValidationError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { crearPacienteHandler, crearPacienteInput } from "@/modules/pacientes/application/crear-paciente";
import { crearMedicoHandler, crearMedicoInput } from "@/modules/medicos/application/crear-medico";
import { diagnosticoCodigoOpcional, esFechaPrescripcionValida, esFechaPrescripcionVigente, resumirItemsReceta, validarItemsReceta, validarOrigenHabilitado } from "../domain/receta";
import type { ComponenteInput, ItemInput } from "../domain/receta";
import { CODIGOS_EMISOR, esUrlVerificacionDeEmisor } from "../domain/receta-pdf-parser";
import { normalizarTexto } from "../domain/normalizar";
import { limpiarSinonimo } from "@/modules/drogas/domain/sinonimo";
import {
  CAMPOS_MEDICO_IMPORTABLES,
  CAMPOS_PACIENTE_IMPORTABLES,
  FUENTES_IMPORTACION,
  MENSAJE_CAMBIOS_DESDE_LECTURA,
  MENSAJE_PACIENTE_DADO_DE_BAJA,
  calcularCompletado,
  mensajeRecetaYaImportada,
  valoresACompletar,
} from "../domain/importacion-receta";
import type { FuenteImportacion } from "../domain/importacion-receta";
import { clasificarDrogasDeReceta, getNombresParaResumen, insertRecetaConItems, jornadaActualTenant, unidadesInvalidas } from "../infrastructure/receta-repository";
import {
import { validarSinonimosDeComponentes } from "./sinonimos-componentes";
  buscarMedicoVigentePorMatricula,
  buscarPacientePorIdentificacion,
  buscarRecetaImportada,
  completarMedico,
  completarPaciente,
  getDrogaAlias,
  insertDrogaAlias,
} from "../infrastructure/importacion-repository";
import { isoDate, itemInput, textoOpcional } from "./crear-receta";

const urlVerificacionOpcional = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v && v.length > 0 ? v : null));

export const importarRecetaInput = z
  .object({
    emisor: z.enum(CODIGOS_EMISOR),
    /** Where the receta was read from (audit only); PDF for clients that do not say. */
    fuente: z.enum(FUENTES_IMPORTACION).default("PDF"),
    nroRecetaEmisor: z.string().trim().regex(/^\d{10,}$/, "Debe ser el número de receta del emisor (solo dígitos, al menos 10)."),
    urlVerificacion: urlVerificacionOpcional,
    fechaPrescripcion: isoDate,
    fechaValidaDesde: isoDate.optional().nullable().transform((v) => v ?? null),
    diagnosticoCodigo: diagnosticoCodigoOpcional,
    diagnosticoDescripcion: textoOpcional,
    /** `existenteId`: what the preview matched (`null` = alta). `datos`: the PDF's data, as confirmed by the user. */
    paciente: z.object({ existenteId: uuid.nullable(), datos: crearPacienteInput }),
    medico: z.object({ existenteId: uuid.nullable(), datos: crearMedicoInput }),
    items: z.array(itemInput).min(1, "La receta debe tener al menos un ítem."),
    /**
     * "Recordar esta equivalencia": the drug name as printed -> the droga the user chose. `componentes`: where that
     * text was printed (positions in `items`), loaded with the remembered synonym (module doc comment).
     */
    equivalencias: z
      .array(
        z.object({
          aliasTexto: z.string().trim().min(1).max(200),
          drogaId: uuid,
          componentes: z
            .array(z.object({ item: z.number().int().min(0), componente: z.number().int().min(0) }))
            .max(200)
            .default([]),
        }),
      )
      .max(50)
      .default([]),
  })
  .superRefine((input, ctx) => {
    if (input.urlVerificacion !== null && !esUrlVerificacionDeEmisor(input.emisor, input.urlVerificacion)) {
      ctx.addIssue({ code: "custom", path: ["urlVerificacion"], message: "No es el link de verificación del emisor." });
    }
  });

export type ImportarRecetaInput = z.infer<typeof importarRecetaInput>;
export type ImportarRecetaWireInput = z.input<typeof importarRecetaInput>;

function toItemsInput(items: ImportarRecetaInput["items"]): ItemInput[] {
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
      }),
    ),
  }));
        drogaAliasId: c.drogaAliasId ?? null,
}

interface Contexto {
  tx: Prisma.TransactionClient;
  session: AuthenticatedSession;
  /** Recorded as `contexto.fuente` on every audit row of the import. Client-asserted, audit-only. */
  fuente: FuenteImportacion;
}

async function auditar(
  { tx, session, fuente }: Contexto,
  entidad: string,
  entidadId: string,
  accion: TipoAccion,
  valores: { valorAnterior?: Prisma.InputJsonValue; valorNuevo: Prisma.InputJsonValue },
): Promise<void> {
  await auditRecord(tx, { tenantId: session.tenantId, usuarioId: session.usuario.id, entidad, entidadId, accion, contexto: { origen: "importacion_receta_pdf", fuente }, ...valores });
}

/** Alta or completion of the paciente; returns its id and a readable name for the receta's audit row. */
async function resolverPaciente(ctx: Contexto, input: ImportarRecetaInput["paciente"]): Promise<{ id: string; nombre: string }> {
  const { tx, session } = ctx;
  const datos = input.datos;
  const existente = await buscarPacientePorIdentificacion(tx, session.tenantId, datos.cuil, datos.dni);
  if ((existente?.id ?? null) !== input.existenteId) throw new ConflictError(MENSAJE_CAMBIOS_DESDE_LECTURA);

  if (!existente) {
    const alta = await crearPacienteHandler({ tx, session, input: datos });
    await auditar(ctx, "paciente", alta.output.id, TipoAccion.CREAR, { valorNuevo: alta.audit!.valorNuevo! });
    return { id: alta.output.id, nombre: `${datos.nombre} ${datos.apellido}` };
  }

  if (existente.fechaBaja !== null) throw new DomainError(MENSAJE_PACIENTE_DADO_DE_BAJA);
  const pdf = {
    dni: datos.dni,
    cuil: datos.cuil,
    sexo: datos.sexo,
    fechaNacimiento: datos.fechaNacimiento ? datos.fechaNacimiento.toISOString().slice(0, 10) : null,
    nroCredencial: datos.nroCredencial,
  };
  const { completar } = calcularCompletado(CAMPOS_PACIENTE_IMPORTABLES, existente, pdf);
  const escritos = await completarPaciente(tx, session.tenantId, existente.id, valoresACompletar(completar, pdf));
  if (Object.keys(escritos).length > 0) {
    await auditar(ctx, "paciente", existente.id, TipoAccion.MODIFICAR, {
      valorAnterior: Object.fromEntries(Object.keys(escritos).map((campo) => [campo, null])),
      valorNuevo: escritos,
    });
  }
  return { id: existente.id, nombre: `${existente.nombre} ${existente.apellido}` };
}

async function resolverMedico(ctx: Contexto, input: ImportarRecetaInput["medico"]): Promise<{ id: string; nombre: string }> {
  const { tx, session } = ctx;
  const datos = input.datos;
  const existente = await buscarMedicoVigentePorMatricula(tx, session.tenantId, datos.matriculaJurisdiccion, datos.matricula);
  if ((existente?.id ?? null) !== input.existenteId) throw new ConflictError(MENSAJE_CAMBIOS_DESDE_LECTURA);

  if (!existente) {
    const alta = await crearMedicoHandler({ tx, session, input: datos });
    await auditar(ctx, "medico", alta.output.id, TipoAccion.CREAR, { valorNuevo: alta.audit!.valorNuevo! });
    return { id: alta.output.id, nombre: `${datos.apellido}, ${datos.nombre} — matrícula ${datos.matricula}` };
  }

  const pdf = { especialidad: datos.especialidad, telefono: datos.telefono, direccionRegistrada: datos.direccionRegistrada };
  const { completar } = calcularCompletado(CAMPOS_MEDICO_IMPORTABLES, existente, pdf);
  const escritos = await completarMedico(tx, session.tenantId, existente.id, valoresACompletar(completar, pdf));
  if (Object.keys(escritos).length > 0) {
    await auditar(ctx, "medico", existente.id, TipoAccion.MODIFICAR, {
      valorAnterior: Object.fromEntries(Object.keys(escritos).map((campo) => [campo, null])),
      valorNuevo: escritos,
    });
  }
  return { id: existente.id, nombre: `${existente.apellido}, ${existente.nombre} — matrícula ${existente.matricula}` };
}

export const importarRecetaCommand = defineCommand({
  name: "recetas.importar",
  permiso: "recetas.crear",
  input: importarRecetaInput,
  audit: {
    skip: true,
    reason: "Writes one audit row per affected entity (paciente, médico, receta, each droga alias) itself, via audit.record in the same transaction -- see the module doc comment.",
  },
  handler: async ({ tx, session, input }) => {
    const ctx: Contexto = { tx, session, fuente: input.fuente };
    validarOrigenHabilitado("DIGITAL_PDF");

    const numeroExistente = await buscarRecetaImportada(tx, session.tenantId, input.emisor, input.nroRecetaEmisor);
    if (numeroExistente !== null) throw new DomainError(mensajeRecetaYaImportada(numeroExistente));

    const jornadaActual = await jornadaActualTenant(tx, session.tenantId);
    if (!esFechaPrescripcionValida(input.fechaPrescripcion, jornadaActual)) {
      throw new ValidationError("La fecha de prescripción no puede ser futura.");
    }
    if (!esFechaPrescripcionVigente(input.fechaValidaDesde ?? input.fechaPrescripcion, jornadaActual)) {
      throw new ValidationError(input.fechaValidaDesde ? "La receta está vencida: pasó más de un mes desde su fecha de validez." : "La receta está vencida: tiene más de un mes desde su prescripción.");
    }

    const itemsDominio = toItemsInput(input.items);
    validarItemsReceta(itemsDominio);

    const drogaIds = [...itemsDominio.flatMap((item) => item.componentes.map((c) => c.drogaId)), ...input.equivalencias.map((e) => e.drogaId)];
    const drogas = await clasificarDrogasDeReceta(tx, session.tenantId, drogaIds);
    if (drogas.invalidas.length > 0) {
      throw new ValidationError("Una o más drogas seleccionadas no existen o están dadas de baja.");
    }
    const unidadIds = [
      ...itemsDominio.flatMap((item) => item.componentes.map((c) => c.unidadMedidaId)),
      ...itemsDominio.flatMap((item) => (item.unidadTotalId ? [item.unidadTotalId] : [])),
    ];
    if ((await unidadesInvalidas(tx, unidadIds)).length > 0) {
      throw new ValidationError("Una o más unidades de medida seleccionadas no existen o están dadas de baja.");
    }

    const paciente = await resolverPaciente(ctx, input.paciente);
    const medico = await resolverMedico(ctx, input.medico);

    const nueva = await insertRecetaConItems(tx, {
      tenantId: session.tenantId,
    const nombresBase = await getNombresParaResumen(tx, session.tenantId, drogaIds, unidadIds);

    // "Recordar esta equivalencia" = add the text as a synonym of the chosen droga (docs/specs/sinonimos-droga.md):
    // idempotent for the same droga, a conflict when a vigente synonym points to another one. A text that already IS
    // a vigente droga's name is never remembered (a synonym cannot repeat a droga's name): it resolves by name.
    // Their audit rows are written after the receta's, as before.
    const aliasesNuevos: { id: string; valorNuevo: Prisma.InputJsonValue }[] = [];
    // normalized text -> the synonym it resolved to (`null`: it is a droga's own name, nothing to remember).
    const resueltos = new Map<string, { id: string; drogaId: string } | null>();
    for (const equivalencia of input.equivalencias) {
      const aliasNormalizado = normalizarTexto(equivalencia.aliasTexto);
      if (aliasNormalizado.length === 0) continue;
      if (!resueltos.has(aliasNormalizado)) {
        const existente = await getDrogaAlias(tx, session.tenantId, aliasNormalizado);
        if (existente?.esNombre) {
          resueltos.set(aliasNormalizado, null);
        } else if (existente) {
          if (existente.drogaId !== equivalencia.drogaId) {
            throw new ConflictError(`«${equivalencia.aliasTexto}» ya está asociado a otra droga. ${MENSAJE_CAMBIOS_DESDE_LECTURA}`);
          }
          resueltos.set(aliasNormalizado, { id: existente.id, drogaId: existente.drogaId });
        } else {
          const texto = limpiarSinonimo(equivalencia.aliasTexto);
          const alias = await insertDrogaAlias(tx, { tenantId: session.tenantId, drogaId: equivalencia.drogaId, aliasNormalizado, texto, creadoPorId: session.usuario.id });
          resueltos.set(aliasNormalizado, { id: alias.id, drogaId: equivalencia.drogaId });
          aliasesNuevos.push({
            id: alias.id,
            valorNuevo: { sinonimo: texto, aliasNormalizado, drogaId: equivalencia.drogaId, droga: nombresBase.drogas.get(equivalencia.drogaId) ?? null },
          });
        }
      }
      const sinonimo = resueltos.get(aliasNormalizado);
      if (!sinonimo) continue;
      // The componentes that showed this text are loaded with the synonym (unless the user already picked one by another name).
      for (const posicion of equivalencia.componentes) {
        const componente = itemsDominio[posicion.item]?.componentes[posicion.componente];
        if (componente && componente.drogaId === sinonimo.drogaId && !componente.drogaAliasId) componente.drogaAliasId = sinonimo.id;
      }
    }

    const sinonimos = await validarSinonimosDeComponentes(tx, session.tenantId, itemsDominio.flatMap((item) => item.componentes));
    const nombres = { ...nombresBase, sinonimos };
      pacienteId: paciente.id,
      medicoId: medico.id,
      fechaPrescripcion: input.fechaPrescripcion,
      origen: "DIGITAL_PDF",
      registradaPorId: session.usuario.id,
      diagnosticoCodigo: input.diagnosticoCodigo,
      diagnosticoDescripcion: input.diagnosticoDescripcion,
      emisor: input.emisor,
      nroRecetaEmisor: input.nroRecetaEmisor,
      urlVerificacion: input.urlVerificacion,
      fechaValidaDesde: input.fechaValidaDesde,
      items: itemsDominio.map((item) => ({
        descripcion: item.descripcion ?? null,
        formaFarmaceutica: item.formaFarmaceutica,
        cantidadUnidades: item.cantidadUnidades,
        fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
        cantidadTotal: item.cantidadTotal,
        unidadTotalId: item.unidadTotalId,
        observaciones: item.observaciones ?? null,
        posologia: item.posologia ?? null,
        duracionTratamientoDias: item.duracionTratamientoDias ?? null,
        componentes: item.componentes.map((c) => ({ ...c, esPrincipioActivo: drogas.principiosActivos.has(c.drogaId) })),
      })),
    });

    await auditar(ctx, "receta", nueva.id, TipoAccion.CREAR, {
      valorNuevo: {
        pacienteId: paciente.id,
        paciente: paciente.nombre,
        medicoId: medico.id,
        medico: medico.nombre,
        fechaPrescripcion: input.fechaPrescripcion,
        origen: "DIGITAL_PDF",
        emisor: input.emisor,
        nroRecetaEmisor: input.nroRecetaEmisor,
        urlVerificacion: input.urlVerificacion,
        diagnosticoCodigo: input.diagnosticoCodigo,
        diagnosticoDescripcion: input.diagnosticoDescripcion,
        numeroInterno: nueva.numeroInterno,
        items: input.items,
        itemsResumen: resumirItemsReceta(itemsDominio, nombres),
      },
    });

    for (const alias of aliasesNuevos) {
      await auditar(ctx, "droga_alias", alias.id, TipoAccion.CREAR, { valorNuevo: alias.valorNuevo });
    }

    return { output: { id: nueva.id, numeroInterno: nueva.numeroInterno } };
  },
});

export async function importarReceta(input: ImportarRecetaWireInput): Promise<{ id: string; numeroInterno: string }> {
  return importarRecetaCommand.execute(input);
}
