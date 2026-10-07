/**
 * Prisma-backed lookups/writes for the receta PDF import
 * (docs/specs/importacion-receta-pdf.md, "Pieza 4" and "Confirmación").
 * Every function runs inside an ALREADY OPEN tenant transaction. Own
 * minimal copies of the paciente/médico/droga/unidad reads, same
 * convention as receta-repository.ts -- the pure decisions (what matches,
 * which fields to complete) live in ../domain/importacion-receta.ts.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { JurisdiccionMatricula } from "@/modules/medicos/domain/medico";
import type { AliasDroga, CampoMedicoImportable, CampoPacienteImportable, DrogaCandidata, UnidadCandidata } from "../domain/importacion-receta";

/** Numero interno of a non-ANULADA receta already imported with this emisor number (mirrors migration 0049's uq_receta_emisor_nro_vigente), or `null`. */
export async function buscarRecetaImportada(tx: Prisma.TransactionClient, tenantId: string, emisor: string, nroRecetaEmisor: string): Promise<string | null> {
  const row = await tx.receta.findFirst({
    where: { tenantId, emisor, nroRecetaEmisor, estado: { not: "ANULADA" } },
    select: { numeroInterno: true },
  });
  return row ? row.numeroInterno.toString() : null;
}

// ============================================================================
// Paciente
// ============================================================================

export interface PacienteParaImportacion extends Record<CampoPacienteImportable, string | null> {
  id: string;
  nombre: string;
  apellido: string;
  fechaBaja: Date | null;
}

const SELECT_PACIENTE = {
  id: true,
  nombre: true,
  apellido: true,
  dni: true,
  cuil: true,
  sexo: true,
  fechaNacimiento: true,
  nroCredencial: true,
  fechaBaja: true,
} as const;

function toPaciente(row: {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  cuil: string | null;
  sexo: string | null;
  fechaNacimiento: Date | null;
  nroCredencial: string | null;
  fechaBaja: Date | null;
}): PacienteParaImportacion {
  return { ...row, fechaNacimiento: row.fechaNacimiento ? row.fechaNacimiento.toISOString().slice(0, 10) : null };
}

/** Spec: by CUIL, else by DNI -- dados de baja INCLUDED (the caller warns; a baja is never reactivated here). With several DNI matches, a vigente one wins. */
export async function buscarPacientePorIdentificacion(
  tx: Prisma.TransactionClient,
  tenantId: string,
  cuil: string | null,
  dni: string | null,
): Promise<PacienteParaImportacion | null> {
  if (cuil) {
    const porCuil = await tx.paciente.findFirst({ where: { tenantId, cuil }, select: SELECT_PACIENTE });
    if (porCuil) return toPaciente(porCuil);
  }
  if (dni) {
    const porDni = await tx.paciente.findFirst({
      where: { tenantId, dni },
      orderBy: [{ fechaBaja: { sort: "asc", nulls: "first" } }],
      select: SELECT_PACIENTE,
    });
    if (porDni) return toPaciente(porDni);
  }
  return null;
}

/**
 * Completes the given fields of an existing paciente, but ONLY those still
 * empty right now: the row is locked first and re-read, so a value written
 * concurrently is never overwritten. Returns what was actually written
 * (empty when nothing was).
 */
export async function completarPaciente(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  valores: Partial<Record<CampoPacienteImportable, string>>,
): Promise<Partial<Record<CampoPacienteImportable, string>>> {
  await tx.$queryRaw`SELECT id FROM fsj.paciente WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
  const actual = await tx.paciente.findUnique({ where: { id, tenantId }, select: SELECT_PACIENTE });
  if (!actual) return {};
  const vigente = toPaciente(actual);
  const escritos: Partial<Record<CampoPacienteImportable, string>> = {};
  for (const [campo, valor] of Object.entries(valores) as [CampoPacienteImportable, string][]) {
    if (vigente[campo] === null || vigente[campo]!.trim().length === 0) escritos[campo] = valor;
  }
  if (Object.keys(escritos).length === 0) return {};
  await tx.paciente.update({
    where: { id, tenantId },
    data: {
      ...(escritos.dni !== undefined ? { dni: escritos.dni } : {}),
      ...(escritos.cuil !== undefined ? { cuil: escritos.cuil } : {}),
      ...(escritos.sexo !== undefined ? { sexo: escritos.sexo } : {}),
      ...(escritos.nroCredencial !== undefined ? { nroCredencial: escritos.nroCredencial } : {}),
      ...(escritos.fechaNacimiento !== undefined ? { fechaNacimiento: new Date(`${escritos.fechaNacimiento}T00:00:00Z`) } : {}),
    },
  });
  return escritos;
}

// ============================================================================
// Médico
// ============================================================================

export interface MedicoParaImportacion extends Record<CampoMedicoImportable, string | null> {
  id: string;
  nombre: string;
  apellido: string;
  matricula: string;
}

const SELECT_MEDICO = { id: true, nombre: true, apellido: true, matricula: true, especialidad: true, telefono: true, direccionRegistrada: true } as const;

/** Spec: (jurisdicción, matrícula) among vigentes -- `matricula` already normalized (modules/medicos/domain/medico.ts). */
export async function buscarMedicoVigentePorMatricula(
  tx: Prisma.TransactionClient,
  tenantId: string,
  matriculaJurisdiccion: JurisdiccionMatricula,
  matricula: string,
): Promise<MedicoParaImportacion | null> {
  return tx.medico.findFirst({ where: { tenantId, matriculaJurisdiccion, matricula, fechaBaja: null }, select: SELECT_MEDICO });
}

/** Same discipline as `completarPaciente`. */
export async function completarMedico(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
  valores: Partial<Record<CampoMedicoImportable, string>>,
): Promise<Partial<Record<CampoMedicoImportable, string>>> {
  await tx.$queryRaw`SELECT id FROM fsj.medico WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
  const actual = await tx.medico.findUnique({ where: { id, tenantId }, select: SELECT_MEDICO });
  if (!actual) return {};
  const escritos: Partial<Record<CampoMedicoImportable, string>> = {};
  for (const [campo, valor] of Object.entries(valores) as [CampoMedicoImportable, string][]) {
    if (actual[campo] === null || actual[campo]!.trim().length === 0) escritos[campo] = valor;
  }
  if (Object.keys(escritos).length === 0) return {};
  await tx.medico.update({ where: { id, tenantId }, data: escritos });
  return escritos;
}

