# Trayectoria del paciente

Status: approved by user 2026-10-01 — implementation in progress.

## Goal

A per-patient view that shows everything a paciente has gone through in the
system, receta by receta, in one screen. Read-only.

## Routes and navigation

- `/pacientes/[id]` gets two tabs:
  - **Datos** -> `/pacientes/[id]` (current edit / baja / reactivar page, unchanged).
  - **Trayectoria** -> `/pacientes/[id]/trayectoria` (new).
- The `/pacientes` list gets a "Trayectoria" button per row.
- URLs carry only the opaque UUID and a plain `?page=` integer. Nothing
  identifying (DP-24 / Ley 25.326), same as the rest of `/pacientes`.
- Both tabs live under the existing `app/(app)/pacientes/layout.tsx` guard
  (`pacientes.gestionar`).
- Tab active state must be exact for "Datos" (`/pacientes/[id]` is a prefix
  of `/pacientes/[id]/trayectoria`).

## Content (top to bottom)

1. **Header**: apellido, nombre, DNI, nro. de credencial, estado
   (vigente / dado de baja + motivo).
2. **Resumen** (counts over ALL the patient's recetas, not just the page):
   total, en curso (not ENTREGADA/ANULADA), entregadas, anuladas,
   última atención (max `fechaIngreso`).
3. **Recetas**: newest first (`fechaIngreso desc`), paginated (`?page=`,
   page size 10). Each receta is an expandable row of a `table.data-table` (summary: número,
   ingreso, qué pide, médico, estado, etapa, presupuesto; the expanded detail
   shows its journey):

   **Ingreso -> Preparación -> Libro -> Entrega -> Archivo**

   - Ingreso: nro. interno, fecha de ingreso, fecha de prescripción,
     médico, origen (presencial / PDF), estado badge, items (forma +
     drogas), presupuesto vigente (sum of the latest cotización per item;
     flag partial/incomplete).
   - Preparación (per item): estado (INICIADA / CONFIRMADA / DESCARTADA),
     iniciada/confirmada/descartada dates, motivo de descarte.
   - Libro (per item): asiento nro. correlativo, fecha, derived visual
     state (vigente / anulado / sin efecto por rectificación). Linked via
     preparacion -> asiento SISTEMA (+ its rectificativos through
     `asientoOriginalId`). Never matched by `pacienteTexto`.
   - Entrega: modalidad (retiro / envío), fecha, firma recibida.
   - Archivo: lote nro. and lote estado.
   - Anulada recetas show `motivoAnulacion`.
   - Each step links to its existing detail page only when the session
     holds that page's permiso (`/recetas/[id]`, `/preparaciones/[id]`,
     `/libro/[id]`, `/entregas/[recetaId]`, `/archivo/[id]`).

## Visibility per role (existing permisos, no new permisos)

| Block | Gate |
|---|---|
| Header, resumen, recetas, entrega | `pacientes.gestionar` (+ link to receta needs `recetas.crear`; entrega link needs `entregas.registrar`) |
| Presupuesto | `cotizaciones.ver` |
| Preparación, Libro | `preparaciones.iniciar` / `libro.ver` respectively |
| Archivo | `archivo.lotes.gestionar` |

Blocks the session cannot see are omitted from the query AND the UI (not
fetched then hidden).

## Technical design

- One use case `getTrayectoriaPaciente` in `modules/pacientes/application/`,
  a `defineQuery` gated on `pacientes.gestionar`. Inside, it uses `can()`
  to decide which optional blocks to load — it must NOT call other
  `defineQuery`s that would write `ACCESO_DENEGADO` rows.
- Batched reads (no N+1): one query for the recetas page, then
  `IN (...)` queries for items/componentes, latest cotizaciones,
  preparaciones, asientos, entregas, lotes. Every query scoped by
  `tenantId` (from session) like the rest of the repositories.
- Pure mapping/derivation (journey steps, resumen, visual asiento state,
  presupuesto sum) in a domain file so it is unit-testable.
- No logging of paciente fields. Reads are not audited (project convention).

## Database

- Migration `0051_trayectoria_paciente_indices`: additive indexes only, no
  data or column changes:
  - `receta (tenant_id, paciente_id)`
  - `item_receta (tenant_id, receta_id)`
  - `preparacion (tenant_id, item_receta_id)`
  (exact columns adjusted to the real schema/existing indexes).
- Rollback: `prisma/rollbacks/0051_trayectoria_paciente_indices.down.sql`
  plus the steps in `docs/rollbacks/trayectoria-paciente.md`.

## Receta física removed (2026-10-01)

The client decided that receta física no longer exists as a concept. Another
developer's migration `20261001090000_0051_drop_receta_fisica` (applied to the
shared DB, not part of this repo) dropped `fsj.receta.receta_fisica_recibida`,
`receta_fisica_recibida_en`, `receta_fisica_recibida_por_id` and the permisos
`recetas.fisica.registrar` / `regularizacion.ver`. Consequences here:

- No "Receta física" data in the receta row, no "recetas físicas adeudadas"
  counter (nor its days-pending value), no use of `etiquetaRecepcionReceta`.
- The journey is Ingreso -> Preparación -> Libro -> Entrega -> Archivo.
  Archivo is COMPLETO with a lote, PENDIENTE otherwise; Entrega "en curso" only
  means an ENVIO still waiting for its firma.
- `schema.prisma` still declares the dropped fields (cleanup owned by the other
  developer), so every Prisma read touching `receta` here uses an explicit
  `select` (or a `groupBy` by `estado` only): a bare `findMany`/`include` would
  select the missing columns and fail.

## Out of scope (v1)

- Global cross-receta timeline (the per-card journey already tells it).
- Paciente audit log (full PII diffs; `auditoria.ver` only).
- `AsientoHistorico` (pre-system, free-text patient, not reliably linkable).
- Stock movements / partidas consumed.
