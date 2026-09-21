-- 0016_entrega_archivo
--
-- FASE 1, point 1.14 (M14/M15): fsj.entrega + fsj.lote_archivo_recetas +
-- receta.lote_archivo_id (deferred from migration 0011, same convention as
-- migration 0013 adding movimiento_stock.preparacion_id's FK). Depends on
-- 0011 (fsj.receta), 0002 (fsj.usuario).
--
-- DP-34 (modalidad de entrega) is UNRESOLVED -- uses the plan's own
-- proposed values (RETIRO_PRESENCIAL, ENVIO), flagged PROPUESTA below.
-- DP-26 (plazos de archivo/destruccion) is UNRESOLVED -- no automatic
-- EN_ARCHIVO -> PLAZO_CUMPLIDO job is implemented here (that is FASE 12,
-- [APP]); this migration only builds the DB-level state machine and
-- INV-D02/D05 guarantees the job will rely on.

-- ============================================================================
-- entrega (M14)
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.modalidad_entrega AS ENUM ('RETIRO_PRESENCIAL', 'ENVIO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON TYPE fsj.modalidad_entrega IS
  'PROPUESTA (DP-34 unresolved) -- plan''s own suggested values, per task instructions.';

CREATE TABLE IF NOT EXISTS fsj.entrega (
  id                    uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  receta_id             uuid NOT NULL,
  modalidad             fsj.modalidad_entrega NOT NULL,
  entregada_por_id      uuid NOT NULL,
  entregada_en          timestamptz NOT NULL DEFAULT now(),
  firma_recibida        boolean NOT NULL DEFAULT false,
  firma_recibida_en     timestamptz,
  fecha_archivo_receta  date,
  PRIMARY KEY (id),
  CONSTRAINT entrega_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT entrega_receta_unica UNIQUE (tenant_id, receta_id),
  CONSTRAINT entrega_receta_fkey FOREIGN KEY (tenant_id, receta_id) REFERENCES fsj.receta (tenant_id, id),
  CONSTRAINT entrega_entregada_por_fkey FOREIGN KEY (tenant_id, entregada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT entrega_firma_pair_check CHECK (firma_recibida = (firma_recibida_en IS NOT NULL))
);

COMMENT ON TABLE fsj.entrega IS
  'M14. One row per receta (UNIQUE). Mutable (firma_recibida/firma_recibida_en only, for the ENVIO -> firma pendiente -> firma recibida flow) -- not in the immutable group per plan section 10.';

SELECT fsj.setup_tenant_table('fsj.entrega');

GRANT UPDATE (firma_recibida, firma_recibida_en) ON fsj.entrega TO fsj_app;

CREATE TRIGGER trg_entrega_forbid_delete
  BEFORE DELETE ON fsj.entrega
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

CREATE OR REPLACE FUNCTION fsj.entrega_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.receta_id IS DISTINCT FROM OLD.receta_id
     OR NEW.modalidad IS DISTINCT FROM OLD.modalidad
     OR NEW.entregada_por_id IS DISTINCT FROM OLD.entregada_por_id
     OR NEW.entregada_en IS DISTINCT FROM OLD.entregada_en
     OR NEW.fecha_archivo_receta IS DISTINCT FROM OLD.fecha_archivo_receta
  THEN
    RAISE EXCEPTION 'INV-ENT-001: entrega rows are immutable except firma_recibida/firma_recibida_en' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.firma_recibida = true AND NEW.firma_recibida = false THEN
    RAISE EXCEPTION 'INV-ENT-001: entrega.firma_recibida cannot revert to false once true' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entrega_validar_update
  BEFORE UPDATE ON fsj.entrega
  FOR EACH ROW EXECUTE FUNCTION fsj.entrega_validar_update();

-- ============================================================================
-- INV-R07 (M14 side, defense in depth on top of migration 0011's CHECK on
-- receta.estado='ENTREGADA'): a RETIRO_PRESENCIAL entrega can only be
-- registered once the receta's physical copy was actually received.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.entrega_validar_receta_fisica()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_recibida boolean;
BEGIN
  IF NEW.modalidad = 'RETIRO_PRESENCIAL' THEN
    SELECT receta_fisica_recibida INTO v_recibida FROM fsj.receta WHERE tenant_id = NEW.tenant_id AND id = NEW.receta_id;
    IF NOT coalesce(v_recibida, false) THEN
      RAISE EXCEPTION 'INV-R07: cannot register a RETIRO_PRESENCIAL entrega without receta_fisica_recibida' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_entrega_validar_receta_fisica
  BEFORE INSERT ON fsj.entrega
  FOR EACH ROW EXECUTE FUNCTION fsj.entrega_validar_receta_fisica();

-- ============================================================================
-- lote_archivo_recetas (M15)
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.estado_lote_archivo AS ENUM (
    'EN_ARCHIVO',
    'PLAZO_CUMPLIDO',
    'DESTRUCCION_SOLICITADA',
    'DESTRUCCION_AUTORIZADA',
    'DESTRUIDO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS fsj.lote_archivo_recetas (
  id                        uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  periodo_desde             date NOT NULL,
  periodo_hasta             date NOT NULL,
  ubicacion                 text NOT NULL,
  incluye_controladas       boolean NOT NULL DEFAULT false,
  estado                    fsj.estado_lote_archivo NOT NULL DEFAULT 'EN_ARCHIVO',
  expediente_autorizacion   text,
  fecha_autorizacion        date,
  fecha_destruccion         date,
  registrado_por_id         uuid NOT NULL,
  registrado_en             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT lote_archivo_recetas_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT lote_archivo_recetas_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT lote_archivo_recetas_periodo_check CHECK (periodo_hasta >= periodo_desde),
  -- INV-D02.
  CONSTRAINT lote_archivo_recetas_destruido_check CHECK (
    estado <> 'DESTRUIDO' OR (expediente_autorizacion IS NOT NULL AND fecha_autorizacion IS NOT NULL)
  )
);

COMMENT ON TABLE fsj.lote_archivo_recetas IS
  'M15. State machine EN_ARCHIVO -> PLAZO_CUMPLIDO -> DESTRUCCION_SOLICITADA -> DESTRUCCION_AUTORIZADA -> DESTRUIDO (linear, no skipping, no backwards -- trigger below). INV-D05: DESTRUIDO is terminal and the row becomes fully immutable.';

SELECT fsj.setup_tenant_table('fsj.lote_archivo_recetas');

GRANT UPDATE (estado, expediente_autorizacion, fecha_autorizacion, fecha_destruccion) ON fsj.lote_archivo_recetas TO fsj_app;

CREATE TRIGGER trg_lote_archivo_recetas_forbid_delete
  BEFORE DELETE ON fsj.lote_archivo_recetas
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ============================================================================
-- State machine + INV-D05 (DESTRUIDO is terminal/immutable).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.lote_archivo_recetas_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.periodo_desde IS DISTINCT FROM OLD.periodo_desde
     OR NEW.periodo_hasta IS DISTINCT FROM OLD.periodo_hasta
     OR NEW.ubicacion IS DISTINCT FROM OLD.ubicacion
     OR NEW.incluye_controladas IS DISTINCT FROM OLD.incluye_controladas
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
  THEN
    RAISE EXCEPTION 'INV-D05: lote_archivo_recetas structural fields are immutable' USING ERRCODE = 'P0001';
  END IF;

  -- INV-D05: once DESTRUIDO, absolutely nothing changes again.
  IF OLD.estado = 'DESTRUIDO' THEN
    RAISE EXCEPTION 'INV-D05: lote_archivo_recetas % is DESTRUIDO -- rows are immutable from that point on', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (
      (OLD.estado = 'EN_ARCHIVO' AND NEW.estado = 'PLAZO_CUMPLIDO')
      OR (OLD.estado = 'PLAZO_CUMPLIDO' AND NEW.estado = 'DESTRUCCION_SOLICITADA')
      OR (OLD.estado = 'DESTRUCCION_SOLICITADA' AND NEW.estado = 'DESTRUCCION_AUTORIZADA')
      OR (OLD.estado = 'DESTRUCCION_AUTORIZADA' AND NEW.estado = 'DESTRUIDO')
    ) THEN
      RAISE EXCEPTION 'INV-ARC-005: invalid lote_archivo_recetas state transition % -> %', OLD.estado, NEW.estado
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lote_archivo_recetas_validar_update
  BEFORE UPDATE ON fsj.lote_archivo_recetas
  FOR EACH ROW EXECUTE FUNCTION fsj.lote_archivo_recetas_validar_update();

-- ============================================================================
-- receta.lote_archivo_id (deferred from migration 0011, per its header).
-- INV-ARC-006 (PROPUESTA): a receta belongs to at most one lote
-- (structural, a single FK column) and can only be archived once it is
-- ENTREGADA or ANULADA AND its physical copy was received.
-- ============================================================================
ALTER TABLE fsj.receta ADD COLUMN IF NOT EXISTS lote_archivo_id uuid;

ALTER TABLE fsj.receta
  ADD CONSTRAINT receta_lote_archivo_fkey
  FOREIGN KEY (tenant_id, lote_archivo_id) REFERENCES fsj.lote_archivo_recetas (tenant_id, id);

COMMENT ON COLUMN fsj.receta.lote_archivo_id IS
  'M15, deferred from migration 0011. INV-ARC-006 [PROPUESTA]: only settable (trg_receta_validar_archivo below) when the receta is ENTREGADA or ANULADA and receta_fisica_recibida is true.';

GRANT UPDATE (lote_archivo_id) ON fsj.receta TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.receta_validar_archivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id AND NEW.lote_archivo_id IS NOT NULL THEN
    IF NEW.estado NOT IN ('ENTREGADA', 'ANULADA') OR NOT NEW.receta_fisica_recibida THEN
      RAISE EXCEPTION 'INV-ARC-006: receta % can only be archived when ENTREGADA/ANULADA and receta_fisica_recibida', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF OLD.lote_archivo_id IS NOT NULL AND NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id THEN
    RAISE EXCEPTION 'INV-ARC-006: receta.lote_archivo_id cannot change once set' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_receta_validar_archivo
  BEFORE UPDATE OF lote_archivo_id ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_archivo();
