# Tasks: Unidades internacionales (U.I.)

Prerequisite: archive `openspec/changes/corregir-potencia-partida` (implemented) first, or in the same pass (design §5).
The user applies migrations by hand; the implementer writes them and never runs them.

## 1. Database
- [x] 1.1 `prisma/migrations/<ts>_0132_tipo_magnitud_actividad/migration.sql`: `ADD VALUE 'ACTIVIDAD'` alone (design §2)
- [x] 1.2 `prisma/rollbacks/0132_tipo_magnitud_actividad.down.sql` (the value stays; guard on `unidad_medida`)
- [x] 1.3 `prisma/migrations/<ts>_0133_unidad_internacional/migration.sql`: U.I. seed, `droga.se_dosifica_en_ui`,
      `partida.actividad_declarada`, `movimiento_stock.actividad_aplicada`, `equivalencia_manual` on `reserva_stock`
      and `movimiento_stock`, CHECKs, triggers, column grants, INV-S12 from the 0088 definition (design §2)
- [x] 1.4 `prisma/rollbacks/0133_unidad_internacional.down.sql`
- [x] 1.5 `prisma/schema.prisma`: enum value and new columns with doc comments; `npm run db:generate`
- [x] 1.6 `docs/rollbacks/unidad-internacional.md`

## 2. Catalog and drogas
- [x] 2.1 Add `"ACTIVIDAD"` to every `TipoMagnitud` union and `unidadesBase` resolver
- [x] 2.2 Droga alta/edit (shared form): "Se dosifica en U.I." for clase DROGA; use case + repository

## 3. Recetas and ficha
- [x] 3.1 `modules/recetas`: U.I. componentes only for marked drogas, modes TOTAL / POR_DOSIS / CONCENTRACION with
      referencia (zod + domain); field error on the componente, form keeps input
- [ ] 3.2 Receta import (PDF/QR): map "UI", "U.I.", "UI." to `UNIDAD_INTERNACIONAL`
- [ ] 3.3 `modules/elaboracion`: U.I. línea; keep `MAGNITUDES_CONCENTRACION` without ACTIVIDAD; R4/R5 scenarios

## 4. Stock
- [x] 4.1 `modules/stock/domain/actividad.ts`: parse "X U.I. cada Y <masa>" ↔ U.I./g (decimal.js)
- [ ] 4.2 Partida input "en gramos / en U.I." in every creation path: `ingresar-partida`, `importar-factura-compra`,
      `guardar-fila-relevamiento`, `importar-planilla-excel`, `pasar-grupo-a-stock`, `elaborar-lote` (dilución)
- [ ] 4.3 `corregir-potencia-partida`: correct `actividad_declarada`; panel shows % or U.I./g
- [ ] 4.4 Partida detail and lists show "100 U.I./g" for U.I. lots

## 5. Preparaciones
- [x] 5.1 `potencia.ts`: tagged factor (PORCENTAJE / ACTIVIDAD); % path unchanged
- [ ] 5.2 `reparto-linea.ts` + callers: no `convertirCantidad` for ACTIVIDAD líneas; candidate partidas by kind
- [ ] 5.3 Cantidad manual por falta de equivalencia (UI7): reserva dialog, toma, confirmation, detail; highlighted;
      `equivalencia_manual` on reserva and movements
- [ ] 5.4 `pesada-real.ts`: precision of an ACTIVIDAD línea from the droga's unidad base; `cantidad_real` readers
- [ ] 5.5 Excipiente notice when an ACTIVIDAD línea blocks `pesoDeDrogas` (UI8)

## 6. Precios
- [ ] 6.1 `calcular-cotizacion.ts`: ACTIVIDAD línea costed through the first U.I. partida (FEFO); else sin precio

## 7. Specs and tests
- [ ] 7.1 Unit tests: `actividad.ts`, `potencia.ts` ACTIVIDAD path, reparto with two U.I. lots, cotización sin precio,
      receta validation, ficha R4 with U.I.
- [ ] 7.2 DB tests (`tests/db`): INV-S12 for %, U.I., enrase manual, equivalencia manual, mixed (refused); partida
      CHECKs and triggers
- [ ] 7.3 Etiqueta and libro scenarios (UI10)
- [ ] 7.4 `npm run specs:validate`

## 8. Verification (local, CI is off)
- [ ] 8.1 `npm run typecheck`, `npm run lint`, `npm test`
- [ ] 8.2 State what was NOT verified (browser flows are checked by the user)
