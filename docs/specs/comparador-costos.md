# Comparador de costos de compra

Status: approved by user 2026-10-01 — implementation in progress.

## Goal

Pick one droga and compare what each proveedor charged for it: latest cost,
difference against the cheapest, weighted average, range, number of
partidas, with each proveedor's partidas expandable.

## Facts it relies on (research 2026-10-01)

- `partida.costo_unitario` is typed per UNIDAD BASE of the droga, without
  conversion (`modules/stock/application/ingresar-partida.ts`), and a droga's
  unidad base is immutable once it has partidas (migration 0028,
  INV-DRG-001) → costs of the same droga are directly comparable.
- No IVA/flete/bonificación fields exist; assumption (stated in the UI): all
  costs are loaded with the same criterion.
- No cost history: corrections overwrite in place (audit only). The
  comparator sees the corrected value.
- Data-quality risk: the ingreso form does not show the base unit and
  `"1.500"` parses as 1.5, so wrong-unit outliers exist → flagged, never
  silently excluded.
- No migration needed: `idx_partida_tenant_droga` is only `(tenant_id,
  droga_id)` (0043); for the per-proveedor lookups the planner will most likely
  use the unique `(tenant_id, droga_id, proveedor_id, lote)` index. Either way
  the rows read per droga are few, so no new index is required.

## Route, navigation, permission

- New sidebar entry **Gestión › Comparador de costos** (below Proveedores),
  route `/comparador-costos`, layout guard + sidebar visibility on
  `stock.valorizado.ver` (ADM/DT/FAR today — same permiso that gates money
  elsewhere).
- One `defineQuery` on `stock.valorizado.ver`. It also returns its own droga
  options (drogas with at least one partida in the tenant) — it must NOT
  call other defineQuerys (e.g. `listDrogasOpciones`, gated on
  `drogas.editar`).

## Filters (standard `FilterForm`, GET, auto-apply)

- `droga` (select, required to show results; empty → instructions empty
  state). Options: drogas with partidas, vigentes first then "(de baja)".
- `unidad`: display unit for costs — `base` | any convertible unit of the
  droga's magnitude (MASA/VOLUMEN chains). Default: a practical unit (base
  mg/mcg → g; base mcL → mL; otherwise base). Non-convertible magnitudes
  (UNIDAD, etc.) only offer `base`.
- `periodo`: `12m` (default) | `todo`. Applies to all metrics and the
  expandable partidas.

## Table (one row per proveedor; standard `.table-wrap` / `table.data-table`, `FilaDesplegable`)

Columns: ▸ · Proveedor · Último costo (+ CSS bar proportional to it) ·
Última compra · Diferencia vs. más barato ($ and %) · Promedio ponderado ·
Mín – Máx · Partidas.

- Ordered by último costo ascending; baja proveedores last.
- **Último costo** = cost of the latest partida (`fecha_ingreso DESC, id
  DESC`) with cost > 0 in the period.
- **Más barato** = lowest último costo among VIGENTE proveedores → badge
  "Más barato"; difference column "—" for it.
- **Diferencia** = (último − mínimo) and (último − mínimo) / mínimo × 100,
  decimal.js, never floats.
- **Promedio ponderado** = Σ(cantidad_inicial × costo) / Σ cantidad_inicial
  over partidas with cost > 0 in the period.
- Badges (standard badge/StatusBadge styles): "Más barato", "De baja"
  (row greyed, excluded from the ranking), "Antiguo" (latest purchase older
  than 12 months), "Revisar" when any of the proveedor's partidas is an
  outlier.
- **Outlier**: cost > 10× or < 0.1× the median of the droga's partidas with
  cost > 0 in the period; only when there are ≥ 3 such partidas. Median via
  `percentile_disc` or Decimal in JS (no floats, INV-PL-003).
- Partidas with cost 0 are excluded from min/avg/último and reported as a
  count ("N partidas con costo $ 0 no se consideran").
- Single proveedor → normal row + notice "Sin otros proveedores para
  comparar".
