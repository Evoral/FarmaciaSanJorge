# Corregir pureza de una partida

## Why

A drug lot's purity (`partida.potencia_declarada`, 0 < p <= 100, NULL = 100%) directly affects the physical weight of active ingredient weighed in compound preparations (`modules/preparaciones/domain/potencia.ts`). Operators can forget to declare the purity at intake or make a typo. If a lot's real purity is below 100% and it was entered as 100% (or omitted), future preparations risk under-dosing the active principle.

Until now, `potencia_declarada` was insert-only for `fsj_app` (migration 0058), with no application command or UI to correct it after intake.

User decision (2026-10-30): Allow editing the declared purity of an existing lot from its detail page (`/partidas/[id]`). The change requires a mandatory `motivo`, is fully audited, and applies strictly to FUTURE preparations without modifying past weighings, stock movements, or signed cierres.

## What Changes

- PostgreSQL schema grant: grant `UPDATE (potencia_declarada)` on `fsj.partida` to `fsj_app`.
- New permission `stock.partida.potencia.corregir` (categoría `operativo` / `gestion`), granted to `ADMINISTRADOR` and `DIRECTOR_TECNICO`.
- New application command `corregirPotenciaPartida` (`modules/stock/application/corregir-potencia-partida.ts`), validating range (`0 < p <= 100`), requiring a `motivo`, locking the lot, verifying no active reservation exists (`cantidadReservada === "0"`), and recording old/new values in `fsj.auditoria`.
- UI: A new "Corregir pureza" panel in `app/(app)/partidas/[id]/page.tsx` (mirroring `CorregirCostoForm`).

## Capabilities

### New Capabilities

- `corregir-potencia-partida`: Correcting the declared purity of an existing lot for future calculations.

### Modified Capabilities

None.

## Impact

- Schema change: new migration in `prisma/migrations/` granting column update + rollback `.down.sql` + rollback guide.
- Code touched: `modules/stock/{application,domain,infrastructure,ui}`, `modules/auth/domain/permisos.ts`, `app/(app)/partidas/[id]/page.tsx`.
- Past data: Zero recalculation of past stock movements, pesadas, or cierres.

## Out of scope

- Retroactive recalculation of past preparations, recipes, or historical stock movements (past consumptions preserved their `potencia_aplicada` snapshot).
- Bulk editing of purity across multiple lots.
- Modifying purity while the lot is actively reserved in an in-progress preparation (`INICIADA`).
