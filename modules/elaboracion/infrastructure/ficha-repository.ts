/**
 * Prisma-backed access to `fsj.ficha_tecnica` / `fsj.linea_pesaje` for M10
 * (FASE 7 points 7.2/7.3). Every function runs inside an ALREADY OPEN
 * tenant transaction (`tx`), same convention as every other module's
 * repository (e.g. modules/recetas/infrastructure/receta-repository.ts).
 *
 * VERSIONING / LOCKING (7.2): `lockItemRecetaParaFicha` takes a
 * `SELECT ... FOR UPDATE` on the `item_receta` row BEFORE
 * `getMaxVersionFicha` reads the current max version. Two concurrent
 * `generarFichaTecnica` calls for the SAME item serialize on that lock: the
 * second transaction blocks until the first commits (or rolls back), then
 * sees the first one's new row in its own `MAX(version)` read -- this is
 * what prevents two simultaneous generations from both computing
 * `version = N+1` and colliding on `ficha_tecnica`'s
 * `UNIQUE (tenant_id, item_receta_id, version)` (migration 0012). Same
 * "lock the parent row to serialize a child sequence" pattern as
 * modules/usuarios/infrastructure/admin-guard.ts and every other
 * `lockXParaAccion` in this codebase.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { TipoMagnitud, UnidadMedidaRef, LineaPesajeCalculada, FormaFarmaceutica, ModoExpresion } from "../domain/calcular-ficha-tecnica";
import type { LineaPesajeGuardada } from "../domain/ficha-no-generable";
import {
  cantidadExcipienteAPesar,
  pesoDeDrogas,
  textoExcipientePorUnidad,
  unidadesDelItem,
  type ItemDosificable,
  type LineaConPeso,
} from "@/modules/preparaciones/domain/excipiente-por-unidad";

// ============================================================================
// Read: item_receta + componentes (calculator inputs)
// ============================================================================

export interface ItemParaFicha {
  id: string;
  recetaId: string;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadTotal: string | null;
  unidadTotal: UnidadMedidaRef | null;
  cantidadUnidades: number;
  fraccionDosisPorUnidad: string;
}

/**
 * Locks the `item_receta` row `FOR UPDATE` -- see this file's module doc
 * comment. MUST be called (and awaited) before `getMaxVersionFicha` in
 * `generarFichaTecnica`. Returns `false` when no row matches (wrong id or
 * wrong tenant, indistinguishable by design -- same as every other
 * `lockXParaAccion`).
 */
