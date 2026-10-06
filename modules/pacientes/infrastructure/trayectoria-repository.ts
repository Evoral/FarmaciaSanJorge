/**
 * Prisma-backed reads for the paciente "Trayectoria" view
 * (docs/specs/trayectoria-paciente.md). HEALTH-ADJACENT DATA (DP-24, Ley
 * 25.326) -- every function runs inside an ALREADY OPEN tenant transaction
 * (RLS-scoped), filters by `tenantId` explicitly as well (raw SQL included),
 * and NONE of them ever passes a paciente field to a logger.
 *
 * Read pattern (no N+1, whatever the page size):
 *   1. the paciente (header fields only -- not the contact data of
 *      `getPacienteParaAccion`),
 *   2. ONE grouped aggregate over ALL the paciente's recetas (counters),
 *   3. ONE query for the requested page of recetas (newest first),
 *   4. one `IN (...)` query per block over the page's ids.
 * The optional blocks (`presupuesto`, `preparacion`, `libro`, `archivo`) are
 * queried ONLY when the caller says the session may see them -- they are not
 * fetched and then hidden. Queries run sequentially: they share one
 * interactive transaction (one connection), so there is nothing to gain from
 * issuing them concurrently.
 *
 * Cross-module reads (`fsj.cotizacion`, `fsj.preparacion`,
 * `fsj.asiento_recetario`, `fsj.entrega`, `fsj.lote_archivo_recetas`) go
 * against the shared schema, same convention as
 * `modules/recetas/infrastructure/receta-repository.ts`. The libro is
 * reached ONLY through preparacion -> SISTEMA asiento (+ its rectificativo
 * via `asientoOriginalId`) -- never by `pacienteTexto`, which is free text.
 */
import type { Prisma } from "@/generated/prisma/client";
import { ordenarComponentes } from "@/modules/elaboracion/domain/orden-componentes";
import { calcularPaginacion } from "../domain/trayectoria";
import type {
  AccesoTrayectoria,
  AsientoCrudo,
  CotizacionCruda,
  EntregaCruda,
  GrupoRecetasCrudo,
  ItemCrudo,
  LoteCrudo,
  PreparacionCruda,
  RecetaCruda,
  TrayectoriaCruda,
} from "../domain/trayectoria";

/** Which optional blocks to read: the subset of `AccesoTrayectoria` that is about data (not links). */
export type BloquesTrayectoria = Pick<AccesoTrayectoria, "presupuesto" | "preparacion" | "libro" | "archivo">;

async function groupRecetasDelPaciente(tx: Prisma.TransactionClient, tenantId: string, pacienteId: string): Promise<GrupoRecetasCrudo[]> {
  const rows = await tx.receta.groupBy({
    by: ["estado"],
    where: { tenantId, pacienteId },
    _count: { _all: true },
    _max: { fechaIngreso: true },
  });
  return rows.map((r) => ({
    estado: r.estado,
    cantidad: r._count._all,
    ultimaIngreso: r._max.fechaIngreso,
  }));
}