// ============================================================================
// Drogas / alias / unidades
// ============================================================================

/** Every vigente droga of the tenant (id + nombre) -- the catalog is small; normalized comparison happens in the domain. */
export async function listDrogasVigentesParaMatch(tx: Prisma.TransactionClient, tenantId: string): Promise<DrogaCandidata[]> {
  return tx.droga.findMany({ where: { tenantId, fechaBaja: null }, select: { id: true, nombre: true } });
}

/** Vigente synonyms among `aliasesNormalizados` whose droga is still vigente. */
export async function listAliasesVigentes(tx: Prisma.TransactionClient, tenantId: string, aliasesNormalizados: string[]): Promise<AliasDroga[]> {
  if (aliasesNormalizados.length === 0) return [];
  return tx.drogaAlias.findMany({
    where: { tenantId, aliasNormalizado: { in: [...new Set(aliasesNormalizados)] }, fechaBaja: null, droga: { fechaBaja: null } },
    select: { aliasNormalizado: true, drogaId: true, id: true, texto: true },
  });
}

/**
 * What `aliasNormalizado` already resolves to, for "recordar esta
 * equivalencia" (docs/specs/sinonimos-droga.md): a VIGENTE synonym of a
 * VIGENTE droga (`id` = the synonym's), or else -- `esNombre: true`, `id` =
 * the droga's -- the normalized name of a vigente droga (a synonym can never
 * repeat a droga's name, INV-DRG-002). Removed synonyms and synonyms of
 * drogas dadas de baja never block a text. `null` = free.
 */
export async function getDrogaAlias(
  tx: Prisma.TransactionClient,
  tenantId: string,
  aliasNormalizado: string,
): Promise<{ id: string; drogaId: string; esNombre?: boolean } | null> {
  const rows = await tx.$queryRaw<{ id: string; droga_id: string; es_nombre: boolean }[]>`
    SELECT id, droga_id, es_nombre FROM (
      SELECT 1 AS orden, a.id, a.droga_id, false AS es_nombre
      FROM fsj.droga_alias a
      JOIN fsj.droga d ON d.tenant_id = a.tenant_id AND d.id = a.droga_id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.alias_normalizado = ${aliasNormalizado}::text AND a.fecha_baja IS NULL AND d.fecha_baja IS NULL
      UNION ALL
      SELECT 2, d.id, d.id, true
      FROM fsj.droga d
      WHERE d.tenant_id = ${tenantId}::uuid AND d.fecha_baja IS NULL AND fsj.normalizar_nombre(d.nombre) = fsj.normalizar_nombre(${aliasNormalizado}::text)
    ) t
    ORDER BY orden
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { id: row.id, drogaId: row.droga_id, esNombre: row.es_nombre } : null;
}

/** `texto` = the synonym as written on the document (display); `aliasNormalizado` = its normalized form (match key). */
export async function insertDrogaAlias(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; drogaId: string; aliasNormalizado: string; texto: string; creadoPorId: string },
): Promise<{ id: string }> {
  return tx.drogaAlias.create({ data: input, select: { id: true } });
}

/** The GLOBAL unidad_medida catalog, vigentes only. */
export async function listUnidadesVigentesParaMatch(tx: Prisma.TransactionClient): Promise<UnidadCandidata[]> {
  return tx.unidadMedida.findMany({ where: { fechaBaja: null }, select: { id: true, codigo: true, simbolo: true } });
}