export async function lockItemRecetaParaFicha(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM fsj.item_receta WHERE id = ${itemRecetaId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

export async function getItemParaFicha(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<ItemParaFicha | null> {
  const item = await tx.itemReceta.findUnique({
    where: { id: itemRecetaId, tenantId },
    select: {
      id: true,
      recetaId: true,
      formaFarmaceutica: true,
      cantidadTotal: true,
      cantidadUnidades: true,
      fraccionDosisPorUnidad: true,
      unidadTotalId: true,
      unidadTotal: { select: { id: true, tipoMagnitud: true, factorABase: true, simbolo: true } },
    },
  });
  if (!item) return null;

  return {
    id: item.id,
    recetaId: item.recetaId,
    formaFarmaceutica: item.formaFarmaceutica as FormaFarmaceutica,
    cantidadTotal: item.cantidadTotal ? item.cantidadTotal.toString() : null,
    unidadTotal: item.unidadTotal
      ? unidadRef(item.unidadTotal)
      : null,
    cantidadUnidades: item.cantidadUnidades,
    fraccionDosisPorUnidad: item.fraccionDosisPorUnidad.toString(),
  };
}

export interface ComponenteParaFicha {
  drogaId: string;
  drogaNombre: string;
  cantidad: string | null;
  unidadMedida: UnidadMedidaRef;
  modoExpresion: ModoExpresion;
  unidadReferencia: UnidadMedidaRef | null;
}

/** The calculator's view of a unidad_medida row (símbolo included: a concentration line's text uses it). */
function unidadRef(u: { id: string; tipoMagnitud: string; factorABase: { toString(): string }; simbolo: string }): UnidadMedidaRef {
  return { id: u.id, tipoMagnitud: u.tipoMagnitud as TipoMagnitud, factorABase: u.factorABase.toString(), simbolo: u.simbolo };
}

/** The item's componentes, unordered -- `calcularFichaTecnica` sorts them (`ordenarComponentes`). */
export async function getComponentesParaFicha(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<ComponenteParaFicha[]> {
  const rows = await tx.componenteItemReceta.findMany({
    where: { tenantId, itemRecetaId },
    select: {
      drogaId: true,
      cantidad: true,
      modoExpresion: true,
      droga: { select: { nombre: true } },
      unidadMedida: { select: { id: true, tipoMagnitud: true, factorABase: true, simbolo: true } },
      unidadReferencia: { select: { id: true, tipoMagnitud: true, factorABase: true, simbolo: true } },
    },
  });

  return rows.map((r) => ({
    drogaId: r.drogaId,
    drogaNombre: r.droga.nombre,
    cantidad: r.cantidad ? r.cantidad.toString() : null,
    unidadMedida: unidadRef(r.unidadMedida),
    modoExpresion: r.modoExpresion as ModoExpresion,
    unidadReferencia: r.unidadReferencia ? unidadRef(r.unidadReferencia) : null,
  }));
}

/**
 * Resolves the BASE `UnidadMedidaRef` for every `TipoMagnitud` that has one
 * (`WHERE es_base` -- INV-M02 guarantees at most one per magnitud; a
 * magnitud with zero base units configured is simply absent from the
 * returned record, which `generarFichaTecnica` treats as a hard
 * configuration error if a componente/total actually needs it).
 */
/** A base unit, plus its símbolo (the cotización labels each costed line with it). */
export type UnidadBase = UnidadMedidaRef & { simbolo: string };

export async function getUnidadesBase(tx: Prisma.TransactionClient): Promise<Partial<Record<TipoMagnitud, UnidadBase>>> {
  const rows = await tx.unidadMedida.findMany({
    where: { esBase: true },
    select: { id: true, tipoMagnitud: true, factorABase: true, simbolo: true },
  });
  const result: Partial<Record<TipoMagnitud, UnidadBase>> = {};
  for (const r of rows) {
    result[r.tipoMagnitud as TipoMagnitud] = { id: r.id, tipoMagnitud: r.tipoMagnitud as TipoMagnitud, factorABase: r.factorABase.toString(), simbolo: r.simbolo };
  }
  return result;
}

// ============================================================================
// Read: an in-progress receta draft's references (openspec/specs/presupuesto-receta/spec.md)
// -- the same fields getItemParaFicha/getComponentesParaFicha read from saved
// rows, looked up by id for a formula that is not saved yet.
// ============================================================================

export interface UnidadParaBorrador {
  ref: UnidadMedidaRef;
  vigente: boolean;
}

/** GLOBAL unidad_medida catalog (DP-39) by id. */
export async function getUnidadesParaBorrador(tx: Prisma.TransactionClient, ids: readonly string[]): Promise<Map<string, UnidadParaBorrador>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.unidadMedida.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, tipoMagnitud: true, factorABase: true, simbolo: true, fechaBaja: true },
  });
  return new Map(rows.map((r) => [r.id, { ref: unidadRef(r), vigente: r.fechaBaja === null }]));
}

export async function getDrogasParaBorrador(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, { nombre: string; vigente: boolean }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.droga.findMany({ where: { tenantId, id: { in: [...new Set(ids)] } }, select: { id: true, nombre: true, fechaBaja: true } });
  return new Map(rows.map((r) => [r.id, { nombre: r.nombre, vigente: r.fechaBaja === null }]));
}

/**
 * `exceso_pesada_porcentaje` (openspec/specs/ficha-tecnica/spec.md
 * "ParametrosPesaje"), per tenant (`fsj.parametro`, migration 0012 backfills
 * it for every existing tenant and `scripts/create-tenant.ts` seeds it
 * for new ones). Falls back to the spec's own default (0) if the row
 * is somehow missing, rather than hard-failing generation over a
 * configuration gap the spec already gives a default for. `precision_balanza`
 * is not read here: the ficha does not round (R8), the pesada real does.
 */
export async function getParametrosPesaje(tx: Prisma.TransactionClient, tenantId: string): Promise<{ excesoPesadaPorcentaje: string }> {
  const row = await tx.parametro.findFirst({
    where: { tenantId, clave: "exceso_pesada_porcentaje" },
    select: { valor: true },
  });
  return { excesoPesadaPorcentaje: row?.valor ?? "0" };
}

// ============================================================================
// Version assignment + insert (7.2)
// ============================================================================

