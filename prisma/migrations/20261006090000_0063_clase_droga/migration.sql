-- 0063_clase_droga
--
-- Client decision (2026-10-05): the droga catalog also holds the non-drug
-- supplies the lab buys (capsules, neutral fillers, alcohol...), so their
-- partidas, stock and cost are tracked with the SAME machinery (partida,
-- movimiento_stock, fsj.convertir, stock valorizado) -- but they never
-- appear in the libro recetario.
--
-- ADDITIVE: one enum, one NOT NULL column with a default (every existing
-- droga becomes DROGA), one CHECK, one column grant.
--
--   - fsj.droga.clase: DROGA (active ingredient, default) | EXCIPIENTE
--     (fillers, vehicles, solvents) | MATERIAL (capsules, containers).
--     The app skips non-DROGA lines when it writes a preparación's
--     detalle_asiento (modules/preparaciones/application/
--     confirmar-preparacion.ts); stock is consumed as usual.
--   - droga_clase_no_controlada_check: only a DROGA can be controlled -- an
--     insumo never reaches the libro contralor.
--   - GRANT UPDATE (clase): editable at any time (it only affects FUTURE
--     preparaciones; asientos are immutable). Not part of 0028's
--     trg_droga_validar_clasificacion_inmutable (unidad/control only).
--
-- Numbering: 0062 (20261005210000_0062_comprobante_compra) is the highest at
-- the time of writing -- re-check before applying.
--
-- *** APPLY 0063 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0063_clase_droga.down.sql (as a NEW forward
-- migration).

CREATE TYPE fsj.clase_droga AS ENUM ('DROGA', 'EXCIPIENTE', 'MATERIAL');

ALTER TABLE fsj.droga
  ADD COLUMN IF NOT EXISTS clase fsj.clase_droga NOT NULL DEFAULT 'DROGA';

ALTER TABLE fsj.droga
  ADD CONSTRAINT droga_clase_no_controlada_check CHECK (clase = 'DROGA' OR tipo_control = 'NINGUNO');

GRANT UPDATE (clase) ON fsj.droga TO fsj_app;

COMMENT ON COLUMN fsj.droga.clase IS
  '0063. DROGA (active ingredient) | EXCIPIENTE | MATERIAL. Non-DROGA rows keep stock and cost but are left out of the libro recetario''s detalle_asiento; they can never be controlled (droga_clase_no_controlada_check).';
