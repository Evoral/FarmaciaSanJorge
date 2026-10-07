# Historial de la droga — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only "Historial" tab on `/catalogos/drogas/[id]` listing every receta that consumed the droga (one expandable row per receta, with the partida(s) it came from). It has a pagination bar and an optional multi-partida filter, and is aimed at lot-recall questions ("lote X was bad, which recetas got it?").

**Architecture:** Modular monolith, sibling of the proveedor "Trayectoria" feature, using the same layering.
- `domain/historial.ts` is pure: types, `parsearPartidaIds`, option helpers, labels, pagination, assembly.
- `infrastructure/historial-repository.ts` runs raw SQL on schema `fsj` inside an already-open tenant `tx`, with `tenant_id` on every `FROM`/`JOIN` and explicit columns.
- `application/get-historial-droga.ts` is a `defineQuery` that decides the optional pieces with `can()`.
- `ui/historial-*.tsx` hold row cells, expanded detail, filter and header.
- `app/(app)/catalogos/drogas/[id]/{layout,historial/page}.tsx` and `droga-tabs.tsx` are the routes.

**Tech Stack:** Next.js 16.3 (non-standard, read `AGENTS.md`), React 19 server components, Prisma 7 (`$queryRaw` tagged templates, Postgres schema `fsj`), zod 4 (`z.locales.es()`), Vitest 5 (project `unit`), ESLint boundaries.

**Spec:** `docs/specs/historial-droga.md` (approved 2026-10-07). Sibling reference: `docs/specs/trayectoria-proveedor.md`.

---

## Global constraints

Copied and adapted from the spec. Every task must respect them.

1. **Gating.** The use case is a `defineQuery` on the receta-read permiso. Optional pieces are decided with `can()` inside the use case, never by calling other `defineQuery`s (a denial writes an `ACCESO_DENEGADO` row). A piece the session cannot see is neither fetched nor rendered.

   | Piece | Gate (real permiso code, see D1) |
   |---|---|
   | Tab, recetas, partidas consumed, quantities | `recetas.crear` (spec says `recetas.ver`) |
   | Paciente name (otherwise "—") | `pacientes.gestionar` (spec says `pacientes.ver`) |
   | Link to the partida in stock + unit-catalog conversion | `stock.ver` |

2. `tenant_id` on EVERY `FROM`/`JOIN` of every raw SQL (composite-key discipline), plus an explicit tenant filter on every Prisma call. **Explicit columns only**: no `SELECT *`, no `include`. `schema.prisma` still declares receta columns the shared DB dropped, so receta data is read only through raw SQL with explicit columns.
3. **No logging** of free-text fields or paciente data. No `getLogger`, no `console.*` in any new file (a test enforces this).
4. **Filter ids are never trusted.** The repository applies only requested partida ids that belong to the droga's option list. A foreign or unknown id is ignored, and a filter made only of such ids is no filter. The filter selects recetas, it does not trim what a receta shows. The row "Consumido" and the detail always cover every partida the receta consumed of this droga.
5. Cap of **20** partidas in the filter (`PARTIDAS_FILTRO_MAX`), in URL parsing AND in the use case input (`z.array(uuid).max(20).default([])`).
6. **Quantities** are SQL `numeric`, returned as text. Never summed in JS, never summed across drogas. Without `stock.ver` they show in the droga's unidad base, unconverted (`crearCatalogoUnidades([])`).
7. **Code language.** Comments and identifiers in English, following the repo's existing Spanish domain naming (`receta`, `partida`, `droga`, `acceso`, `etiqueta`). UI copy in Spanish exactly as the spec words it.
8. **Process.** STRICT TDD for domain, repository and use-case tasks (failing test first, watch it fail, then implement). Test command: `npm test -- <path>` (vitest project `unit`). At the end of every task that touches TS run `npm run typecheck` and `npm run lint -- <touched paths>`.
9. **NEVER run `npm run test:db`** (one production database). No git worktrees. Commits are conventional commits on `master`, with **no `Co-Authored-By` line**. In bash, stage with `git --literal-pathspecs add ...`, because `[id]` is a glob character class in git pathspecs.

## Clarifications of the spec (decisions taken here)

- **D1 (spec text vs code).** `recetas.ver` and `pacientes.ver` are NOT permiso codes. They are use-case names (`getRecetaQuery` is named `recetas.ver` with permiso `recetas.crear`; `getPacienteQuery` is named `pacientes.ver` with permiso `pacientes.gestionar`). `modules/auth/domain/permisos.ts` only has `recetas.crear`, `pacientes.gestionar` and `stock.ver`. This plan uses the real codes, which are the same ones the `/recetas/**` and `/pacientes/**` layouts guard on. Consequence: `recetas.crear` is `operativo`, so the locked ADMINISTRADOR does not hold it implicitly and will not see the tab unless a role grants it. This matches how `/recetas` itself behaves.
- **D2.** The use case is named `drogas.historial`. A single exported helper `puedeVerHistorialDroga(session)` is the one place the page and the tab ask "may this session see the Historial?".
- **D3 (page size).** The spec is silent. 20 rows per page (`PAGE_SIZE_HISTORIAL_DROGA`). A recall scan benefits from longer pages, and the per-page detail query is batched.
- **D4 (Paciente column).** It is always present, and shows "—" when the session lacks `pacientes.gestionar`. The paciente statement is not even executed in that case. This is the literal reading of "Paciente name (otherwise '—')".
- **D5.** `DrogaTabs` renders nothing when the session cannot see the Historial. A lone "Datos" tab would be noise.
- **D6.** `partidaIds`, `drogaId` and `page` already have labels in `shared/labels/field-labels.ts` (`partidaIds: "Partidas"`, line ~90). No label edit is needed. Task 3 verifies this through the registry test instead of editing the file.
- **D7.** The partida options list is not capped (spec does not cap it). The Combobox renders at most 30 matches at a time (`filtrarOpciones`), and a droga's partidas-with-egreso list is small for one pharmacy.

---

## File structure map

**Create**

| File | Responsibility |
|---|---|
| `modules/drogas/domain/historial.ts` | Pure: constants, raw + view types, `parsearPartidaIds`, `filtrarPartidasDeLaDroga`, `partidasSeleccionadas`, `partidasRestantes`, `etiquetaPartidaOpcion`, `hrefHistorialDroga`, `calcularPaginacion`, `armarHistorialDroga` |
| `modules/drogas/infrastructure/historial-repository.ts` | Raw SQL reads: droga header (Prisma, explicit select), partida options, count, receta page, per-receta partida detail, paciente names; orchestrator `getHistorialDrogaCruda` |
| `modules/drogas/application/get-historial-droga.ts` | `defineQuery` `drogas.historial` (permiso `recetas.crear`), `accesoHistorialDroga`, `puedeVerHistorialDroga`, `getHistorialDroga` |
| `modules/drogas/ui/historial-encabezado.tsx` | Page header (breadcrumbs, droga name, vigente/baja badge) |
| `modules/drogas/ui/historial-receta-fila.tsx` | Row summary cells + expanded detail for `FilaDesplegable` |
| `modules/drogas/ui/historial-filtro-partidas.tsx` | Client autocomplete + chips (`?partida=` repeatable) |
| `app/(app)/catalogos/drogas/droga-tabs.tsx` | "Datos \| Historial" tabs on `SectionTabs` |
| `app/(app)/catalogos/drogas/[id]/layout.tsx` | uuid guard only |
| `app/(app)/catalogos/drogas/[id]/historial/page.tsx` | The Historial page |
| `tests/unit/drogas-historial.test.ts` | Domain tests |
| `tests/unit/drogas-historial-repository.test.ts` | Repository tests with a recording fake `tx` |
| `tests/unit/drogas-historial-usecase.test.ts` | Use case: declared permiso, gating, input validation |
| `tests/unit/drogas-historial-privacy.test.ts` | "No logger / console" source scan |

**Modify**

| File | Change |
|---|---|
| `app/(app)/catalogos/drogas/[id]/page.tsx` | Render `<DrogaTabs>` right under `PageHeader` |
| `docs/specs/historial-droga.md` | Status line and "Implementation notes" (Task 6) |

---

## Task 1: Domain pure helpers + tests

**Files**
- Create: `modules/drogas/domain/historial.ts`
- Test: `tests/unit/drogas-historial.test.ts`

**Interfaces (exports of this task, used by Tasks 2–5)**

```ts
export const PAGE_SIZE_HISTORIAL_DROGA = 20;
export const PAGE_MAX_HISTORIAL_DROGA = 100_000;
export const PARTIDAS_FILTRO_MAX = 20;

export interface DrogaHistorial { id: string; nombre: string; fechaBaja: Date | null; unidadBaseId: string; unidadBaseSimbolo: string }
export interface PartidaOpcion { id: string; lote: string; proveedor: string; fechaVencimiento: Date | null }
export interface AccesoHistorialDroga { pacientes: boolean; stock: boolean }

export interface RecetaConsumoCruda { id: string; numeroInterno: string; estado: string; preparadaEn: Date | null; consumido: string; medicoApellido: string; medicoNombre: string }
export interface PacienteRecetaCrudo { recetaId: string; apellido: string; nombre: string }
export interface PartidaConsumidaCruda { recetaId: string; partidaId: string; lote: string; proveedor: string; fechaVencimiento: Date | null; cantidad: string }
export interface HistorialDrogaCruda { droga; zonaHoraria; partidasDisponibles; partidaIds; totalRecetas; totalFiltradas; page; recetas; pacientes; partidasConsumidas }

export interface PartidaConsumida { partidaId: string; lote: string; proveedor: string; fechaVencimiento: Date | null; cantidad: string }
export interface RecetaHistorial { id; numeroInterno; estado; preparadaEn; medico; paciente: string | null; consumido; partidas: PartidaConsumida[] }
export interface PaginacionHistorialDroga { page; pageSize; total; totalPages }
export interface HistorialDroga { droga; acceso; zonaHoraria; partidasDisponibles; partidaIds; totalRecetas; recetas; paginacion }

export function parsearPartidaIds(raw: string | readonly string[] | undefined): string[];
export function filtrarPartidasDeLaDroga(ids: readonly string[], disponibles: readonly PartidaOpcion[]): string[];
export function partidasSeleccionadas(disponibles: readonly PartidaOpcion[], ids: readonly string[]): PartidaOpcion[];
export function partidasRestantes(disponibles: readonly PartidaOpcion[], ids: readonly string[]): PartidaOpcion[];
export function etiquetaPartidaOpcion(p: PartidaOpcion): string;
export function hrefHistorialDroga(baseHref: string, partidaIds: readonly string[], page?: number): string;
export function calcularPaginacion(total: number, page: number, pageSize?: number): PaginacionHistorialDroga;
export function armarHistorialDroga(cruda: HistorialDrogaCruda, acceso: AccesoHistorialDroga): HistorialDroga;
```

- [ ] **Step 1: Write the failing test** `tests/unit/drogas-historial.test.ts`