/** The lines of the item's LATEST ficha (highest version), or `null` when it has none -- to tell whether a regeneration would only duplicate it. */
export async function getLineasUltimaFicha(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemRecetaId: string,
): Promise<{ id: string; version: number; lineas: LineaPesajeGuardada[] } | null> {
  const ficha = await tx.fichaTecnica.findFirst({
    where: { tenantId, itemRecetaId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      lineas: {
        select: { drogaId: true, cantidadTeorica: true, excesoAplicado: true, cantidadAPesar: true, unidadMedidaId: true, esEnraseManual: true, prescripcion: true },
      },
    },
  });
  if (!ficha) return null;
  return {
    id: ficha.id,
    version: ficha.version,
    lineas: ficha.lineas.map((l) => ({
      drogaId: l.drogaId,
      cantidadTeorica: l.cantidadTeorica ? l.cantidadTeorica.toString() : null,
      excesoAplicado: l.excesoAplicado.toString(),
      cantidadAPesar: l.cantidadAPesar ? l.cantidadAPesar.toString() : null,
      unidadMedidaId: l.unidadMedidaId,
      esEnraseManual: l.esEnraseManual,
      prescripcion: l.prescripcion,
    })),
  };
}

/** `COALESCE(MAX(version), 0)` for the item -- `generarFichaTecnica` uses `+ 1`. MUST be called AFTER `lockItemRecetaParaFicha` in the same transaction (see module doc comment). */
export async function getMaxVersionFicha(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ max_version: number }[]>`
    SELECT COALESCE(MAX(version), 0)::int AS max_version
    FROM fsj.ficha_tecnica
    WHERE tenant_id = ${tenantId}::uuid AND item_receta_id = ${itemRecetaId}::uuid
  `;
  return rows[0]?.max_version ?? 0;
}

/**
 * The estado of the item's LIVE preparación (INICIADA or CONFIRMADA, any ficha version; at most one, migration 0077),
 * `null` when none: `generarFichaTecnica` refuses new versions while it lives (CONFIRMADA: the item is done;
 * INICIADA: its stock is reserved on the current version -- openspec/specs/reserva-stock-preparacion/spec.md R20). Read after
 * `lockItemRecetaParaFicha`: a reserva locks the same row before inserting its preparación, so the two serialize.
 */
