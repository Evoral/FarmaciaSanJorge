/**
 * Shared seed helpers for tests/db/recetas-items-componentes.test.ts,
 * fichas-tecnicas-lineas-pesaje.test.ts and preparacion-etiqueta.test.ts
 * (migrations 0011-0013, FASE 1 points 1.9-1.11). Mirrors the seeding
 * pattern already used per-file in tests/db/partidas-movimientos-stock.test.ts
 * and tests/db/designacion-dt.test.ts, factored out here since these three
 * files share a much longer fixture chain (tenant -> usuario -> droga ->
 * receta -> item -> componente -> ficha -> linea -> preparacion).
 */
import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";

export const FUTURO = "2099-12-31";

/**
 * Independent (Node-side) reimplementation of the hash serialization V2
 * documented in the header of migration 0018_legal_core_fixes -- written
 * from the documented format, NOT by calling the DB, so a test comparing it
 * against a trigger-computed hash proves an external auditor could
 * reproduce the hash from the spec alone.
 *
 *   field:   NULL -> "-" ; otherwise "<UTF-8 byte length>:<value>"
 *   payload: concatenation of the encoded fields (no separator), tag first
 *   hash:    lowercase hex SHA-256 of the UTF-8 payload
 */
export function campoV2(valor: string | null): string {
  return valor === null ? "-" : `${Buffer.byteLength(valor, "utf8")}:${valor}`;
}

export function hashV2(campos: ReadonlyArray<string | null>): string {
  return createHash("sha256").update(campos.map(campoV2).join(""), "utf8").digest("hex");
}

export async function insertTenant(tx: Client, suffix: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.tenant (razon_social, cuit) VALUES ('Test', $1) RETURNING id`, [
    `20-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
  ]);
  return result.rows[0].id as string;
}

export async function createSistemaUser(tx: Client, tenantId: string): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, es_tecnico, creado_por_id)
     VALUES ($1, $2, $3, 'Sistema', 'Tecnico', $4, 'ACTIVO', true, $1)`,
    [id, tenantId, `sistema+${id}@internal.local`, `SISTEMA-${id}`],
  );
  const sistemaRol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = 'SISTEMA'`);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
    tenantId,
    id,
    sistemaRol.rows[0].id,
  ]);
  return id;
}

export async function createUserWithRole(
  tx: Client,
  tenantId: string,
  rolCodigo: string,
  sistema: string,
  suffix: string,
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5)`,
    [id, tenantId, `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`, `DNI-${suffix}-${Date.now()}`, sistema],
  );
  const rol = await tx.query(`SELECT id FROM fsj.rol WHERE codigo = $1`, [rolCodigo]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    rol.rows[0].id,
    sistema,
  ]);
  return id;
}

export async function insertUnidad(tx: Client, suffix: string, tipoMagnitud = "MASA", factorABase = 1): Promise<string> {
  const codigo = `TEST-UM-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const result = await tx.query(
    `INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base)
     VALUES ($1, $1, 'x', $2, $3, false) RETURNING id`,
    [codigo, tipoMagnitud, factorABase],
  );
  return result.rows[0].id as string;
}

export async function insertDroga(tx: Client, tenantId: string, unidadId: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.droga (tenant_id, nombre, unidad_base_id) VALUES ($1, $2, $3) RETURNING id`, [
    tenantId,
    `Droga-${randomUUID()}`,
    unidadId,
  ]);
  return result.rows[0].id as string;
}

export async function insertMedico(tx: Client, tenantId: string): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.medico (tenant_id, nombre, apellido, matricula) VALUES ($1, 'Med', 'Ico', $2) RETURNING id`,
    [tenantId, `MAT-${randomUUID()}`],
  );
  return result.rows[0].id as string;
}