```ts
/**
 * Unit tests for `modules/drogas/domain/historial.ts`: pure derivation of the droga
 * Historial (docs/specs/historial-droga.md): partida filter parsing, option helpers,
 * partida label, pagination clamp, URL builder and view-model assembly. No mocks, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  PAGE_SIZE_HISTORIAL_DROGA,
  PARTIDAS_FILTRO_MAX,
  armarHistorialDroga,
  calcularPaginacion,
  etiquetaPartidaOpcion,
  filtrarPartidasDeLaDroga,
  hrefHistorialDroga,
  parsearPartidaIds,
  partidasRestantes,
  partidasSeleccionadas,
} from "@/modules/drogas/domain/historial";
import type { HistorialDrogaCruda, PartidaOpcion } from "@/modules/drogas/domain/historial";

const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P_AJENA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DROGA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const opcionA: PartidaOpcion = { id: P1, lote: "A-1", proveedor: "Droguería Sur", fechaVencimiento: new Date("2027-01-31T00:00:00Z") };
const opcionB: PartidaOpcion = { id: P2, lote: "B-2", proveedor: "Química Norte", fechaVencimiento: null };

describe("constants", () => {
  it("caps the filter at 20 and pages by 20", () => {
    expect(PARTIDAS_FILTRO_MAX).toBe(20);
    expect(PAGE_SIZE_HISTORIAL_DROGA).toBe(20);
  });
});

describe("parsearPartidaIds", () => {
  it("accepts a single value, a repeated param and nothing at all", () => {
    expect(parsearPartidaIds(undefined)).toEqual([]);
    expect(parsearPartidaIds(P1)).toEqual([P1]);
    expect(parsearPartidaIds([P1, P2])).toEqual([P1, P2]);
  });

  it("drops anything that is not a uuid, silently", () => {
    expect(parsearPartidaIds(["no-es-uuid", P1, "", "123", "' OR 1=1 --"])).toEqual([P1]);
    expect(parsearPartidaIds("zzz")).toEqual([]);
  });

  it("ignores non-string entries", () => {
    expect(parsearPartidaIds([P1, 42, null] as unknown as string[])).toEqual([P1]);
  });

  it("lowercases and deduplicates in first-seen order", () => {
    expect(parsearPartidaIds([P2.toUpperCase(), P1, P2, P1.toUpperCase()])).toEqual([P2, P1]);
  });

  it("caps the selection at PARTIDAS_FILTRO_MAX distinct valid ids", () => {
    const muchos = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const parsed = parsearPartidaIds(muchos);
    expect(parsed).toHaveLength(PARTIDAS_FILTRO_MAX);
    expect(parsed).toEqual(muchos.slice(0, PARTIDAS_FILTRO_MAX));
  });
});

describe("filtrarPartidasDeLaDroga / partidasSeleccionadas / partidasRestantes", () => {
  const disponibles = [opcionA, opcionB];

  it("keeps only requested ids that are one of the droga's own partidas (never trusted)", () => {
    expect(filtrarPartidasDeLaDroga([P_AJENA, P2], disponibles)).toEqual([P2]);
    expect(filtrarPartidasDeLaDroga([P_AJENA], disponibles)).toEqual([]);
    expect(filtrarPartidasDeLaDroga([P2, P1], disponibles)).toEqual([P2, P1]);
  });

  it("selected options come back in the options' order, whatever the order of the ids", () => {
    expect(partidasSeleccionadas(disponibles, [P2, P1]).map((p) => p.id)).toEqual([P1, P2]);
  });

  it("the remaining options exclude the selected ones and keep the order", () => {
    expect(partidasRestantes(disponibles, [P1]).map((p) => p.id)).toEqual([P2]);
    expect(partidasRestantes(disponibles, [])).toEqual(disponibles);
    expect(partidasRestantes(disponibles, [P1, P2])).toEqual([]);
  });
});

describe("etiquetaPartidaOpcion", () => {
  it("shows lote, proveedor and the vencimiento as dd/mm/aaaa (a Postgres date is UTC midnight)", () => {
    expect(etiquetaPartidaOpcion(opcionA)).toBe("Lote A-1 · Droguería Sur · vence 31/01/2027");
  });

  it("says 'sin vencimiento' for an insumo that does not expire", () => {
    expect(etiquetaPartidaOpcion(opcionB)).toBe("Lote B-2 · Química Norte · sin vencimiento");
  });
});

describe("calcularPaginacion", () => {
  it("clamps the page into [1, totalPages]", () => {
    expect(calcularPaginacion(45, 99, 20)).toEqual({ page: 3, pageSize: 20, total: 45, totalPages: 3 });
    expect(calcularPaginacion(45, -3, 20)).toEqual({ page: 1, pageSize: 20, total: 45, totalPages: 3 });
  });

  it("an empty result still has one page", () => {
    expect(calcularPaginacion(0, 5, 20)).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  });

  it("defaults the page size to PAGE_SIZE_HISTORIAL_DROGA", () => {
    expect(calcularPaginacion(41, 1).totalPages).toBe(3);
    expect(calcularPaginacion(41, 1).pageSize).toBe(PAGE_SIZE_HISTORIAL_DROGA);
  });
});

describe("hrefHistorialDroga", () => {
  const base = `/catalogos/drogas/${DROGA}/historial`;

  it("is the bare base without filter nor page", () => {
    expect(hrefHistorialDroga(base, [])).toBe(base);
  });

  it("repeats ?partida= once per id, in order", () => {
    expect(hrefHistorialDroga(base, [P1, P2])).toBe(`${base}?partida=${P1}&partida=${P2}`);
  });

  it("appends ?page= only past the first page", () => {
    expect(hrefHistorialDroga(base, [P1], 2)).toBe(`${base}?partida=${P1}&page=2`);
    expect(hrefHistorialDroga(base, [P1], 1)).toBe(`${base}?partida=${P1}`);
    expect(hrefHistorialDroga(base, [], 3)).toBe(`${base}?page=3`);
  });
});

describe("armarHistorialDroga", () => {
  const cruda = (over: Partial<HistorialDrogaCruda> = {}): HistorialDrogaCruda => ({
    droga: { id: DROGA, nombre: "Minoxidil", fechaBaja: null, unidadBaseId: "u-g", unidadBaseSimbolo: "g" },
    zonaHoraria: "America/Argentina/Mendoza",
    partidasDisponibles: [opcionA, opcionB],
    partidaIds: [],
    totalRecetas: 45,
    totalFiltradas: 45,
    page: 1,
    recetas: [
      { id: "r1", numeroInterno: "120", estado: "PREPARADA", preparadaEn: new Date("2026-10-01T15:00:00Z"), consumido: "12.5", medicoApellido: "Gómez", medicoNombre: "Ana" },
      { id: "r2", numeroInterno: "119", estado: "ANULADA", preparadaEn: new Date("2026-09-30T15:00:00Z"), consumido: "3", medicoApellido: "Ruiz", medicoNombre: "Luis" },
    ],
    pacientes: [{ recetaId: "r1", apellido: "Pérez", nombre: "Juan" }],
    partidasConsumidas: [
      { recetaId: "r1", partidaId: P1, lote: "A-1", proveedor: "Droguería Sur", fechaVencimiento: new Date("2027-01-31T00:00:00Z"), cantidad: "7.5" },
      { recetaId: "r1", partidaId: P2, lote: "B-2", proveedor: "Química Norte", fechaVencimiento: null, cantidad: "5" },
      { recetaId: "r2", partidaId: P1, lote: "A-1", proveedor: "Droguería Sur", fechaVencimiento: new Date("2027-01-31T00:00:00Z"), cantidad: "3" },
    ],
    ...over,
  });

  const TODO = { pacientes: true, stock: true };
  const NADA = { pacientes: false, stock: false };

  it("builds one row per receta with médico, paciente and its partidas in query order", () => {
    const h = armarHistorialDroga(cruda(), TODO);
    expect(h.recetas).toHaveLength(2);
    expect(h.recetas[0]).toMatchObject({ id: "r1", numeroInterno: "120", estado: "PREPARADA", medico: "Gómez, Ana", paciente: "Pérez, Juan", consumido: "12.5" });
    expect(h.recetas[0]!.partidas.map((p) => [p.partidaId, p.cantidad])).toEqual([
      [P1, "7.5"],
      [P2, "5"],
    ]);
    expect(h.recetas[1]!.partidas).toHaveLength(1);
  });

  it("a receta without a paciente row gets null even with the permiso", () => {
    expect(armarHistorialDroga(cruda(), TODO).recetas[1]!.paciente).toBeNull();
  });

  it("without pacientes access the paciente is null even if rows were handed in (defense in depth)", () => {
    const h = armarHistorialDroga(cruda(), NADA);
    expect(h.recetas.every((r) => r.paciente === null)).toBe(true);
    expect(JSON.stringify(h)).not.toContain("Pérez");
  });

  it("a receta with no consumed rows has an empty partidas list", () => {
    const h = armarHistorialDroga(cruda({ partidasConsumidas: [] }), TODO);
    expect(h.recetas[0]!.partidas).toEqual([]);
  });

  it("paginates over the FILTERED total, clamping the page; the unfiltered total and the applied filter are echoed", () => {
    const h = armarHistorialDroga(cruda({ totalFiltradas: 41, totalRecetas: 90, page: 9, partidaIds: [P1] }), TODO);
    expect(h.paginacion).toEqual({ page: 3, pageSize: 20, total: 41, totalPages: 3 });
    expect(h.totalRecetas).toBe(90);
    expect(h.partidaIds).toEqual([P1]);
  });

  it("carries the droga, the tenant time zone, the access flags and the options through", () => {
    const h = armarHistorialDroga(cruda(), NADA);
    expect(h.droga.nombre).toBe("Minoxidil");
    expect(h.zonaHoraria).toBe("America/Argentina/Mendoza");
    expect(h.acceso).toEqual(NADA);
    expect(h.partidasDisponibles).toEqual([opcionA, opcionB]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/unit/drogas-historial.test.ts`
Expected: FAIL (cannot resolve `@/modules/drogas/domain/historial`).

- [ ] **Step 3: Implement** `modules/drogas/domain/historial.ts`

```ts
/**
 * Pure derivation for the droga "Historial" view (docs/specs/historial-droga.md):
 * every receta that CONSUMED a droga (EGRESO_PREPARACION movements of its
 * partidas, reached through preparacion -> item_receta -> receta) and the
 * partida(s) each one came from. No I/O, no Prisma (eslint's
 * domainBoundaryPatterns enforce this).
 *
 * Data flow (same as the proveedor Trayectoria):
 *   infrastructure/historial-repository.ts  ->  `HistorialDrogaCruda` (raw rows)
 *   application/get-historial-droga.ts      ->  `armarHistorialDroga()` (this file)
 *   ui/historial-*.tsx                      ->  renders `HistorialDroga`
 *
 * Optional pieces (paciente name) arrive EMPTY when the session cannot see
 * them (the repository does not even query them); `AccesoHistorialDroga` tells
 * the UI what to render, so "no data" and "not allowed" are never confused.
 *
 * No free-text field and no paciente data is ever logged from here.
 */
import { formatFecha } from "@/shared/format/fecha";
import { uuid } from "@/shared/validation";

// ============================================================================
// Constants
// ============================================================================

/** Recetas per page of the Historial (spec is silent; see plan D3). */
export const PAGE_SIZE_HISTORIAL_DROGA = 20;

/** Upper bound of the `?page=` value accepted by the use case; callers clamp to it (the repository then clamps to the last real page). */
export const PAGE_MAX_HISTORIAL_DROGA = 100_000;

/** Most partidas the filter accepts at once (URL parsing and use case input are both capped to it). */
export const PARTIDAS_FILTRO_MAX = 20;

// ============================================================================
// Access
// ============================================================================

/**
 * Derived from the session's permisos by the use case (`can()`), then used
 * twice: the repository only loads what is `true`, and the UI only renders
 * (and links to) what is `true`.
 */
export interface AccesoHistorialDroga {
  /** `pacientes.gestionar`: the paciente name column (otherwise "—"). */
  pacientes: boolean;
  /** `stock.ver`: link to /stock/partidas/[id] AND the unit-catalog conversion of quantities. */
  stock: boolean;
}

// ============================================================================
// Raw input (what the repository reads)
// ============================================================================

export interface DrogaHistorial {
  id: string;
  nombre: string;
  fechaBaja: Date | null;
  /** The unidad base every quantity of this view is expressed in. */
  unidadBaseId: string;
  unidadBaseSimbolo: string;
}

/** A partida of the droga that has at least one EGRESO_PREPARACION: one option of the filter. */
export interface PartidaOpcion {
  id: string;
  lote: string;
  /** Razón social. */
  proveedor: string;
  /** Postgres `date` (UTC midnight); `null` = does not expire (an insumo). */
  fechaVencimiento: Date | null;
}

export interface RecetaConsumoCruda {
  id: string;
  /** `numero_interno` is a bigint: read as text. */
  numeroInterno: string;
  /** `receta.estado` as text (an ANULADA receta still shows: the stock was consumed). */
  estado: string;
  /** Latest `preparacion.confirmada_en` among the droga's movements of this receta. */
  preparadaEn: Date | null;
  /** SQL `SUM(movimiento_stock.cantidad)`, decimal string, droga unidad base. */
  consumido: string;
  medicoApellido: string;
  medicoNombre: string;
}

export interface PacienteRecetaCrudo {
  recetaId: string;
  apellido: string;
  nombre: string;
}

export interface PartidaConsumidaCruda {
  recetaId: string;
  partidaId: string;
  lote: string;
  proveedor: string;
  fechaVencimiento: Date | null;
  /** SQL `SUM(cantidad)` of this receta from this partida, decimal string. */
  cantidad: string;
}

export interface HistorialDrogaCruda {
  droga: DrogaHistorial;
  zonaHoraria: string;
  /** The droga's partidas with at least one egreso, newest ingreso first: the filter's options. */
  partidasDisponibles: PartidaOpcion[];
  /** The filter actually applied: the requested ids that belong to `partidasDisponibles`. Empty = no filter. */
  partidaIds: string[];
  /** Recetas that consumed the droga, ignoring the filter. */
  totalRecetas: number;
  /** Recetas matching the filter (= `totalRecetas` without a filter). Drives the pagination. */
  totalFiltradas: number;
  /** Requested page, already clamped to the last real page. */
  page: number;
  recetas: RecetaConsumoCruda[];
  /** Empty unless `acceso.pacientes`. */
  pacientes: PacienteRecetaCrudo[];
  partidasConsumidas: PartidaConsumidaCruda[];
}

// ============================================================================
// View model (what the UI renders)
// ============================================================================

export interface PartidaConsumida {
  partidaId: string;
  lote: string;
  proveedor: string;
  fechaVencimiento: Date | null;
  cantidad: string;
}

export interface RecetaHistorial {
  id: string;
  numeroInterno: string;
  estado: string;
  preparadaEn: Date | null;
  /** "Apellido, Nombre". */
  medico: string;
  /** "Apellido, Nombre"; `null` without `pacientes.gestionar` (or without a row). */
  paciente: string | null;
  consumido: string;
  partidas: PartidaConsumida[];
}

export interface PaginacionHistorialDroga {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface HistorialDroga {
  droga: DrogaHistorial;
  acceso: AccesoHistorialDroga;
  zonaHoraria: string;
  /** The filter's options (newest ingreso first). */
  partidasDisponibles: PartidaOpcion[];
  /** The filter in effect (ids that belong to `partidasDisponibles`); empty = no filter. */
  partidaIds: string[];
  /** Recetas of the droga ignoring the filter (the "de M" of the count line). */
  totalRecetas: number;
  recetas: RecetaHistorial[];
  /** Over the FILTERED recetas (`total`). */
  paginacion: PaginacionHistorialDroga;
}

// ============================================================================
// Pagination
// ============================================================================

/** Clamps `page` into `[1, totalPages]` (an empty result still has one page). */
export function calcularPaginacion(total: number, page: number, pageSize: number = PAGE_SIZE_HISTORIAL_DROGA): PaginacionHistorialDroga {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, page), totalPages), pageSize, total, totalPages };
}

// ============================================================================
// Filter by partida
// ============================================================================

/**
 * The `partida` search param (`string | string[] | undefined`; one entry per
 * repeated `?partida=a&partida=b`) as a clean id list: only valid uuids (the
 * shared zod `uuid`), lowercased (Postgres prints uuids in lowercase and ids
 * are compared as strings), deduplicated in first-seen order and capped to
 * `PARTIDAS_FILTRO_MAX`. Anything else is dropped silently, never an error.
 * Whether an id belongs to the droga is NOT decided here
 * (see `filtrarPartidasDeLaDroga`).
 */
export function parsearPartidaIds(raw: string | readonly string[] | undefined): string[] {
  const lista = raw === undefined ? [] : typeof raw === "string" ? [raw] : raw;
  const ids = new Set<string>();
  for (const valor of lista) {
    if (ids.size >= PARTIDAS_FILTRO_MAX) break;
    if (typeof valor === "string" && uuid.safeParse(valor).success) ids.add(valor.toLowerCase());
  }
  return [...ids];
}

/** Keeps only the requested ids that are one of the droga's own option partidas: the filter is never trusted, an unknown id is ignored. */
export function filtrarPartidasDeLaDroga(ids: readonly string[], disponibles: readonly PartidaOpcion[]): string[] {
  const propias = new Set(disponibles.map((p) => p.id));
  return ids.filter((id) => propias.has(id));
}

/** The selected partidas in the order of `disponibles`, so the chips never reshuffle when the URL's order changes. */
export function partidasSeleccionadas(disponibles: readonly PartidaOpcion[], ids: readonly string[]): PartidaOpcion[] {
  const elegidas = new Set(ids);
  return disponibles.filter((p) => elegidas.has(p.id));
}

/** What the autocomplete still offers: the available partidas minus the already selected ones. */
export function partidasRestantes(disponibles: readonly PartidaOpcion[], ids: readonly string[]): PartidaOpcion[] {
  const elegidas = new Set(ids);
  return disponibles.filter((p) => !elegidas.has(p.id));
}

/** `Lote <lote> · <proveedor> · vence dd/mm/aaaa` (insumos without vencimiento: "sin vencimiento"). */
export function etiquetaPartidaOpcion(partida: PartidaOpcion): string {
  const vencimiento = partida.fechaVencimiento ? `vence ${formatFecha(partida.fechaVencimiento)}` : "sin vencimiento";
  return `Lote ${partida.lote} · ${partida.proveedor} · ${vencimiento}`;
}

/** The historial URL for a filter (and optionally a page): repeated `partida`, `page` only past the first page. Shared by the filter control and the pagination links. */
export function hrefHistorialDroga(baseHref: string, partidaIds: readonly string[], page?: number): string {
  const qs = new URLSearchParams();
  for (const id of partidaIds) qs.append("partida", id);
  if (page !== undefined && page > 1) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `${baseHref}?${query}` : baseHref;
}

// ============================================================================
// Assembly
// ============================================================================

function apellidoNombre(apellido: string, nombre: string): string {
  return `${apellido}, ${nombre}`;
}

/**
 * Shapes the raw rows into the view model. The paciente name is built ONLY when
 * `acceso.pacientes` allows it, even if the caller handed in rows for it
 * (defense in depth: the repository already skips the query).
 */
export function armarHistorialDroga(cruda: HistorialDrogaCruda, acceso: AccesoHistorialDroga): HistorialDroga {
  const pacientes = new Map<string, string>(acceso.pacientes ? cruda.pacientes.map((p) => [p.recetaId, apellidoNombre(p.apellido, p.nombre)] as const) : []);

  const consumidas = new Map<string, PartidaConsumida[]>();
  for (const c of cruda.partidasConsumidas) {
    const item: PartidaConsumida = { partidaId: c.partidaId, lote: c.lote, proveedor: c.proveedor, fechaVencimiento: c.fechaVencimiento, cantidad: c.cantidad };
    const lista = consumidas.get(c.recetaId);
    if (lista) lista.push(item);
    else consumidas.set(c.recetaId, [item]);
  }

  const recetas: RecetaHistorial[] = cruda.recetas.map((r) => ({
    id: r.id,
    numeroInterno: r.numeroInterno,
    estado: r.estado,
    preparadaEn: r.preparadaEn,
    medico: apellidoNombre(r.medicoApellido, r.medicoNombre),
    paciente: pacientes.get(r.id) ?? null,
    consumido: r.consumido,
    partidas: consumidas.get(r.id) ?? [],
  }));

  return {
    droga: cruda.droga,
    acceso,
    zonaHoraria: cruda.zonaHoraria,
    partidasDisponibles: cruda.partidasDisponibles,
    partidaIds: cruda.partidaIds,
    totalRecetas: cruda.totalRecetas,
    recetas,
    paginacion: calcularPaginacion(cruda.totalFiltradas, cruda.page),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- tests/unit/drogas-historial.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck` then `npm run lint -- modules/drogas/domain/historial.ts tests/unit/drogas-historial.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git --literal-pathspecs add modules/drogas/domain/historial.ts tests/unit/drogas-historial.test.ts
git commit -m "feat(drogas): add pure domain for the droga historial"
```

