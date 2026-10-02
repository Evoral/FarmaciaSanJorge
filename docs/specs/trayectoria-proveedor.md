# Trayectoria del proveedor

Status: approved by user 2026-10-01 — implemented (see "Implementation notes" at the end).

## Goal

A per-supplier, read-only view that shows everything a proveedor has gone
through in the system, as an expandable list. Sibling of
`docs/specs/trayectoria-paciente.md` (same patterns).

Key fact: `Proveedor` relates ONLY to `Partida` (`schema.prisma` ~619), and
each partida IS an ingreso (migration 0008, INV-STK-002: exactly one
INGRESO_COMPRA movement per partida). There is no remito/factura entity, so
purchases cannot be grouped.

## Routes and navigation

- `/proveedores/[id]` gets two tabs, **Datos** (`/proveedores/[id]`, exact,
  the current edit/baja/reactivar page) | **Trayectoria**
  (`/proveedores/[id]/trayectoria`), via `app/(app)/proveedores/[id]/layout.tsx`
  (back link + tabs + uuid guard), same as `app/(app)/pacientes/[id]/layout.tsx`.
- The `/proveedores` list gets a "Trayectoria" link per row.
- URL carries only the opaque UUID, `?page=` and the optional repeatable
  `?droga=<uuid>` filter (see "Filtro por droga").
- Guard: existing `app/(app)/proveedores/layout.tsx` (`proveedores.gestionar`).

## Content

1. **Header**: razón social, CUIT (formatted), estado (vigente / dado de baja
   + motivo).
