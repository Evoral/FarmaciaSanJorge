-- 0013_preparacion_etiqueta
--
-- FASE 1, point 1.11: fsj.preparacion + fsj.etiqueta (M11), plus the
-- movimiento_stock -> preparacion FK that migration 0008 left pending.
-- Depends on 0008 (fsj.movimiento_stock), 0011 (fsj.item_receta), 0012
-- (fsj.ficha_tecnica).
--
-- P04 (bidirectional invariant between preparacion and its asiento_recetario)
-- is explicitly OUT OF SCOPE here -- fsj.asiento_recetario does not exist
-- until 1.12 (another agent). Left as a comment below where it will attach.

-- ============================================================================
-- Enum: estado_preparacion (M11)
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.estado_preparacion AS ENUM ('INICIADA', 'CONFIRMADA', 'DESCARTADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- preparacion (M11) -- tenant-scoped
--
-- item_receta_id is a DENORMALIZED, trigger-populated copy of
-- ficha_tecnica.item_receta_id (frozen at INSERT, never changes -- see the
-- validar_update trigger below). It exists solely to let INV-PRP-003 be a
-- plain partial unique index instead of a second deferred constraint
-- trigger doing a join through ficha_tecnica on every mutation.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.preparacion (
  id                  uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  ficha_tecnica_id    uuid NOT NULL, -- INV-P01: exactly one ficha (NOT NULL FK)
  item_receta_id      uuid NOT NULL, -- denormalized from ficha_tecnica, trigger-set -- see header
  estado              fsj.estado_preparacion NOT NULL DEFAULT 'INICIADA',
  iniciada_en         timestamptz NOT NULL DEFAULT now(),
  iniciada_por_id     uuid NOT NULL,
  confirmada_en       timestamptz,
  preparada_por_id    uuid,
  motivo_descarte     text,
  descartada_en       timestamptz,
  descartada_por_id   uuid,
  PRIMARY KEY (id),
  CONSTRAINT preparacion_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT preparacion_ficha_fkey FOREIGN KEY (tenant_id, ficha_tecnica_id) REFERENCES fsj.ficha_tecnica (tenant_id, id),
  CONSTRAINT preparacion_item_receta_fkey FOREIGN KEY (tenant_id, item_receta_id) REFERENCES fsj.item_receta (tenant_id, id),
  CONSTRAINT preparacion_iniciada_por_fkey FOREIGN KEY (tenant_id, iniciada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT preparacion_preparada_por_fkey FOREIGN KEY (tenant_id, preparada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT preparacion_descartada_por_fkey FOREIGN KEY (tenant_id, descartada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  -- CONFIRMADA requires its audit pair.
  CONSTRAINT preparacion_confirmada_check CHECK (
    estado <> 'CONFIRMADA' OR (confirmada_en IS NOT NULL AND preparada_por_id IS NOT NULL)
  ),
  -- DESCARTADA requires motivo + who (task binding decision).
  CONSTRAINT preparacion_descartada_check CHECK (
    estado <> 'DESCARTADA' OR (motivo_descarte IS NOT NULL AND descartada_por_id IS NOT NULL AND descartada_en IS NOT NULL)
  )
);

COMMENT ON TABLE fsj.preparacion IS
  'M11. item_receta_id is denormalized from ficha_tecnica (trigger-set, immutable) purely to back INV-PRP-003 with a partial unique index -- see migration header. P04 (bidirectional link with asiento_recetario) arrives in 1.12.';

SELECT fsj.setup_tenant_table('fsj.preparacion');

GRANT UPDATE (estado, confirmada_en, preparada_por_id, motivo_descarte, descartada_por_id, descartada_en)
  ON fsj.preparacion TO fsj_app;

-- INV-P02: at most one non-DESCARTADA preparacion per ficha_tecnica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_preparacion_ficha_activa
  ON fsj.preparacion (tenant_id, ficha_tecnica_id)
  WHERE estado <> 'DESCARTADA';

-- INV-PRP-003 (PROPUESTA, task binding decision): at most one CONFIRMADA
-- preparacion per item_receta (across all of its fichas/versions).
CREATE UNIQUE INDEX IF NOT EXISTS uq_preparacion_item_confirmada
  ON fsj.preparacion (tenant_id, item_receta_id)
  WHERE estado = 'CONFIRMADA';

-- ============================================================================
-- BEFORE INSERT: freeze item_receta_id from ficha_tecnica_id (see header).
-- Runs before the FK/CHECK constraints above, and before the state-machine
-- trigger (irrelevant here, that one only fires BEFORE UPDATE OF estado).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.preparacion_set_item_receta_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT item_receta_id INTO NEW.item_receta_id
  FROM fsj.ficha_tecnica
  WHERE tenant_id = NEW.tenant_id AND id = NEW.ficha_tecnica_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-P01: ficha_tecnica % not found for tenant', NEW.ficha_tecnica_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_preparacion_set_item_receta_id
  BEFORE INSERT ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.preparacion_set_item_receta_id();

-- ============================================================================
-- INV-P05 + state machine: INICIADA -> CONFIRMADA (terminal) or
-- INICIADA -> DESCARTADA (terminal). No other transition, ever. Also blocks
-- changing ficha_tecnica_id/item_receta_id/iniciada_en/iniciada_por_id
-- after insert (frozen facts about how/when the preparacion started).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.preparacion_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ficha_tecnica_id IS DISTINCT FROM OLD.ficha_tecnica_id THEN
    RAISE EXCEPTION 'INV-P01: ficha_tecnica_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.item_receta_id IS DISTINCT FROM OLD.item_receta_id THEN
    RAISE EXCEPTION 'INV-P01: item_receta_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.iniciada_en IS DISTINCT FROM OLD.iniciada_en THEN
    RAISE EXCEPTION 'INV-P05: iniciada_en cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.iniciada_por_id IS DISTINCT FROM OLD.iniciada_por_id THEN
    RAISE EXCEPTION 'INV-P05: iniciada_por_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    -- INV-P05: CONFIRMADA never changes state again; DESCARTADA is also terminal.
    IF OLD.estado <> 'INICIADA' THEN
      RAISE EXCEPTION 'INV-P05: invalid preparacion state transition % -> % (% is terminal)', OLD.estado, NEW.estado, OLD.estado
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.estado NOT IN ('CONFIRMADA', 'DESCARTADA') THEN
      RAISE EXCEPTION 'INV-P05: invalid preparacion state transition % -> %', OLD.estado, NEW.estado
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_update() IS
  'INV-P05: INICIADA -> CONFIRMADA | DESCARTADA, both terminal. No other transition. Also freezes ficha_tecnica_id/item_receta_id/iniciada_en/iniciada_por_id after insert.';

CREATE TRIGGER trg_preparacion_validar_update
  BEFORE UPDATE ON fsj.preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.preparacion_validar_update();

-- ============================================================================
-- etiqueta (M11) -- tenant-scoped
-- Minimal per task scope (DP-28 content rules are open): contenido is a
-- free-text field for now.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.etiqueta (
  id                 uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  preparacion_id     uuid NOT NULL,
  contenido          text NOT NULL,
  generada_en        timestamptz NOT NULL DEFAULT now(),
  impresa            boolean NOT NULL DEFAULT false,
  impresa_en         timestamptz,
  impresa_por_id     uuid,
  PRIMARY KEY (id),
  CONSTRAINT etiqueta_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT etiqueta_preparacion_key UNIQUE (tenant_id, preparacion_id),
  CONSTRAINT etiqueta_preparacion_fkey FOREIGN KEY (tenant_id, preparacion_id) REFERENCES fsj.preparacion (tenant_id, id),
  CONSTRAINT etiqueta_impresa_por_fkey FOREIGN KEY (tenant_id, impresa_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT etiqueta_impresa_pair_check CHECK (
    impresa = (impresa_en IS NOT NULL AND impresa_por_id IS NOT NULL)
  )
);

COMMENT ON TABLE fsj.etiqueta IS
  'M11. DP-28 (label content rules) is open -- contenido is free text for now. Impression is NOT audited (plan §14 "no se audita ... impresion de etiquetas").';

SELECT fsj.setup_tenant_table('fsj.etiqueta');

GRANT UPDATE (impresa, impresa_en, impresa_por_id) ON fsj.etiqueta TO fsj_app;

-- Generating a label only makes sense for a CONFIRMADA preparacion (plan
-- §9 M11 "Etiqueta: generar/imprimir tras CONFIRMADA"). Defense-in-depth
-- DB check alongside the [APP] gate.
CREATE OR REPLACE FUNCTION fsj.etiqueta_validar_preparacion_confirmada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_estado fsj.estado_preparacion;
BEGIN
  SELECT estado INTO v_estado
  FROM fsj.preparacion
  WHERE tenant_id = NEW.tenant_id AND id = NEW.preparacion_id;

  IF v_estado IS DISTINCT FROM 'CONFIRMADA' THEN
    RAISE EXCEPTION 'INV-ETQ-001: etiqueta can only be generated for a CONFIRMADA preparacion (preparacion % is %)',
      NEW.preparacion_id, v_estado
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_etiqueta_validar_preparacion_confirmada
  BEFORE INSERT ON fsj.etiqueta
  FOR EACH ROW EXECUTE FUNCTION fsj.etiqueta_validar_preparacion_confirmada();

-- ============================================================================
-- movimiento_stock.preparacion_id -> preparacion: the FK migration 0008
-- left pending (fsj.preparacion did not exist yet). Composite, tenant-scoped,
-- same convention as every other FK in this codebase. The column, its
-- INV-S09 NOT-NULL-when-EGRESO check and INV-S06 immutability already exist
-- (migration 0008) -- this only adds referential integrity.
-- ============================================================================
ALTER TABLE fsj.movimiento_stock
  ADD CONSTRAINT movimiento_stock_preparacion_fkey
  FOREIGN KEY (tenant_id, preparacion_id) REFERENCES fsj.preparacion (tenant_id, id);

-- P04 (bidirectional: a CONFIRMADA preparacion has exactly one
-- asiento_recetario and vice versa) is a DEFERRED constraint trigger that
-- needs fsj.asiento_recetario, which arrives in migration 1.12 (out of
-- scope for this migration/task) -- attach it there, symmetrically to how
-- this migration attaches the movimiento_stock FK that 0008 deferred.