---

## Task 2: Repository (raw SQL) + tests with a fake `tx`

**Files**
- Create: `modules/drogas/infrastructure/historial-repository.ts`
- Test: `tests/unit/drogas-historial-repository.test.ts`

**Interfaces (exports of this task)**

```ts
export type BloquesHistorialDroga = Pick<AccesoHistorialDroga, "pacientes">;

export async function readDroga(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<DrogaHistorial | null>;
export async function readPartidasConConsumo(tx, tenantId, drogaId): Promise<PartidaOpcion[]>;
export async function countRecetas(tx, tenantId, drogaId, partidaIds: readonly string[]): Promise<{ totalRecetas: number; totalFiltradas: number }>;
export async function readRecetasPagina(tx, tenantId, drogaId, partidaIds: readonly string[], page: number, pageSize: number): Promise<RecetaConsumoCruda[]>;
export async function readPartidasConsumidas(tx, tenantId, drogaId, recetaIds: string[]): Promise<PartidaConsumidaCruda[]>;
export async function readPacientes(tx, tenantId, recetaIds: string[]): Promise<PacienteRecetaCrudo[]>;

export async function getHistorialDrogaCruda(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  page: number,
  pageSize: number,
  bloques: BloquesHistorialDroga,
  partidaIdsSolicitados?: readonly string[], // default []
): Promise<HistorialDrogaCruda | null>;
```

**SQL conventions.** The tenant id is bound and cast `${tenantId}::uuid`, and every `JOIN fsj.<t> <a> ON <a>.tenant_id = ${tenantId}::uuid`. The partida filter is ONE static statement. It binds the already-validated ids as `${ids}::uuid[]` and switches on `cardinality(...) = 0`, so no SQL is built by string concatenation, and the tests can read the full SQL text from the template strings.

- [ ] **Step 1: Write the failing test** `tests/unit/drogas-historial-repository.test.ts`