export async function insertPaciente(tx: Client, tenantId: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.paciente (tenant_id, nombre, apellido) VALUES ($1, 'Pac', 'Iente') RETURNING id`, [
    tenantId,
  ]);
  return result.rows[0].id as string;
}

export interface CrearRecetaInput {
  tenantId: string;
  pacienteId: string;
  medicoId: string;
  registradaPorId: string;
  origen?: string;
  archivoAdjuntoUrl?: string | null;
}

export async function insertReceta(tx: Client, input: CrearRecetaInput): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.receta (tenant_id, paciente_id, medico_id, fecha_prescripcion, origen, archivo_adjunto_url, registrada_por_id)
     VALUES ($1, $2, $3, current_date, $4, $5, $6) RETURNING id`,
    [
      input.tenantId,
      input.pacienteId,
      input.medicoId,
      input.origen ?? "PRESENCIAL",
      input.archivoAdjuntoUrl ?? null,
      input.registradaPorId,
    ],
  );
  return result.rows[0].id as string;
}

export interface CrearItemInput {
  tenantId: string;
  recetaId: string;
  formaFarmaceutica?: string;
  cantidadUnidades?: number;
  fraccionDosisPorUnidad?: number;
  cantidadTotal?: number | null;
  unidadTotalId?: string | null;
}

export async function insertItemReceta(tx: Client, input: CrearItemInput): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.item_receta (tenant_id, receta_id, forma_farmaceutica, cantidad_unidades, fraccion_dosis_por_unidad, cantidad_total, unidad_total_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.tenantId,
      input.recetaId,
      input.formaFarmaceutica ?? "CREMA",
      input.cantidadUnidades ?? 1,
      input.fraccionDosisPorUnidad ?? 1,
      input.cantidadTotal ?? null,
      input.unidadTotalId ?? null,
    ],
  );
  return result.rows[0].id as string;
}

export interface CrearComponenteInput {
  tenantId: string;
  itemRecetaId: string;
  drogaId: string;
  unidadMedidaId: string;
  modoExpresion?: string;
  cantidad?: number | null;
  orden?: number;
}

export async function insertComponente(tx: Client, input: CrearComponenteInput): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.componente_item_receta (tenant_id, item_receta_id, droga_id, cantidad, unidad_medida_id, modo_expresion, orden)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.tenantId,
      input.itemRecetaId,
      input.drogaId,
      input.cantidad ?? null,
      input.unidadMedidaId,
      input.modoExpresion ?? "CS",
      input.orden ?? 0,
    ],
  );
  return result.rows[0].id as string;
}

export interface CrearFichaInput {
  tenantId: string;
  itemRecetaId: string;
  generadaPorId: string;
  version?: number;
}

export async function insertFicha(tx: Client, input: CrearFichaInput): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.ficha_tecnica (tenant_id, item_receta_id, version, generada_por_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.tenantId, input.itemRecetaId, input.version ?? 1, input.generadaPorId],
  );
  return result.rows[0].id as string;
}

export interface CrearLineaInput {
  tenantId: string;
  fichaTecnicaId: string;
  drogaId: string;
  unidadMedidaId: string;
  drogaNombre?: string;
  cantidadTeorica?: number | null;
  cantidadAPesar?: number | null;
  esEnraseManual?: boolean;
  orden?: number;
}

