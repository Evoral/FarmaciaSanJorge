# Reanálisis de partida

Status: implemented 2026-10-12 (migration 0074). Rollback:
`docs/rollbacks/reanalisis-partida.md`. Revises INV-S10 (plan §9 M07): a partida's
expiry is now its **vencimiento vigente**, not always the printed date.

## Goal

A droga partida whose expiry date is reached is not necessarily unusable: the
Director Técnico can have it re-analysed and set a new date. Until the DT acts,
the expired partida stays blocked (today's INV-S10). The DT either records a
**reanálisis** (the partida is usable again until the new date) or **marks it as
vencida** (its whole saldo is discounted). Everyone sees that the partida needs
the DT; only the DT can act.

## Vocabulary

- **Vencimiento original**: `partida.fecha_vencimiento`, the date printed on the
  lot. Never changes.
- **Fecha de reanálisis**: the new date a reanálisis sets.
- **Vencimiento vigente**: the date of the latest reanálisis, else the original
  date (`partida.fecha_vencimiento_vigente`). Every expiry rule uses this one.
- **Vencida**: vencimiento vigente < jornada actual. **Por vencer**: jornada ≤
  vencimiento vigente ≤ jornada + `dias_alerta_vencimiento_partida` (default 30).

## Rules

| # | Rule | Enforced in |
|---|---|---|
| R1 | Only partidas of a **droga** (`droga.clase = DROGA`) can be re-analysed or marked as vencida. Insumos keep their date and today's behaviour (expired = unusable; zeroed with a normal VENCIMIENTO ajuste). | Domain `rechazoReanalisis` / `rechazoMarcarVencida` (`modules/stock/domain/vencimiento-partida.ts`); DB INV-S22 (`fsj.reanalisis_partida_validar`). |
| R2 | Scope is the partida (lote), not the droga. | `fsj.reanalisis_partida.partida_id`. |
| R3 | A reanálisis records the new date (required, **strictly after** the jornada actual), motivo (optional) and respaldo (optional free text: certificado de análisis / número de protocolo). No limit on how far or how many times. Allowed whether the partida is vencida, por vencer or vigente, as long as it has saldo. | `reanalisisCampos` (zod), `rechazoReanalisis`; DB INV-S22. |
| R4 | The original `fecha_vencimiento` is **never** overwritten. Each reanálisis is an immutable, append-only row (`fsj.reanalisis_partida`, tenant-scoped: RLS + `forbid_update_delete`, no UPDATE/DELETE grant), with the vigente date it replaced (`fecha_vencimiento_anterior`, set by the trigger) and the DT who registered it. Audited in the same transaction (`reanalisis_partida`, CREAR). | Migration 0074; `registrarReanalisisPartida` (`modules/stock/application/reanalizar-partida.ts`). DB INV-S23: `fecha_vencimiento` can not change; `fecha_vencimiento_vigente` only through a reanálisis insert. |
| R5 | When a droga partida's vencimiento vigente passes, it is **blocked**: no reserva, no descuento, until the DT acts (INV-S10 on the vigente date). | App: `ordenarParaConsumo` / `proponerReparto` (callers load `fecha_vencimiento_vigente`), `planificarConsumoEnTx`, `fsj.v_stock_droga`. DB: `fsj.movimiento_stock_aplicar` (INV-S10). |
| R6 | **Marcar como vencida**: on a vencida droga partida with saldo, after a warning that its saldo will be discounted to zero, registers an AJUSTE motivo VENCIMIENTO for the **whole remaining saldo** (read after the partida lock, never from the client) through the stock ajuste's own code (`registrarAjusteEnTx`). Stock reserved by a preparación INICIADA is not free: the ajuste refuses it with the recetas holding it (release that reserva first). The partida is then **terminal**. | `marcarPartidaVencida` (`modules/stock/application/marcar-partida-vencida.ts`). |
| R7 | Only the **DT vigente** (titular or suplente, `fsj.es_dt_vigente` at the jornada) performs either action, **themselves**, confirming with **their own password** in the same form. | App: permiso `stock.ajuste.autorizar` + `esDtVigenteHoy(session.usuario.id)` + `verificarPasswordDtPartidaCommand` (own instance of the stock co-firma with the DT fixed to the session's usuario: argon2, lockout counters, failed attempts audited). DB: INV-S22 (`registrado_por_id` DT vigente) for the reanálisis; INV-U05 (`autorizado_por_id` DT vigente) for the ajuste. |
| R8 | Every place that evaluates expiry uses the vencimiento vigente: reparto/`estaVencida` callers, partidas para pesar, the confirmation and "Imprimir etiqueta" (`getPartidasFrescas`), the toma's `reservaAlcanza`, cotizaciones, INV-S10, `v_stock_droga`, stock alerts (por vencer / vencidas), `/stock` filters and "Próximo vencimiento" order, `/stock/partidas` (filter, order, estado), stock valorizado (filter, order, the date shown), the proveedor trayectoria (counters and estado). | `partida-repository.ts`, `preparacion-repository.ts`, `cotizacion-repository.ts`, `valorizado-repository.ts`, `trayectoria-repository.ts`. |
| R9 | Partida detail (`/stock/partidas/[id]`): vencimiento vigente with its estado, the original date when they differ, and the reanálisis history (date registered, anterior → nuevo, respaldo/motivo, DT). | `getPartida`, the page. |
| R10 | **Por vencer** warnings: the home "Alertas de stock" card (por vencer count), `/stock` alert tab, partida detail banner, and inline (compact badge) wherever the partida is chosen for a descuento: the reserva / confirmation / modificar reserva form (`confirmar-form.tsx`), the pesar step (`lineas-ficha-tabla.tsx`) and the reserved partidas of the toma workspace. | `estadoVencimientoPartida`, `textoPorVencer`. |
| R11 | **Vencida — requiere acción del DT**: shown to **everyone** who sees stock: a separate urgent card on the home page ("Partidas vencidas: requiere acción del DT", links to the partida or to `/stock?vencidas=1`), the `/stock` alert note, the partida detail banner ("Avisale al Director Técnico" when the viewer is not the DT). The action buttons are rendered only for the DT vigente. In the preparation flow a blocked vencida partida stays visible with the reason: disabled (never preselected) in the reserva/confirmation form, listed as "No disponible" in the pesar step, flagged on a reserved partida. | `app/(app)/page.tsx`, `app/(app)/stock/page.tsx`, `app/(app)/stock/partidas/[id]/page.tsx`, `partidas-para-pesar.ts`, `get-toma-receta.ts`. |
| R12 | The preparado's own expiry (`vencimiento-preparado.md`) is unrelated and unchanged. | — |

## Decisions

- **Denormalized `fecha_vencimiento_vigente`, maintained only by triggers.**
  Same pattern as `cantidad_disponible` (0008): initialised from
  `fecha_vencimiento` on INSERT (`trg_partida_inicializar_vencimiento_vigente`,
  ignoring any client value), moved only by the reanálisis' AFTER INSERT trigger
  (SECURITY DEFINER, transaction-local flag `fsj.reanalisis`, checked by
  `partida_validar_update`, INV-S23). Computing it (`coalesce(latest reanálisis,
  fecha_vencimiento)`) would need a lateral subquery in every one of the ~15
  expiry reads (several are plain Prisma `where`/`orderBy`), in `v_stock_droga`
  and in the INV-S10 trigger: easy to miss one, slower for the FEFO orders.
  The column keeps each read a one-column change, and the triggers make
  drift impossible (fsj_app has no UPDATE grant on it, and the guard covers
  any other role). Backfilled = `fecha_vencimiento`.
- **Terminal = saldo 0, no new estado.** A partida can never regain stock
  (DP-21b: no positive ajuste; one INGRESO only), so saldo 0 already is final.
  The DB refuses a reanálisis without saldo (INV-S22), and the alerts only list
  partidas with saldo. This also covers a partida consumed completely.
- **The DT acts personally, with their own password** (like the cierre firma),
  rather than the ajuste's "operator + DT co-firma picker": the requirement is
  that only the DT/designee can perform the actions and that only they see the
  buttons. It still reuses the ajuste's verification code unchanged
  (`verificarCoFirmaDtEnTx` with `dtUsuarioId = session.usuario.id`), so rate
  limiting and audit of failures are identical. For "marcar como vencida",
  `registrado_por_id` = `autorizado_por_id` = the DT (the DB allows it; INV-U05
  checks the authorizer).
- **Permiso `stock.ajuste.autorizar`** (operativo, held by the DT role): no new
  permiso, so no role/permiso migration and no change to the role editor.
- A reanálisis may set a date earlier than the current vigente one (the
  analysis decides; only "after today" is required). "Marcar como vencida" is
  offered only for an already vencida partida; a por vencer one waits or gets a
  reanálisis.
- A normal ajuste (any motivo, with DT co-firma) on an expired droga partida is
  still possible, as before; "marcar como vencida" is the guided path.
- The droga history (`historial-droga`) keeps showing each consumed lot's
  original date: it describes the lot, it does not evaluate expiry.

## Code

- Migration: `prisma/migrations/20261012090000_0074_reanalisis_partida/migration.sql`;
  rollback `prisma/rollbacks/0074_reanalisis_partida.down.sql`.
- Domain: `modules/stock/domain/vencimiento-partida.ts` (estado, por vencer
  text, reanálisis / marcar vencida rules, zod fields); `reparto.ts` documents
  that `fechaVencimiento` is the vigente date.
- Application: `reanalizar-partida.ts`, `marcar-partida-vencida.ts`,
  `verificar-password-dt-partida.ts`, `dias-alerta-vencimiento.ts`,
  `get-partida.ts`, `list-partidas-droga.ts` (`modules/stock/application/`).
- UI: `modules/stock/ui/acciones-dt-partida.tsx`, `modules/stock/ui/actions.ts`
  (`registrarReanalisisAction`, `marcarPartidaVencidaAction`).
- DB messages: `INV-S22`, `INV-S23`, revised `INV-S10` in
  `shared/errors/mensajes-invariantes.ts`.

## Open

- Should a reanálisis be required to move the date **forward** (after the
  current vigente date)? Today only "after the jornada" is enforced.