async function readRecetasPagina(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pacienteId: string,
  page: number,
  pageSize: number,
): Promise<RecetaCruda[]> {
  const rows = await tx.receta.findMany({
    where: { tenantId, pacienteId },
    // `id` as tie-break keeps pages stable when two recetas share a fechaIngreso.
    orderBy: [{ fechaIngreso: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      numeroInterno: true,
      fechaIngreso: true,
      fechaPrescripcion: true,
      origen: true,
      estado: true,
      motivoAnulacion: true,
      loteArchivoId: true,
      medico: { select: { nombre: true, apellido: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    numeroInterno: r.numeroInterno.toString(),
    fechaIngreso: r.fechaIngreso,
    fechaPrescripcion: r.fechaPrescripcion,
    medicoNombre: r.medico.nombre,
    medicoApellido: r.medico.apellido,
    origen: r.origen,
    estado: r.estado,
    motivoAnulacion: r.motivoAnulacion,
    loteArchivoId: r.loteArchivoId,
  }));
}

async function readItems(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<ItemCrudo[]> {
  const rows = await tx.itemReceta.findMany({
    where: { tenantId, recetaId: { in: recetaIds } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      recetaId: true,
      descripcion: true,
      formaFarmaceutica: true,
      cantidadUnidades: true,
      componentes: { select: { modoExpresion: true, droga: { select: { nombre: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    recetaId: r.recetaId,
    descripcion: r.descripcion,
    formaFarmaceutica: r.formaFarmaceutica,
    cantidadUnidades: r.cantidadUnidades,
    drogas: ordenarComponentes(r.componentes.map((c) => ({ modoExpresion: c.modoExpresion, drogaNombre: c.droga.nombre }))).map((c) => c.drogaNombre),
  }));
}

/** INV-R06: the vigente cotización is the latest per item. `DISTINCT ON` over `cotizacion_item_receta_calculada_idx` returns ONE row per item and skips the heavy `detalle` json. */
async function readCotizacionesVigentes(tx: Prisma.TransactionClient, tenantId: string, itemIds: string[]): Promise<CotizacionCruda[]> {
  const rows = await tx.$queryRaw<{ item_receta_id: string; precio_final: string; es_parcial: boolean; es_incompleta: boolean; calculada_en: Date }[]>`
    SELECT DISTINCT ON (c.item_receta_id)
      c.item_receta_id, c.precio_final::text AS precio_final, c.es_parcial, c.es_incompleta, c.calculada_en
    FROM fsj.cotizacion c
    WHERE c.tenant_id = ${tenantId}::uuid AND c.item_receta_id = ANY(${itemIds}::uuid[])
    ORDER BY c.item_receta_id, c.calculada_en DESC, c.id DESC
  `;
  return rows.map((r) => ({
    itemRecetaId: r.item_receta_id,
    precioFinal: r.precio_final,
    esParcial: r.es_parcial,
    esIncompleta: r.es_incompleta,
    calculadaEn: r.calculada_en,
  }));
}

async function readPreparaciones(tx: Prisma.TransactionClient, tenantId: string, itemIds: string[]): Promise<PreparacionCruda[]> {
  // `preparacion.item_receta_id` is a scalar without a Prisma relation (migration 0013): plain IN on it.
  const rows = await tx.preparacion.findMany({
    where: { tenantId, itemRecetaId: { in: itemIds } },
    orderBy: [{ iniciadaEn: "asc" }, { id: "asc" }],
    select: { id: true, itemRecetaId: true, estado: true, iniciadaEn: true, confirmadaEn: true, descartadaEn: true, motivoDescarte: true },
  });
  return rows;
}

/** The SISTEMA asiento of each item's preparación + the facts the libro's visual-state rule needs. Filtering on `origen` lets the planner use the partial unique indexes of migration 0014. */
async function readAsientos(tx: Prisma.TransactionClient, tenantId: string, itemIds: string[]): Promise<AsientoCrudo[]> {
  const rows = await tx.asientoRecetario.findMany({
    where: { tenantId, origen: "SISTEMA", preparacion: { is: { tenantId, itemRecetaId: { in: itemIds } } } },
    orderBy: [{ fechaAsiento: "asc" }, { id: "asc" }],
    select: {
      id: true,
      numeroCorrelativo: true,
      fechaAsiento: true,
      estado: true,
      preparacion: { select: { itemRecetaId: true } },
      anulacion: { select: { motivo: true, anuladoEn: true } },
      rectificativos: { where: { tenantId, origen: "RECTIFICATIVO" }, select: { numeroCorrelativo: true }, orderBy: { numeroCorrelativo: "asc" }, take: 1 },
    },
  });
  const asientos: AsientoCrudo[] = [];
  for (const r of rows) {
    if (!r.preparacion) continue;
    asientos.push({
      id: r.id,
      itemRecetaId: r.preparacion.itemRecetaId,
      numeroCorrelativo: r.numeroCorrelativo.toString(),
      fechaAsiento: r.fechaAsiento,
      estado: r.estado,
      anulacion: r.anulacion,
      rectificativoNumeroCorrelativo: r.rectificativos[0] ? r.rectificativos[0].numeroCorrelativo.toString() : null,
    });
  }
  return asientos;
}

async function readEntregas(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<EntregaCruda[]> {
  return tx.entrega.findMany({
    where: { tenantId, recetaId: { in: recetaIds } },
    select: { recetaId: true, modalidad: true, entregadaEn: true, firmaRecibida: true, firmaRecibidaEn: true },
  });
}

async function readLotes(tx: Prisma.TransactionClient, tenantId: string, loteIds: string[]): Promise<LoteCrudo[]> {
  if (loteIds.length === 0) return [];
  const rows = await tx.loteArchivoRecetas.findMany({ where: { tenantId, id: { in: loteIds } }, select: { id: true, numero: true, estado: true } });
  return rows.map((r) => ({ id: r.id, numero: r.numero.toString(), estado: r.estado }));
}

/**
 * The raw Trayectoria of one paciente: header, counters, one page of recetas
 * and the requested blocks. `null` when the paciente does not exist in the
 * tenant. `page` is clamped to the last page.
 */
export async function getTrayectoriaCruda(
  tx: Prisma.TransactionClient,
  tenantId: string,
  pacienteId: string,
  page: number,
  pageSize: number,
  bloques: BloquesTrayectoria,
): Promise<TrayectoriaCruda | null> {
  const paciente = await tx.paciente.findUnique({
    where: { id: pacienteId, tenantId },
    select: { id: true, nombre: true, apellido: true, dni: true, nroCredencial: true, fechaBaja: true, motivoBaja: true },
  });
  if (!paciente) return null;

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  const grupos = await groupRecetasDelPaciente(tx, tenantId, pacienteId);
  const total = grupos.reduce((suma, g) => suma + g.cantidad, 0);
  const paginacion = calcularPaginacion(total, page, pageSize);

  const recetas = total === 0 ? [] : await readRecetasPagina(tx, tenantId, pacienteId, paginacion.page, pageSize);
  const recetaIds = recetas.map((r) => r.id);
  const items = recetaIds.length === 0 ? [] : await readItems(tx, tenantId, recetaIds);
  const itemIds = items.map((i) => i.id);

  const cotizaciones = bloques.presupuesto && itemIds.length > 0 ? await readCotizacionesVigentes(tx, tenantId, itemIds) : [];
  const preparaciones = bloques.preparacion && itemIds.length > 0 ? await readPreparaciones(tx, tenantId, itemIds) : [];
  const asientos = bloques.libro && itemIds.length > 0 ? await readAsientos(tx, tenantId, itemIds) : [];
  // Entrega is part of the base permiso (`pacientes.gestionar`): always read.
  const entregas = recetaIds.length > 0 ? await readEntregas(tx, tenantId, recetaIds) : [];
  const loteIds = [...new Set(recetas.flatMap((r) => (r.loteArchivoId ? [r.loteArchivoId] : [])))];
  const lotes = bloques.archivo ? await readLotes(tx, tenantId, loteIds) : [];

  return { paciente, grupos, recetas, page: paginacion.page, zonaHoraria: tenant.zonaHoraria, items, cotizaciones, preparaciones, asientos, entregas, lotes };
}
