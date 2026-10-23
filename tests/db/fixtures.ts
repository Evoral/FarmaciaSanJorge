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

/**
 * D4 (migration 0034, hash V3): a SISTEMA asiento_recetario requires at
 * least one detalle_asiento row ALREADY inserted under its own id
 * (INV-L22) -- and detalle_asiento can no longer be inserted once its
 * asiento exists (INV-L23). Every test that used to `INSERT INTO
 * fsj.asiento_recetario (...) VALUES (...)` for a SISTEMA row directly
 * must go through this helper instead: it pre-generates the asiento id,
 * inserts ONE detalle_asiento row against it, THEN inserts the asiento
 * itself with that id explicit (bypassing the `gen_random_uuid()` column
 * default) -- same order `modules/preparaciones/infrastructure/preparacion-repository.ts#insertAsientoRecetario`
 * now uses.
 *
 * D8 (migration 0082): every NEW SISTEMA asiento is por receta -- no
 * `preparacion_id`, `receta_id` set, and its preparaciones in
 * `fsj.asiento_preparacion`, inserted BEFORE it like the detalle (INV-L25).
 * This helper keeps its `preparacionId` input: it resolves that
 * preparación's receta and writes the asiento for the receta with that one
 * preparación (INV-L24: at most one SISTEMA asiento per receta -- a second
 * asiento needs a preparación of ANOTHER receta, see `insertItemAdicional`).
 */
export async function insertAsientoSistema(
  tx: Client,
  input: {
    tenantId: string;
    preparacionId: string;
    registradoPorId: string;
    lineaPesajeId?: string | null;
    descripcion?: string;
    cantidad?: number;
    unidadTexto?: string;
    pacienteTexto?: string;
    medicoTexto?: string;
    formulaTexto?: string;
    numeroCorrelativoForzado?: number;
  },
): Promise<{ id: string; numeroCorrelativo: string; libroId: string; hashIntegridad: string; hashAnterior: string; fechaAsiento: string }> {
  const asientoId = randomUUID();
  const recetaId = await recetaDePreparacion(tx, input.tenantId, input.preparacionId);

  await tx.query(`INSERT INTO fsj.asiento_preparacion (tenant_id, asiento_recetario_id, preparacion_id, orden) VALUES ($1, $2, $3, 1)`, [
    input.tenantId,
    asientoId,
    input.preparacionId,
  ]);
  await tx.query(
    `INSERT INTO fsj.detalle_asiento (tenant_id, asiento_recetario_id, linea_pesaje_id, descripcion, cantidad, unidad_texto, orden)
     VALUES ($1, $2, $3, $4, $5, $6, 1)`,
    [input.tenantId, asientoId, input.lineaPesajeId ?? null, input.descripcion ?? "Detalle de prueba", input.cantidad ?? 5, input.unidadTexto ?? "g"],
  );

  const cols = ["id", "tenant_id", "origen", "receta_id", "paciente_texto", "medico_texto", "formula_texto", "registrado_por_id"];
  const vals: unknown[] = [
    asientoId,
    input.tenantId,
    "SISTEMA",
    recetaId,
    input.pacienteTexto ?? "Paciente Test",
    input.medicoTexto ?? "Medico Test - MAT-1",
    input.formulaTexto ?? "Formula de prueba",
    input.registradoPorId,
  ];
  if (input.numeroCorrelativoForzado !== undefined) {
    cols.push("numero_correlativo");
    vals.push(input.numeroCorrelativoForzado);
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
  const result = await tx.query(
    `INSERT INTO fsj.asiento_recetario (${cols.join(", ")}) VALUES (${placeholders})
     RETURNING id, numero_correlativo, libro_id, hash_integridad, hash_anterior, fecha_asiento::text`,
    vals,
  );
  return {
    id: result.rows[0].id as string,
    numeroCorrelativo: String(result.rows[0].numero_correlativo),
    libroId: result.rows[0].libro_id as string,
    hashIntegridad: result.rows[0].hash_integridad as string,
    hashAnterior: result.rows[0].hash_anterior as string,
    fechaAsiento: result.rows[0].fecha_asiento as string,
  };
}

/** The receta of a preparación (preparacion -> item_receta -> receta). */
export async function recetaDePreparacion(tx: Client, tenantId: string, preparacionId: string): Promise<string> {
  const result = await tx.query(
    `SELECT ir.receta_id FROM fsj.preparacion p JOIN fsj.item_receta ir ON ir.tenant_id = p.tenant_id AND ir.id = p.item_receta_id
     WHERE p.tenant_id = $1 AND p.id = $2`,
    [tenantId, preparacionId],
  );
  return result.rows[0].receta_id as string;
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
  const sistemaRol = await tx.query(`SELECT id FROM fsj.rol WHERE tenant_id = $1 AND codigo = 'SISTEMA'`, [tenantId]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1, $2, $3, $2)`, [
    tenantId,
    id,
    sistemaRol.rows[0].id,
  ]);
  return id;
}

/**
 * `estado` defaults to `ACTIVO` -- NOT the schema's own DEFAULT
 * (`PENDIENTE_ACTIVACION`, migration 0002). Every existing caller of this
 * helper needs an ACTIVO user (it's what "a DIRECTOR_TECNICO who can act"
 * means for the AJUSTE/anulacion/cierre_diario_firmar tests that consume
 * it), and none of them was ever testing PENDIENTE_ACTIVACION/SUSPENDIDO/
 * BAJA behavior -- `estado` simply didn't matter before migration 0022
 * (FASE 3 point 3.9 finding M1) added ACTIVO-vigency checks (INV-DT-005,
 * fsj.es_dt_vigente, fsj.cierre_diario_firmar). Pass `estado` explicitly
 * (e.g. `"SUSPENDIDO"`) for a test that specifically needs a non-active
 * user -- see tests/db/designacion-dt.test.ts's INV-DT-005 tests.
 */
export async function createUserWithRole(
  tx: Client,
  tenantId: string,
  rolCodigo: string,
  sistema: string,
  suffix: string,
  estado: "PENDIENTE_ACTIVACION" | "ACTIVO" | "SUSPENDIDO" | "BAJA" = "ACTIVO",
): Promise<string> {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO fsj.usuario (id, tenant_id, email, nombre, apellido, dni, estado, creado_por_id) VALUES ($1,$2,$3,'N','A',$4,$5,$6)`,
    [id, tenantId, `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`, `DNI-${suffix}-${Date.now()}`, estado, sistema],
  );
  const rol = await tx.query(`SELECT id FROM fsj.rol WHERE tenant_id = $1 AND codigo = $2`, [tenantId, rolCodigo]);
  await tx.query(`INSERT INTO fsj.usuario_rol (tenant_id, usuario_id, rol_id, asignado_por_id) VALUES ($1,$2,$3,$4)`, [
    tenantId,
    id,
    rol.rows[0].id,
    sistema,
  ]);
  return id;
}

