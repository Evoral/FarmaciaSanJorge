-- Rollback of 0110_insumos_preparacion (apply as a NEW forward migration).
-- Release first every reserva holding a material or an insumo adicional ("Liberar reserva"): once 0092's triggers
-- are restored, a re-plan of such a reserva would be refused. An insumo already descontado is history (its
-- EGRESO_PREPARACION has no línea and points to fsj.insumo_preparacion through its droga): then keep sections 1-2
-- and revert only the draft table and the code (docs/rollbacks/insumos-preparacion.md).

-- 3. Draft
DROP TABLE IF EXISTS fsj.insumo_borrador;

-- 2. Línea-less rows: only the excipiente again (0092's bodies)
CREATE OR REPLACE FUNCTION fsj.validar_reserva_excipiente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.linea_pesaje_id IS NULL AND NOT EXISTS (
    SELECT 1
    FROM fsj.preparacion pr
    JOIN fsj.partida pa ON pa.tenant_id = pr.tenant_id AND pa.id = NEW.partida_id
    WHERE pr.tenant_id = NEW.tenant_id AND pr.id = NEW.preparacion_id AND pr.excipiente_droga_id = pa.droga_id
  ) THEN
    RAISE EXCEPTION 'reserva_stock without linea_pesaje_id must reserve the preparacion''s excipiente (preparacion %, partida %)', NEW.preparacion_id, NEW.partida_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.validar_egreso_excipiente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tipo = 'EGRESO_PREPARACION' AND NEW.linea_pesaje_id IS NULL AND NOT EXISTS (
    SELECT 1
    FROM fsj.preparacion pr
    JOIN fsj.partida pa ON pa.tenant_id = pr.tenant_id AND pa.id = NEW.partida_id
    WHERE pr.tenant_id = NEW.tenant_id AND pr.id = NEW.preparacion_id AND pr.excipiente_droga_id = pa.droga_id
  ) THEN
    RAISE EXCEPTION 'EGRESO_PREPARACION without linea_pesaje_id must consume the preparacion''s excipiente (preparacion %, partida %)', NEW.preparacion_id, NEW.partida_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.validar_reserva_excipiente() IS
  '0092. A reserva_stock row without línea de pesaje only reserves the preparación''s excipiente (partida droga = preparacion.excipiente_droga_id).';
COMMENT ON FUNCTION fsj.validar_egreso_excipiente() IS
  '0092. An EGRESO_PREPARACION without línea de pesaje only consumes the preparación''s excipiente (partida droga = preparacion.excipiente_droga_id).';

-- 1. Insumos of the preparación
DROP TABLE IF EXISTS fsj.insumo_preparacion;
DROP FUNCTION IF EXISTS fsj.insumo_preparacion_validar();
DROP TYPE IF EXISTS fsj.tipo_insumo;