export async function estadoPreparacionVivaDeItem(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<"INICIADA" | "CONFIRMADA" | null> {
  const viva = await tx.preparacion.findFirst({
    where: { tenantId, itemRecetaId, estado: { in: ["INICIADA", "CONFIRMADA"] } },
    orderBy: { estado: "desc" },
    select: { estado: true },
  });
  return viva ? (viva.estado === "CONFIRMADA" ? "CONFIRMADA" : "INICIADA") : null;
}

export interface NuevaFichaInput {
  tenantId: string;
  itemRecetaId: string;
  version: number;
  generadaPorId: string;
  lineas: LineaPesajeCalculada[];
}

/** INSERT `ficha_tecnica` + its `linea_pesaje` rows, in order -- both tables are fully insert-only (migration 0012: no UPDATE/DELETE grant at all), so there is nothing to roll back by hand if a later line fails other than letting the transaction abort. */
export async function insertFichaConLineas(tx: Prisma.TransactionClient, input: NuevaFichaInput): Promise<{ id: string; version: number }> {
  const ficha = await tx.fichaTecnica.create({
    data: {
      tenantId: input.tenantId,
      itemRecetaId: input.itemRecetaId,
      version: input.version,
      generadaPorId: input.generadaPorId,
    },
    select: { id: true, version: true },
  });

  for (const linea of input.lineas) {
    await tx.lineaPesaje.create({
      data: {
        tenantId: input.tenantId,
        fichaTecnicaId: ficha.id,
        drogaId: linea.drogaId,
        drogaNombre: linea.drogaNombre,
        cantidadTeorica: linea.cantidadTeorica ? linea.cantidadTeorica.toString() : null,
        excesoAplicado: linea.excesoAplicado.toString(),
        cantidadAPesar: linea.cantidadAPesar ? linea.cantidadAPesar.toString() : null,
        unidadMedidaId: linea.unidadMedida.id,
        esEnraseManual: linea.esEnraseManual,
        orden: linea.orden,
        prescripcion: linea.prescripcion ?? null,
      },
    });
  }

  return { id: ficha.id, version: ficha.version };
}

// ============================================================================
// Reads for the UI (list versions, ficha detail, PDF)
// ============================================================================

export interface FichaVersionListItem {
  id: string;
  version: number;
  generadaEn: Date;
  generadaPorNombre: string;
  cantidadLineas: number;
  /** The ficha's non-DESCARTADA preparación, if any (INV-P02: at most one). `null` means no preparación was ever started on this specific version. */
  preparacionActual: { id: string; estado: string } | null;
}

export async function listVersionesFicha(tx: Prisma.TransactionClient, tenantId: string, itemRecetaId: string): Promise<FichaVersionListItem[]> {
  const rows = await tx.fichaTecnica.findMany({
    where: { tenantId, itemRecetaId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      generadaEn: true,
      generadaPor: { select: { nombre: true, apellido: true } },
      _count: { select: { lineas: true } },
      preparaciones: {
        where: { estado: { not: "DESCARTADA" } },
        select: { id: true, estado: true },
        take: 1,
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    generadaEn: r.generadaEn,
    generadaPorNombre: `${r.generadaPor.apellido}, ${r.generadaPor.nombre}`,
    cantidadLineas: r._count.lineas,
    preparacionActual: r.preparaciones[0] ? { id: r.preparaciones[0].id, estado: r.preparaciones[0].estado } : null,
  }));
}

export interface LineaImprimir {
  drogaNombre: string;
  cantidadTeorica: string | null;
  excesoAplicado: string;
  cantidadAPesar: string | null;
  unidadSimbolo: string;
  esEnraseManual: boolean;
  orden: number;
  /** A concentration line's prescription and breakdown ("5 % × 30 mL", migration 0112). */
  prescripcion: string | null;
}

export interface FichaParaImprimir {
  id: string;
  version: number;
  generadaEn: Date;
  generadaPorNombre: string;
  itemDescripcion: string | null;
  formaFarmaceutica: string;
  cantidadUnidades: number;
  cantidadTotal: string | null;
  unidadTotalSimbolo: string | null;
  recetaNumeroInterno: string;
  pacienteNombre: string;
  pacienteApellido: string;
  medicoNombre: string;
  medicoApellido: string;
  medicoMatricula: string;
  tenantRazonSocial: string;
  tenantNombreFantasia: string | null;
  tenantCuit: string;
  tenantDomicilio: string | null;
  tenantMatriculaFarmacia: string | null;
  lineas: LineaImprimir[];
  /** The excipiente, then the material and the adicionales (insumos-preparacion), listed under the líneas. */
  insumos: InsumoImprimir[];
}

/** An excipiente or insumo row of the printed list; `cantidad` in the droga's unidad base, `null` when unknown. */
export interface InsumoImprimir {
  nombre: string;
  cantidad: string | null;
  unidadSimbolo: string;
  /** An excipiente typed per unidad (migration 0113): "= 0,3975 g por cápsula", under its total; `null` otherwise. */
  detalle: string | null;
}

/** `por_unidad`: the excipiente typed per unidad (0113) -- in one unit once stored, the weight typed in a draft -- NULL otherwise. */
type FilaInsumo = { nombre: string; cantidad: string | null; simbolo: string; por_unidad: string | null; factor_a_base: string; tipo_magnitud: string; es_excipiente: boolean };

/**
 * The ficha's excipiente and insumos: those of its live preparación once started (stored with it, the
 * ones reserved and descontados), else the drafts typed before starting (borradores without a droga skipped). A draft
 * excipiente is the weight typed minus the ficha's drogas (`lineas`), as the reserva will compute it.
 */
async function getInsumosParaImprimir(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fichaId: string,
  item: ItemDosificable,
  lineas: readonly LineaConPeso[],
): Promise<InsumoImprimir[]> {
  const preparacion = await tx.preparacion.findFirst({
    where: { tenantId, fichaTecnicaId: fichaId, estado: { in: ["INICIADA", "CONFIRMADA"] } },
    select: { id: true, excipienteDrogaId: true, excipienteTexto: true },
  });
  const filas = preparacion
    ? await tx.$queryRaw<FilaInsumo[]>`
        SELECT d.nombre::text AS nombre, x.cantidad::text AS cantidad, u.simbolo, x.por_unidad::text AS por_unidad,
               u.factor_a_base::text AS factor_a_base, u.tipo_magnitud::text AS tipo_magnitud, (x.grupo = 0) AS es_excipiente
        FROM (
          SELECT 0 AS grupo, 0 AS orden, p.excipiente_droga_id AS droga_id, p.excipiente_cantidad AS cantidad, p.excipiente_cantidad_por_unidad AS por_unidad
          FROM fsj.preparacion p
          WHERE p.tenant_id = ${tenantId}::uuid AND p.id = ${preparacion.id}::uuid AND p.excipiente_droga_id IS NOT NULL
          UNION ALL
          SELECT 1, i.orden, i.droga_id, i.cantidad, NULL
          FROM fsj.insumo_preparacion i
          WHERE i.tenant_id = ${tenantId}::uuid AND i.preparacion_id = ${preparacion.id}::uuid
        ) x
        JOIN fsj.droga d ON d.tenant_id = ${tenantId}::uuid AND d.id = x.droga_id
        JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
        ORDER BY x.grupo, x.orden
      `
    : await tx.$queryRaw<FilaInsumo[]>`
        SELECT d.nombre::text AS nombre, x.cantidad::text AS cantidad, u.simbolo, x.por_unidad::text AS por_unidad,
               u.factor_a_base::text AS factor_a_base, u.tipo_magnitud::text AS tipo_magnitud, (x.grupo = 0) AS es_excipiente
        FROM (
          SELECT 0 AS grupo, 0 AS orden, e.droga_id, e.cantidad, CASE WHEN e.por_unidad THEN e.cantidad END AS por_unidad
          FROM fsj.excipiente_borrador e
          WHERE e.tenant_id = ${tenantId}::uuid AND e.ficha_tecnica_id = ${fichaId}::uuid AND e.droga_id IS NOT NULL
          UNION ALL
          SELECT 1, i.orden, i.droga_id, i.cantidad, NULL
          FROM fsj.insumo_borrador i
          WHERE i.tenant_id = ${tenantId}::uuid AND i.ficha_tecnica_id = ${fichaId}::uuid AND i.droga_id IS NOT NULL
        ) x
        JOIN fsj.droga d ON d.tenant_id = ${tenantId}::uuid AND d.id = x.droga_id
        JOIN fsj.unidad_medida u ON u.id = d.unidad_base_id
        ORDER BY x.grupo, x.orden
      `;
  const unidades = unidadesDelItem(item);
  const insumos = filas.map((f): InsumoImprimir => {
    const fila = { nombre: f.nombre, cantidad: f.cantidad, unidadSimbolo: f.simbolo, detalle: null };
    if (!f.cantidad) return fila;
    // The preparación stores the excipiente to weigh (total and per unidad); a draft only the weight typed.
    if (preparacion) {
      if (!f.por_unidad || !unidades) return fila;
      return { ...fila, detalle: textoExcipientePorUnidad(f.por_unidad, f.simbolo, unidades.singular) };
    }
    if (!f.es_excipiente) return fila;
    if (f.por_unidad && !unidades) return fila;
    const aPesar = cantidadExcipienteAPesar({
      cantidad: f.cantidad,
      unidades: f.por_unidad ? unidades : null,
      pesoDrogas: pesoDeDrogas(lineas),
      unidad: { factorABase: f.factor_a_base, tipoMagnitud: f.tipo_magnitud },
    });
    // The drogas weigh as much as the weight typed: nothing to print until it is fixed in the toma.
    if (!aPesar.total.greaterThan(0)) return { ...fila, cantidad: null };
    return {
      ...fila,
      cantidad: aPesar.total.toString(),
      detalle: aPesar.porUnidad && unidades ? textoExcipientePorUnidad(aPesar.porUnidad, f.simbolo, unidades.singular) : null,
    };
  });
  // A preparación from before migration 0092 kept its excipiente as text only.
  if (preparacion && !preparacion.excipienteDrogaId && preparacion.excipienteTexto) {
    insumos.unshift({ nombre: preparacion.excipienteTexto, cantidad: null, unidadSimbolo: "", detalle: null });
  }
  return insumos;
}

export async function getFichaParaImprimir(tx: Prisma.TransactionClient, tenantId: string, fichaId: string): Promise<FichaParaImprimir | null> {
  const ficha = await tx.fichaTecnica.findUnique({
    where: { id: fichaId, tenantId },
    select: {
      id: true,
      version: true,
      generadaEn: true,
      generadaPor: { select: { nombre: true, apellido: true } },
      lineas: {
        orderBy: { orden: "asc" },
        select: {
          drogaNombre: true,
          cantidadTeorica: true,
          excesoAplicado: true,
          cantidadAPesar: true,
          orden: true,
          esEnraseManual: true,
          prescripcion: true,
          unidadMedida: { select: { simbolo: true, factorABase: true, tipoMagnitud: true } },
        },
      },
      itemReceta: {
        select: {
          descripcion: true,
          formaFarmaceutica: true,
          cantidadUnidades: true,
          fraccionDosisPorUnidad: true,
          cantidadTotal: true,
          unidadTotal: { select: { simbolo: true } },
          receta: {
            select: {
              numeroInterno: true,
              paciente: { select: { nombre: true, apellido: true } },
              medico: { select: { nombre: true, apellido: true, matricula: true } },
            },
          },
        },
      },
    },
  });
  if (!ficha) return null;

  // fsj.receta has no direct Prisma relation to fsj.tenant (tenant_id is
  // enforced by RLS/composite FKs, not a Tenant-side back-relation) -- the
  // caller already knows tenantId (the SAME tenant the `findUnique` above
  // scoped to, via RLS + the explicit filter), so this is one extra
  // lookup by id, not a second tenant-scoping decision.
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { razonSocial: true, nombreFantasia: true, cuit: true, domicilio: true, matriculaFarmacia: true },
  });

  const receta = ficha.itemReceta.receta;

  return {
    id: ficha.id,
    version: ficha.version,
    generadaEn: ficha.generadaEn,
    generadaPorNombre: `${ficha.generadaPor.apellido}, ${ficha.generadaPor.nombre}`,
    itemDescripcion: ficha.itemReceta.descripcion,
    formaFarmaceutica: ficha.itemReceta.formaFarmaceutica,
    cantidadUnidades: ficha.itemReceta.cantidadUnidades,
    cantidadTotal: ficha.itemReceta.cantidadTotal ? ficha.itemReceta.cantidadTotal.toString() : null,
    unidadTotalSimbolo: ficha.itemReceta.unidadTotal?.simbolo ?? null,
    recetaNumeroInterno: receta.numeroInterno.toString(),
    pacienteNombre: receta.paciente.nombre,
    pacienteApellido: receta.paciente.apellido,
    medicoNombre: receta.medico.nombre,
    medicoApellido: receta.medico.apellido,
    medicoMatricula: receta.medico.matricula,
    tenantRazonSocial: tenant.razonSocial,
    tenantNombreFantasia: tenant.nombreFantasia,
    tenantCuit: tenant.cuit,
    tenantDomicilio: tenant.domicilio,
    tenantMatriculaFarmacia: tenant.matriculaFarmacia,
    lineas: ficha.lineas.map((l) => ({
      drogaNombre: l.drogaNombre,
      cantidadTeorica: l.cantidadTeorica ? l.cantidadTeorica.toString() : null,
      excesoAplicado: l.excesoAplicado.toString(),
      cantidadAPesar: l.cantidadAPesar ? l.cantidadAPesar.toString() : null,
      unidadSimbolo: l.unidadMedida.simbolo,
      esEnraseManual: l.esEnraseManual,
      orden: l.orden,
      prescripcion: l.prescripcion,
    })),
    insumos: await getInsumosParaImprimir(tx, tenantId, ficha.id, {
      formaFarmaceutica: ficha.itemReceta.formaFarmaceutica,
      cantidadUnidades: ficha.itemReceta.cantidadUnidades,
      fraccionDosisPorUnidad: ficha.itemReceta.fraccionDosisPorUnidad.toString(),
    }, ficha.lineas.map((l) => ({
      cantidadAPesar: l.cantidadAPesar ? l.cantidadAPesar.toString() : null,
      esEnraseManual: l.esEnraseManual,
      unidad: { factorABase: l.unidadMedida.factorABase.toString(), tipoMagnitud: l.unidadMedida.tipoMagnitud },
    }))),
  };
}

