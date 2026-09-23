-- 0033_rectificacion_asiento
--
-- D1 (user decision, 2026-09-23): authorization for a RECTIFICATIVO
-- asiento_recetario lives in its OWN table, fsj.rectificacion_asiento --
-- NOT folded into asiento_recetario itself, mirroring how
-- fsj.anulacion_asiento (migration 0014) is the authorization record for
-- the "jornada abierta" correction path. This closes the
-- docs/specs/libro-recetario-y-contralor.md section 1 [PENDIENTE] note
-- "error de dato: solo deja sin efecto o transcribe tambien" -- resolved
-- per D3: a rectificativo ONLY leaves the original sin efecto (no data
-- transcription -- see this migration's header and
-- modules/libro/application/rectificar-asiento.ts).
--
-- INV-L21 (new): every RECTIFICATIVO asiento_recetario has EXACTLY one
-- rectificacion_asiento row, enforced in BOTH directions:
--   * rectificacion_asiento -> asiento_recetario: immediate BEFORE INSERT
--     validation (trg_rectificacion_asiento_validar) -- the referenced
--     asiento must exist and be origen = RECTIFICATIVO. This side does NOT
--     need to be deferred: by the time the app inserts rectificacion_asiento
--     (in the SAME transaction, right after the RECTIFICATIVO asiento_recetario
--     insert -- see rectificar-asiento.ts), the asiento row already exists.
--   * asiento_recetario -> rectificacion_asiento: the OPPOSITE direction
--     needs a DEFERRED constraint trigger (same INV-P04/L08 pattern as
--     migration 0014), because the RECTIFICATIVO asiento_recetario row is
--     inserted BEFORE its rectificacion_asiento row in the app's tx -- at
--     the moment the asiento is inserted, there is no rectificacion_asiento
--     row yet. Checked at COMMIT via a DEFERRABLE INITIALLY DEFERRED
--     CONSTRAINT TRIGGER, exactly like fsj.trg_asiento_recetario_p04.
--
-- "AT MOST one rectificativo per original" is INV-L19, already enforced by
-- migration 0014's uq_asiento_recetario_rectificativo_unico partial unique
-- index -- untouched here. "AT MOST one rectificacion_asiento per
-- asiento_rectificativo_id" is enforced below by a plain UNIQUE constraint
-- (immediate, not deferred -- a second INSERT for the SAME rectificativo id
-- has no reason to ever be allowed to wait until commit).
--
-- autorizado_por_id must be a DT vigente TODAY -- the SAME check
-- anulacion_asiento_validar uses (fsj.es_dt_vigente against
-- fsj.jornada_actual(tenant_id)), since D1 requires the "same DT co-firma
-- as anularAsiento".
--
-- Immutable (like anulacion_asiento): no UPDATE/DELETE/TRUNCATE grant,
-- forbid_update_delete trigger.