```ts
/**
 * `getHistorialDrogaCruda` (modules/drogas/infrastructure/historial-repository.ts)
 * against a recording fake `tx`: proves the read pattern (batched, no N+1),
 * tenant scoping of EVERY join, explicit columns, the paciente statement only
 * when the caller says the session may see it, and that the partida filter is
 * never trusted. No DB.
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { getHistorialDrogaCruda } from "@/modules/drogas/infrastructure/historial-repository";

const TENANT = "11111111-1111-4111-8111-111111111111";
const DROGA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARTIDA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARTIDA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PARTIDA_AJENA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const OPCIONES = [
  { id: PARTIDA_A, lote: "L-1", fecha_vencimiento: new Date("2027-01-31T00:00:00Z"), proveedor: "Droguería Sur" },
  { id: PARTIDA_B, lote: "L-2", fecha_vencimiento: null, proveedor: "Química Norte" },
];

interface FakeOpts {
  droga?: boolean;
  opciones?: typeof OPCIONES;
  totalRecetas?: number;
  /** What the count statement answers for the filtered total (defaults to `totalRecetas`). */
  totalFiltradas?: number;
  /** Receta rows the page statement answers. */
  recetas?: number;
}

function fakeTx(opts: FakeOpts = {}) {
  const { droga = true, opciones = OPCIONES, totalRecetas = 45, recetas = 2 } = opts;
  const totalFiltradas = opts.totalFiltradas ?? totalRecetas;
  const recetaRows = Array.from({ length: recetas }, (_, i) => ({
    id: `r${i}`,
    numero_interno: String(120 - i),
    estado: "PREPARADA",
    consumido: "12.5",
    preparada_en: new Date("2026-10-01T15:00:00Z"),
    medico_apellido: "Gómez",
    medico_nombre: "Ana",
  }));

  const tx = {
    droga: {
      findUnique: vi.fn(async () => (droga ? { id: DROGA, nombre: "Minoxidil", fechaBaja: null, unidadBaseId: "u-g", unidadBase: { simbolo: "g" } } : null)),
    },
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ zonaHoraria: "America/Argentina/Mendoza" })) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("AS total_recetas")) return [{ total_recetas: totalRecetas, total_filtradas: totalFiltradas }];
      if (sql.includes("AS consumido")) return recetaRows;
      if (sql.includes("fsj.paciente")) return [{ receta_id: "r0", apellido: "Pérez", nombre: "Juan" }];
      if (sql.includes("GROUP BY ir.receta_id, p.id")) {
        return [
          { receta_id: "r0", partida_id: PARTIDA_A, lote: "L-1", fecha_vencimiento: new Date("2027-01-31T00:00:00Z"), proveedor: "Droguería Sur", cantidad: "7.5" },
          { receta_id: "r0", partida_id: PARTIDA_B, lote: "L-2", fecha_vencimiento: null, proveedor: "Química Norte", cantidad: "5" },
        ];
      }
      if (sql.includes("AS proveedor")) return opciones;
      throw new Error(`unexpected raw query: ${sql}`);
    }),
  };
  return tx;
}

type FakeTx = ReturnType<typeof fakeTx>;
const asTx = (tx: FakeTx) => tx as unknown as Prisma.TransactionClient;
const NO_PACIENTES = { pacientes: false };
const CON_PACIENTES = { pacientes: true };

const rawSql = (tx: FakeTx) => tx.$queryRaw.mock.calls.map((c) => (c as unknown as [TemplateStringsArray, ...unknown[]])[0].join("?"));
const rawCalls = (tx: FakeTx) => tx.$queryRaw.mock.calls as unknown as [TemplateStringsArray, ...unknown[]][];
const find = (tx: FakeTx, marker: string) => {
  const idx = rawSql(tx).findIndex((s) => s.includes(marker));
  return { idx, sql: rawSql(tx)[idx]!, values: rawCalls(tx)[idx]?.slice(1) ?? [] };
};

describe("getHistorialDrogaCruda", () => {
  it("returns null (and reads nothing else) when the droga is not in the tenant", async () => {
    const tx = fakeTx({ droga: false });
    expect(await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES)).toBeNull();
    expect(tx.droga.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: DROGA, tenantId: TENANT } }));
    expect(tx.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("uses an explicit select on every Prisma call (no bare find, no include)", async () => {
    const tx = fakeTx();
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    for (const fn of [tx.droga.findUnique, tx.tenant.findUniqueOrThrow]) {
      const arg = (fn.mock.calls[0] as unknown as [{ select?: unknown; include?: unknown }])[0];
      expect(arg.select).toBeDefined();
      expect(arg.include).toBeUndefined();
    }
    expect((tx.droga.findUnique.mock.calls[0] as unknown as [{ select: unknown }])[0].select).toEqual({
      id: true,
      nombre: true,
      fechaBaja: true,
      unidadBaseId: true,
      unidadBase: { select: { simbolo: true } },
    });
  });

  it("returns the header, the tenant time zone, the options and the rows mapped", async () => {
    const tx = fakeTx();
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    expect(r).toMatchObject({
      droga: { id: DROGA, nombre: "Minoxidil", fechaBaja: null, unidadBaseId: "u-g", unidadBaseSimbolo: "g" },
      zonaHoraria: "America/Argentina/Mendoza",
      partidaIds: [],
      totalRecetas: 45,
      totalFiltradas: 45,
      page: 1,
    });
    expect(r!.partidasDisponibles).toEqual([
      { id: PARTIDA_A, lote: "L-1", proveedor: "Droguería Sur", fechaVencimiento: new Date("2027-01-31T00:00:00Z") },
      { id: PARTIDA_B, lote: "L-2", proveedor: "Química Norte", fechaVencimiento: null },
    ]);
    expect(r!.recetas[0]).toEqual({
      id: "r0",
      numeroInterno: "120",
      estado: "PREPARADA",
      preparadaEn: new Date("2026-10-01T15:00:00Z"),
      consumido: "12.5",
      medicoApellido: "Gómez",
      medicoNombre: "Ana",
    });
    expect(r!.partidasConsumidas[0]).toEqual({
      recetaId: "r0",
      partidaId: PARTIDA_A,
      lote: "L-1",
      proveedor: "Droguería Sur",
      fechaVencimiento: new Date("2027-01-31T00:00:00Z"),
      cantidad: "7.5",
    });
    expect(r!.pacientes).toEqual([{ recetaId: "r0", apellido: "Pérez", nombre: "Juan" }]);
  });

  it("batches: options, count, page, detail and paciente are ONE statement each, whatever the page size", async () => {
    const tx = fakeTx({ recetas: 20 });
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    expect(rawSql(tx)).toHaveLength(5);
    expect(tx.droga.findUnique).toHaveBeenCalledTimes(1);
  });

  it("does NOT touch paciente without the permiso: no statement mentions it", async () => {
    const tx = fakeTx();
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    expect(rawSql(tx)).toHaveLength(4);
    for (const sql of rawSql(tx)) expect(sql).not.toMatch(/paciente/i);
    expect(r!.pacientes).toEqual([]);
  });

  it("with the permiso, reads the paciente names in ONE statement over the page's receta ids only", async () => {
    const tx = fakeTx({ recetas: 3 });
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    const { sql, values } = find(tx, "fsj.paciente");
    expect(sql).toContain("r.id = ANY(?::uuid[])");
    expect(sql).toContain("pa.tenant_id = ?::uuid");
    expect(values[0]).toEqual(["r0", "r1", "r2"]);
    expect(values).toContain(TENANT);
    expect(sql).not.toMatch(/dni|cuil|email|telefono|fecha_nacimiento|nro_credencial/i); // names only
  });

  it("a droga without consumed partidas reads only the options: no count, page, detail nor paciente", async () => {
    const tx = fakeTx({ opciones: [] });
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    expect(rawSql(tx)).toHaveLength(1);
    expect(r).toMatchObject({ partidasDisponibles: [], partidaIds: [], totalRecetas: 0, totalFiltradas: 0, recetas: [], pacientes: [], partidasConsumidas: [] });
  });

  it("an empty page reads neither detail nor paciente", async () => {
    const tx = fakeTx({ totalRecetas: 0 });
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
    expect(rawSql(tx)).toHaveLength(2); // options + count
    expect(r).toMatchObject({ recetas: [], pacientes: [], partidasConsumidas: [] });
  });

  it("the options statement lists the droga's partidas WITH at least one EGRESO_PREPARACION, newest ingreso first, tenant-scoped", async () => {
    const tx = fakeTx();
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    const { sql, values } = find(tx, "AS proveedor");
    expect(sql).toContain("p.tenant_id = ?::uuid");
    expect(sql).toContain("p.droga_id = ?::uuid");
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("m.tipo = 'EGRESO_PREPARACION'");
    expect(sql).toContain("pv.razon_social AS proveedor");
    expect(sql).toContain("ORDER BY p.fecha_ingreso DESC, p.id DESC");
    expect(values).toEqual(expect.arrayContaining([TENANT, DROGA]));
  });

  it("the count statement answers the unfiltered total and the filtered one in a single pass", async () => {
    const tx = fakeTx();
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    const { sql } = find(tx, "AS total_recetas");
    expect(sql).toContain("count(*)::int AS total_recetas");
    expect(sql).toContain("AS total_filtradas");
    expect(sql).toContain("GROUP BY ir.receta_id");
    expect(sql).toContain("m.tipo = 'EGRESO_PREPARACION'");
    expect(sql).toContain("p.droga_id = ?::uuid");
  });

  it("the page statement: one row per receta, SUM in SQL numeric returned as text, latest confirmación, ordered newest first with numero_interno as tie-break", async () => {
    const tx = fakeTx();
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    const { sql } = find(tx, "AS consumido");
    expect(sql).toContain("sum(m.cantidad)");
    expect(sql).toContain("::text AS consumido");
    expect(sql).toContain("max(pr.confirmada_en) AS preparada_en");
    expect(sql).toContain("GROUP BY ir.receta_id");
    expect(sql).toContain("ORDER BY x.preparada_en DESC NULLS LAST, r.numero_interno DESC");
    expect(sql).toContain("r.numero_interno::text AS numero_interno");
    expect(sql).toContain("LIMIT ?::int OFFSET ?::int");
  });

  it("clamps the requested page against the FILTERED total before computing the offset", async () => {
    const tx = fakeTx({ totalRecetas: 45 });
    const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 99, 20, NO_PACIENTES);
    expect(r!.page).toBe(3);
    const { values } = find(tx, "AS consumido");
    expect(values).toEqual(expect.arrayContaining([20, 40])); // LIMIT 20 OFFSET 40
  });

  it("the detail statement groups by (receta, partida) over the page's receta ids, for THIS droga's egresos only", async () => {
    const tx = fakeTx({ recetas: 2 });
    await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
    const { sql, values } = find(tx, "GROUP BY ir.receta_id, p.id");
    expect(sql).toContain("m.tipo = 'EGRESO_PREPARACION'");
    expect(sql).toContain("p.droga_id = ?::uuid");
    expect(sql).toContain("ir.receta_id = ANY(?::uuid[])");
    expect(sql).toContain("sum(m.cantidad)::text AS cantidad");
    expect(values[0]).toEqual(["r0", "r1"]);
    expect(values).toEqual(expect.arrayContaining([TENANT, DROGA]));
  });

  describe("filtro por partida", () => {
    it("without a filter the same statements bind an EMPTY id array (the SQL switches on cardinality, no string building)", async () => {
      const tx = fakeTx();
      const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES);
      expect(r!.partidaIds).toEqual([]);
      const count = find(tx, "AS total_recetas");
      expect(count.sql).toContain("cardinality(?::uuid[]) = 0");
      expect(count.values).toContainEqual([]);
      expect(find(tx, "AS consumido").values).toContainEqual([]);
    });

    it("applies the requested ids that are the droga's own options to the count and to the page", async () => {
      const tx = fakeTx({ totalRecetas: 90, totalFiltradas: 41 });
      const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 3, 20, NO_PACIENTES, [PARTIDA_B]);
      expect(r).toMatchObject({ partidaIds: [PARTIDA_B], totalRecetas: 90, totalFiltradas: 41, page: 3 });
      expect(find(tx, "AS total_recetas").values).toContainEqual([PARTIDA_B]);
      const page = find(tx, "AS consumido");
      expect(page.values).toContainEqual([PARTIDA_B]);
      expect(page.sql).toContain("bool_or(m.partida_id = ANY(?::uuid[]))");
    });

    it("ignores ids that are not one of the droga's options (never trusted): they reach no statement", async () => {
      const tx = fakeTx();
      const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES, [PARTIDA_AJENA, PARTIDA_A]);
      expect(r!.partidaIds).toEqual([PARTIDA_A]);
      for (const call of rawCalls(tx)) {
        expect(call.slice(1)).not.toContain(PARTIDA_AJENA);
        expect(call.slice(1)).not.toContainEqual([PARTIDA_AJENA, PARTIDA_A]);
      }
    });

    it("a filter made only of foreign ids is no filter at all", async () => {
      const tx = fakeTx();
      const r = await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES, [PARTIDA_AJENA]);
      expect(r!.partidaIds).toEqual([]);
      expect(find(tx, "AS total_recetas").values).toContainEqual([]);
      for (const call of rawCalls(tx)) expect(call.slice(1)).not.toContain(PARTIDA_AJENA);
    });

    it("the filter selects recetas, it does not trim them: the detail statement never receives the filter", async () => {
      const tx = fakeTx();
      await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, NO_PACIENTES, [PARTIDA_A]);
      const detail = find(tx, "GROUP BY ir.receta_id, p.id");
      expect(detail.values).not.toContainEqual([PARTIDA_A]);
      expect(detail.sql).not.toContain("cardinality");
      expect(detail.sql).not.toContain("bool_or");
    });
  });

  describe("tenant discipline and explicit columns", () => {
    it("every statement binds the tenant id", async () => {
      const tx = fakeTx();
      await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
      rawCalls(tx).forEach((call, i) => {
        expect(call.slice(1), `statement #${i}`).toContain(TENANT);
        expect(call[0].join("?"), `statement #${i}`).toMatch(/tenant_id = \?::uuid/);
      });
    });

    it("EVERY JOIN carries its own tenant_id, and every FROM of a table is tenant-filtered", async () => {
      const tx = fakeTx();
      await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
      for (const sql of rawSql(tx)) {
        const joins = sql.match(/JOIN fsj\.\w+ \w+/g) ?? [];
        const scopedJoins = sql.match(/JOIN fsj\.\w+ (\w+) ON \1\.tenant_id = \?::uuid/g) ?? [];
        expect(scopedJoins.length, sql).toBe(joins.length);
        for (const m of sql.matchAll(/FROM fsj\.\w+ (\w+)/g)) {
          expect(sql, `FROM alias ${m[1]}`).toMatch(new RegExp(`${m[1]}\\.tenant_id = \\?::uuid`));
        }
      }
    });

    it("no wildcard, and no free-text or unrelated receta columns are read", async () => {
      const tx = fakeTx();
      await getHistorialDrogaCruda(asTx(tx), TENANT, DROGA, 1, 20, CON_PACIENTES);
      for (const sql of rawSql(tx)) {
        expect(sql).not.toMatch(/SELECT \*|\.\*/);
        expect(sql).not.toMatch(/observacion|motivo_|diagnostico|posologia|descripcion|archivo_adjunto|url_verificacion/i);
      }
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/unit/drogas-historial-repository.test.ts`
Expected: FAIL (cannot resolve `@/modules/drogas/infrastructure/historial-repository`).

- [ ] **Step 3: Implement** `modules/drogas/infrastructure/historial-repository.ts`

```ts
/**
 * Prisma-backed reads for the droga "Historial" view
 * (docs/specs/historial-droga.md). Every function runs inside an ALREADY OPEN
 * tenant transaction (RLS-scoped) and filters by `tenantId` explicitly as well:
 * EVERY `FROM` and EVERY `JOIN` of the raw SQL carries its own `tenant_id`
 * (composite-key discipline). HEALTH-ADJACENT DATA (receta, paciente, Ley
 * 25.326): no function passes a paciente field or any free text to a logger.
 *
 * What counts as "the droga reached a receta": ONLY the consumed path,
 * `partida (droga) -> movimiento_stock EGRESO_PREPARACION -> preparacion ->
 * item_receta -> receta`. EGRESO_PREPARACION is written only when a
 * preparación is confirmed and descartar never touches stock, so those
 * movements are by themselves the complete and exact source (spec "Goal").
 * DB constraint (migration 0008): an EGRESO_PREPARACION always has a
 * preparacion_id.
 *
 * Read pattern (no N+1, whatever the page size):
 *   1. the droga (header + unidad base) and the tenant's zona horaria,
 *   2. the droga's partidas with at least one egreso (the filter's options),
 *   3. ONE count that answers both the unfiltered and the filtered total,
 *   4. ONE page of recetas (GROUP BY receta, SUM in SQL numeric, newest first),
 *   5. ONE detail statement over the page's receta ids (receta x partida),
 *   6. ONE paciente-names statement, ONLY when the caller says the session may
 *      see them (it is not fetched and then hidden).
 * Queries run sequentially: they share one interactive transaction (one
 * connection).
 *
 * The partida filter is never trusted: only requested ids that are in the
 * droga's option list reach the SQL, as ONE bound `uuid[]`; the statements
 * switch on `cardinality(...) = 0` instead of building SQL text. The filter
 * selects recetas (HAVING bool_or over the receta's movements); it never
 * trims what a receta shows (the detail statement does not receive it).
 *
 * Quantities are SQL `numeric` aggregates read as text: never summed in JS and
 * never across drogas (one droga = one unidad base here). Cross-module reads
 * (`fsj.movimiento_stock`, `fsj.preparacion`, `fsj.item_receta`, `fsj.receta`,
 * `fsj.medico`, `fsj.paciente`, `fsj.proveedor`) go against the shared schema,
 * same convention as modules/proveedores/infrastructure/trayectoria-repository.ts:
 * a module does not import another module's infrastructure layer. Raw SQL with
 * explicit columns for receta data because `schema.prisma` still declares
 * receta columns the shared DB dropped.
 */
import type { Prisma } from "@/generated/prisma/client";
import { calcularPaginacion, filtrarPartidasDeLaDroga } from "../domain/historial";
import type {
  AccesoHistorialDroga,
  DrogaHistorial,
  HistorialDrogaCruda,
  PacienteRecetaCrudo,
  PartidaConsumidaCruda,
  PartidaOpcion,
  RecetaConsumoCruda,
} from "../domain/historial";

/** Which optional pieces to read: the subset of `AccesoHistorialDroga` that is about data (not links). */
export type BloquesHistorialDroga = Pick<AccesoHistorialDroga, "pacientes">;

export async function readDroga(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<DrogaHistorial | null> {
  const row = await tx.droga.findUnique({
    where: { id: drogaId, tenantId },
    select: { id: true, nombre: true, fechaBaja: true, unidadBaseId: true, unidadBase: { select: { simbolo: true } } },
  });
  if (!row) return null;
  return { id: row.id, nombre: row.nombre, fechaBaja: row.fechaBaja, unidadBaseId: row.unidadBaseId, unidadBaseSimbolo: row.unidadBase.simbolo };
}

/**
 * The droga's partidas that have at least one EGRESO_PREPARACION, newest
 * ingreso first: the options of the "filtrar por partida" control. Enters by
 * `partida (tenant_id, droga_id)`, then one EXISTS per partida through
 * `movimiento_stock (tenant_id, partida_id, registrado_en DESC)`.
 */
export async function readPartidasConConsumo(tx: Prisma.TransactionClient, tenantId: string, drogaId: string): Promise<PartidaOpcion[]> {
  const rows = await tx.$queryRaw<{ id: string; lote: string; fecha_vencimiento: Date | null; proveedor: string }[]>`
    SELECT p.id, p.lote, p.fecha_vencimiento, pv.razon_social AS proveedor
    FROM fsj.partida p
    JOIN fsj.proveedor pv ON pv.tenant_id = ${tenantId}::uuid AND pv.id = p.proveedor_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.droga_id = ${drogaId}::uuid
      AND EXISTS (
        SELECT 1
        FROM fsj.movimiento_stock m
        WHERE m.tenant_id = ${tenantId}::uuid AND m.partida_id = p.id AND m.tipo = 'EGRESO_PREPARACION'
      )
    ORDER BY p.fecha_ingreso DESC, p.id DESC
  `;
  return rows.map((r) => ({ id: r.id, lote: r.lote, proveedor: r.proveedor, fechaVencimiento: r.fecha_vencimiento }));
}

/**
 * Distinct recetas that consumed the droga: `totalRecetas` ignores the filter,
 * `totalFiltradas` honours it (a receta matches when it consumed from ANY
 * selected partida; an empty filter matches everything). One pass, one group
 * per receta.
 */
export async function countRecetas(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  partidaIds: readonly string[],
): Promise<{ totalRecetas: number; totalFiltradas: number }> {
  const ids = [...partidaIds];
  const rows = await tx.$queryRaw<{ total_recetas: number; total_filtradas: number }[]>`
    SELECT
      count(*)::int AS total_recetas,
      (count(*) FILTER (WHERE cardinality(${ids}::uuid[]) = 0 OR g.coincide))::int AS total_filtradas
    FROM (
      SELECT ir.receta_id, bool_or(m.partida_id = ANY(${ids}::uuid[])) AS coincide
      FROM fsj.partida p
      JOIN fsj.movimiento_stock m ON m.tenant_id = ${tenantId}::uuid AND m.partida_id = p.id AND m.tipo = 'EGRESO_PREPARACION'
      JOIN fsj.preparacion pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = m.preparacion_id
      JOIN fsj.item_receta ir ON ir.tenant_id = ${tenantId}::uuid AND ir.id = pr.item_receta_id
      WHERE p.tenant_id = ${tenantId}::uuid AND p.droga_id = ${drogaId}::uuid
      GROUP BY ir.receta_id
    ) g
  `;
  const r = rows[0];
  return { totalRecetas: r?.total_recetas ?? 0, totalFiltradas: r?.total_filtradas ?? 0 };
}

/**
 * One page of recetas, ONE row per receta: `consumido` is the SUM of this
 * droga's EGRESO_PREPARACION over ALL the receta's items and partidas (the
 * filter never trims it), `preparada_en` the latest confirmación among those
 * movements. Newest first; `numero_interno` (unique per tenant) is the stable
 * tie-break. `page` must already be clamped by the caller.
 */
export async function readRecetasPagina(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  partidaIds: readonly string[],
  page: number,
  pageSize: number,
): Promise<RecetaConsumoCruda[]> {
  const ids = [...partidaIds];
  const offset = (page - 1) * pageSize;
  const rows = await tx.$queryRaw<
    {
      id: string;
      numero_interno: string;
      estado: string;
      consumido: string;
      preparada_en: Date | null;
      medico_apellido: string;
      medico_nombre: string;
    }[]
  >`
    SELECT
      r.id,
      r.numero_interno::text AS numero_interno,
      r.estado::text AS estado,
      x.consumido::text AS consumido,
      x.preparada_en,
      me.apellido AS medico_apellido,
      me.nombre AS medico_nombre
    FROM (
      SELECT ir.receta_id, sum(m.cantidad) AS consumido, max(pr.confirmada_en) AS preparada_en
      FROM fsj.partida p
      JOIN fsj.movimiento_stock m ON m.tenant_id = ${tenantId}::uuid AND m.partida_id = p.id AND m.tipo = 'EGRESO_PREPARACION'
      JOIN fsj.preparacion pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = m.preparacion_id
      JOIN fsj.item_receta ir ON ir.tenant_id = ${tenantId}::uuid AND ir.id = pr.item_receta_id
      WHERE p.tenant_id = ${tenantId}::uuid AND p.droga_id = ${drogaId}::uuid
      GROUP BY ir.receta_id
      HAVING cardinality(${ids}::uuid[]) = 0 OR bool_or(m.partida_id = ANY(${ids}::uuid[]))
    ) x
    JOIN fsj.receta r ON r.tenant_id = ${tenantId}::uuid AND r.id = x.receta_id
    JOIN fsj.medico me ON me.tenant_id = ${tenantId}::uuid AND me.id = r.medico_id
    ORDER BY x.preparada_en DESC NULLS LAST, r.numero_interno DESC
    LIMIT ${pageSize}::int OFFSET ${offset}::int
  `;
  return rows.map((r) => ({
    id: r.id,
    numeroInterno: r.numero_interno,
    estado: r.estado,
    preparadaEn: r.preparada_en,
    consumido: r.consumido,
    medicoApellido: r.medico_apellido,
    medicoNombre: r.medico_nombre,
  }));
}

/**
 * Detail for the page: what each receta consumed of THIS droga, per partida
 * (`SUM(cantidad)` grouped by receta x partida) with lote / proveedor /
 * vencimiento. Deliberately does NOT receive the partida filter: an expanded
 * receta always shows everything it consumed.
 */
export async function readPartidasConsumidas(tx: Prisma.TransactionClient, tenantId: string, drogaId: string, recetaIds: string[]): Promise<PartidaConsumidaCruda[]> {
  const rows = await tx.$queryRaw<
    { receta_id: string; partida_id: string; lote: string; fecha_vencimiento: Date | null; proveedor: string; cantidad: string }[]
  >`
    SELECT
      ir.receta_id,
      p.id AS partida_id,
      p.lote,
      p.fecha_vencimiento,
      pv.razon_social AS proveedor,
      sum(m.cantidad)::text AS cantidad
    FROM fsj.partida p
    JOIN fsj.movimiento_stock m ON m.tenant_id = ${tenantId}::uuid AND m.partida_id = p.id AND m.tipo = 'EGRESO_PREPARACION'
    JOIN fsj.preparacion pr ON pr.tenant_id = ${tenantId}::uuid AND pr.id = m.preparacion_id
    JOIN fsj.item_receta ir ON ir.tenant_id = ${tenantId}::uuid AND ir.id = pr.item_receta_id AND ir.receta_id = ANY(${recetaIds}::uuid[])
    JOIN fsj.proveedor pv ON pv.tenant_id = ${tenantId}::uuid AND pv.id = p.proveedor_id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.droga_id = ${drogaId}::uuid
    GROUP BY ir.receta_id, p.id, p.lote, p.fecha_vencimiento, p.fecha_ingreso, pv.razon_social
    ORDER BY ir.receta_id, p.fecha_ingreso DESC, p.id DESC
  `;
  return rows.map((r) => ({
    recetaId: r.receta_id,
    partidaId: r.partida_id,
    lote: r.lote,
    proveedor: r.proveedor,
    fechaVencimiento: r.fecha_vencimiento,
    cantidad: r.cantidad,
  }));
}

/** Names (only) of the pacientes of the page's recetas, in ONE statement. Read ONLY with `pacientes.gestionar`. */
export async function readPacientes(tx: Prisma.TransactionClient, tenantId: string, recetaIds: string[]): Promise<PacienteRecetaCrudo[]> {
  const rows = await tx.$queryRaw<{ receta_id: string; apellido: string; nombre: string }[]>`
    SELECT r.id AS receta_id, pa.apellido, pa.nombre
    FROM fsj.receta r
    JOIN fsj.paciente pa ON pa.tenant_id = ${tenantId}::uuid AND pa.id = r.paciente_id
    WHERE r.tenant_id = ${tenantId}::uuid AND r.id = ANY(${recetaIds}::uuid[])
  `;
  return rows.map((r) => ({ recetaId: r.receta_id, apellido: r.apellido, nombre: r.nombre }));
}

/**
 * The raw Historial of one droga: header, options, one page of recetas and
 * the requested optional pieces. `null` when the droga does not exist in the
 * tenant. `page` is clamped to the last page of the FILTERED result.
 * `partidaIdsSolicitados` is the (already parsed) filter: ids that are not one
 * of the droga's option partidas are ignored.
 */
export async function getHistorialDrogaCruda(
  tx: Prisma.TransactionClient,
  tenantId: string,
  drogaId: string,
  page: number,
  pageSize: number,
  bloques: BloquesHistorialDroga,
  partidaIdsSolicitados: readonly string[] = [],
): Promise<HistorialDrogaCruda | null> {
  const droga = await readDroga(tx, tenantId, drogaId);
  if (!droga) return null;

  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { zonaHoraria: true } });
  const partidasDisponibles = await readPartidasConConsumo(tx, tenantId, drogaId);
  // The requested ids are never trusted: only those that are one of the droga's own option partidas are applied.
  const partidaIds = filtrarPartidasDeLaDroga(partidaIdsSolicitados, partidasDisponibles);

  // No partida with an egreso means no receta at all: skip the heavy statements.
  const { totalRecetas, totalFiltradas } = partidasDisponibles.length === 0 ? { totalRecetas: 0, totalFiltradas: 0 } : await countRecetas(tx, tenantId, drogaId, partidaIds);
  const paginacion = calcularPaginacion(totalFiltradas, page, pageSize);

  const recetas = totalFiltradas === 0 ? [] : await readRecetasPagina(tx, tenantId, drogaId, partidaIds, paginacion.page, pageSize);
  const recetaIds = recetas.map((r) => r.id);
  const partidasConsumidas = recetaIds.length > 0 ? await readPartidasConsumidas(tx, tenantId, drogaId, recetaIds) : [];
  const pacientes = bloques.pacientes && recetaIds.length > 0 ? await readPacientes(tx, tenantId, recetaIds) : [];

  return {
    droga,
    zonaHoraria: tenant.zonaHoraria,
    partidasDisponibles,
    partidaIds,
    totalRecetas,
    totalFiltradas,
    page: paginacion.page,
    recetas,
    pacientes,
    partidasConsumidas,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- tests/unit/drogas-historial-repository.test.ts`
Expected: PASS. If the JOIN-tenant test fails, check that every `JOIN fsj.x alias ON alias.tenant_id = ${tenantId}::uuid` is on ONE line (the regex is line-agnostic but needs `ON` right after the alias).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck` then `npm run lint -- modules/drogas/infrastructure/historial-repository.ts tests/unit/drogas-historial-repository.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git --literal-pathspecs add modules/drogas/infrastructure/historial-repository.ts tests/unit/drogas-historial-repository.test.ts
git commit -m "feat(drogas): add historial repository with tenant-scoped raw SQL"
```

---

## Task 3: Use case + permission gating + tests

**Files**
- Create: `modules/drogas/application/get-historial-droga.ts`
- Test: `tests/unit/drogas-historial-usecase.test.ts`

**Interfaces**

```ts
export const getHistorialDrogaQuery: DefinedUseCase<HistorialDroga | null>; // name "drogas.historial", permiso "recetas.crear"
export type GetHistorialDrogaInput = z.input<typeof getHistorialDrogaInput>; // { drogaId: string; page?: number; partidaIds?: string[] }
export function accesoHistorialDroga(session: AuthenticatedSession): AccesoHistorialDroga; // { pacientes: can pacientes.gestionar, stock: can stock.ver }
export function puedeVerHistorialDroga(session: AuthenticatedSession): boolean;            // can recetas.crear
export async function getHistorialDroga(input: GetHistorialDrogaInput): Promise<HistorialDroga | null>;
export type { HistorialDroga };
```

**Label check (D6).** `drogaId`, `page` and `partidaIds` already have entries in `shared/labels/field-labels.ts`. No edit; Step 4 proves it through the registry test.

- [ ] **Step 1: Write the failing test** `tests/unit/drogas-historial-usecase.test.ts`

```ts
/**
 * `drogas.historial` (modules/drogas/application/get-historial-droga.ts):
 * declared permiso, gating of the optional pieces through can() (no extra
 * defineQuery), and input validation. The repository is mocked: this proves the
 * use case's wiring and the permission rules, not the SQL (that is
 * tests/unit/drogas-historial-repository.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError, ValidationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";
import type { HistorialDrogaCruda } from "@/modules/drogas/domain/historial";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const getHistorialDrogaCruda = vi.fn();
vi.mock("@/modules/drogas/infrastructure/historial-repository", () => ({
  getHistorialDrogaCruda: (...args: unknown[]) => getHistorialDrogaCruda(...args),
}));

const { getHistorialDrogaQuery, accesoHistorialDroga, puedeVerHistorialDroga } = await import("@/modules/drogas/application/get-historial-droga");
const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const TENANT = "11111111-1111-1111-1111-111111111111";
const DROGA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PARTIDA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sessionWith(permisos: Permiso[]): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "a@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const cruda = (): HistorialDrogaCruda => ({
  droga: { id: DROGA, nombre: "Minoxidil", fechaBaja: null, unidadBaseId: "u-g", unidadBaseSimbolo: "g" },
  zonaHoraria: "America/Argentina/Mendoza",
  partidasDisponibles: [],
  partidaIds: [],
  totalRecetas: 1,
  totalFiltradas: 1,
  page: 1,
  recetas: [{ id: "r1", numeroInterno: "120", estado: "PREPARADA", preparadaEn: new Date("2026-10-01T15:00:00Z"), consumido: "5", medicoApellido: "Gómez", medicoNombre: "Ana" }],
  pacientes: [{ recetaId: "r1", apellido: "Pérez", nombre: "Juan" }],
  partidasConsumidas: [],
});

beforeEach(() => {
  getHistorialDrogaCruda.mockReset();
  getHistorialDrogaCruda.mockImplementation(async () => cruda());
});

describe("drogas.historial -- declared permiso and gate", () => {
  it('is registered as "drogas.historial" on permiso "recetas.crear" (the receta-read permiso, same as recetas.ver / recetas.listar)', () => {
    const entry = listRegisteredUseCasesForTests().find((e) => e.name === "drogas.historial");
    expect(entry, 'no registered use case named "drogas.historial"').toBeDefined();
    expect(entry!.permiso).toBe("recetas.crear");
    expect(entry!.kind).toBe("query");
  });

  it("denies a session without recetas.crear even if it holds every other permiso involved, and never reads", async () => {
    const session = sessionWith(["drogas.editar", "pacientes.gestionar", "stock.ver"]);
    await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session })).rejects.toBeInstanceOf(AuthorizationError);
    expect(getHistorialDrogaCruda).not.toHaveBeenCalled();
  });

  it("allows recetas.crear and passes (tx, tenant, droga, page, page size, acceso, filter) to the repository", async () => {
    const session = sessionWith(["recetas.crear"]);
    await getHistorialDrogaQuery.execute({ drogaId: DROGA, page: 3, partidaIds: [PARTIDA] }, { session });
    expect(getHistorialDrogaCruda).toHaveBeenCalledTimes(1);
    expect(getHistorialDrogaCruda).toHaveBeenCalledWith({ __fakeTx: true, tenantId: TENANT }, TENANT, DROGA, 3, 20, { pacientes: false, stock: false }, [PARTIDA]);
  });

  it("defaults page to 1 and the filter to empty", async () => {
    await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear"]) });
    expect(getHistorialDrogaCruda).toHaveBeenCalledWith(expect.anything(), TENANT, DROGA, 1, 20, expect.anything(), []);
  });
});

describe("drogas.historial -- optional pieces follow the session's OTHER permisos (can(), no extra defineQuery)", () => {
  it("a session with only recetas.crear sees no paciente and no stock link", () => {
    expect(accesoHistorialDroga(sessionWith(["recetas.crear"]))).toEqual({ pacientes: false, stock: false });
  });

  it("each flag is exactly the permiso of its piece", () => {
    const cases: ReadonlyArray<[Permiso, keyof ReturnType<typeof accesoHistorialDroga>]> = [
      ["pacientes.gestionar", "pacientes"],
      ["stock.ver", "stock"],
    ];
    for (const [permiso, flag] of cases) {
      const acceso = accesoHistorialDroga(sessionWith(["recetas.crear", permiso]));
      for (const [, other] of cases) expect(acceso[other], `${permiso} -> ${String(other)}`).toBe(other === flag);
    }
  });

  it("asks the repository for the paciente names only with pacientes.gestionar", async () => {
    await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear", "pacientes.gestionar"]) });
    expect(getHistorialDrogaCruda).toHaveBeenLastCalledWith(expect.anything(), TENANT, DROGA, 1, 20, { pacientes: true, stock: false }, []);
  });

  it("never exposes a paciente without pacientes.gestionar, even if the repository handed rows in", async () => {
    const out = await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear"]) });
    expect(out!.recetas[0]!.paciente).toBeNull();
    expect(JSON.stringify(out)).not.toContain("Pérez");
  });

  it("shows the paciente name with pacientes.gestionar", async () => {
    const out = await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear", "pacientes.gestionar", "stock.ver"]) });
    expect(out!.recetas[0]!.paciente).toBe("Pérez, Juan");
    expect(out!.acceso).toEqual({ pacientes: true, stock: true });
  });

  it("returns null when the droga does not exist in the tenant (the page answers 404)", async () => {
    getHistorialDrogaCruda.mockResolvedValueOnce(null);
    expect(await getHistorialDrogaQuery.execute({ drogaId: DROGA }, { session: sessionWith(["recetas.crear"]) })).toBeNull();
  });
});

describe("puedeVerHistorialDroga -- the single rule for the tab and the page", () => {
  it("is true only with recetas.crear", () => {
    expect(puedeVerHistorialDroga(sessionWith(["recetas.crear"]))).toBe(true);
    expect(puedeVerHistorialDroga(sessionWith(["drogas.editar", "pacientes.gestionar", "stock.ver"]))).toBe(false);
  });
});

describe("drogas.historial -- input validation", () => {
  const session = () => sessionWith(["recetas.crear"]);

  it("rejects a malformed droga id", async () => {
    await expect(getHistorialDrogaQuery.execute({ drogaId: "no-uuid" }, { session: session() })).rejects.toBeInstanceOf(ValidationError);
    expect(getHistorialDrogaCruda).not.toHaveBeenCalled();
  });

  it("rejects page 0, a fractional page and a page above the cap", async () => {
    for (const page of [0, 1.5, 100_001]) {
      await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA, page }, { session: session() })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("rejects a filter with a non-uuid id or more than 20 ids", async () => {
    await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA, partidaIds: ["x"] }, { session: session() })).rejects.toBeInstanceOf(ValidationError);
    const veintiuno = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA, partidaIds: veintiuno }, { session: session() })).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts exactly 20 filter ids", async () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await expect(getHistorialDrogaQuery.execute({ drogaId: DROGA, partidaIds: veinte }, { session: session() })).resolves.not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/unit/drogas-historial-usecase.test.ts`
Expected: FAIL (cannot resolve `@/modules/drogas/application/get-historial-droga`).

- [ ] **Step 3: Implement** `modules/drogas/application/get-historial-droga.ts`

```ts
/**
 * `getHistorialDroga` (docs/specs/historial-droga.md): read-only "every receta
 * that CONSUMED this droga, and from which partida(s)", for
 * `/catalogos/drogas/[id]/historial`. HEALTH-ADJACENT DATA (recetas, pacientes,
 * Ley 25.326): the URL carries only the opaque droga id, a plain `?page=`
 * integer and the optional repeatable `?partida=<uuid>` filter (partida ids are
 * not sensitive); nothing here is ever logged.
 *
 * Gated on `recetas.crear` -- the broadest recetas.* permiso, the one the
 * `/recetas/**` layout and `getReceta` ("recetas.ver") guard on (the spec's
 * `recetas.ver` is a use-case name, not a permiso code; plan D1).
 *
 * `defineQuery` takes ONE permiso (and a denial writes an ACCESO_DENEGADO audit
 * row), so the optional pieces use `can()` instead of other `defineQuery` use
 * cases: the paciente name (`pacientes.gestionar`) is not even queried without
 * it, and `stock.ver` only gates the partida link and the unit conversion in
 * the UI. Reads are not audited (project convention). Returns `null` when the
 * droga does not exist in the tenant (the page answers 404).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { uuid } from "@/shared/validation";
import { PAGE_MAX_HISTORIAL_DROGA, PAGE_SIZE_HISTORIAL_DROGA, PARTIDAS_FILTRO_MAX, armarHistorialDroga } from "../domain/historial";
import type { AccesoHistorialDroga, HistorialDroga } from "../domain/historial";
import { getHistorialDrogaCruda } from "../infrastructure/historial-repository";

export type { HistorialDroga };

const getHistorialDrogaInput = z.object({
  drogaId: uuid,
  page: z.number().int().min(1).max(PAGE_MAX_HISTORIAL_DROGA).default(1),
  /** Partida filter (OR): ids that are not one of the droga's option partidas are ignored by the repository. Empty = no filter. */
  partidaIds: z.array(uuid).max(PARTIDAS_FILTRO_MAX).default([]),
});

export type GetHistorialDrogaInput = z.input<typeof getHistorialDrogaInput>;

/** Each flag is the permiso of the piece / of the target page's own guard. */
export function accesoHistorialDroga(session: AuthenticatedSession): AccesoHistorialDroga {
  return {
    pacientes: can(session, "pacientes.gestionar"),
    stock: can(session, "stock.ver"),
  };
}

/**
 * THE rule for "may this session see the Historial": the tab (`DrogaTabs`) and
 * the page both ask it, so the UI never shows a link the page would turn away
 * and the page never calls the use case (which would audit a denial) for a
 * session that cannot pass it.
 */
export function puedeVerHistorialDroga(session: AuthenticatedSession): boolean {
  return can(session, "recetas.crear");
}

export const getHistorialDrogaQuery = defineQuery({
  name: "drogas.historial",
  permiso: "recetas.crear",
  input: getHistorialDrogaInput,
  handler: async ({ tx, session, input }): Promise<HistorialDroga | null> => {
    const acceso = accesoHistorialDroga(session);
    const cruda = await getHistorialDrogaCruda(tx, session.tenantId, input.drogaId, input.page, PAGE_SIZE_HISTORIAL_DROGA, acceso, input.partidaIds);
    return cruda ? armarHistorialDroga(cruda, acceso) : null;
  },
});

export async function getHistorialDroga(input: GetHistorialDrogaInput): Promise<HistorialDroga | null> {
  return getHistorialDrogaQuery.execute(input);
}
```

- [ ] **Step 4: Run it, then the cross-module registry guard**

Run: `npm test -- tests/unit/drogas-historial-usecase.test.ts`
Expected: PASS.

Run: `npm test -- tests/unit/usecase-registry-all-modules.test.ts tests/unit/drogas-authorization-matrix.test.ts`
Expected: PASS. This confirms the glob-discovered use case rejects a permissionless session with `AuthorizationError` and that `drogaId`, `page` and `partidaIds` all have labels (no label edit needed). If the label guard names a missing key, add that key to `shared/labels/field-labels.ts` in the "References to other entities" block and include the file in the commit.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck` then `npm run lint -- modules/drogas/application/get-historial-droga.ts tests/unit/drogas-historial-usecase.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git --literal-pathspecs add modules/drogas/application/get-historial-droga.ts tests/unit/drogas-historial-usecase.test.ts
git commit -m "feat(drogas): add historial use case gated on recetas.crear"
```

---

## Task 4: UI components (header, row cells + detail, partida filter)

**Files**
- Create: `modules/drogas/ui/historial-encabezado.tsx`
- Create: `modules/drogas/ui/historial-receta-fila.tsx`
- Create: `modules/drogas/ui/historial-filtro-partidas.tsx`

No unit tests for rendering (the repo has none for UI components). Correctness is covered by typecheck/lint, the pure helpers already tested in Task 1, and the privacy source scan added in Task 5. Server components except the filter (client). Modules do not import each other's UI, and these components only import `shared/*`, their own `../domain/historial`, and `lucide-react`/`next`.

**Interfaces**

```ts
// historial-encabezado.tsx
export function HistorialEncabezado({ droga }: { droga: DrogaHistorial }): JSX.Element;

// historial-receta-fila.tsx
export const COLUMNAS_TABLA_HISTORIAL = 7; // toggle + Nº, Preparada, Paciente, Médico, Consumido, Estado
export function etiquetaReceta(receta: RecetaHistorial): string; // "Receta Nº 120"
export function HistorialRecetaCeldas(props: HistorialRecetaFilaProps): JSX.Element;
export function HistorialRecetaDetalle(props: HistorialRecetaFilaProps): JSX.Element;
interface HistorialRecetaFilaProps { receta: RecetaHistorial; droga: DrogaHistorial; acceso: AccesoHistorialDroga; zonaHoraria: string; catalogo: CatalogoUnidades }

// historial-filtro-partidas.tsx ("use client")
export interface HistorialFiltroPartidasProps { elegidas: readonly PartidaOpcion[]; restantes: readonly PartidaOpcion[]; baseHref: string }
export function HistorialFiltroPartidas(props: HistorialFiltroPartidasProps): JSX.Element;
```

- [ ] **Step 1: Create** `modules/drogas/ui/historial-encabezado.tsx`

```tsx
/**
 * Header of `/catalogos/drogas/[id]/historial`: breadcrumbs
 * `Inicio › Catálogos › Drogas › <droga> › Historial`, the droga's name and its
 * vigente / dada de baja badge (same title as the Datos tab). Server component.
 * Rendered only for sessions that passed the use case's `recetas.crear` gate.
 */
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import type { DrogaHistorial } from "../domain/historial";

export function HistorialEncabezado({ droga }: { droga: DrogaHistorial }) {
  return (
    <PageHeader
      breadcrumbs={[
        { label: "Inicio", href: "/" },
        { label: "Catálogos" },
        { label: "Drogas", href: "/catalogos/drogas" },
        { label: droga.nombre, href: `/catalogos/drogas/${droga.id}` },
        { label: "Historial" },
      ]}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {droga.nombre}
          <ToneBadge tone={droga.fechaBaja ? "neutral" : "success"}>{droga.fechaBaja ? "Dada de baja" : "Vigente"}</ToneBadge>
        </span>
      }
      description="Recetas que consumieron esta droga y de qué partida salió."
    />
  );
}
```

- [ ] **Step 2: Create** `modules/drogas/ui/historial-receta-fila.tsx`

```tsx
/**
 * One receta (that consumed the droga) of the Historial as a row of the recetas
 * table. Two server components feed `shared/ui/fila-desplegable.tsx` (the only
 * client piece, which just holds the open/closed state):
 * `HistorialRecetaCeldas` renders the summary cells (Nº, preparada, paciente,
 * médico, consumido, estado) and `HistorialRecetaDetalle` renders the expanded
 * body: one line per partida consumed by that receta (lote, proveedor,
 * vencimiento, quantity) plus the link to the receta and, with `acceso.stock`,
 * to each partida.
 *
 * The summary cells carry no links on purpose (the whole row toggles on click);
 * the links live in the detail. Quantities are always the droga's unidad base,
 * converted for display only with the unit catalog the page loads under
 * `stock.ver` (an empty catalog leaves them unconverted). The paciente cell is
 * "—" when the session lacks `pacientes.gestionar` (the name is not even
 * fetched). Quantities are never summed across drogas: everything here is one
 * droga, one unidad base.
 */
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatCantidad } from "@/shared/format/cantidad";
import type { CatalogoUnidades } from "@/shared/format/cantidad";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { Cantidad } from "@/shared/ui/cantidad";
import { StatusBadge } from "@/shared/ui/status-badge";
import type { AccesoHistorialDroga, DrogaHistorial, RecetaHistorial } from "../domain/historial";

interface HistorialRecetaFilaProps {
  receta: RecetaHistorial;
  droga: DrogaHistorial;
  acceso: AccesoHistorialDroga;
  zonaHoraria: string;
  catalogo: CatalogoUnidades;
}

/** Total column count of the recetas table: toggle + Nº, Preparada, Paciente, Médico, Consumido, Estado. */
export const COLUMNAS_TABLA_HISTORIAL = 7;

/** Accessible name of a receta row (completes the toggle button's label). */
export function etiquetaReceta(receta: RecetaHistorial): string {
  return `Receta Nº ${receta.numeroInterno}`;
}

/** The summary `<td>`s of a receta row, in the table's column order (after the toggle cell). */
export function HistorialRecetaCeldas({ receta, droga, zonaHoraria, catalogo }: HistorialRecetaFilaProps) {
  const unidad = { id: droga.unidadBaseId, simbolo: droga.unidadBaseSimbolo };
  return (
    <>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono font-medium text-zinc-900">{receta.numeroInterno}</td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums">{receta.preparadaEn ? formatFechaHora(receta.preparadaEn, zonaHoraria) : "—"}</td>
      <td className="px-3 py-2.5">{receta.paciente ?? <span className="text-zinc-400">—</span>}</td>
      <td className="hidden px-3 py-2.5 md:table-cell">{receta.medico}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">
        <Cantidad valor={formatCantidad(receta.consumido, unidad, catalogo)} />
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge estado={receta.estado} />
      </td>
    </>
  );
}

/** The expanded body of a receta row. */
export function HistorialRecetaDetalle({ receta, droga, acceso, catalogo }: HistorialRecetaFilaProps) {
  const unidad = { id: droga.unidadBaseId, simbolo: droga.unidadBaseSimbolo };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[0.8125rem] font-semibold text-zinc-900">Partidas consumidas</h3>
        <Link href={`/recetas/${receta.id}`} className="btn btn-secondary btn-sm">
          Ver receta
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {receta.partidas.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin partidas registradas.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Lote</th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Proveedor</th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Vencimiento</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Consumido</th>
              </tr>
            </thead>
            <tbody>
              {receta.partidas.map((partida) => (
                <tr key={partida.partidaId} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono">
                    {acceso.stock ? (
                      <Link href={`/stock/partidas/${partida.partidaId}`} className="underline underline-offset-2">
                        {partida.lote}
                      </Link>
                    ) : (
                      partida.lote
                    )}
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">{partida.proveedor}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2 font-mono tabular-nums sm:table-cell">
                    {partida.fechaVencimiento ? formatFecha(partida.fechaVencimiento) : "No vence"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    <Cantidad valor={formatCantidad(partida.cantidad, unidad, catalogo)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create** `modules/drogas/ui/historial-filtro-partidas.tsx`

```tsx
"use client";

/**
 * "Filtrar por partida" control of the droga Historial table (docs/specs/historial-droga.md,
 * "Filtro por partida"). An AUTOCOMPLETE over the droga's partidas that have at
 * least one consumption and are NOT selected yet (typing narrows them; picking
 * one adds it), plus one chip per selected partida (its × drops that partida,
 * accessible name "Quitar filtro <etiqueta>"). Same URL contract as the proveedor's
 * "Filtrar por droga": repeated `?partida=a&partida=b`, `page` dropped on every
 * change (the URL is rebuilt with `hrefHistorialDroga` WITHOUT a page). The options and
 * the selection come from the use case (already restricted to the droga's own
 * partidas, split by the page with the domain helpers), never from the raw URL.
 * A NEW component on purpose: modules do not import each other's UI.
 */
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Combobox, filtrarOpciones } from "@/shared/ui/combobox";
import { etiquetaPartidaOpcion, hrefHistorialDroga } from "../domain/historial";
import type { PartidaOpcion } from "../domain/historial";

