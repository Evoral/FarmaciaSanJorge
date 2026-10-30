-- 0110 -- Insumos de la preparación: the material and the insumos adicionales (openspec/specs/insumos-preparacion/spec.md,
-- change openspec/changes/insumos-preparacion/).
--
-- Next to the excipiente (0092), the toma workspace records a "Material" (a droga of clase MATERIAL, e.g. the cápsula
-- type; pre-filled with the number of cápsulas of a CAPSULA ítem) and any number of "insumos adicionales" (drogas of
-- clase EXCIPIENTE or MATERIAL), each with its quantity in the droga's unidad base. Same mechanics as the excipiente:
-- saved as filled in, reserved at "Marcar como preparada" (oldest lot first, automatic), re-planned, descontado at
-- "Imprimir etiquetas" as EGRESO_PREPARACION, never a línea de pesaje:
--
--   1. fsj.tipo_insumo + fsj.insumo_preparacion: the insumos a preparación used (droga, cantidad, the fórmula's text),
--      written only while INICIADA (INV-P08, trigger), at most one MATERIAL, a droga at most once per preparación and
--      never the preparación's excipiente -- so a línea-less reserva/egreso maps to exactly one insumo.
--   2. 0092's triggers relaxed: a reserva_stock / EGRESO_PREPARACION without linea_pesaje_id is allowed for the
--      preparación's excipiente OR one of its insumo_preparacion drogas (clase EXCIPIENTE or MATERIAL, never DROGA).
--      reserva_stock_preparacion_linea_partida_key is a plain UNIQUE (NULLs distinct): unaffected.
--   3. fsj.insumo_borrador: the draft per ficha técnica (several rows, `orden`), like fsj.excipiente_borrador (0092).
--      The save replaces the ficha's rows (DELETE + INSERT), so fsj_app gets DELETE on it, no UPDATE.
--
-- *** APPLY 0110 TOGETHER WITH ITS CODE (same deploy). *** Old code + 0110: nothing writes the new tables --
-- unchanged. New code without 0110: the toma page fails (it reads the draft).
-- Rollback: prisma/rollbacks/0110_insumos_preparacion.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. fsj.insumo_preparacion
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'tipo_insumo' AND t.typnamespace = 'fsj'::regnamespace) THEN
    CREATE TYPE fsj.tipo_insumo AS ENUM ('MATERIAL', 'ADICIONAL');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS fsj.insumo_preparacion (
  id              uuid             NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id       uuid             NOT NULL,
  preparacion_id  uuid             NOT NULL,
  tipo            fsj.tipo_insumo  NOT NULL,
  orden           smallint         NOT NULL,
  droga_id        uuid             NOT NULL,
  cantidad        numeric          NOT NULL,  -- the droga's unidad base
  texto           varchar(120)     NOT NULL,  -- "Aerosil 0,5 g": what the libro's fórmula carries (EXCIPIENTE adicionales only)
  creado_en       timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT insumo_preparacion_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT insumo_preparacion_droga_key UNIQUE (tenant_id, preparacion_id, droga_id),
  CONSTRAINT insumo_preparacion_orden_key UNIQUE (tenant_id, preparacion_id, orden),
  CONSTRAINT insumo_preparacion_preparacion_fkey FOREIGN KEY (tenant_id, preparacion_id) REFERENCES fsj.preparacion (tenant_id, id),
  CONSTRAINT insumo_preparacion_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT insumo_preparacion_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT insumo_preparacion_orden_check CHECK (orden >= 0)
);

-- At most one MATERIAL per preparación.
CREATE UNIQUE INDEX IF NOT EXISTS insumo_preparacion_un_material
  ON fsj.insumo_preparacion (tenant_id, preparacion_id) WHERE tipo = 'MATERIAL';

COMMENT ON TABLE fsj.insumo_preparacion IS
  'Migration 0110. The material (clase MATERIAL) and insumos adicionales (clase EXCIPIENTE or MATERIAL) a preparación used, chosen in the toma workspace; reserved and descontado with the preparación without línea de pesaje. Written only while INICIADA (INV-P08).';

SELECT fsj.setup_tenant_table('fsj.insumo_preparacion');

-- Table-level SELECT and INSERT reach fsj_app through default privileges (0000): the rows are history, never
-- updated nor deleted ("Liberar reserva" discards the preparación, it does not delete it).
REVOKE TRUNCATE ON fsj.insumo_preparacion FROM fsj_app;

CREATE OR REPLACE FUNCTION fsj.insumo_preparacion_validar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_estado text;
  v_excipiente uuid;
  v_clase text;
BEGIN
  SELECT pr.estado::text, pr.excipiente_droga_id INTO v_estado, v_excipiente
  FROM fsj.preparacion pr
  WHERE pr.tenant_id = NEW.tenant_id AND pr.id = NEW.preparacion_id;
  IF v_estado IS DISTINCT FROM 'INICIADA' THEN
    RAISE EXCEPTION 'INV-P08: the insumos can only change while the preparacion is INICIADA (is %)', v_estado
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.droga_id = v_excipiente THEN
    RAISE EXCEPTION 'insumo_preparacion.droga_id % is already the preparacion''s excipiente', NEW.droga_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT d.clase::text INTO v_clase FROM fsj.droga d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.droga_id;
  IF (NEW.tipo = 'MATERIAL' AND v_clase IS DISTINCT FROM 'MATERIAL')
     OR (NEW.tipo = 'ADICIONAL' AND v_clase IS DISTINCT FROM 'EXCIPIENTE' AND v_clase IS DISTINCT FROM 'MATERIAL') THEN
    RAISE EXCEPTION 'insumo_preparacion % droga % has clase %, not allowed', NEW.tipo, NEW.droga_id, v_clase
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.insumo_preparacion_validar() IS
  '0110, INV-P08: an insumo is written only while the preparación is INICIADA; MATERIAL = a droga of clase MATERIAL, ADICIONAL = clase EXCIPIENTE or MATERIAL; never the preparación''s excipiente.';

