-- 0021_designacion_dt_cese_retroactivo_guard
--
-- FASE 3, point 3.9: fsj.cierre_diario_firmar (migration 0019) validates
-- DT vigency (INV-U04) against fsj.designacion_director_tecnico AT SIGNING
-- TIME ONLY, then snapshots designacion_id + matricula_dt into
-- cierre_diario and never re-validates them afterwards -- an already
-- signed cierre is an immutable legal fact (INV-C-family). A cese
-- (vigente_hasta + motivo_cese) is allowed to be dated in the past
-- (INV-DT-003 only requires vigente_hasta >= vigente_desde, nothing about
-- "not before today").
--
-- Combine those two and there is a real hole: if a cese is registered with
-- a vigente_hasta EARLIER than the fecha of a cierre_diario that already
-- exists and references this SAME designacion_id, fsj.es_dt_vigente(usuario,
-- fecha) would afterwards say the DT was NOT vigente on a date for which a
-- legally signed cierre exists claiming the opposite. That is a
-- database-created contradiction between two tables that are both
-- supposed to be authoritative -- exactly the kind of legal-integrity gap
-- this schema is meant to make impossible, not just unlikely. This
-- migration rejects that specific cese instead of allowing it.
--
-- Deliberately narrow: it only blocks a cese whose vigente_hasta would
-- fall STRICTLY BEFORE the fecha of an EXISTING signed cierre that
-- references this exact designacion_id. A cese dated in the past that
-- does not conflict with any signed cierre (no cierre yet, or every
-- signed cierre referencing this designacion is on/before the new
-- vigente_hasta) is still allowed, per task instruction.

CREATE OR REPLACE FUNCTION fsj.designacion_dt_validar_cese_retroactivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflicto date;
BEGIN
  -- Only relevant the moment vigente_hasta is FIRST set (the cese itself).
  -- trg_designacion_dt_validar_update (migration 0005) already forbids
  -- changing vigente_hasta again once set, so OLD.vigente_hasta IS NULL is
  -- exactly "this UPDATE is the cese".
  IF OLD.vigente_hasta IS NULL AND NEW.vigente_hasta IS NOT NULL THEN
    SELECT c.fecha INTO v_conflicto
    FROM fsj.cierre_diario c
    WHERE c.designacion_id = OLD.id
      AND c.fecha > NEW.vigente_hasta
    ORDER BY c.fecha
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'INV-DT-004: cese of designacion % with vigente_hasta % would leave the already-signed cierre_diario of % without a vigente DT that day', OLD.id, NEW.vigente_hasta, v_conflicto
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_designacion_dt_validar_cese_retroactivo ON fsj.designacion_director_tecnico;
-- Trigger name sorts before trg_designacion_dt_validar_update
-- alphabetically ("cese_retroactivo" < "update"), so this guard runs
-- first; order does not actually matter here since neither trigger
-- mutates NEW, but keeping both as BEFORE UPDATE triggers on the same
-- table follows this migration set's established pattern (one trigger per
-- concern, not one giant function).
CREATE TRIGGER trg_designacion_dt_validar_cese_retroactivo
  BEFORE UPDATE ON fsj.designacion_director_tecnico
  FOR EACH ROW EXECUTE FUNCTION fsj.designacion_dt_validar_cese_retroactivo();

COMMENT ON FUNCTION fsj.designacion_dt_validar_cese_retroactivo() IS
  'INV-DT-004 (FASE 3 point 3.9): rejects a cese whose vigente_hasta predates an already-signed cierre_diario that references this designacion_id -- see migration header for the legal-consistency reasoning.';