- Expanded detail: that proveedor's partidas for the droga in the period —
  fecha de ingreso, lote, cantidad inicial (formatted), costo (display unit),
  "Revisar" badge per outlier partida, link to `/stock/partidas/[id]` (only
  with `stock.ver`). Cap 50 rows, "mostrando 50 de N".

Header above the table: droga name, unidad base, display unit note
("Costos por g — convertidos desde la unidad base mg"), and the assumption
note on IVA/flete.

## Technical design

- Module: `modules/proveedores/` (`domain/comparador-costos.ts`,
  `infrastructure/comparador-costos-repository.ts`,
  `application/comparar-costos-droga.ts`, `ui/comparador-*.tsx`).
- Pure domain: unit conversion of a cost (`costoBase × factorDestino /
  factorOrigen`, Decimal), display-unit default and options, ranking,
  difference, outlier flags, antiguo flag, cost-0 handling.
- SQL: numeric aggregates as `::text` (pattern:
  `modules/stock/infrastructure/valorizado-repository.ts`), tenant filter on
  every table, explicit selects; never touch `receta`.
- Standard components ONLY: `FilterForm`, `.input`/labels as other filters,
  `.table-wrap`/`.data-table`, `FilaDesplegable`, badge styles /
  `StatusBadge`, `formatearMonto`/`formatearCostoUnitario`,
  `shared/format/cantidad.ts`, page header + count line + empty states like
  `app/(app)/proveedores/page.tsx`.

## Out of scope

- Fixing the ingreso form (show base unit next to cost, `1.500` trap) —
  recommended separately.
- IVA/flete/bonificación modelling, cost history, charts library.

## Implementation notes

Status: implemented 2026-10-01 (unit-tested with a fake `tx`; the raw SQL has NOT
been executed against Postgres in this change, by instruction: run it once on a
seeded tenant before relying on it).

### Files

- `modules/proveedores/domain/comparador-costos.ts`: pure rules (filter parsing,
  display unit, period, outliers, metrics, ranking, assembly).
- `modules/proveedores/infrastructure/comparador-costos-repository.ts`: reads.
- `modules/proveedores/application/comparar-costos-droga.ts`: use case
  `proveedores.comparar-costos` (`defineQuery`, permiso `stock.valorizado.ver`).
- `modules/proveedores/ui/comparador-filtros.tsx`, `comparador-encabezado.tsx`,
  `comparador-fila.tsx`: presentational server components.
- `app/(app)/comparador-costos/layout.tsx` (guard + `.page`) and `page.tsx`.
- Sidebar: `puedeComparadorCostos` (`app/(app)/layout.tsx`, `sidebar-nav.tsx`).
- Tests: `tests/unit/comparador-costos.test.ts`,
  `comparador-costos-repository.test.ts`,
  `comparador-costos-authorization-matrix.test.ts`.

### Decisions

- **Reads (4 statements, constant).** (1) tenant jornada, (2) droga-level
  statistic (count and median of the partidas with cost > 0 in the period),
  (3) one aggregate per proveedor (CTE `base` + `DISTINCT ON` for the latest
  cost, `FILTER (WHERE costo_unitario > 0)` for every metric, cost 0 only
  counted), (4) one batched detail query (`unnest(proveedor ids) CROSS JOIN
  LATERAL ... LIMIT 50`). The detail total ("mostrando 50 de N") is the
  aggregate's `partidas_total`, so there is no extra count query. All numeric
  values cross as `text`; sums and products are Postgres `numeric`.
- **Median in SQL, rule in the domain.** The median is `percentile_disc(0.5)`
  (exact numeric; for an even count it is the LOWER middle value, not the
  average of the two). The domain (`limitesAtipicos`) owns the rule (>= 3
  partidas, bounds `median x 10` and `median x 0.1`, strict) and hands the two
  bounds back to SQL, which only counts the aggregate's partidas outside them;
  the per-partida flag in the detail uses the same bounds (`esCostoAtipico`).
  The rule therefore lives in one place.