export async function insertLinea(tx: Client, input: CrearLineaInput): Promise<string> {
  const manual = input.esEnraseManual ?? false;
  const result = await tx.query(
    `INSERT INTO fsj.linea_pesaje (tenant_id, ficha_tecnica_id, droga_id, droga_nombre, cantidad_teorica, cantidad_a_pesar, unidad_medida_id, es_enrase_manual, orden)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      input.tenantId,
      input.fichaTecnicaId,
      input.drogaId,
      input.drogaNombre ?? "Droga",
      manual ? null : (input.cantidadTeorica ?? 10),
      manual ? null : (input.cantidadAPesar ?? 10),
      input.unidadMedidaId,
      manual,
      input.orden ?? 0,
    ],
  );
  return result.rows[0].id as string;
}

/** Full chain: tenant/sistema/paciente/medico/receta/item/componente/ficha/linea, ready for a preparacion. */
export async function seedFichaCompleta(
  tx: Client,
  suffix: string,
): Promise<{
  tenantId: string;
  sistema: string;
  itemRecetaId: string;
  fichaTecnicaId: string;
}> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS", orden: 0 });
  const fichaTecnicaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
  await insertLinea(tx, { tenantId, fichaTecnicaId, drogaId, unidadMedidaId: unidadId });

  return { tenantId, sistema, itemRecetaId, fichaTecnicaId };
}

// ============================================================================
// Shared helpers for tests/db/libro-recetario.test.ts, contralor.test.ts,
// cierre-diario.test.ts, entrega-archivo.test.ts (migrations 0014-0016,
// FASE 1 points 1.12-1.14). Added alongside those files rather than
// duplicated locally in each, since the full "confirmed preparacion with
// its SISTEMA asiento" chain is long and reused by all of them.
// ============================================================================

export async function insertProveedor(tx: Client, tenantId: string): Promise<string> {
  const result = await tx.query(`INSERT INTO fsj.proveedor (tenant_id, razon_social, cuit) VALUES ($1, 'Prov', $2) RETURNING id`, [
    tenantId,
    `2${Math.floor(10000000000 + Math.random() * 8999999999)}`.slice(0, 11),
  ]);
  return result.rows[0].id as string;
}

export interface CrearPartidaInput {
  tenantId: string;
  drogaId: string;
  proveedorId: string;
  registradoPorId: string;
  cantidadInicial?: number;
  fechaVencimiento?: string;
  lote?: string;
  numeroValeAdquisicion?: string | null;
}

export async function crearPartidaConIngreso(tx: Client, input: CrearPartidaInput): Promise<string> {
  const partida = await tx.query(
    `INSERT INTO fsj.partida (tenant_id, droga_id, proveedor_id, lote, costo_unitario, cantidad_inicial, fecha_vencimiento)
     VALUES ($1, $2, $3, $4, 10, $5, $6) RETURNING id`,
    [
      input.tenantId,
      input.drogaId,
      input.proveedorId,
      input.lote ?? `LOTE-${randomUUID()}`,
      input.cantidadInicial ?? 100,
      input.fechaVencimiento ?? FUTURO,
    ],
  );
  const partidaId = partida.rows[0].id as string;
  await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, numero_vale_adquisicion, registrado_por_id)
     VALUES ($1, $2, 'INGRESO_COMPRA', $3, $4, $5)`,
    [input.tenantId, partidaId, input.cantidadInicial ?? 100, input.numeroValeAdquisicion ?? null, input.registradoPorId],
  );
  return partidaId;
}

/**
 * Creates the 3 libro_rubricado rows (RECETARIO, PSICOTROPICO,
 * ESTUPEFACIENTE) a tenant needs for asiento_recetario/asiento_contralor to
 * work at all -- mirrors scripts/create-tenant.ts. The official rubric
 * data (numero, fecha_rubrica, expediente_rubrica) is left NULL, exactly
 * like create-tenant.ts: it is issued by the health authority and must
 * never be invented (DP-38, migration 0018 B3). Tenants created directly via `insertTenant` (a raw INSERT, used
 * by nearly every DB test file) do NOT get these automatically -- only real
 * tenant provisioning (create-tenant.ts) or the migration 0014 backfill
 * does. Call this explicitly wherever a test needs the libro recetario or
 * contralor tables.
 */
export async function crearLibrosRubricados(tx: Client, tenantId: string, sistema: string): Promise<void> {
  await tx.query(
    `INSERT INTO fsj.libro_rubricado (tenant_id, tipo, registrado_por_id)
     VALUES
       ($1, 'RECETARIO', $2),
       ($1, 'PSICOTROPICO', $2),
       ($1, 'ESTUPEFACIENTE', $2)`,
    [tenantId, sistema],
  );
}

/** Designates `usuarioId` as TITULAR DT, vigente_desde in the far past (open-ended) so it covers any test date. */
export async function designarDt(
  tx: Client,
  tenantId: string,
  usuarioId: string,
  registradoPorId: string,
  vigenteDesde = "2000-01-01",
): Promise<{ designacionId: string; matricula: string }> {
  const matricula = `MAT-DT-${randomUUID()}`;
  const result = await tx.query(
    `INSERT INTO fsj.designacion_director_tecnico (tenant_id, usuario_id, caracter, matricula, vigente_desde, registrado_por_id)
     VALUES ($1, $2, 'TITULAR', $3, $4, $5) RETURNING id`,
    [tenantId, usuarioId, matricula, vigenteDesde, registradoPorId],
  );
  return { designacionId: result.rows[0].id as string, matricula };
}

