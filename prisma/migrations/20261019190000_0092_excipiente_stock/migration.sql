-- 0092 -- Excipiente from the catalog, with stock (docs/specs/excipiente-preparacion.md).
--
-- The excipiente used is chosen in the ficha técnica (a droga of clase EXCIPIENTE, never free text) with its
-- quantity, saved as it is filled in, reserved at "Marcar como preparada" (oldest lot first, automatic) and
-- descontado at "Imprimir etiquetas" like the drogas. It is not a línea de pesaje (fichas are immutable and the
-- receta is not altered), so its reserva and egreso have no línea:
--
--   1. preparacion.excipiente_droga_id / excipiente_cantidad (droga's unidad base): set while INICIADA (INV-P08,
--      like excipiente_texto, which keeps carrying the fórmula's text).
--   2. reserva_stock.linea_pesaje_id and EGRESO_PREPARACION's linea_pesaje_id may be NULL ONLY for the
--      preparación's excipiente: the partida's droga must be its excipiente_droga_id (trigger).
--   3. fsj.excipiente_borrador: the draft per ficha técnica (droga + cantidad), like fsj.pesada_borrador (0090).
--
-- *** APPLY 0092 TOGETHER WITH ITS CODE (same deploy). *** Old code + 0092: nothing writes the new columns or
-- línea-less rows -- unchanged. New code without 0092: the toma page fails (it reads the draft).
-- Rollback: prisma/rollbacks/0092_excipiente_stock.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. preparacion: the excipiente used
-- ============================================================================
ALTER TABLE fsj.preparacion
  ADD COLUMN IF NOT EXISTS excipiente_droga_id uuid,
  ADD COLUMN IF NOT EXISTS excipiente_cantidad numeric,
  ADD CONSTRAINT preparacion_excipiente_droga_fkey FOREIGN KEY (tenant_id, excipiente_droga_id) REFERENCES fsj.droga (tenant_id, id),
  ADD CONSTRAINT preparacion_excipiente_cantidad_check CHECK (
    (excipiente_droga_id IS NULL AND excipiente_cantidad IS NULL) OR (excipiente_droga_id IS NOT NULL AND excipiente_cantidad > 0)
  );

COMMENT ON COLUMN fsj.preparacion.excipiente_droga_id IS
  '0092. The excipiente used (a droga of clase EXCIPIENTE), chosen in the toma workspace; its stock is reserved and descontado with the preparación.';
COMMENT ON COLUMN fsj.preparacion.excipiente_cantidad IS
  '0092. Quantity of the excipiente used, in its droga''s unidad base.';

GRANT UPDATE (excipiente_droga_id, excipiente_cantidad) ON fsj.preparacion TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.preparacion_validar_excipiente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.excipiente_texto IS DISTINCT FROM OLD.excipiente_texto
      OR NEW.excipiente_droga_id IS DISTINCT FROM OLD.excipiente_droga_id
      OR NEW.excipiente_cantidad IS DISTINCT FROM OLD.excipiente_cantidad)
     AND OLD.estado <> 'INICIADA' THEN
    RAISE EXCEPTION 'INV-P08: the excipiente can only change while the preparacion is INICIADA (is %)', OLD.estado
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.excipiente_droga_id IS NOT NULL AND NEW.excipiente_droga_id IS DISTINCT FROM OLD.excipiente_droga_id
     AND NOT EXISTS (SELECT 1 FROM fsj.droga d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.excipiente_droga_id AND d.clase = 'EXCIPIENTE') THEN
    RAISE EXCEPTION 'preparacion.excipiente_droga_id % is not a droga of clase EXCIPIENTE', NEW.excipiente_droga_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_excipiente() IS
  '0083/0092, INV-P08: the excipiente (texto, droga, cantidad) changes only while INICIADA; the droga must be of clase EXCIPIENTE.';

DROP TRIGGER IF EXISTS trg_preparacion_validar_excipiente ON fsj.preparacion;
CREATE TRIGGER trg_preparacion_validar_excipiente
  BEFORE UPDATE OF excipiente_texto, excipiente_droga_id, excipiente_cantidad ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.preparacion_validar_excipiente();

-- ============================================================================
-- 2. Reserva and egreso without línea: only the preparación's excipiente
-- ============================================================================
ALTER TABLE fsj.reserva_stock ALTER COLUMN linea_pesaje_id DROP NOT NULL;

ALTER TABLE fsj.movimiento_stock DROP CONSTRAINT movimiento_stock_linea_pesaje_check;
ALTER TABLE fsj.movimiento_stock
  ADD CONSTRAINT movimiento_stock_linea_pesaje_check
  CHECK (tipo <> 'EGRESO_PREPARACION' OR linea_pesaje_id IS NOT NULL OR preparacion_id IS NOT NULL);

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

CREATE TRIGGER trg_reserva_stock_validar_excipiente
  BEFORE INSERT ON fsj.reserva_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.validar_reserva_excipiente();

CREATE TRIGGER trg_movimiento_stock_validar_excipiente
  BEFORE INSERT ON fsj.movimiento_stock
  FOR EACH ROW EXECUTE FUNCTION fsj.validar_egreso_excipiente();

-- ============================================================================
-- 3. fsj.excipiente_borrador
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.excipiente_borrador (
  id                  uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  ficha_tecnica_id    uuid        NOT NULL,
  droga_id            uuid,                 -- NULL = no excipiente chosen
  cantidad            numeric,              -- the droga's unidad base
  actualizado_por_id  uuid        NOT NULL,
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT excipiente_borrador_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT excipiente_borrador_ficha_key UNIQUE (tenant_id, ficha_tecnica_id),
  CONSTRAINT excipiente_borrador_ficha_fkey FOREIGN KEY (tenant_id, ficha_tecnica_id) REFERENCES fsj.ficha_tecnica (tenant_id, id),
  CONSTRAINT excipiente_borrador_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT excipiente_borrador_actualizado_por_fkey FOREIGN KEY (tenant_id, actualizado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT excipiente_borrador_cantidad_check CHECK (cantidad IS NULL OR cantidad > 0)
);

COMMENT ON TABLE fsj.excipiente_borrador IS
  'Migration 0092. Draft of the excipiente of a ficha técnica (droga + quantity), saved from the toma workspace while the lab prepares. Never stock or libro: the reserva re-validates it.';

SELECT fsj.setup_tenant_table('fsj.excipiente_borrador');

-- The save is an upsert: it needs UPDATE (0091). Only the draft's own fields.
GRANT UPDATE (droga_id, cantidad, actualizado_por_id, actualizado_en) ON fsj.excipiente_borrador TO fsj_app;
REVOKE TRUNCATE ON fsj.excipiente_borrador FROM fsj_app;
