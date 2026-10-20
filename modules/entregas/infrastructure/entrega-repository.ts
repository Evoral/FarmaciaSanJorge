/**
 * Prisma-backed access to `fsj.entrega` + the `fsj.receta` reads/writes M14
 * (FASE 11) needs. Every function runs inside an ALREADY OPEN tenant
 * transaction. `modules/entregas` cannot import
 * `modules/recetas/infrastructure/**` (eslint's `appBoundaryPatterns`
 * forbids ANY `modules/**\/*.ts` from reaching into another module's
 * `infrastructure/` layer) -- so the receta reads/locks/estado-transition
 * helpers below are OWN COPIES, same "own copy per module" discipline
 * `modules/cierres/infrastructure/cierre-repository.ts` and
 * `modules/libro/infrastructure/receta-coupling-repository.ts` already
 * establish. The DB remains authoritative for every invariant duplicated
 * here (INV-R08, INV-ENT-001/002, migrations 0011/0016/0040).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoReceta } from "@/modules/recetas/domain/receta";
import { rangoDeJornadas } from "@/shared/time/jornada";
import { calcularItemsEntregables } from "../domain/entrega";
import type { ModalidadEntrega, ItemParaEntrega } from "../domain/entrega";

// ============================================================================
// jornada helper -- own copy (see module doc comment).
// ============================================================================

export async function jornadaActualTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ jornada: string }[]>`
    SELECT fsj.jornada_actual(${tenantId}::uuid)::text AS jornada
  `;
  if (!rows[0]) throw new Error(`jornadaActualTenant: no row for tenant ${tenantId}`);
  return rows[0].jornada;
}

// ============================================================================
// receta lock/read (own copy of modules/recetas/infrastructure/receta-repository.ts's
// lockRecetaParaAccion/getRecetaParaAccion, trimmed to what M14 needs).
// ============================================================================

/** Locks the target receta row (`SELECT ... FOR UPDATE`) BEFORE reading its state -- M3 discipline. `fsj.entrega` only has an UPDATE grant on firma_recibida/firma_recibida_en (migration 0016), so the receta row -- which fsj_app CAN lock -- is the right lock point, not the entrega row. */
export async function lockRecetaParaAccion(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.receta WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

export interface RecetaParaEntrega {
  id: string;
  estado: EstadoReceta;
  /** Migration 0071 -- whether the receta is already paid. ENTREGADA requires it (INV-R14, migration 0076); only an ENVIO may leave unpaid. */
  pagada: boolean;
  /** `receta.domicilio_paciente` (migration 0070): where an ENVIO goes (docs/specs/envios-repartidores.md E4). */
  domicilioPaciente: string | null;
}

export async function getRecetaParaEntrega(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<RecetaParaEntrega | null> {
  return tx.receta.findUnique({
    where: { id, tenantId },
    select: { id: true, estado: true, pagada: true, domicilioPaciente: true },
  }) as Promise<RecetaParaEntrega | null>;
}

// ============================================================================
// Repartidores (own copy of the reads entregas needs: modules/entregas cannot reach into
// modules/repartidores/infrastructure, see the module doc comment).
// ============================================================================

/** E3: the repartidor as the assignment rules need it; null when it does not exist in the tenant. */
export async function getRepartidorParaAsignar(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<{ id: string; activo: boolean } | null> {
  return tx.repartidor.findFirst({ where: { id, tenantId }, select: { id: true, activo: true } });
}

/** Whether the tenant has at least one active repartidor to offer for a new envío (the entrega modal's "No hay repartidores" notice). */
export async function hayRepartidoresActivos(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
  const row = await tx.repartidor.findFirst({ where: { tenantId, activo: true }, select: { id: true } });
  return row !== null;
}

export interface RepartidorDeEntrega {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
}

/** The repartidor currently assigned to an entrega (active or not: deactivating one keeps its envíos, E3). */
export async function getRepartidorDeEntrega(tx: Prisma.TransactionClient, tenantId: string, repartidorId: string): Promise<RepartidorDeEntrega | null> {
  return tx.repartidor.findFirst({ where: { id: repartidorId, tenantId }, select: { id: true, nombre: true, apellido: true, telefono: true } });
}

/** Raises the receta's payment flag (own copy of modules/recetas/infrastructure/receta-repository.ts's `setPagoDeReceta`, mark case only): `pagada_en` = now, `pagada_por_id` = the acting usuario, the three columns together (receta_pagada_check). */
export async function marcarRecetaPagada(tx: Prisma.TransactionClient, tenantId: string, id: string, usuarioId: string): Promise<void> {
  await tx.receta.update({ where: { id, tenantId }, data: { pagada: true, pagadaEn: new Date(), pagadaPorId: usuarioId } });
}

/**
 * docs/specs/envios-repartidores.md E4: writes ONLY `receta.domicilio_paciente` (own copy, narrow on purpose: an envío is
 * registered from PREPARADA, where the receta can no longer be edited, so a receta without domicilio gets it here). `fsj_app`
 * holds UPDATE on that column (migration 0070) and no trigger restricts it by estado.
 */
export async function actualizarDomicilioReceta(tx: Prisma.TransactionClient, tenantId: string, id: string, domicilio: string): Promise<void> {
  await tx.receta.update({ where: { id, tenantId }, data: { domicilioPaciente: domicilio } });
}

/** Clears the receta's payment flag, the three columns together (receta_pagada_check). Only for a receta that is no longer ENTREGADA (INV-R14). */
export async function desmarcarRecetaPagada(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<void> {
  await tx.receta.update({ where: { id, tenantId }, data: { pagada: false, pagadaEn: null, pagadaPorId: null } });
}

/** `anularEntrega`: whether the receta was already archived (INV-R08 refuses reverting it, migration 0086). */
export async function recetaEstaArchivada(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean> {
  const receta = await tx.receta.findUnique({ where: { id, tenantId }, select: { loteArchivoId: true } });
  return receta?.loteArchivoId != null;
}

export interface EntregaMovida {
  entregaId: string;
  modalidad: ModalidadEntrega;
}

/**
 * Migration 0086: copies the receta's entrega to `fsj.entrega_anulada` (with motivo and who) and deletes it, in this
 * order -- the DELETE guard (INV-ENT-004) only lets the row go once its copy exists. null when the receta has no entrega.
 * Migration 0093: the copy keeps the entrega's `repartidor_id` (docs/specs/envios-repartidores.md E6).
 */
export async function moverEntregaAAnuladas(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; recetaId: string; motivo: string; anuladaPorId: string },
): Promise<EntregaMovida | null> {
  const copiadas = await tx.$queryRaw<{ entrega_id: string; modalidad: ModalidadEntrega }[]>`
    INSERT INTO fsj.entrega_anulada
      (tenant_id, entrega_id, receta_id, modalidad, entregada_por_id, entregada_en, firma_recibida, firma_recibida_en, fecha_archivo_receta, repartidor_id, motivo, anulada_por_id)
    SELECT e.tenant_id, e.id, e.receta_id, e.modalidad, e.entregada_por_id, e.entregada_en, e.firma_recibida, e.firma_recibida_en, e.fecha_archivo_receta, e.repartidor_id,
           ${input.motivo}, ${input.anuladaPorId}::uuid
    FROM fsj.entrega e
    WHERE e.tenant_id = ${input.tenantId}::uuid AND e.receta_id = ${input.recetaId}::uuid
    RETURNING entrega_id, modalidad::text AS modalidad
  `;
  const copiada = copiadas[0];
  if (!copiada) return null;
  await tx.$executeRaw`DELETE FROM fsj.entrega WHERE tenant_id = ${input.tenantId}::uuid AND id = ${copiada.entrega_id}::uuid`;
  return { entregaId: copiada.entrega_id, modalidad: copiada.modalidad };
}

/** One batched query resolving every item's `estadoAsiento` for each of the given recetas -- same query as `modules/recetas/infrastructure/receta-repository.ts`'s private `getEstadoAsientoPorItem` (own copy, see module doc comment). */
export async function getItemsParaEntregaDeRecetas(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<Map<string, ItemParaEntrega[]>> {
  const porReceta = new Map<string, ItemParaEntrega[]>();
  if (recetaIds.length === 0) return porReceta;
  const rows = await tx.$queryRaw<{ receta_id: string; item_id: string; estado: "PENDIENTE" | "VIGENTE" | "SIN_EFECTO" }[]>`
    SELECT
      ir.receta_id,
      ir.id AS item_id,
      CASE
        WHEN a.id IS NULL THEN 'PENDIENTE'
        WHEN a.estado = 'ANULADO' OR EXISTS (
          SELECT 1 FROM fsj.asiento_recetario r WHERE r.tenant_id = a.tenant_id AND r.asiento_original_id = a.id
        ) THEN 'SIN_EFECTO'
        ELSE 'VIGENTE'
      END AS estado
    FROM fsj.item_receta ir
    LEFT JOIN fsj.preparacion p ON p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA'
    -- D8 (migration 0082): the SISTEMA asiento of the preparación, legacy per-ítem or por receta.
    LEFT JOIN fsj.v_asiento_sistema_preparacion v ON v.tenant_id = p.tenant_id AND v.preparacion_id = p.id
    LEFT JOIN fsj.asiento_recetario a ON a.tenant_id = v.tenant_id AND a.id = v.asiento_recetario_id
    WHERE ir.tenant_id = ${tenantId}::uuid AND ir.receta_id = ANY(${recetaIds}::uuid[])
  `;
  for (const r of rows) {
    const items = porReceta.get(r.receta_id) ?? [];
    items.push({ id: r.item_id, estadoAsiento: r.estado });
    porReceta.set(r.receta_id, items);
  }
  return porReceta;
}

/** Every item's `estadoAsiento` for one receta (`getItemsParaEntregaDeRecetas` with a single id). */
export async function getItemsParaEntrega(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<ItemParaEntrega[]> {
  return (await getItemsParaEntregaDeRecetas(tx, tenantId, [recetaId])).get(recetaId) ?? [];
}

/** A single receta.estado UPDATE (the state machine trigger, migration 0011/0061, validates the transition). `registrarEntrega` issues one, PREPARADA -> {ENTREGADA|ENVIADA_PEND_FIRMA}, after inserting the entrega row (INV-ENT-002, migration 0040). */
export async function actualizarEstadoReceta(tx: Prisma.TransactionClient, tenantId: string, id: string, estado: EstadoReceta): Promise<void> {
  await tx.receta.update({ where: { id, tenantId }, data: { estado } });
}

// ============================================================================
// 11.1/11.2: entrega row.
// ============================================================================

export interface NuevaEntregaInput {
  tenantId: string;
  recetaId: string;
  modalidad: ModalidadEntrega;
  entregadaPorId: string;
  /** Migration 0093: required for an ENVIO (INV-ENT-005), absent for a RETIRO_PRESENCIAL (CHECK). */
  repartidorId?: string | null;
}

/** INSERTs the entrega row -- must run BEFORE the receta's own estado UPDATE (migration 0040's INV-ENT-002 checks for this row's existence when estado becomes ENTREGADA). */
export async function insertEntrega(tx: Prisma.TransactionClient, input: NuevaEntregaInput): Promise<{ id: string }> {
  return tx.entrega.create({
    data: {
      tenantId: input.tenantId,
      recetaId: input.recetaId,
      modalidad: input.modalidad,
      entregadaPorId: input.entregadaPorId,
      repartidorId: input.repartidorId ?? null,
    },
    select: { id: true },
  });
}

/** `cambiarRepartidor` (E5): reassigns the envío. `fsj_app` may UPDATE `repartidor_id` (migration 0093); INV-ENT-005 refuses clearing it. */
export async function cambiarRepartidorDeEntrega(tx: Prisma.TransactionClient, tenantId: string, entregaId: string, repartidorId: string): Promise<void> {
  await tx.entrega.update({ where: { id: entregaId, tenantId }, data: { repartidorId } });
}

export interface EntregaRow {
  id: string;
  modalidad: ModalidadEntrega;
  entregadaEn: Date;
  firmaRecibida: boolean;
  firmaRecibidaEn: Date | null;
  /** Migration 0093: null for a retiro and for the envíos registered before it (E7). */
  repartidorId: string | null;
}

/**
 * `recetaId` is `@unique` (single-field, not a `(tenantId, recetaId)`
 * compound in the Prisma model -- see `prisma/schema.prisma`'s `Entrega`),
 * so this is a plain `findUnique` on it. Still tenant-safe: RLS
 * (`fsj.entrega`'s `tenant_isolation` policy, `fsj.setup_tenant_table`)
 * hides any row outside the transaction's `app.tenant_id`, and the
 * `tenantId` in the result is compared defensively below anyway.
 */
export async function getEntregaPorReceta(tx: Prisma.TransactionClient, tenantId: string, recetaId: string): Promise<EntregaRow | null> {
  const row = await tx.entrega.findUnique({
    where: { recetaId },
    select: { id: true, tenantId: true, modalidad: true, entregadaEn: true, firmaRecibida: true, firmaRecibidaEn: true, repartidorId: true },
  });
  if (!row || row.tenantId !== tenantId) return null;
  return {
    id: row.id,
    modalidad: row.modalidad,
    entregadaEn: row.entregadaEn,
    firmaRecibida: row.firmaRecibida,
    firmaRecibidaEn: row.firmaRecibidaEn,
    repartidorId: row.repartidorId,
  };
}

/**
 * 11.2 "Confirmar firma recibida" -- user decision 1: ONE atomic write,
 * entrega FIRST (so migration 0040's INV-ENT-002 sees firma_recibida=true
 * when the receta UPDATE right after it targets ENTREGADA), then the
 * receta's estado.
 */
export async function confirmarFirmaYEntregar(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: { recetaId: string; entregaId: string },
): Promise<void> {
  await tx.entrega.update({
    where: { id: input.entregaId, tenantId },
    data: { firmaRecibida: true, firmaRecibidaEn: new Date() },
  });

  await tx.receta.update({ where: { id: input.recetaId, tenantId }, data: { estado: "ENTREGADA" } });
}

// ============================================================================
// 11.1/11.2: /entregas listado (PREPARADA listas para entregar,
// ENVIADA_PEND_FIRMA esperando firma).
// ============================================================================

export interface EntregaPendienteItem {
  id: string;
  numeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  medicoNombre: string;
  medicoApellido: string;
  estado: EstadoReceta;
  fechaIngreso: Date;
  /** ENVIADA_PEND_FIRMA only: whole days since the envío (entrega.entregada_en); null otherwise. The /entregas notice. */
  diasEsperandoFirma: number | null;
  /** docs/specs/pago-receta.md: the counter sees whether it still has to charge. */
  pagada: boolean;
  /** Sum of each ítem's vigente cotización (INV-R06); null when nothing was cotizado or the viewer lacks `cotizaciones.ver`. */
  precio: string | null;
  /** Some ítem has no cotización, or a cotización is parcial/incompleta: the total is not the full price. */
  precioIncompleto: boolean;
}

export interface ListEntregasPendientesFilter {
  tenantId: string;
  search?: string;
  /** One of the listing's estados; omitted = both. */
  estado?: EstadoReceta;
  numeroInterno?: string;
  ingresoDesde?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  ingresoHasta?: string; // YYYY-MM-DD, jornada in the tenant's time zone (inclusive)
  page: number;
  pageSize: number;
  /** Read the price only for a viewer with `cotizaciones.ver` (the use case decides). */
  conPrecio: boolean;
}

interface PrecioReceta {
  precio: string | null;
  precioIncompleto: boolean;
}

/**
 * Per receta of the page: the sum of each ítem's vigente cotización (latest `calculada_en`, INV-R06), in ONE read.
 * Cross-module read of `fsj.cotizacion`, the same way `modules/pacientes` reads it for the presupuesto.
 */
async function preciosDeRecetas(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<Map<string, PrecioReceta>> {
  if (recetaIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ receta_id: string; items: number; cotizados: number; total: string | null; parcial: boolean | null }[]>`
    SELECT ir.receta_id,
           count(*)::int AS items,
           count(v.precio_final)::int AS cotizados,
           sum(v.precio_final)::text AS total,
           bool_or(v.es_parcial OR v.es_incompleta) AS parcial
    FROM fsj.item_receta ir
    LEFT JOIN LATERAL (
      SELECT c.precio_final, c.es_parcial, c.es_incompleta
      FROM fsj.cotizacion c
      WHERE c.tenant_id = ir.tenant_id AND c.item_receta_id = ir.id
      ORDER BY c.calculada_en DESC, c.id DESC
      LIMIT 1
    ) v ON true
    WHERE ir.tenant_id = ${tenantId}::uuid AND ir.receta_id = ANY(${recetaIds}::uuid[])
    GROUP BY ir.receta_id
  `;
  return new Map(
    rows.map((r) => [r.receta_id, { precio: r.cotizados > 0 ? r.total : null, precioIncompleto: r.cotizados < r.items || r.parcial === true }]),
  );
}

const ESTADOS_LISTADO_ENTREGAS: EstadoReceta[] = ["PREPARADA", "ENVIADA_PEND_FIRMA"];

/** Calendar days in the pharmacy's time zone, not UTC (fecha_ingreso is a timestamptz). */
async function rangoIngreso(tx: Prisma.TransactionClient, filter: ListEntregasPendientesFilter): Promise<Prisma.DateTimeFilter> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: filter.tenantId }, select: { zonaHoraria: true } });
  const { desde, hastaExclusivo } = rangoDeJornadas(filter.ingresoDesde, filter.ingresoHasta, tenant.zonaHoraria);
  return { ...(desde ? { gte: desde } : {}), ...(hastaExclusivo ? { lt: hastaExclusivo } : {}) };
}

export async function listEntregasPendientes(tx: Prisma.TransactionClient, filter: ListEntregasPendientesFilter): Promise<{ items: EntregaPendienteItem[]; total: number }> {
  const where: Prisma.RecetaWhereInput = {
    tenantId: filter.tenantId,
    estado: filter.estado ? filter.estado : { in: ESTADOS_LISTADO_ENTREGAS },
    ...(filter.numeroInterno && filter.numeroInterno.trim().length > 0
      ? { numeroInterno: BigInt(filter.numeroInterno.trim().replace(/[^0-9]/g, "") || "-1") }
      : {}),
    ...(filter.ingresoDesde || filter.ingresoHasta ? { fechaIngreso: await rangoIngreso(tx, filter) } : {}),
    ...(filter.search && filter.search.trim().length > 0
      ? {
          paciente: {
            OR: [
              { nombre: { contains: filter.search.trim(), mode: "insensitive" as const } },
              { apellido: { contains: filter.search.trim(), mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };
  const skip = (filter.page - 1) * filter.pageSize;

  const total = await tx.receta.count({ where });
  const rows = await tx.receta.findMany({
    where,
    orderBy: [{ fechaIngreso: "asc" }],
    skip,
    take: filter.pageSize,
    select: {
      id: true,
      numeroInterno: true,
      estado: true,
      fechaIngreso: true,
      pagada: true,
      paciente: { select: { nombre: true, apellido: true } },
      medico: { select: { nombre: true, apellido: true } },
      entrega: { select: { entregadaEn: true } },
    },
  });
  const ahora = Date.now();
  const precios = filter.conPrecio ? await preciosDeRecetas(tx, filter.tenantId, rows.map((r) => r.id)) : new Map<string, PrecioReceta>();

  return {
    items: rows.map((r) => ({
      id: r.id,
      numeroInterno: r.numeroInterno.toString(),
      pacienteNombre: r.paciente.nombre,
      pacienteApellido: r.paciente.apellido,
      medicoNombre: r.medico.nombre,
      medicoApellido: r.medico.apellido,
      estado: r.estado,
      fechaIngreso: r.fechaIngreso,
      diasEsperandoFirma:
        r.estado === "ENVIADA_PEND_FIRMA" && r.entrega ? Math.max(0, Math.floor((ahora - r.entrega.entregadaEn.getTime()) / 86_400_000)) : null,
      pagada: r.pagada,
      precio: precios.get(r.id)?.precio ?? null,
      precioIncompleto: precios.get(r.id)?.precioIncompleto ?? false,
    })),
    total,
  };
}

// ============================================================================
// Hoja de envíos de un repartidor (docs/specs/envios-repartidores.md E8-E10).
// ============================================================================

/** The tenant's zona horaria: turns "today" and a picked fecha de envío into a jornada (own copy, see module doc comment). */
export async function zonaHorariaTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  return tenant.zonaHoraria;
}

export interface FarmaciaParaHoja {
  nombre: string;
  telefonoFijo: string | null;
  telefonoCelular: string | null;
}

/** The farmacia's name (nombre de fantasía, else razón social) and phones: who the repartidor calls (own copy of the tenant read the comprobante and the etiqueta headers do). */
export async function getFarmaciaParaHoja(tx: Prisma.TransactionClient, tenantId: string): Promise<FarmaciaParaHoja> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { razonSocial: true, nombreFantasia: true, telefonoFijo: true, telefonoCelular: true },
  });
  return { nombre: tenant.nombreFantasia ?? tenant.razonSocial, telefonoFijo: tenant.telefonoFijo, telefonoCelular: tenant.telefonoCelular };
}

export interface EnvioDeRepartidor {
  recetaId: string;
  numeroInterno: string;
  entregadaEn: Date;
  pacienteApellido: string;
  pacienteNombre: string;
  pacienteDni: string | null;
  pacienteTelefono: string | null;
  /** `receta.domicilio_paciente` as it is now (not frozen at the envío). */
  domicilio: string | null;
  pagada: boolean;
  /** Ítems entregables (`calcularItemsEntregables`): the ones whose asiento is still VIGENTE; the excluded ones are not delivered. */
  itemsPreparados: number;
  /** Sum of each ítem's vigente cotización; null when nothing was cotizado or the price was not requested (`conPrecio` off). */
  precio: string | null;
  precioIncompleto: boolean;
}

export interface ListEnviosDeRepartidorFilter {
  tenantId: string;
  repartidorId: string;
  /** YYYY-MM-DD jornada in the tenant's time zone, filtering `entrega.entregada_en`; null = every pending envío of the repartidor. */
  fecha: string | null;
  /** Read the price only for a viewer with `cotizaciones.ver` (the use case decides, E10). */
  conPrecio: boolean;
}

/**
 * E8/E9: the envíos the repartidor carries that have not come back signed (receta ENVIADA_PEND_FIRMA), optionally of
 * one day. The day is the farmacia's calendar day, turned into an instant range with `rangoDeJornadas` exactly like the
 * other date filters of this module (`rangoIngreso`), never UTC midnight. Sorted by envío time, then Nº de receta.
 */
export async function listEnviosDeRepartidor(tx: Prisma.TransactionClient, filter: ListEnviosDeRepartidorFilter): Promise<EnvioDeRepartidor[]> {
  let entregadaEn: Prisma.DateTimeFilter | undefined;
  if (filter.fecha) {
    const { desde, hastaExclusivo } = rangoDeJornadas(filter.fecha, filter.fecha, await zonaHorariaTenant(tx, filter.tenantId));
    entregadaEn = { ...(desde ? { gte: desde } : {}), ...(hastaExclusivo ? { lt: hastaExclusivo } : {}) };
  }

  const rows = await tx.receta.findMany({
    where: {
      tenantId: filter.tenantId,
      estado: "ENVIADA_PEND_FIRMA",
      entrega: { is: { repartidorId: filter.repartidorId, ...(entregadaEn ? { entregadaEn } : {}) } },
    },
    orderBy: [{ entrega: { entregadaEn: "asc" } }, { numeroInterno: "asc" }],
    select: {
      id: true,
      numeroInterno: true,
      domicilioPaciente: true,
      pagada: true,
      paciente: { select: { apellido: true, nombre: true, dni: true, telefono: true } },
      entrega: { select: { entregadaEn: true } },
    },
  });

  const recetaIds = rows.map((r) => r.id);
  const itemsPorReceta = await getItemsParaEntregaDeRecetas(tx, filter.tenantId, recetaIds);
  const precios = filter.conPrecio ? await preciosDeRecetas(tx, filter.tenantId, recetaIds) : new Map<string, PrecioReceta>();

  return rows.flatMap((r) =>
    r.entrega
      ? [
          {
            recetaId: r.id,
            numeroInterno: r.numeroInterno.toString(),
            entregadaEn: r.entrega.entregadaEn,
            pacienteApellido: r.paciente.apellido,
            pacienteNombre: r.paciente.nombre,
            pacienteDni: r.paciente.dni,
            pacienteTelefono: r.paciente.telefono,
            domicilio: r.domicilioPaciente,
            pagada: r.pagada,
            itemsPreparados: calcularItemsEntregables(itemsPorReceta.get(r.id) ?? []).entregables.length,
            precio: precios.get(r.id)?.precio ?? null,
            precioIncompleto: precios.get(r.id)?.precioIncompleto ?? false,
          },
        ]
      : [],
  );
}
