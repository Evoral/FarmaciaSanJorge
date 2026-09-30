/**
 * `leerRecetaPdf` -- first step of the receta PDF import
 * (docs/specs/importacion-receta-pdf.md): trust boundary -> extraction ->
 * parser -> match. Returns the preview the form is prefilled with;
 * NOTHING is written (it is a query: read-only transaction, no audit row --
 * the spec audits the confirmation, `recetas.importar`, not the reading).
 *
 * Spec order, mandatory: (1) permiso `recetas.crear` -- the use-case
 * pipeline's `authorize()`, before anything else; (2-6) File / size 0 /
 * size > MAX_PDF_BYTES (before reading it) / type / `%PDF-` signature --
 * domain/archivo-receta-pdf.ts, first thing in the handler. The PDF only
 * lives in memory for the duration of this call and is never logged.
 *
 * Trade-off, deliberate: extraction runs inside the query's transaction
 * (the pipeline has no "authorize without a transaction" entry point, by
 * design -- shared/usecase.ts). It is bounded: 1 MiB, at most
 * MAX_PDF_PAGINAS pages, ~150 ms for a real one-page receta.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import { DomainError, ValidationError } from "@/shared/errors";
import { normalizarMatricula } from "@/modules/medicos/domain/medico";
import { validarArchivoRecetaPdf } from "../domain/archivo-receta-pdf";
import { parsearRecetaPdf } from "../domain/receta-pdf-parser";
import type { AdvertenciaParser, BorradorReceta } from "../domain/receta-pdf-parser";
import { normalizarTexto } from "../domain/normalizar";
import {
  CAMPOS_MEDICO_IMPORTABLES,
  CAMPOS_PACIENTE_IMPORTABLES,
  MENSAJE_PACIENTE_DADO_DE_BAJA,
  advertenciasDeDiferencias,
  calcularCompletado,
  diferenciaDeNombre,
  mensajeRecetaYaImportada,
  resolverDroga,
  resolverUnidad,
} from "../domain/importacion-receta";
import type { AdvertenciaImportacion, ComponenteVistaPrevia, MedicoVistaPrevia, PacienteVistaPrevia, VistaPreviaImportacion } from "../domain/importacion-receta";
import { extraerTextoRecetaPdf } from "../infrastructure/receta-pdf.server";
import {
  buscarMedicoVigentePorMatricula,
  buscarPacientePorIdentificacion,
  buscarRecetaImportada,
  listAliasesVigentes,
  listDrogasVigentesParaMatch,
  listUnidadesVigentesParaMatch,
} from "../infrastructure/importacion-repository";

export type { VistaPreviaImportacion };

/** `archivo` is checked by `validarArchivoRecetaPdf` (step 2 onward), not by zod, so every step keeps its own message and order. */
const leerRecetaPdfInput = z.object({ archivo: z.unknown() });

/** Datos del paciente as printed, keyed like the importable fields. */
export function datosPacientePdf(borrador: BorradorReceta) {
  const p = borrador.paciente;
  return { dni: p.dni, cuil: p.cuil, sexo: p.sexo, fechaNacimiento: p.fechaNacimiento, nroCredencial: p.nroCredencial };
}

export function datosMedicoPdf(borrador: BorradorReceta) {
  const m = borrador.medico;
  return { especialidad: m.especialidad, telefono: m.telefono, direccionRegistrada: m.direccionRegistrada };
}