- **Period.** `12m` starts at the local midnight (tenant zona horaria, via
  `shared/time/jornada.ts#inicioDeJornada`) of the tenant's jornada actual minus
  12 calendar months; `todo` has no start. "Antiguo" compares the latest costed
  purchase's local calendar day with that same date (so with `12m` nothing is
  antiguo by construction; it matters with `todo`).
- **Display unit.** Options come from `CADENAS_CONVERTIBLES` (masa / volumen)
  restricted to vigente units of the droga's magnitude (the base is always
  kept). Default: mg/mcg base -> g, mcL -> mL, anything else the base. The URL
  carries `unidad=base|<CODIGO>`; whatever does not fit the droga falls back to
  the default. The unit catalog is read inside the repository (global table, no
  tenant filter) instead of calling `getCatalogoUnidades` (gated on `stock.ver`).
- **Filter URL.** The first option of "Mostrar costo por" and "Período" has an
  empty value (default), so `FilterForm` leaves no `unidad=` / `periodo=12m` noise
  and "Limpiar filtros" returns the bare route. `periodo=12m` is still accepted.
  "Mostrar costo por" is disabled (not submitted) until a droga is selected and is
  re-mounted when the droga changes.
- **Baja proveedores** are listed last, greyed (text only, since `FilaDesplegable`
  owns the `<tr>`), never take "Más barato", and show no difference ("—"), even if
  they were cheaper than every vigente proveedor.
- **"Más barato"**: see "Más barato and outliers" below; with a tie every tied
  vigente proveedor gets the badge and no difference.
- **Partidas column** = all partidas of the period (cost 0 included, with a
  muted "N con costo $ 0" line); the detail lists all of them, marking cost 0
  ("no se considera") and outliers ("Revisar").
- **Badges** use the shared `.badge` pill: `shared/ui/status-badge.tsx` gained
  an exported `ToneBadge` (and `BadgeTone`) for flags that are not workflow
  estados. The ranking bar is a decorative `aria-hidden` div; the figure is
  always written as text.
- **Field labels:** `periodo` ("Período") and `unidad` ("Mostrar costo por")
  added to `shared/labels/field-labels.ts` (completeness test).

- **"Más barato" and outliers (review fixes).** The badge needs at least two
  VIGENTE proveedores with a cost; the minimum (and so the difference column)
  is taken over the vigentes whose último costo is NOT an outlier (same band as
  "Revisar"); if all are outliers nobody wins. A difference is only shown for a
  cost above the minimum. The "Sin otros proveedores" notice follows the same
  definition (fewer than two vigentes with cost). Bars are scaled by the largest
  último costo of the vigentes that are not outliers (all rows with cost if none
  qualifies) and a cost above the scale is clamped to 100%.
- **Legend.** A small visible line in the header explains "Revisar" and "Antiguo"
  (the `title`s stay). The detail adds a note when "Revisar" is set and the list
  is capped at 50 (the flagged partidas may be older ones).
- **`droga` param present but not a uuid** shows the same "droga no disponible"
  notice as an unknown droga (`parsearFiltrosComparador().drogaInvalida`).

### Shared dependencies

- The page imports `shared/ui/fila-desplegable.tsx` (shared with both
  Trayectoria views).
- `comparador-costos-repository.ts` imports `readJornadaActual` from
  `modules/proveedores/infrastructure/trayectoria-repository.ts` (same module).

### Known limits

- Without a real database the SQL (`percentile_disc ... WITHIN GROUP`,
  `DISTINCT ON`, the `FILTER` aggregates and the LATERAL detail, with the
  nullable `::timestamptz` / `::numeric` binds) is verified only by statement
  shape tests.
- Outlier detection is only as good as the median: with few partidas (< 3) or a
  droga bought mostly in the wrong unit nothing (or the wrong ones) is flagged.
- The proveedor name is plain text (no link to `/proveedores/[id]`, whose guard is
  `proveedores.gestionar`, a different permiso than the page's).
