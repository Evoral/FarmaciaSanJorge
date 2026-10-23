/**
 * `leerRecetaPdf` -- first step of the receta PDF import
 * (docs/specs/importacion-receta-pdf.md, "Lectura por RCTA"): trust boundary -> extraction -> the PDF's RCTA link ->
 * the SAME RCTA read as the QR import (./lectura-rcta.ts) -> the paciente's name from the PDF text -> match. Returns
 * the preview the form is prefilled with; NOTHING is written (it is a query: read-only transaction, no audit row --
 * the spec audits the confirmation, `recetas.importar`, not the reading).
 *
 * User decision (2026-10-23): every datum comes from RCTA, so a PDF and a QR of the same receta load the same thing;
 * the PDF only gives its "Ver Link" (same hash as its QR) and the paciente's name (RCTA anonymizes it). Without that
 * link, or when RCTA cannot answer, the read fails with an error: there is no fallback to the PDF's text.
 *
 * Spec order, mandatory: (1) permiso `recetas.crear` -- the use-case pipeline's `authorize()`, before anything else;
 * (2-6) File / size 0 / size > MAX_PDF_BYTES (before reading it) / type / `%PDF-` signature --
 * domain/archivo-receta-pdf.ts, first thing in `prepare`. The PDF only lives in memory for the duration of this call
 * and is never logged. The extraction and the RCTA fetch run in the query's `prepare` step, OUTSIDE any transaction
 * (the fetch can take seconds and must not hold a pooled connection); only the match runs inside it.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { defineQuery } from "@/shared/usecase";
import { DomainError, ValidationError } from "@/shared/errors";
import { normalizarMatricula } from "@/modules/medicos/domain/medico";
import { validarArchivoRecetaPdf } from "../domain/archivo-receta-pdf";
import { parsearRecetaPdf } from "../domain/receta-pdf-parser";
import { hashDeLinksPdf, MENSAJES_LECTURA_PDF } from "../domain/receta-qr";
import { conNombrePacienteDelPdf } from "../domain/receta-rcta-json";
import { leerRecetaRcta } from "./lectura-rcta";
import type { AdvertenciaParser, BorradorReceta } from "../domain/receta-pdf-parser";
import {
  CAMPOS_MEDICO_IMPORTABLES,
  CAMPOS_PACIENTE_IMPORTABLES,
  MENSAJE_PACIENTE_DADO_DE_BAJA,
  acotarAvisos,
  advertenciasDeDiferencias,
  calcularCompletado,
  diferenciaDeNombre,
  mensajeRecetaYaImportada,
  normalizarTextoDroga,
  resolverDroga,
  resolverUnidad,
} from "../domain/importacion-receta";
import type {
  AdvertenciaImportacion,
  ComponenteVistaPrevia,
  FuenteImportacion,
  MedicoVistaPrevia,
  PacienteVistaPrevia,
  VistaPreviaImportacion,
} from "../domain/importacion-receta";
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

/** The match step (spec "Pieza 4"): duplicate check, paciente, médico, drogas, unidades. Shared by every source of recetas (`fuente` tags the preview). */
export async function construirVistaPrevia(
  tx: Prisma.TransactionClient,
  tenantId: string,
  borrador: BorradorReceta,
  advertenciasParser: readonly AdvertenciaParser[],
  fuente: FuenteImportacion,
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
        domicilio: pacienteExistente.domicilio,
        domicilioEntrega: pacienteExistente.domicilioEntrega,
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
  const textos = borrador.items.flatMap((item) => item.componentes.map((c) => normalizarTextoDroga(c.drogaTexto)));
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
        drogaAliasId: droga?.aliasId ?? null,
        sinonimo: droga?.sinonimo ?? null,
        unidadMedidaId: unidad?.id ?? null,
      };
    }),
  );

  return { fuente, borrador, advertencias, paciente, medico, componentes };
}

export const leerRecetaPdfQuery = defineQuery({
  name: "recetas.importar.leer",
  permiso: "recetas.crear",
  input: leerRecetaPdfInput,
  prepare: async ({ input }) => {
    const bytes = await validarArchivoRecetaPdf(input.archivo);
    const pdf = await extraerTextoRecetaPdf(bytes);
    const hash = hashDeLinksPdf(pdf.links);
    if (hash === null) throw new ValidationError(MENSAJES_LECTURA_PDF.SIN_LINK);
    const lectura = await leerRecetaRcta(hash, MENSAJES_LECTURA_PDF);
    // Only the name is taken from the PDF's text; a text the parser cannot read just leaves it to be typed.
    const texto = parsearRecetaPdf(pdf);
    return conNombrePacienteDelPdf(lectura, texto.ok ? texto.borrador.paciente.nombre : null);
  },
  handler: async ({ tx, session, prepared }): Promise<VistaPreviaImportacion> => {
    const vista = await construirVistaPrevia(tx, session.tenantId, prepared.borrador, prepared.advertencias, "PDF");
    // Same bound as the QR import: the match step adds notices echoing the receta's text.
    return { ...vista, advertencias: acotarAvisos(vista.advertencias) };
  },
});

export async function leerRecetaPdf(archivo: unknown): Promise<VistaPreviaImportacion> {
  return leerRecetaPdfQuery.execute({ archivo });
}
