-- 0061_quitar_lista_para_retirar
--
-- Client decision (2026-10-05): the receta estado LISTA_PARA_RETIRAR is
-- removed. The flow is now EN_PREPARACION -> PREPARADA -> (ENTREGADA |
-- ENVIADA_PEND_FIRMA), both reached directly from PREPARADA by
-- registrarEntrega (modules/entregas/application/registrar-entrega.ts) in a
-- SINGLE receta UPDATE -- the intermediate PREPARADA -> LISTA_PARA_RETIRAR
-- step that 0040's header describes is gone. Every other transition of
-- INV-R08 (0011) is unchanged, including ANULADA from any non-terminal state.
--
-- Every DB object that references the value or the column's type was
-- checked (grepping every migration, LATEST definitions):
--   - 0011 fsj.receta_validar_transicion_estado (INV-R08; never redefined
--     after 0011) -> recreated below with PREPARADA -> {ENTREGADA,
--     ENVIADA_PEND_FIRMA}.
--   - 0040 fsj.receta_validar_entrega_para_entregada (INV-ENT-002): its body
--     never names LISTA_PARA_RETIRAR (only 0040's header comment does) --
--     unchanged.
--   - 0050 fsj.receta_validar_anulacion_libro (INV-R12): only looks at
--     ANULADA -- unchanged.
--   - 0030 fsj.receta_assert_editable (v_estado fsj.estado_receta): plpgsql
--     resolves the type by name at runtime, so it picks up the new type --
--     unchanged.
--   - No view, RLS policy, function signature or other column uses
--     fsj.estado_receta; fsj.receta.estado is its only column.
--
-- Postgres cannot drop an enum value, so the type is swapped: rename the old
-- type, create the new one, retype the column with a text cast, drop the old
-- type. Objects that depend on fsj.receta.estado and would break the
-- ALTER COLUMN ... TYPE are dropped first and recreated, verbatim, after it:
--   - The three `BEFORE UPDATE OF estado` triggers (0011 state machine, 0040
--     INV-ENT-002, 0050 INV-R12): a column-specific trigger blocks the
--     retype ("cannot alter type of a column used in a trigger
--     definition"). Dropping them first also lets the backfill below move
--     LISTA_PARA_RETIRAR back to PREPARADA, a backwards transition the
--     state machine would reject -- same intent as 0039's one-statement
--     trigger disable, without a separate DISABLE/ENABLE pair.
--   - The partial indexes uq_receta_emisor_nro_vigente (0049) and
--     idx_receta_tenant_tomada_en_curso (0057) and the CHECK
--     receta_anulada_motivo_check (0011): Postgres rebuilds them from their
--     deparsed text, where the literals are cast to the RENAMED old type,
--     so the rebuild would fail with "operator does not exist".
--   - The column DEFAULT 'PENDIENTE_PREPARACION' (typed as the old enum).
--
-- Backfill: recetas still LISTA_PARA_RETIRAR become PREPARADA (they are
-- ready to deliver, which is exactly what PREPARADA means now). Runs as the
-- migration owner, like 0042/0054/0057's backfills. SET CONSTRAINTS ALL
-- IMMEDIATE is issued before the DDL, defensively (55006 "pending trigger
-- events", see 0054).
--
-- *** APPLY 0061 TOGETHER WITH THE CODE THAT STOPS WRITING LISTA_PARA_RETIRAR. ***
-- Rollback: prisma/rollbacks/0061_quitar_lista_para_retirar.down.sql (as a
-- NEW forward migration).

-- ============================================================================
-- 1. Drop the column-specific estado triggers (recreated in step 6).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_receta_validar_transicion_estado ON fsj.receta;
DROP TRIGGER IF EXISTS trg_receta_validar_entrega_para_entregada ON fsj.receta;
DROP TRIGGER IF EXISTS trg_receta_validar_anulacion_libro ON fsj.receta;

-- ============================================================================
-- 2. Backfill LISTA_PARA_RETIRAR -> PREPARADA (no estado trigger fires now).
-- ============================================================================
UPDATE fsj.receta
SET estado = 'PREPARADA'
WHERE estado = 'LISTA_PARA_RETIRAR';

SET CONSTRAINTS ALL IMMEDIATE;

-- ============================================================================
-- 3. Drop the objects whose deparsed text casts to the old type.
-- ============================================================================
DROP INDEX IF EXISTS fsj.uq_receta_emisor_nro_vigente;
DROP INDEX IF EXISTS fsj.idx_receta_tenant_tomada_en_curso;
ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_anulada_motivo_check;
ALTER TABLE fsj.receta ALTER COLUMN estado DROP DEFAULT;

-- ============================================================================
-- 4. Enum swap.
-- ============================================================================
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

-- ============================================================================
-- 5. Recreate the CHECK and partial indexes exactly as 0011/0049/0057.
-- ============================================================================
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

-- ============================================================================
-- 6. INV-R08 without LISTA_PARA_RETIRAR, and the three estado triggers.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_transicion_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado IN ('ENTREGADA', 'ANULADA') THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> % (% is terminal)', OLD.estado, NEW.estado, OLD.estado
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado = 'ANULADA' THEN
    -- Anulacion is reachable from any non-terminal state (spec section 1).
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.estado = 'PENDIENTE_PREPARACION' AND NEW.estado = 'EN_PREPARACION')
    OR (OLD.estado = 'EN_PREPARACION' AND NEW.estado = 'PREPARADA')
    OR (OLD.estado = 'PREPARADA' AND NEW.estado IN ('ENTREGADA', 'ENVIADA_PEND_FIRMA'))
    OR (OLD.estado = 'ENVIADA_PEND_FIRMA' AND NEW.estado = 'ENTREGADA')
  ) THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_transicion_estado() IS
  'INV-R08 + docs/specs/libro-recetario-y-contralor.md section 1. No backwards transitions; ANULADA reachable from any non-terminal state; ENTREGADA/ANULADA terminal. 0061: LISTA_PARA_RETIRAR removed -- PREPARADA goes straight to ENTREGADA or ENVIADA_PEND_FIRMA.';

CREATE TRIGGER trg_receta_validar_transicion_estado
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_transicion_estado();

CREATE TRIGGER trg_receta_validar_entrega_para_entregada
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_entrega_para_entregada();

CREATE TRIGGER trg_receta_validar_anulacion_libro
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_anulacion_libro();