CREATE TABLE IF NOT EXISTS fsj.rectificacion_asiento (
  id                        uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  asiento_rectificativo_id  uuid NOT NULL,
  motivo                    text NOT NULL,
  autorizado_por_id         uuid NOT NULL,
  registrado_por_id         uuid NOT NULL,
  registrado_en             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT rectificacion_asiento_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT rectificacion_asiento_rectificativo_unico UNIQUE (tenant_id, asiento_rectificativo_id),
  CONSTRAINT rectificacion_asiento_asiento_fkey FOREIGN KEY (tenant_id, asiento_rectificativo_id) REFERENCES fsj.asiento_recetario (tenant_id, id),
  CONSTRAINT rectificacion_asiento_autorizado_por_fkey FOREIGN KEY (tenant_id, autorizado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT rectificacion_asiento_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT rectificacion_asiento_motivo_check CHECK (btrim(motivo) <> '')
);

COMMENT ON TABLE fsj.rectificacion_asiento IS
  'D1 (2026-09-23). Authorization record for a RECTIFICATIVO asiento_recetario -- the "jornada firmada" correction path, mirroring fsj.anulacion_asiento for the "jornada abierta" path. Fully immutable (no UPDATE/DELETE grant, trigger below). INV-L21: every RECTIFICATIVO asiento has exactly one row here (this direction validated immediately by trg_rectificacion_asiento_validar; the OPPOSITE direction -- a RECTIFICATIVO asiento_recetario row requires a matching row here -- is checked at COMMIT by a deferred constraint trigger on asiento_recetario, see below).';

SELECT fsj.setup_tenant_table('fsj.rectificacion_asiento');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.rectificacion_asiento FROM fsj_app;

CREATE TRIGGER trg_rectificacion_asiento_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.rectificacion_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- BEFORE INSERT: the referenced asiento must exist and be RECTIFICATIVO;
-- autorizado_por_id must be a DT vigente today (INV-U05-style, same check
-- as fsj.anulacion_asiento_validar).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.rectificacion_asiento_validar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_asiento fsj.asiento_recetario%ROWTYPE;
BEGIN
  SELECT * INTO v_asiento FROM fsj.asiento_recetario WHERE tenant_id = NEW.tenant_id AND id = NEW.asiento_rectificativo_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L21: asiento_rectificativo_id % not found', NEW.asiento_rectificativo_id USING ERRCODE = 'P0001';
  END IF;
  IF v_asiento.origen <> 'RECTIFICATIVO' THEN
    RAISE EXCEPTION 'INV-L21: asiento % is not RECTIFICATIVO (is %) -- rectificacion_asiento only authorizes a rectificativo entry', NEW.asiento_rectificativo_id, v_asiento.origen
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT fsj.es_dt_vigente(NEW.autorizado_por_id, fsj.jornada_actual(NEW.tenant_id)) THEN
    RAISE EXCEPTION 'INV-U05: rectificacion autorizado_por_id % is not a DT vigente today', NEW.autorizado_por_id USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.rectificacion_asiento_validar() IS
  'INV-L21 (asiento side) + INV-U05: the referenced asiento_recetario must exist and be origen=RECTIFICATIVO; autorizado_por_id must be a DT vigente today (fsj.jornada_actual). Immediate (not deferred): by the time the app inserts this row the RECTIFICATIVO asiento already exists -- see migration 0033 header.';

CREATE TRIGGER trg_rectificacion_asiento_validar
  BEFORE INSERT ON fsj.rectificacion_asiento
  FOR EACH ROW EXECUTE FUNCTION fsj.rectificacion_asiento_validar();

-- ============================================================================
-- INV-L21 (asiento_recetario side, DEFERRED): a RECTIFICATIVO asiento
-- inserted without a matching rectificacion_asiento row fails at COMMIT.
-- Same shape as fsj.trg_asiento_recetario_p04 (migration 0014).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_validar_rectificacion(p_tenant_id uuid, p_asiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_origen fsj.origen_asiento;
BEGIN
  SELECT origen INTO v_origen FROM fsj.asiento_recetario WHERE tenant_id = p_tenant_id AND id = p_asiento_id;

  IF v_origen IS DISTINCT FROM 'RECTIFICATIVO' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM fsj.rectificacion_asiento WHERE tenant_id = p_tenant_id AND asiento_rectificativo_id = p_asiento_id
  ) THEN
    RAISE EXCEPTION 'INV-L21: asiento_recetario % (RECTIFICATIVO) requires a matching rectificacion_asiento by commit time', p_asiento_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_asiento_recetario_check_rectificacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.asiento_recetario_validar_rectificacion(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_asiento_recetario_rectificacion_l21
  AFTER INSERT ON fsj.asiento_recetario
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_asiento_recetario_check_rectificacion();

COMMENT ON FUNCTION fsj.trg_asiento_recetario_check_rectificacion() IS
  'INV-L21 (migration 0033, asiento side): a RECTIFICATIVO asiento_recetario row must have a matching fsj.rectificacion_asiento row by COMMIT time. DEFERRABLE INITIALLY DEFERRED because the app inserts the asiento BEFORE its rectificacion_asiento row in the same transaction (modules/libro/application/rectificar-asiento.ts).';