DROP TRIGGER IF EXISTS trg_insumo_preparacion_validar ON fsj.insumo_preparacion;
CREATE TRIGGER trg_insumo_preparacion_validar
  BEFORE INSERT ON fsj.insumo_preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.insumo_preparacion_validar();

-- ============================================================================
-- 2. Reserva and egreso without línea: the excipiente or an insumo
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.validar_reserva_excipiente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.linea_pesaje_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM fsj.preparacion pr
       JOIN fsj.partida pa ON pa.tenant_id = pr.tenant_id AND pa.id = NEW.partida_id
       WHERE pr.tenant_id = NEW.tenant_id AND pr.id = NEW.preparacion_id AND pr.excipiente_droga_id = pa.droga_id
     )
     AND NOT EXISTS (
       SELECT 1
       FROM fsj.insumo_preparacion ip
       JOIN fsj.partida pa ON pa.tenant_id = ip.tenant_id AND pa.id = NEW.partida_id
       WHERE ip.tenant_id = NEW.tenant_id AND ip.preparacion_id = NEW.preparacion_id AND ip.droga_id = pa.droga_id
     ) THEN
    RAISE EXCEPTION 'reserva_stock without linea_pesaje_id must reserve the preparacion''s excipiente or one of its insumos (preparacion %, partida %)', NEW.preparacion_id, NEW.partida_id
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
  IF NEW.tipo = 'EGRESO_PREPARACION' AND NEW.linea_pesaje_id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM fsj.preparacion pr
       JOIN fsj.partida pa ON pa.tenant_id = pr.tenant_id AND pa.id = NEW.partida_id
       WHERE pr.tenant_id = NEW.tenant_id AND pr.id = NEW.preparacion_id AND pr.excipiente_droga_id = pa.droga_id
     )
     AND NOT EXISTS (
       SELECT 1
       FROM fsj.insumo_preparacion ip
       JOIN fsj.partida pa ON pa.tenant_id = ip.tenant_id AND pa.id = NEW.partida_id
       WHERE ip.tenant_id = NEW.tenant_id AND ip.preparacion_id = NEW.preparacion_id AND ip.droga_id = pa.droga_id
     ) THEN
    RAISE EXCEPTION 'EGRESO_PREPARACION without linea_pesaje_id must consume the preparacion''s excipiente or one of its insumos (preparacion %, partida %)', NEW.preparacion_id, NEW.partida_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.validar_reserva_excipiente() IS
  '0092/0110. A reserva_stock row without línea de pesaje only reserves the preparación''s excipiente (partida droga = preparacion.excipiente_droga_id) or one of its insumos (fsj.insumo_preparacion).';
COMMENT ON FUNCTION fsj.validar_egreso_excipiente() IS
  '0092/0110. An EGRESO_PREPARACION without línea de pesaje only consumes the preparación''s excipiente (partida droga = preparacion.excipiente_droga_id) or one of its insumos (fsj.insumo_preparacion).';

-- ============================================================================
-- 3. fsj.insumo_borrador
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.insumo_borrador (
  id                  uuid             NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid             NOT NULL,
  ficha_tecnica_id    uuid             NOT NULL,
  tipo                fsj.tipo_insumo  NOT NULL,
  orden               smallint         NOT NULL,
  droga_id            uuid,                      -- NULL = none chosen (e.g. the cápsulas' count typed, no material yet)
  cantidad            numeric,                   -- the droga's unidad base
  actualizado_por_id  uuid             NOT NULL,
  actualizado_en      timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT insumo_borrador_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT insumo_borrador_orden_key UNIQUE (tenant_id, ficha_tecnica_id, orden),
  CONSTRAINT insumo_borrador_ficha_fkey FOREIGN KEY (tenant_id, ficha_tecnica_id) REFERENCES fsj.ficha_tecnica (tenant_id, id),
  CONSTRAINT insumo_borrador_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT insumo_borrador_actualizado_por_fkey FOREIGN KEY (tenant_id, actualizado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT insumo_borrador_cantidad_check CHECK (cantidad IS NULL OR cantidad > 0),
  CONSTRAINT insumo_borrador_orden_check CHECK (orden >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS insumo_borrador_un_material
  ON fsj.insumo_borrador (tenant_id, ficha_tecnica_id) WHERE tipo = 'MATERIAL';

COMMENT ON TABLE fsj.insumo_borrador IS
  'Migration 0110. Draft of the material and insumos adicionales of a ficha técnica (droga + quantity per row), saved from the toma workspace while the lab prepares. Never stock or libro: the reserva re-validates it.';

SELECT fsj.setup_tenant_table('fsj.insumo_borrador');

-- The save replaces the ficha's rows: DELETE + INSERT (SELECT/INSERT by default privileges).
GRANT DELETE ON fsj.insumo_borrador TO fsj_app;
REVOKE TRUNCATE ON fsj.insumo_borrador FROM fsj_app;
