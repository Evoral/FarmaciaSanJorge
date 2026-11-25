# Rollback: Unidades internacionales (U.I.)

Spec: `openspec/specs/unidad-internacional/spec.md` (UI1–UI10) and `openspec/specs/ficha-tecnica/spec.md` (R9, INV-S12).
The feature has **two schema migrations** (`0132_tipo_magnitud_actividad` and `0133_unidad_internacional`), so it is reverted as code + new forward migration(s) built from `prisma/rollbacks/0133_unidad_internacional.down.sql` (and optionally `prisma/rollbacks/0132_tipo_magnitud_actividad.down.sql`, which only guards that no `ACTIVIDAD` unit remains).

## What the down migration loses

- `droga.se_dosifica_en_ui`, `partida.actividad_declarada`, `movimiento_stock.actividad_aplicada`, and `equivalencia_manual` on `reserva_stock` and `movimiento_stock`.
- The `UNIDAD_INTERNACIONAL` row in `fsj.unidad_medida` (cannot be deleted if any receta componente, línea de pesaje or detalle asiento already references it).
- `fsj.linea_pesaje_validar_consumo` (INV-S12) reverts to the `0088` body.
- `ACTIVIDAD` stays in `fsj.tipo_magnitud` (Postgres cannot drop an enum value; harmless once unused).

## Order

1. Deploy the reverted code **first**: it neither reads nor writes the 0133 columns, and all new columns are nullable or defaulted, so it runs against the 0133 schema.
2. Copy `prisma/rollbacks/0133_unidad_internacional.down.sql` into a NEW migration folder (next free number, timestamp later than every existing one) and apply it. Never edit or delete applied migrations.
3. Revert the code, `npm run db:generate`, then `npm run typecheck`, `npm run lint`, `npm test`.