export interface AsientoSistemaResult {
  tenantId: string;
  sistema: string;
  drogaId: string;
  unidadId: string;
  itemRecetaId: string;
  fichaTecnicaId: string;
  lineaPesajeId: string;
  preparacionId: string;
  partidaId: string;
  movimientoId: string;
  asientoId: string;
}

/**
 * Full chain ending in a CONFIRMADA preparacion with its matching SISTEMA
 * asiento_recetario (satisfying INV-P04 and the INV-S12 consumption sum),
 * ready to be anulled/rectified/linked to a cierre. `cantidadAPesar` is
 * both the linea_pesaje.cantidad_a_pesar AND the single EGRESO_PREPARACION
 * movement's cantidad, so INV-S12's SUM = cantidad_a_pesar holds exactly
 * (relevant only under `setConstraintsImmediate: true` -- deferred checks
 * never fire otherwise, since inRollbackTx always rolls back).
 */
export async function seedAsientoSistema(tx: Client, suffix: string, cantidadAPesar = 5): Promise<AsientoSistemaResult> {
  const tenantId = await insertTenant(tx, suffix);
  const sistema = await createSistemaUser(tx, tenantId);
  await crearLibrosRubricados(tx, tenantId, sistema);
  const unidadId = await insertUnidad(tx, suffix);
  const drogaId = await insertDroga(tx, tenantId, unidadId);
  const pacienteId = await insertPaciente(tx, tenantId);
  const medicoId = await insertMedico(tx, tenantId);
  const recetaId = await insertReceta(tx, { tenantId, pacienteId, medicoId, registradaPorId: sistema });
  const itemRecetaId = await insertItemReceta(tx, { tenantId, recetaId });
  await insertComponente(tx, {
    tenantId,
    itemRecetaId,
    drogaId,
    unidadMedidaId: unidadId,
    modoExpresion: "TOTAL",
    cantidad: cantidadAPesar,
  });
  const fichaTecnicaId = await insertFicha(tx, { tenantId, itemRecetaId, generadaPorId: sistema });
  const lineaPesajeId = await insertLinea(tx, {
    tenantId,
    fichaTecnicaId,
    drogaId,
    unidadMedidaId: unidadId,
    cantidadTeorica: cantidadAPesar,
    cantidadAPesar,
  });

  const proveedorId = await insertProveedor(tx, tenantId);
  const partidaId = await crearPartidaConIngreso(tx, {
    tenantId,
    drogaId,
    proveedorId,
    registradoPorId: sistema,
    cantidadInicial: 1000,
  });

  const preparacionResult = await tx.query(
    `INSERT INTO fsj.preparacion (tenant_id, ficha_tecnica_id, iniciada_por_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, fichaTecnicaId, sistema],
  );
  const preparacionId = preparacionResult.rows[0].id as string;

  const movimientoResult = await tx.query(
    `INSERT INTO fsj.movimiento_stock (tenant_id, partida_id, tipo, cantidad, preparacion_id, linea_pesaje_id, registrado_por_id)
     VALUES ($1, $2, 'EGRESO_PREPARACION', $3, $4, $5, $6) RETURNING id`,
    [tenantId, partidaId, cantidadAPesar, preparacionId, lineaPesajeId, sistema],
  );
  const movimientoId = movimientoResult.rows[0].id as string;

  const asientoResult = await tx.query(
    `INSERT INTO fsj.asiento_recetario (tenant_id, origen, preparacion_id, paciente_texto, medico_texto, formula_texto, registrado_por_id)
     VALUES ($1, 'SISTEMA', $2, 'Paciente Test', 'Medico Test - MAT-1', 'Formula de prueba', $3) RETURNING id`,
    [tenantId, preparacionId, sistema],
  );
  const asientoId = asientoResult.rows[0].id as string;

  await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
    sistema,
    preparacionId,
  ]);

  return {
    tenantId,
    sistema,
    drogaId,
    unidadId,
    itemRecetaId,
    fichaTecnicaId,
    lineaPesajeId,
    preparacionId,
    partidaId,
    movimientoId,
    asientoId,
  };
}