/**
 * Carries the toma workspace's drafts of the item's previous ficha version over to the new one, so editing the
 * receta forgets nothing that was being prepared (the drafts are keyed by ficha / línea, and a new version has new
 * ids). Runs in `generarFichaTecnica`'s transaction, which only creates a version while the item has no live
 * preparación, i.e. while these drafts are all there is.
 *   - excipiente (0092/0113) and material / insumos adicionales (0110): copied as typed. An excipiente typed per
 *     unidad keeps its weight only while the forma is still counted by units (`porUnidadValido`): one unit's weight
 *     would otherwise read as the preparado's.
 *   - pesada en borrador (0090), matched línea by línea by droga (the n-th línea of a droga to the n-th): the lots
 *     and the motivo always; the pesada real only when the amount to weigh is unchanged (else it weighed something
 *     else); the enrase manual quantity only while both líneas are enrase manual.
 * Drafts already present on the new version (none: it was just inserted) are left alone.
 */
export async function trasladarBorradoresDeFicha(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; fichaNuevaId: string; porUnidadValido: boolean },
): Promise<void> {
  const { tenantId, fichaNuevaId } = input;
  const anterior = await tx.$queryRaw<{ id: string }[]>`
    SELECT a.id
    FROM fsj.ficha_tecnica n
    JOIN fsj.ficha_tecnica a ON a.tenant_id = n.tenant_id AND a.item_receta_id = n.item_receta_id AND a.version < n.version
    WHERE n.tenant_id = ${tenantId}::uuid AND n.id = ${fichaNuevaId}::uuid
    ORDER BY a.version DESC
    LIMIT 1
  `;
  const fichaAnteriorId = anterior[0]?.id;
  if (!fichaAnteriorId) return;

  await tx.$executeRaw`
    INSERT INTO fsj.excipiente_borrador (tenant_id, ficha_tecnica_id, droga_id, cantidad, por_unidad, actualizado_por_id, actualizado_en)
    SELECT e.tenant_id, ${fichaNuevaId}::uuid, e.droga_id,
      CASE WHEN e.por_unidad AND NOT ${input.porUnidadValido} THEN NULL ELSE e.cantidad END,
      e.por_unidad AND ${input.porUnidadValido},
      e.actualizado_por_id, e.actualizado_en
    FROM fsj.excipiente_borrador e
    WHERE e.tenant_id = ${tenantId}::uuid AND e.ficha_tecnica_id = ${fichaAnteriorId}::uuid
    ON CONFLICT DO NOTHING
  `;
  await tx.$executeRaw`
    INSERT INTO fsj.insumo_borrador (tenant_id, ficha_tecnica_id, tipo, orden, droga_id, cantidad, actualizado_por_id, actualizado_en)
    SELECT i.tenant_id, ${fichaNuevaId}::uuid, i.tipo, i.orden, i.droga_id, i.cantidad, i.actualizado_por_id, i.actualizado_en
    FROM fsj.insumo_borrador i
    WHERE i.tenant_id = ${tenantId}::uuid AND i.ficha_tecnica_id = ${fichaAnteriorId}::uuid
    ON CONFLICT DO NOTHING
  `;
  await tx.$executeRaw`
    WITH viejas AS (
      SELECT l.id, l.droga_id, l.cantidad_a_pesar, l.unidad_medida_id, l.es_enrase_manual,
        row_number() OVER (PARTITION BY l.droga_id ORDER BY l.orden) AS n
      FROM fsj.linea_pesaje l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.ficha_tecnica_id = ${fichaAnteriorId}::uuid
    ), nuevas AS (
      SELECT l.id, l.droga_id, l.cantidad_a_pesar, l.unidad_medida_id, l.es_enrase_manual,
        row_number() OVER (PARTITION BY l.droga_id ORDER BY l.orden) AS n
      FROM fsj.linea_pesaje l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.ficha_tecnica_id = ${fichaNuevaId}::uuid
    )
    INSERT INTO fsj.pesada_borrador (tenant_id, linea_pesaje_id, partida_ids, cantidad_real, cantidad_manual, motivo_apertura_adicional, actualizado_por_id, actualizado_en)
    SELECT b.tenant_id, nu.id, b.partida_ids,
      CASE WHEN NOT nu.es_enrase_manual AND NOT v.es_enrase_manual AND nu.unidad_medida_id = v.unidad_medida_id
             AND nu.cantidad_a_pesar = v.cantidad_a_pesar THEN b.cantidad_real END,
      CASE WHEN nu.es_enrase_manual AND v.es_enrase_manual THEN b.cantidad_manual END,
      b.motivo_apertura_adicional, b.actualizado_por_id, b.actualizado_en
    FROM fsj.pesada_borrador b
    JOIN viejas v ON v.id = b.linea_pesaje_id
    JOIN nuevas nu ON nu.droga_id = v.droga_id AND nu.n = v.n
    WHERE b.tenant_id = ${tenantId}::uuid
    ON CONFLICT DO NOTHING
  `;
}
