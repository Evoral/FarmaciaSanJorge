-- Rollback of 0061_quitar_lista_para_retirar. Prisma has no "down": apply
-- this as the body of a NEW forward migration (next free number). Restores
-- LISTA_PARA_RETIRAR in fsj.estado_receta (same position as 0011) and 0011's
-- INV-R08 (PREPARADA -> LISTA_PARA_RETIRAR -> {ENTREGADA,
-- ENVIADA_PEND_FIRMA}). Recetas backfilled to PREPARADA by 0061 are NOT moved
-- back (they stay PREPARADA, a valid starting point for the restored flow).
-- Same drop/recreate of estado-dependent objects as 0061 (see its header).

DROP TRIGGER IF EXISTS trg_receta_validar_transicion_estado ON fsj.receta;
DROP TRIGGER IF EXISTS trg_receta_validar_entrega_para_entregada ON fsj.receta;
DROP TRIGGER IF EXISTS trg_receta_validar_anulacion_libro ON fsj.receta;

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
  'LISTA_PARA_RETIRAR',
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
    OR (OLD.estado = 'PREPARADA' AND NEW.estado = 'LISTA_PARA_RETIRAR')
    OR (OLD.estado = 'LISTA_PARA_RETIRAR' AND NEW.estado IN ('ENTREGADA', 'ENVIADA_PEND_FIRMA'))
    OR (OLD.estado = 'ENVIADA_PEND_FIRMA' AND NEW.estado = 'ENTREGADA')
  ) THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_transicion_estado() IS
  'INV-R08 + docs/specs/libro-recetario-y-contralor.md section 1. No backwards transitions; ANULADA reachable from any non-terminal state; ENTREGADA/ANULADA terminal.';

CREATE TRIGGER trg_receta_validar_transicion_estado
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_transicion_estado();

CREATE TRIGGER trg_receta_validar_entrega_para_entregada
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_entrega_para_entregada();

CREATE TRIGGER trg_receta_validar_anulacion_libro
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_anulacion_libro();