/** The match step (spec "Pieza 4"): duplicate check, paciente, médico, drogas, unidades. Exported for tests; only `leerRecetaPdfQuery` calls it. */
export async function construirVistaPrevia(
  tx: Prisma.TransactionClient,
  tenantId: string,
  borrador: BorradorReceta,
  advertenciasParser: readonly AdvertenciaParser[],
): Promise<VistaPreviaImportacion> {
  const numeroExistente = await buscarRecetaImportada(tx, tenantId, borrador.emisor, borrador.nroRecetaEmisor);
  if (numeroExistente !== null) throw new DomainError(mensajeRecetaYaImportada(numeroExistente));

  const advertencias: AdvertenciaImportacion[] = [...advertenciasParser];

  // --- Paciente: CUIL, else DNI, bajas included. ---
  const pacienteExistente = await buscarPacientePorIdentificacion(tx, tenantId, borrador.paciente.cuil, borrador.paciente.dni);
  let paciente: PacienteVistaPrevia = { existente: null, completar: [], diferencias: [] };
  if (pacienteExistente) {
    const completado = calcularCompletado(CAMPOS_PACIENTE_IMPORTABLES, pacienteExistente, datosPacientePdf(borrador));
    const nombre = diferenciaDeNombre(pacienteExistente, borrador.paciente.nombre?.nombreCompleto ?? null);
    paciente = {
      existente: {
        id: pacienteExistente.id,
        nombre: pacienteExistente.nombre,
        apellido: pacienteExistente.apellido,
        dadoDeBaja: pacienteExistente.fechaBaja !== null,
      },
      completar: completado.completar,
      diferencias: nombre ? [nombre, ...completado.diferencias] : completado.diferencias,
    };
    if (pacienteExistente.fechaBaja !== null) advertencias.push({ codigo: "PACIENTE_DADO_DE_BAJA", mensaje: MENSAJE_PACIENTE_DADO_DE_BAJA });
    advertencias.push(...advertenciasDeDiferencias("paciente", paciente.diferencias));
  }

  // --- Médico: (jurisdicción, matrícula) among vigentes. ---
  let medico: MedicoVistaPrevia = { existente: null, completar: [], diferencias: [] };
  const { matricula, matriculaJurisdiccion } = borrador.medico;
  const medicoExistente =
    matricula && matriculaJurisdiccion ? await buscarMedicoVigentePorMatricula(tx, tenantId, matriculaJurisdiccion, normalizarMatricula(matricula)) : null;
  if (medicoExistente) {
    const completado = calcularCompletado(CAMPOS_MEDICO_IMPORTABLES, medicoExistente, datosMedicoPdf(borrador));
    const nombre = diferenciaDeNombre(medicoExistente, borrador.medico.nombre?.nombreCompleto ?? null);
    medico = {
      existente: { id: medicoExistente.id, nombre: medicoExistente.nombre, apellido: medicoExistente.apellido, matricula: medicoExistente.matricula },
      completar: completado.completar,
      diferencias: nombre ? [nombre, ...completado.diferencias] : completado.diferencias,
    };
    advertencias.push(...advertenciasDeDiferencias("médico", medico.diferencias));
  }

  // --- Drogas (alias, then nombre) and unidades (símbolo/código). ---
  const textos = borrador.items.flatMap((item) => item.componentes.map((c) => normalizarTexto(c.drogaTexto)));
  const [aliases, drogas, unidades] = [
    await listAliasesVigentes(tx, tenantId, textos),
    await listDrogasVigentesParaMatch(tx, tenantId),
    await listUnidadesVigentesParaMatch(tx),
  ];
  const nombrePorId = new Map(drogas.map((d) => [d.id, d.nombre]));
  const componentes: ComponenteVistaPrevia[][] = borrador.items.map((item) =>
    item.componentes.map((c) => {
      const droga = resolverDroga(c.drogaTexto, aliases, drogas);
      const unidad = resolverUnidad(c.unidadTexto, unidades);
      if (!droga) {
        advertencias.push({ codigo: "DROGA_SIN_MATCH", mensaje: `No se encontró la droga «${c.drogaTexto}» en el catálogo.`, texto: c.drogaTexto });
      }
      if (!unidad) {
        advertencias.push({ codigo: "UNIDAD_SIN_MATCH", mensaje: `No se reconoció la unidad «${c.unidadTexto}» de «${c.drogaTexto}».`, texto: c.unidadTexto });
      }
      return {
        drogaId: droga?.drogaId ?? null,
        drogaNombre: droga ? (nombrePorId.get(droga.drogaId) ?? null) : null,
        via: droga?.via ?? null,
        unidadMedidaId: unidad?.id ?? null,
      };
    }),
  );

  return { borrador, advertencias, paciente, medico, componentes };
}

export const leerRecetaPdfQuery = defineQuery({
  name: "recetas.importar.leer",
  permiso: "recetas.crear",
  input: leerRecetaPdfInput,
  handler: async ({ tx, session, input }): Promise<VistaPreviaImportacion> => {
    const bytes = await validarArchivoRecetaPdf(input.archivo);
    const resultado = parsearRecetaPdf(await extraerTextoRecetaPdf(bytes));
    if (!resultado.ok) throw new ValidationError(resultado.error.mensaje);
    return construirVistaPrevia(tx, session.tenantId, resultado.borrador, resultado.advertencias);
  },
});

export async function leerRecetaPdf(archivo: unknown): Promise<VistaPreviaImportacion> {
  return leerRecetaPdfQuery.execute({ archivo });
}
