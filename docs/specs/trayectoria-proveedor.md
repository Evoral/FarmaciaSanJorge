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
- URL carries only the opaque UUID and `?page=`.
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
3. **Partidas** — expandable list (native `<details>/<summary>`, closed by
   default, no links inside `<summary>`), newest first
   (`fecha_ingreso desc, id desc`), 10 per page (`?page=`).
   - Summary: droga · lote · fecha de ingreso · cantidad inicial → disponible
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

- Migration `0056_trayectoria_proveedor_indices` (next free after 0055; the
  other developer's 0051–0054 are not in this repo): additive only,
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
- **Caps.** Movimientos: latest 20 per partida in ONE windowed statement
  (`ROW_NUMBER() OVER (PARTITION BY partida_id ORDER BY registrado_en DESC, id DESC)`
  plus `COUNT(*) OVER` for "mostrando N de M"). The spec did not cap
  preparaciones; they are capped the same way (20 per partida, distinct
  preparaciones reached through `movimiento_stock.preparacion_id`) because a
  heavily used partida can feed thousands of them.
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
  corregido", without the amounts. The audit rows are read with explicit selects
  (no `ip`, no `contexto`), at most 200 per page of partidas; the domain keeps
  only those whose diff touches `costoUnitario` (`correccionDeCosto`). The
  diff JSON is read even without `stock.valorizado.ver` (it is needed to decide
  whether the row is a cost correction) and stripped in the domain.
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
  (fake `tx`), typecheck and lint; the raw SQL (counters, windowed movimientos,
  preparaciones, contralor) has not been executed against a real database in this
  change, by instruction. Run it once against a seeded tenant before relying on it.
