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
      unidadTotal: { select: { id: true, tipoMagnitud: true, factorABase: true } },
    },
  });
  if (!item) return null;

  return {
    id: item.id,
    recetaId: item.recetaId,
    formaFarmaceutica: item.formaFarmaceutica as FormaFarmaceutica,
    cantidadTotal: item.cantidadTotal ? item.cantidadTotal.toString() : null,
    unidadTotal: item.unidadTotal
      ? { id: item.unidadTotal.id, tipoMagnitud: item.unidadTotal.tipoMagnitud as TipoMagnitud, factorABase: item.unidadTotal.factorABase.toString() }
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
      unidadMedida: { select: { id: true, tipoMagnitud: true, factorABase: true } },
    },
  });

  return rows.map((r) => ({
    drogaId: r.drogaId,
    drogaNombre: r.droga.nombre,
    cantidad: r.cantidad ? r.cantidad.toString() : null,
    unidadMedida: { id: r.unidadMedida.id, tipoMagnitud: r.unidadMedida.tipoMagnitud as TipoMagnitud, factorABase: r.unidadMedida.factorABase.toString() },
    modoExpresion: r.modoExpresion as ModoExpresion,
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
// Read: an in-progress receta draft's references (docs/specs/presupuesto-receta.md)
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
    select: { id: true, tipoMagnitud: true, factorABase: true, fechaBaja: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      { ref: { id: r.id, tipoMagnitud: r.tipoMagnitud as TipoMagnitud, factorABase: r.factorABase.toString() }, vigente: r.fechaBaja === null },
    ]),
  );
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
 * `precision_balanza` / `exceso_pesada_porcentaje` (docs/specs/ficha-tecnica.md
 * "ParametrosPesaje"), per tenant (`fsj.parametro`, migration 0012 backfills
 * both for every existing tenant and `scripts/create-tenant.ts` seeds them
 * for new ones). Falls back to the spec's own defaults (0.001 / 0) if a row
 * is somehow missing, rather than hard-failing generation over a
 * configuration gap the spec already gives a default for.
 */
export async function getParametrosPesaje(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<{ precisionBalanza: string; excesoPesadaPorcentaje: string }> {
  const rows = await tx.parametro.findMany({
    where: { tenantId, clave: { in: ["precision_balanza", "exceso_pesada_porcentaje"] } },
    select: { clave: true, valor: true },
  });
  const porClave = new Map(rows.map((r) => [r.clave, r.valor]));
  return {
    precisionBalanza: porClave.get("precision_balanza") ?? "0.001",
    excesoPesadaPorcentaje: porClave.get("exceso_pesada_porcentaje") ?? "0",
  };
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
        select: { drogaId: true, cantidadTeorica: true, excesoAplicado: true, cantidadAPesar: true, unidadMedidaId: true, esEnraseManual: true },
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
          unidadMedida: { select: { simbolo: true } },
        },
      },
      itemReceta: {
        select: {
          descripcion: true,
          formaFarmaceutica: true,
          cantidadUnidades: true,
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
    })),
  };
}