2. **Resumen** (over ALL the proveedor's partidas, computed in SQL `numeric`):
   partidas, drogas distintas, último ingreso, vencidas con saldo, por vencer;
   and — only with `stock.valorizado.ver` — total comprado
   (`SUM(cantidad_inicial * costo_unitario)`) and stock valorizado actual
   (`SUM(cantidad_disponible * costo_unitario)`), both at CURRENT cost (no
   cost history exists; say so in a hint). Quantities are never summed
   across drogas (different unidad base).
3. **Partidas** — `table.data-table` (same look as the other lists) with a
   count line, an empty-state row and the standard pagination bar; each row
   expands (closed by default, toggle button + click on the row, no links in the
   summary cells) to a full-width detail row, newest first
   (`fecha_ingreso desc, id desc`), 10 per page (`?page=`).
   - Summary columns: droga · lote · fecha de ingreso · cantidad inicial → disponible
     (with the droga's unidad base) · vencimiento + derived estado badge ·
     costo unitario (only with `stock.valorizado.ver`).
   - Derived partida estado (pure domain function, priority order):
     `AGOTADA` (disponible = 0) > `VENCIDA` (vencimiento < jornada actual of the
     tenant) > `POR_VENCER` (within `dias_alerta_vencimiento_partida`, default
     30, same source as the stock alerts) > `ABIERTA` (`fechaApertura` set) >
     `VIGENTE`. Reuse the stock module's existing rules/helpers where possible
     so the view never disagrees with `/stock` alerts.
   - Body:
     - Movimientos: latest 20 of the partida (tipo, cantidad + unidad, motivo
       de ajuste, observación, registrado por, autorizado por, fecha), with a
       note + link to the full kardex/partida page when there are more.
     - Preparaciones that consumed it (via `movimiento.preparacionId`): opaque
       link + estado + dates. Only with `preparaciones.iniciar`. NEVER follow
       to receta/paciente (health data, Ley 25.326).
     - Contralor (controlled drogas): número de vale de adquisición and asiento
       contralor número. Only with `libro.ver`.
     - Correcciones de costo: audit rows entidad `partida`, accion `MODIFICAR`
       (costo anterior → nuevo, motivo, quién, cuándo). Only with
       `auditoria.ver`.
     - Link to `/stock/partidas/[id]` (`stock.ver`).

## Filtro por droga

Approved by user 2026-10-01. A cumulative filter above the partidas table,
built with the system's standard `FilterForm` (`shared/ui/filter-form.tsx`).

- **Semantics.** Each partida has exactly ONE droga (`Partida.drogaId`), so
  several selected drogas combine with OR: `drogaId IN (...)`.
- **Controls** (`modules/proveedores/ui/trayectoria-filtro-drogas.tsx`, server
  component rendering the `FilterForm` children; hidden when the proveedor has
  no partida):
  - a "Filtrar por droga" field (label + `select.input`, `name="droga"`), first
    option empty ("Agregar droga…"), listing ONLY the drogas the proveedor has
    partidas of (distinct, by name) that are not selected yet. Choosing one
    auto-applies (FilterForm's native behaviour for selects). It disappears when
    every droga is already selected;
  - each selected droga is a CHECKED checkbox `name="droga" value={drogaId}`
    drawn as a chip (droga name + ✕, visible focus ring through
    `has-[:focus-visible]`, accessible name "Quitar filtro <droga>"). Unchecking
    applies and removes it; "Limpiar filtros" unchecks all (native FilterForm
    behaviour); `hasActiveFilters` is true with at least one droga selected.
    Chips are always shown in alphabetical order, whatever the URL's order.
- **URL**: `?droga=<uuid>&droga=<uuid>&page=N` (droga ids are not sensitive).
  `page` is dropped by FilterForm on every filter change. Pagination links keep
  every selected droga (they are rebuilt from the effective filter, not echoed).
- **Parsing** (`parsearDrogaIds`, domain): `searchParams.droga` is
  `string | string[] | undefined`; only valid uuids (shared zod `uuid`) are kept,
  lowercased, deduplicated in first-seen order and capped to
  `DROGAS_FILTRO_MAX` (20). The use case input is
  `drogaIds: z.array(uuid).max(20).default([])` (label `drogaIds` in
  `shared/labels/field-labels.ts`). The single `defineQuery` stays on
  `proveedores.gestionar`.
- **Never trusted.** The repository reads the proveedor's distinct drogas first
  and applies only the requested ids that are in that list
  (`filtrarDrogasDelProveedor`); a foreign or unknown id is ignored, and a
  filter made only of such ids is no filter. The use case output carries
  `drogasDisponibles` (`{ id, nombre }[]`) and `drogaIds` (the filter actually
  applied), which is what the UI renders.
- **Queries.** `drogaId IN (...)` (only when non-empty) goes on the paginated
  partidas query AND on its own `partida.count` (the pagination total). The
  options come from `droga.findMany({ where: { tenantId, partidas: { some: {
  tenantId, proveedorId } } }, select: { id, nombre }, orderBy: nombre })`
  (explicit select, tenant + proveedor scoped; skipped when the proveedor has no
  partidas). The extra count runs only with an active filter.
- **Count line.** Without a filter "N partida(s)."; with one "{filtradas} de
  {total} partidas." (total = the proveedor-wide `resumen.partidas`). Empty
  result with a filter: "No hay partidas de las drogas seleccionadas."
- **The resumen stays proveedor-wide**: the filter never reaches its counters nor
  its money aggregates.
- **Shared FilterForm change.** `buildQuery` now uses `URLSearchParams.append`
  instead of `set`, so a name repeated by several controls keeps EVERY value
  (`set` kept only the last one and would have broken the accumulation). Safe
  for the other forms: no existing `FilterForm` has two controls with the same
  `name` (checked on the 23 pages that use it, `FilterMultiSelect` options
  included), so for them `append` and `set` serialize identically. The doc
  comment of `filter-form.tsx` mentions the repeated-name behaviour.

## Permissions

Base `defineQuery` on `proveedores.gestionar`; optional blocks decided with
`can()` inside the use case (never call other defineQuerys — a denial writes
ACCESO_DENEGADO). Blocks the session cannot see are neither fetched nor
rendered.

| Block | Gate |
|---|---|
| Header, resumen counts, partidas, movimientos | `proveedores.gestionar` (+ partida link needs `stock.ver`) |
| Costo unitario, total comprado, valorizado | `stock.valorizado.ver` |
| Preparaciones | `preparaciones.iniciar` |
| Contralor | `libro.ver` |
| Correcciones de costo | `auditoria.ver` |

## Technical design

- `modules/proveedores/domain/trayectoria.ts` (pure: estado partida, resumen
  mapping, pagination), `infrastructure/trayectoria-repository.ts` (batched:
  one page of partidas, then `IN (partidaIds)` for movimientos — capped per
  partida —, contralor, preparaciones, audit), `application/get-trayectoria-
  proveedor.ts`, `ui/trayectoria-*.tsx`.
- Explicit Prisma `select` everywhere (schema drift: see
  docs/specs/trayectoria-paciente.md; this view must not reach `receta`).
- `formatearMonto` moves from `modules/pacientes/domain/trayectoria.ts` to a
  shared formatter (`shared/format/`), re-exported or re-imported by pacientes.
- No logging of free-text fields.

## Database

- Migration `0056_trayectoria_proveedor_indices` (next free after 0055; this
  repo already has its own `20261001100000_0051_trayectoria_paciente_indices`
  and 0055, while the OTHER developer's 0051–0054 are not in this repo):
  additive only,
  `CREATE INDEX IF NOT EXISTS idx_partida_tenant_proveedor_ingreso ON
  fsj.partida (tenant_id, proveedor_id, fecha_ingreso DESC)` + matching
  `@@index` in `schema.prisma`.
- Rollback: `prisma/rollbacks/0056_trayectoria_proveedor_indices.down.sql`
  + `docs/rollbacks/trayectoria-proveedor.md`.
- The view works without the index (performance only), but apply it before
  relying on the view at volume.

## Out of scope (v1)

- Grouping partidas by purchase/remito (no such entity).
- Cost history beyond the audit log.
- Cotizaciones (linked only through JSON, and lead to recetas).
- Any receta/paciente data.

## Implementation notes

Status: implemented 2026-10-01. Deviations and decisions taken while building it
(none of them changes the approved behavior; each is the narrowest reading of the
spec that satisfies the extra requirements).

- **Two money formatters.** `formatearMonto` moved to `shared/format/monto.ts` as
  planned (pacientes imports updated, no re-export). Totals use it (2 decimals).
  A UNIT cost is recorded per unidad base (mg, mL...) and can be far below one
  cent, where a fixed 2 decimals would print "0,00", so costo unitario and the
  cost corrections use a new `formatearCostoUnitario` (min 2, max 6 decimals,
  trailing zeros trimmed) in the same file.
- **Estado of a partida shares the stock alerts' sources, not their code.** A
  module may not import another module's infrastructure, so the repository reads
  the same two sources directly: `fsj.jornada_actual(tenant)` and the
  `dias_alerta_vencimiento_partida` parametro row (default from
  `modules/stock/domain/partida.ts`, which the domain DOES import). The jornada is
  read ONCE and used for both the per-partida estado (pure
  `derivarEstadoPartida`, string date comparison) and the SQL counters
  (`vencidas con saldo`, `por vencer`), which use the predicates of
  `alertasVencidasConSaldo` / `alertasPorVencer` verbatim. AGOTADA is first in the
  priority because both alerts require balance. The parse of the parametro
  (`parseDiasAlertaVencimiento`) mirrors `getDiasAlertaVencimiento`; if the stock
  rule ever changes, update both (the unit tests pin boundaries, tz and the
  parse).
- **Caps.** Movimientos: latest 20 per partida in ONE statement,
  `unnest(page ids) CROSS JOIN LATERAL (... ORDER BY registrado_en DESC, id DESC LIMIT 20)`,
  so each partida is a bounded index range scan and the cost does not grow with
  its history; the "mostrando N de M" total is a second grouped
  `count(*) ... GROUP BY partida_id` (index-only, one row per partida). (A first
  version used `ROW_NUMBER()` / `COUNT(*) OVER`, which read every movement of
  every partida of the page: replaced.) The spec did not cap
  preparaciones; they are bounded the same way: a LATERAL takes the latest 20
  movements of the partida that carry a `preparacion_id`, the distinct
  preparaciones of those are shown (so there can be fewer than 20 when one
  preparación consumed the partida in several movements), and the total is a
  grouped `count(DISTINCT preparacion_id)`.
- **Preparaciones** read only `id`, `estado`, `iniciada_en`, `confirmada_en`,
  `descartada_en` of `fsj.preparacion` (raw SQL, join stops there). Unlike the
  paciente card, `motivo_descarte` is NOT shown (free text, not needed here).
- **Contralor** is read from the partida's single INGRESO_COMPRA movement with a
  LEFT JOIN to `asiento_contralor`: the vale comes from the movement, so a
  controlled partida that entered before the tenant's contralor was active still
  shows its vale (and "Sin asiento"). Only partidas whose droga has
  `tipo_control <> 'NINGUNO'` are asked for.
- **Correcciones de costo vs. money gate.** The block is gated on `auditoria.ver`
  as specified, but the AMOUNTS are money and need `stock.valorizado.ver` too:
  with only `auditoria.ver` the row shows who/when/motivo and "Costo unitario
  corregido", without the amounts. The rows are filtered IN SQL to the audit rows
  (entidad `partida`, accion MODIFICAR) whose diff carries `costoUnitario`
  (`corregirCostoPartida` writes `{ costoUnitario }` in both `valor_anterior`
  and `valor_nuevo`; `jsonb_exists(...)` on either), with one LATERAL per
  partida reading at most 21 rows (newest first, through 0003's
  `idx_registro_auditoria_entidad`): the card shows the latest 20 and, when the
  21st exists, "Hay más correcciones de costo anteriores". Explicit columns (no
  `ip`, no `contexto`). The domain still re-checks the diff
  (`correccionDeCosto`). The diff JSON is read even without
  `stock.valorizado.ver` (it is needed to decide whether the row is a cost
  correction) and stripped in the domain.
- **Unit cost is per unidad base.** Costo unitario (summary and corrections) is
  printed as `$ X / <símbolo de la unidad base>` (g, mL...), because the
  quantities next to it are auto-converted (e.g. "0,5 kg") and the cost is NOT
  per kg.
- **Alert window clamp (parity caveat).** This view clamps
  `dias_alerta_vencimiento_partida` to 1..3650 days (`parseDiasAlertaVencimiento`
  and `sumarDiasAJornada`) so a huge value cannot overflow the SQL `::int` cast
  or make `toISOString` throw. The stock module's own parser is unchanged and does
  NOT clamp: for a parametro above 3650 the /stock alert window and this view
  would differ (and the stock SQL could fail on the cast). Not reachable with a
  sane parametro; if the stock rule is ever bounded, align the two.
- **Open decision (product, pending with the user).** The movimientos table shows
  the free-text `observación` and the corrections show the free-text `motivo` to
  every session that can open the view (`proveedores.gestionar`). Whether those
  fields should be hidden or gated behind another permiso is NOT decided here;
  they are only never logged.
- **Money queries.** Counters and totals are SQL `numeric` aggregates. The totals
  are a second statement that is executed only with `stock.valorizado.ver`; the
  partida page select adds `costoUnitario` only with that permiso.
- **Unit catalog.** `getCatalogoUnidades` is gated on `stock.ver`; the page calls
  it only when the session holds it (a denial would write an ACCESO_DENEGADO audit
  row). Without it, quantities show in the droga's unidad base, unconverted.
- **Pagination helper** (`calcularPaginacion`) is a small copy inside the
  proveedores domain rather than an import from pacientes, to keep the two modules
  decoupled.
- **Users.** Names of "registrado por" / "autorizado por" come from one batched
  `usuario.findMany` (id, nombre, apellido) over the page's movements.
- **Status badge.** `POR_VENCER` (warn), `AGOTADA` and `ABIERTA` (neutral) tones
  added to `shared/ui/status-badge.tsx`; labels come from the badge's humanizer.
- **Not verified against Postgres.** Everything was verified with unit tests
  (fake `tx`), typecheck and lint; the raw SQL (counters, LATERAL movimientos,
  preparaciones, cost corrections, contralor) has not been executed against a real database in this
  change, by instruction. Run it once against a seeded tenant before relying on it.
