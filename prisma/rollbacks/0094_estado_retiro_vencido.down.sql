-- Rollback of 0094_estado_retiro_vencido (apply as a NEW forward migration), AFTER
-- prisma/rollbacks/0095_retiro_vencido.down.sql and after reverting the code (docs/rollbacks/retiro-vencido.md).
--
-- Postgres cannot drop an enum value, so fsj.estado_receta is swapped exactly like 0061 did (rename the old type,
-- create the new one without RETIRO_VENCIDO, retype the column with a text cast, drop the old type). Everything that
-- would break the ALTER COLUMN ... TYPE is dropped first and recreated verbatim afterwards:
--   - the four `BEFORE UPDATE OF estado[, ...]` triggers on fsj.receta: INV-R08 (0011/0061/0086),
--     INV-ENT-002 (0040), INV-R12 (0050) and INV-R14 (0076). trg_receta_preparada_en (0095) is already gone: it is
--     dropped by 0095's rollback, which must run first.
--   - the partial indexes uq_receta_emisor_nro_vigente (0049) and idx_receta_tenant_tomada_en_curso (0057) and the
--     CHECK receta_anulada_motivo_check (0011), whose deparsed text casts the literals to the renamed old type.
--   - the column DEFAULT.
-- fsj.receta.estado is the only column typed fsj.estado_receta (checked: every migration and schema.prisma); the
-- plpgsql functions that declare a variable of that type (fsj.receta_assert_editable, 0030/0072) resolve it by name at
-- run time and pick up the new type.
--
-- REFUSED while any receta is in RETIRO_VENCIDO (the cast would fail anyway): move them back to PREPARADA first
-- (docs/rollbacks/retiro-vencido.md).

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM fsj.receta WHERE estado = 'RETIRO_VENCIDO') THEN
    RAISE EXCEPTION '0094 rollback refused: recetas in RETIRO_VENCIDO exist (move them back to PREPARADA first, see docs/rollbacks/retiro-vencido.md)';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.atttypid = 'fsj.estado_receta'::regtype
      AND a.attnum > 0 AND NOT a.attisdropped
      AND c.relkind IN ('r', 'p')
      AND NOT (n.nspname = 'fsj' AND c.relname = 'receta' AND a.attname = 'estado')
  ) THEN
    RAISE EXCEPTION '0094 rollback refused: another column is typed fsj.estado_receta besides fsj.receta.estado (extend this rollback to retype it)';
  END IF;
END $do$;

DROP TRIGGER IF EXISTS trg_receta_validar_transicion_estado ON fsj.receta;
DROP TRIGGER IF EXISTS trg_receta_validar_entrega_para_entregada ON fsj.receta;
DROP TRIGGER IF EXISTS trg_receta_validar_anulacion_libro ON fsj.receta;
DROP TRIGGER IF EXISTS trg_receta_validar_entregada_pagada ON fsj.receta;

SET CONSTRAINTS ALL IMMEDIATE;

DROP INDEX IF EXISTS fsj.uq_receta_emisor_nro_vigente;
DROP INDEX IF EXISTS fsj.idx_receta_tenant_tomada_en_curso;
ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_anulada_motivo_check;
ALTER TABLE fsj.receta ALTER COLUMN estado DROP DEFAULT;

ALTER TYPE fsj.estado_receta RENAME TO estado_receta_old;

CREATE TYPE fsj.estado_receta AS ENUM (
  'PENDIENTE_PREPARACION',
  'EN_PREPARACION',
  'PREPARADA',
  'ENVIADA_PEND_FIRMA',
  'ENTREGADA',
  'ANULADA'
);

ALTER TABLE fsj.receta
  ALTER COLUMN estado TYPE fsj.estado_receta
  USING estado::text::fsj.estado_receta;

ALTER TABLE fsj.receta ALTER COLUMN estado SET DEFAULT 'PENDIENTE_PREPARACION';

DROP TYPE fsj.estado_receta_old;

-- Anulacion requires a motivo (task binding decision).
ALTER TABLE fsj.receta
  ADD CONSTRAINT receta_anulada_motivo_check CHECK (
    estado <> 'ANULADA' OR motivo_anulacion IS NOT NULL
  );

-- A receta anulada por error can be imported again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_receta_emisor_nro_vigente
  ON fsj.receta (tenant_id, emisor, nro_receta_emisor)
  WHERE nro_receta_emisor IS NOT NULL AND estado <> 'ANULADA';

CREATE INDEX IF NOT EXISTS idx_receta_tenant_tomada_en_curso
  ON fsj.receta (tenant_id, tomada_en)
  WHERE tomada_por_id IS NOT NULL AND estado IN ('PENDIENTE_PREPARACION', 'EN_PREPARACION');

-- The four estado triggers, recreated verbatim (their functions are untouched: 0095's rollback already restored
-- INV-R08 to the 0086 definition).
CREATE TRIGGER trg_receta_validar_transicion_estado
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_transicion_estado();

CREATE TRIGGER trg_receta_validar_entrega_para_entregada
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_entrega_para_entregada();

CREATE TRIGGER trg_receta_validar_anulacion_libro
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_anulacion_libro();

CREATE TRIGGER trg_receta_validar_entregada_pagada
  BEFORE UPDATE OF estado, pagada ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_entregada_pagada();