/** A fictitious repartidor (migration 0093) -- what every ENVIO entrega needs (INV-ENT-005). */
export async function insertRepartidor(tx: Client, tenantId: string, creadoPorId: string): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.repartidor (tenant_id, nombre, apellido, telefono, creado_por_id) VALUES ($1, 'Test', 'Repartidor', '000-0000', $2) RETURNING id`,
    [tenantId, creadoPorId],
  );
  return result.rows[0].id as string;
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

/**
 * Marks a receta paid (migration 0071). INV-R14 (migration 0076) rejects
 * moving an unpaid receta INTO ENTREGADA, so every test that delivers a
 * receta pays it first -- the same write order the app uses
 * (modules/entregas/application/registrar-entrega.ts).
 */
export async function marcarRecetaPagada(tx: Client, tenantId: string, recetaId: string, pagadaPorId: string): Promise<void> {
  await tx.query(
    `UPDATE fsj.receta SET pagada = true, pagada_en = now(), pagada_por_id = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, recetaId, pagadaPorId],
  );
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
  
}

export async function insertComponente(tx: Client, input: CrearComponenteInput): Promise<string> {
  const result = await tx.query(
    `INSERT INTO fsj.componente_item_receta (tenant_id, item_receta_id, droga_id, cantidad, unidad_medida_id, modo_expresion)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.tenantId,
      input.itemRecetaId,
      input.drogaId,
      input.cantidad ?? null,
      input.unidadMedidaId,
      input.modoExpresion ?? "CS",
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
  await insertComponente(tx, { tenantId, itemRecetaId, drogaId, unidadMedidaId: unidadId, modoExpresion: "CS" });
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
 * Creates one more item_receta (with a single componente) on a NEW receta of
 * the same paciente/médico as `seed.itemRecetaId`'s and returns its id. Tests
 * that need a second live preparacion/asiento in the same tenant cannot reuse
 * the seed's item: INV-P02 allows one non-DESCARTADA preparacion per
 * ficha_tecnica, and migration 0077 (spec reserva-stock-preparacion R19)
 * allows at most one live (INICIADA or CONFIRMADA) preparacion per
 * item_receta across ficha versions. A new receta (not the seed's) because
 * migration 0082 (D8) allows at most one SISTEMA asiento per receta (INV-L24).
 */
export async function insertItemAdicional(
  tx: Client,
  seed: Pick<AsientoSistemaResult, "tenantId" | "itemRecetaId" | "drogaId" | "unidadId">,
): Promise<string> {
  const recetaResult = await tx.query(
    `SELECT r.paciente_id, r.medico_id, r.registrada_por_id FROM fsj.item_receta ir JOIN fsj.receta r ON r.tenant_id = ir.tenant_id AND r.id = ir.receta_id
     WHERE ir.tenant_id = $1 AND ir.id = $2`,
    [seed.tenantId, seed.itemRecetaId],
  );
  const origen = recetaResult.rows[0];
  const recetaId = await insertReceta(tx, {
    tenantId: seed.tenantId,
    pacienteId: origen.paciente_id as string,
    medicoId: origen.medico_id as string,
    registradaPorId: origen.registrada_por_id as string,
  });
  const itemRecetaId = await insertItemReceta(tx, { tenantId: seed.tenantId, recetaId });
  await insertComponente(tx, {
    tenantId: seed.tenantId,
    itemRecetaId,
    drogaId: seed.drogaId,
    unidadMedidaId: seed.unidadId,
    modoExpresion: "CS",
  });
  return itemRecetaId;
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

  const asientoResult = await insertAsientoSistema(tx, {
    tenantId,
    preparacionId,
    registradoPorId: sistema,
    lineaPesajeId,
    cantidad: cantidadAPesar,
  });
  const asientoId = asientoResult.id;

  await tx.query(`UPDATE fsj.preparacion SET estado = 'CONFIRMADA', confirmada_en = now(), preparada_por_id = $1 WHERE id = $2`, [
    sistema,
    preparacionId,
  ]);

  // Migration 0101: fsj.cierre_diario_firmar only signs for the current tenant, as withTenantTransaction sets it.
  await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

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