export interface HistorialFiltroPartidasProps {
  /** The droga's partidas currently filtered (`partidasSeleccionadas`). */
  elegidas: readonly PartidaOpcion[];
  /** The droga's partidas not filtered yet (`partidasRestantes`), newest ingreso first. */
  restantes: readonly PartidaOpcion[];
  /** The historial's URL without query string. */
  baseHref: string;
}

export function HistorialFiltroPartidas({ elegidas, restantes, baseHref }: HistorialFiltroPartidasProps) {
  const router = useRouter();
  const seleccionadas = elegidas.map((p) => p.id);
  const search = useMemo(() => filtrarOpciones(restantes.map((p) => ({ value: p.id, label: etiquetaPartidaOpcion(p) }))), [restantes]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {restantes.length > 0 ? (
        <div className="w-full min-w-0 sm:w-80">
          <Combobox
            id="historial-partida"
            label="Filtrar por partida"
            hideLabel
            size="sm"
            placeholder={elegidas.length > 0 ? "Agregar otra partida…" : "Filtrar por partida…"}
            search={search}
            value={null}
            onChange={(option) => {
              if (option) router.push(hrefHistorialDroga(baseHref, [...seleccionadas, option.value]), { scroll: false });
            }}
          />
        </div>
      ) : null}

      {elegidas.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Partidas seleccionadas">
          {elegidas.map((partida) => {
            const etiqueta = etiquetaPartidaOpcion(partida);
            return (
              <span key={partida.id} className="chip">
                <strong>{etiqueta}</strong>
                <Link
                  href={hrefHistorialDroga(
                    baseHref,
                    seleccionadas.filter((id) => id !== partida.id),
                  )}
                  scroll={false}
                  className="chip-remove"
                  aria-label={`Quitar filtro ${etiqueta}`}
                >
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            );
          })}
          {elegidas.length > 1 ? (
            <Link href={baseHref} scroll={false} className="btn btn-ghost btn-sm">
              Limpiar
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck` then `npm run lint -- modules/drogas/ui/historial-encabezado.tsx modules/drogas/ui/historial-receta-fila.tsx modules/drogas/ui/historial-filtro-partidas.tsx`
Expected: no errors. Note: `Combobox`'s `onChange` receives `ComboboxOption | null`, and `filtrarOpciones(options)` returns `(query) => Promise<readonly ComboboxOption[]>`, which is assignable to `search`.

- [ ] **Step 5: Commit**

```bash
git --literal-pathspecs add modules/drogas/ui/historial-encabezado.tsx modules/drogas/ui/historial-receta-fila.tsx modules/drogas/ui/historial-filtro-partidas.tsx
git commit -m "feat(drogas): add historial header, receta rows and partida filter ui"
```

---

## Task 5: Routes: layout guard, tabs, Historial page, tabs on the Datos page, privacy scan

**Files**
- Create: `app/(app)/catalogos/drogas/[id]/layout.tsx`
- Create: `app/(app)/catalogos/drogas/droga-tabs.tsx`
- Create: `app/(app)/catalogos/drogas/[id]/historial/page.tsx`
- Modify: `app/(app)/catalogos/drogas/[id]/page.tsx`
- Test: `tests/unit/drogas-historial-privacy.test.ts`

This Next.js is non-standard (`AGENTS.md`). The patterns below copy files already running on this version (`app/(app)/proveedores/[id]/{layout,historial/page}.tsx`: `params`/`searchParams` as Promises, `notFound`/`redirect` from `next/navigation`). Before writing, skim `node_modules/next/dist/docs/01-app/` for "layout", "redirect" and "not-found" to confirm nothing in these signatures changed.

- [ ] **Step 1: Create** `app/(app)/catalogos/drogas/[id]/layout.tsx`

```tsx
/**
 * Layout for `/catalogos/drogas/[id]/**`: only the uuid guard (a malformed id is a 404 here, before the Datos
 * use case would throw a ValidationError). Each page renders its own header (breadcrumbs back to the list) and the
 * droga's "Datos | Historial" tabs (`DrogaTabs`, ../droga-tabs.tsx), so the tabs sit under the droga's name. The access
 * guard (`drogas.editar`) is the parent `catalogos/drogas/layout.tsx`. Layouts and pages render independently, so the
 * Historial page repeats the uuid check itself.
 */
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { uuid } from "@/shared/validation";

interface DrogaIdLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function DrogaIdLayout({ children, params }: DrogaIdLayoutProps) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  return <>{children}</>;
}
```

- [ ] **Step 2: Create** `app/(app)/catalogos/drogas/droga-tabs.tsx`

```tsx
/**
 * "Datos | Historial" tabs of ONE droga (`/catalogos/drogas/[id]/**`). Rendered by each page right under its
 * header. "Datos" is an exact match because its href is a prefix of the Historial one. The Historial tab only
 * exists for sessions that may see it (`puedeVerHistorialDroga`: `recetas.crear`, the permiso the page itself checks);
 * without it there is a single section, so no tab bar is rendered at all.
 */
import { SectionTabs } from "../../section-tabs";

export function DrogaTabs({ id, conHistorial }: { id: string; conHistorial: boolean }) {
  if (!conHistorial) return null;
  return (
    <SectionTabs
      ariaLabel="Secciones de la droga"
      links={[
        { href: `/catalogos/drogas/${id}`, label: "Datos", exact: true },
        { href: `/catalogos/drogas/${id}/historial`, label: "Historial" },
      ]}
    />
  );
}
```

- [ ] **Step 3: Create** `app/(app)/catalogos/drogas/[id]/historial/page.tsx`

```tsx
/**
 * `/catalogos/drogas/[id]/historial` (docs/specs/historial-droga.md): read-only
 * view of every receta that CONSUMED the droga and from which partida(s), as a
 * `table.data-table` whose rows expand to the detail (`FilaDesplegable`).
 * `[id]` is an opaque UUID and `searchParams` ONLY ever reads `page` (a plain
 * integer) and `partida` (repeatable uuid filter, parsed by `parsearPartidaIds`
 * and re-checked against the droga's own partidas by the repository). Base
 * access is the parent layout's `drogas.editar` guard; the receta data needs
 * `recetas.crear` (`puedeVerHistorialDroga`): without it this page redirects to
 * the Datos tab BEFORE calling the use case, so no ACCESO_DENEGADO row is
 * written for a link the UI never showed. Paciente names and the partida links
 * are decided by the use case from the session's other permisos.
 */
import { notFound, redirect } from "next/navigation";
import { PackageSearch, SearchX } from "lucide-react";
import { getHistorialDroga, puedeVerHistorialDroga } from "@/modules/drogas/application/get-historial-droga";
import {
  PAGE_MAX_HISTORIAL_DROGA,
  hrefHistorialDroga,
  parsearPartidaIds,
  partidasRestantes,
  partidasSeleccionadas,
} from "@/modules/drogas/domain/historial";
import { HistorialEncabezado } from "@/modules/drogas/ui/historial-encabezado";
import { HistorialFiltroPartidas } from "@/modules/drogas/ui/historial-filtro-partidas";
import { COLUMNAS_TABLA_HISTORIAL, HistorialRecetaCeldas, HistorialRecetaDetalle, etiquetaReceta } from "@/modules/drogas/ui/historial-receta-fila";
import { getCatalogoUnidades } from "@/modules/unidades/application/catalogo-unidades";
import { requireSession } from "@/shared/auth/session";
import { crearCatalogoUnidades } from "@/shared/format/cantidad";
import { EmptyState } from "@/shared/ui/empty-state";
import { FilaDesplegable } from "@/shared/ui/fila-desplegable";
import { Pagination } from "@/shared/ui/pagination";
import { uuid } from "@/shared/validation";
import { DrogaTabs } from "../../droga-tabs";

const numberFormat = new Intl.NumberFormat("es-AR");

interface HistorialDrogaPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; partida?: string | string[] }>;
}

export default async function HistorialDrogaPage({ params, searchParams }: HistorialDrogaPageProps) {
  const session = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  // Same rule as the use case's own input (zod uuid): anything else is a 404, never a ValidationError.
  if (!uuid.safeParse(id).success) notFound();
  // Decided here, before the use case: a session without the permiso is sent back to the Datos tab (and the tab was never shown to it).
  if (!puedeVerHistorialDroga(session)) redirect(`/catalogos/drogas/${id}`);

  // Clamped into the use case's accepted range (a huge digit string parses to Infinity); the repository then clamps to the last page.
  const parsedPage = Number.parseInt(query.page ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) ? Math.min(PAGE_MAX_HISTORIAL_DROGA, Math.max(1, parsedPage)) : 1;
  // Valid uuids only, deduplicated, capped: the repository then keeps just the ones that are this droga's own partidas.
  const historial = await getHistorialDroga({ drogaId: id, page: requestedPage, partidaIds: parsearPartidaIds(query.partida) });
  if (!historial) notFound();

  const { droga, acceso, zonaHoraria, partidasDisponibles, partidaIds, totalRecetas, recetas, paginacion } = historial;
  // The unit catalog is gated on `stock.ver`: without it (a denial would write an ACCESO_DENEGADO audit row) quantities show in the droga's own unidad base, unconverted.
  const catalogo = acceso.stock ? (await getCatalogoUnidades()).catalogo : crearCatalogoUnidades([]);

  const baseHref = `/catalogos/drogas/${id}/historial`;
  const filtrando = partidaIds.length > 0;
  // Pagination links keep EVERY selected partida (the effective filter, not the raw URL).
  const pageHref = (target: number) => hrefHistorialDroga(baseHref, partidaIds, target);

  return (
    <>
      <HistorialEncabezado droga={droga} />
      <DrogaTabs id={id} conHistorial />

      <section aria-labelledby="historial-recetas" className="list-panel">
        <div className="list-toolbar flex-wrap gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="historial-recetas" className="text-[0.9375rem] font-semibold text-zinc-900">
              Recetas
            </h2>
            <p role="status" className="text-xs">
              {filtrando ? (
                <>
                  <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(paginacion.total)}</span> de{" "}
                  <span className="tabular-nums">{numberFormat.format(totalRecetas)}</span> recetas
                </>
              ) : (
                <>
                  <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(paginacion.total)}</span> {paginacion.total === 1 ? "receta" : "recetas"}
                </>
              )}
              <span className="hidden sm:inline"> · tocá una fila para ver su detalle</span>
            </p>
          </div>
          {partidasDisponibles.length > 0 ? (
            <HistorialFiltroPartidas
              elegidas={partidasSeleccionadas(partidasDisponibles, partidaIds)}
              restantes={partidasRestantes(partidasDisponibles, partidaIds)}
              baseHref={baseHref}
            />
          ) : null}
        </div>

        {recetas.length === 0 ? (
          filtrando ? (
            <EmptyState icon={<SearchX className="size-5" />} title="Sin resultados" description="No hay recetas que hayan usado las partidas seleccionadas." />
          ) : (
            <EmptyState icon={<PackageSearch className="size-5" />} title="Sin recetas" description="Esta droga todavía no se usó en ninguna preparación." />
          )
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="w-8 px-3 py-2">
                    <span className="sr-only">Detalle</span>
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Nº
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Preparada
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Paciente
                  </th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">
                    Médico
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Consumido
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {recetas.map((receta) => (
                  <FilaDesplegable
                    key={receta.id}
                    id={receta.id}
                    etiqueta={etiquetaReceta(receta)}
                    colSpan={COLUMNAS_TABLA_HISTORIAL}
                    celdas={<HistorialRecetaCeldas receta={receta} droga={droga} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />}
                    detalle={<HistorialRecetaDetalle receta={receta} droga={droga} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={paginacion.page} pageSize={paginacion.pageSize} total={paginacion.total} hrefFor={pageHref} label="Paginación de recetas de la droga" />
      </section>
    </>
  );
}
```

- [ ] **Step 4: Modify** `app/(app)/catalogos/drogas/[id]/page.tsx`

Add two imports next to the existing ones:

```tsx
import { puedeVerHistorialDroga } from "@/modules/drogas/application/get-historial-droga";
import { DrogaTabs } from "../droga-tabs";
```

Render the tabs right under `PageHeader` (the closing of `<PageHeader ... />` and the `<div className="split-layout">` are unchanged):

```tsx
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Catálogos" }, { label: "Drogas", href: "/catalogos/drogas" }, { label: droga.nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {droga.nombre}
            <ToneBadge tone={droga.fechaBaja ? "neutral" : "success"}>{droga.fechaBaja ? "Dada de baja" : "Vigente"}</ToneBadge>
          </span>
        }
      />
      <DrogaTabs id={droga.id} conHistorial={puedeVerHistorialDroga(session)} />

      <div className="split-layout">
```

`session` is already in scope (`const session = await requireSession();`).

- [ ] **Step 5: Write the privacy scan test** `tests/unit/drogas-historial-privacy.test.ts`

```ts
/**
 * The droga Historial reads recetas and (optionally) paciente names: its source
 * must never log them (docs/specs/historial-droga.md: "No logging of free-text
 * fields or paciente data"). Same source scan as the proveedor Trayectoria.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const files = [
  "modules/drogas/domain/historial.ts",
  "modules/drogas/infrastructure/historial-repository.ts",
  "modules/drogas/application/get-historial-droga.ts",
  "modules/drogas/ui/historial-encabezado.tsx",
  "modules/drogas/ui/historial-receta-fila.tsx",
  "modules/drogas/ui/historial-filtro-partidas.tsx",
  "app/(app)/catalogos/drogas/droga-tabs.tsx",
  "app/(app)/catalogos/drogas/[id]/layout.tsx",
  "app/(app)/catalogos/drogas/[id]/historial/page.tsx",
];

describe("privacy: the droga historial's source never logs", () => {
  for (const file of files) {
    it(`${file} has no logger or console call`, () => {
      const source = readFileSync(path.resolve(__dirname, "../..", file), "utf8");
      expect(source).not.toMatch(/getLogger|shared\/logging|\blogger\.\w+\(|console\./);
    });
  }
});
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `npm test -- tests/unit/drogas-historial-privacy.test.ts tests/unit/drogas-historial.test.ts tests/unit/drogas-historial-repository.test.ts tests/unit/drogas-historial-usecase.test.ts`
Expected: PASS.

Run: `npm run typecheck` (it runs `next typegen`, which registers the new routes) then:
`npm run lint -- "app/(app)/catalogos/drogas" tests/unit/drogas-historial-privacy.test.ts`
Expected: no errors. `app/**` must not import `modules/*/infrastructure/**`, and none of the new app files do.

- [ ] **Step 7: Commit**

```bash
git --literal-pathspecs add "app/(app)/catalogos/drogas/[id]/layout.tsx" "app/(app)/catalogos/drogas/droga-tabs.tsx" "app/(app)/catalogos/drogas/[id]/historial/page.tsx" "app/(app)/catalogos/drogas/[id]/page.tsx" tests/unit/drogas-historial-privacy.test.ts
git commit -m "feat(drogas): add the historial tab and page under /catalogos/drogas/[id]"
```

---

## Task 6: Spec status, implementation notes, final verification

**Files**
- Modify: `docs/specs/historial-droga.md`

- [ ] **Step 1: Update the spec header and add notes.** Replace the status line `Status: approved by user 2026-10-07 — not implemented yet.` with `Status: approved by user 2026-10-07 — implemented (see "Implementation notes" at the end).` Append this section at the end of the file:

```markdown
## Implementation notes

Status: implemented 2026-10-07. Decisions taken while building it (none changes
the approved behavior; each is the narrowest reading of the spec).

- **Permiso codes.** `recetas.ver` / `pacientes.ver` are use-case NAMES, not
  permiso codes. The gates are the real ones: `recetas.crear` (tab, page and the
  `drogas.historial` defineQuery, same as `/recetas/**`), `pacientes.gestionar`
  (paciente name) and `stock.ver` (partida link + unit catalog).
  `recetas.crear` is `operativo`, so the locked ADMINISTRADOR does not hold it
  implicitly. A single helper, `puedeVerHistorialDroga`, is the rule used by the
  tab and the page.
- **Page size** is 20 (spec silent).
- **Paciente column** is always present, "—" without `pacientes.gestionar`; the
  paciente statement is not even executed in that case.
- **`DrogaTabs`** renders nothing when the session cannot see the Historial.
- **Statements.** options, count (unfiltered + filtered total in one pass), page,
  detail and (optional) paciente names: one each, whatever the page size. The
  partida filter is ONE bound `uuid[]` and the SQL switches on
  `cardinality(...) = 0`; the page applies it with `HAVING bool_or(...)`, and the
  detail statement never receives it (the filter selects recetas, it does not trim
  them).
- **Labels.** `drogaId`, `page` and `partidaIds` already existed in
  `shared/labels/field-labels.ts`; nothing was added.
- **Options are not capped** (a droga's partidas with egresos is a small list; the
  Combobox shows at most 30 matches at once).
- **Not verified against Postgres.** Everything was verified with unit tests
  (fake `tx`), typecheck and lint. The raw SQL (count, page, detail, paciente
  names, options) has NOT been executed against a real database in this change,
  by instruction (`test:db` points at the single production database). Run it once
  against a seeded tenant before relying on it, including: an empty `{}` filter
  array bound as `uuid[]`, a receta with items of several partidas, and an ANULADA
  receta (it must still appear).
```

- [ ] **Step 2: Full verification (read-only, no `test:db`)**

Run, each to completion:
1. `npm test` (whole unit project). Expected: all green; in particular the four `drogas-historial*` files, `usecase-registry-all-modules`, `drogas-authorization-matrix` and `proveedores-*` still pass.
2. `npm run typecheck`. Expected: no errors.
3. `npm run lint`. Expected: no errors.

If anything unrelated to this change fails, report it and do not fix it here.

- [ ] **Step 3: Commit**

```bash
git --literal-pathspecs add docs/specs/historial-droga.md
git commit -m "docs(specs): mark historial de la droga implemented and record decisions"
```

---

## Self-review checklist (against `docs/specs/historial-droga.md`)

- [ ] **Goal / consumed path only.** The SQL only goes `partida → movimiento_stock EGRESO_PREPARACION → preparacion → item_receta → receta`. No `componente_item_receta` anywhere. Pending recetas never appear (Tasks 2 and 5).
- [ ] **Routes and navigation.**
  - `/catalogos/drogas/[id]` has "Datos" (exact) and "Historial" tabs via `DrogaTabs` on `SectionTabs`. The tabs are rendered by each page under its header: the existing `[id]/page.tsx` (Task 5, Step 4) and the new historial page.
  - `[id]/layout.tsx` is a uuid guard only.
  - The tab only exists with the receta permiso. The historial URL without it redirects to the Datos tab BEFORE calling the use case, so no `ACCESO_DENEGADO` row.
  - URL carries only the uuid, `?page=` and repeatable `?partida=`.
  - Breadcrumbs are `Inicio › Catálogos › Drogas › <droga> › Historial`.
- [ ] **Permissions.**
  - Base guard is the existing `drogas.editar` layout.
  - The `defineQuery` is on the receta-read permiso, `recetas.crear` (D1, since `recetas.ver` is not a permiso).
  - `can()` gates `pacientes.gestionar` (name otherwise "—", statement not run) and `stock.ver` (link + `getCatalogoUnidades`, otherwise `crearCatalogoUnidades([])`).
  - No other `defineQuery` is invoked from the use case.
  - Tested in `drogas-historial-usecase.test.ts`.
- [ ] **Recetas table.**
  - One row per receta, ordered by latest `preparacion.confirmada_en` desc with `numero_interno DESC` tie-break.
  - Columns Nº, Preparada (tenant zone), Paciente, Médico (hidden on small screens), Consumido (SQL `SUM`, this droga only, all items and partidas), Estado (`StatusBadge`; ANULADA still shows).
  - `FilaDesplegable` closed by default.
  - Detail per partida: lote, proveedor, vencimiento ("No vence" for insumos), quantity from that partida.
  - Receta link always; partida link only with `stock.ver`.
- [ ] **Count line and empty states.** "N receta(s)" and "{filtradas} de {total} recetas". Empty copy is exactly "Esta droga todavía no se usó en ninguna preparación." and, with a filter, "No hay recetas que hayan usado las partidas seleccionadas." No resumen block.
- [ ] **Filtro por partida.**
  - New component in `modules/drogas/ui/`, `shared/ui/combobox`, chips with accessible name "Quitar filtro <etiqueta>", `page` dropped on every change.
  - Options are the droga's partidas with ≥1 egreso, `fecha_ingreso DESC`, label `Lote <lote> · <proveedor> · vence dd/mm/aaaa` / "sin vencimiento".
  - `parsearPartidaIds`: valid uuid, lowercase, dedupe, cap 20. Use case input is `z.array(uuid).max(20).default([])`.
  - Never trusted: foreign ids ignored, an all-foreign filter is no filter. The output carries `partidasDisponibles` and `partidaIds` (applied).
  - ANY-of semantics, and the filter does not trim "Consumido" or the detail (test: detail statement never receives the filter).
- [ ] **Technical design.** The domain (`historial.ts`), repository, `defineQuery` use case, `historial-*.tsx`, routes and `droga-tabs.tsx` all exist in the planned locations. Statement list in the repository matches spec steps 1–4, with `tenant_id` on every `FROM`/`JOIN` (generic regex test) and explicit columns. The paciente columns come from a separate statement that only runs with the permiso. No logging (privacy scan test).
- [ ] **Database.** No migration was added. The SQL enters via `partida (tenant_id, droga_id)` and `movimiento_stock (tenant_id, partida_id, registrado_en DESC)`, then by primary key. An index migration (next free number, currently 0067, plus rollback, separate commit) is only needed if a measurement on a seeded tenant says so; this is recorded in the spec notes.
- [ ] **Testing list.** All spec test items are covered:
  - `parsearPartidaIds` (invalid, duplicates, case, cap).
  - Option split helpers.
  - Partida label with and without vencimiento.
  - Pagination clamp.
  - Use case gating (no `pacientes` → no paciente fields fetched; no `stock.ver` → `acceso.stock` false, so no links or conversion).
  - Foreign partida ids ignored.
  - Fake-`tx` repository tests.
  - Typecheck and lint at the end of each task, and `npm test` in full at the end.
  - The "run the raw SQL once against a seeded tenant" requirement is a documented manual follow-up (never `test:db`).
- [ ] **Out of scope respected.** No pending-recetas view, no resumen block, no export, no other filters.
- [ ] **Global constraints.** English comments and identifiers following the repo's Spanish domain naming. Conventional commits on `master` without `Co-Authored-By`. No worktrees. No `test:db`.

---

### Critical Files for Implementation
- `M:\Projects\farmacia-san-jose\modules\drogas\domain\historial.ts`
- `M:\Projects\farmacia-san-jose\modules\drogas\infrastructure\historial-repository.ts`
- `M:\Projects\farmacia-san-jose\modules\drogas\application\get-historial-droga.ts`
- `M:\Projects\farmacia-san-jose\app\(app)\catalogos\drogas\[id]\historial\page.tsx`
- `M:\Projects\farmacia-san-jose\app\(app)\catalogos\drogas\[id]\page.tsx`
