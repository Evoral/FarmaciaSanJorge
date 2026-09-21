-- 0005_designacion_director_tecnico
--
-- FASE 1, point 1.5: Director Tecnico designations (M04). Depends on 0002
-- (fsj.usuario, fsj.rol/usuario_rol for the INV-DT-001 role check) and on
-- btree_gist (Phase 0 extension) for the EXCLUDE constraint below.
--
-- DP-11 is unresolved (can TITULAR + SUPLENTE be vigente simultaneously?),
-- so only TITULAR periods are constrained to be non-overlapping; SUPLENTE
-- is intentionally left unconstrained, as instructed.

DO $do$ BEGIN
  CREATE TYPE fsj.caracter_designacion_dt AS ENUM ('TITULAR', 'SUPLENTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS fsj.designacion_director_tecnico (
  id                      uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  usuario_id              uuid NOT NULL,
  caracter                fsj.caracter_designacion_dt NOT NULL,
  matricula               text NOT NULL,
  expediente_designacion  text,
  vigente_desde           date NOT NULL,
  vigente_hasta           date,
  motivo_cese             text,
  registrado_por_id       uuid NOT NULL,
  registrado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT designacion_dt_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT designacion_dt_usuario_fkey FOREIGN KEY (tenant_id, usuario_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT designacion_dt_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT designacion_dt_vigencia_check CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

COMMENT ON TABLE fsj.designacion_director_tecnico IS
  'M04. "MatriculaProfesional vigente" (INV-U04) is modeled via this designation''s own matricula column (DP-10). A cese sets vigente_hasta + motivo_cese; the row is never deleted or otherwise rewritten (INV-DT-003).';

SELECT fsj.setup_tenant_table('fsj.designacion_director_tecnico');

GRANT UPDATE (vigente_hasta, motivo_cese) ON fsj.designacion_director_tecnico TO fsj_app;

-- ============================================================================
-- INV-DT-002: no two TITULAR designations with overlapping periods, per
-- tenant. Requires btree_gist for the `tenant_id WITH =` equality operator
-- class inside a GiST exclusion constraint (Phase 0 extension).
-- SUPLENTE is intentionally NOT constrained here -- DP-11 pending.
-- ============================================================================
ALTER TABLE fsj.designacion_director_tecnico
  ADD CONSTRAINT designacion_dt_titular_no_solapa
  EXCLUDE USING gist (
    tenant_id WITH =,
    daterange(vigente_desde, vigente_hasta, '[]') WITH &&
  )
  WHERE (caracter = 'TITULAR');

-- ============================================================================
-- INV-DT-001 (DB half): the designated user must hold role DIRECTOR_TECNICO
-- at the time of designation. Checked on INSERT only -- usuario_id is
-- immutable afterwards (INV-DT-003, enforced below).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.designacion_dt_validar_rol()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM fsj.usuario_rol ur
    JOIN fsj.rol r ON r.id = ur.rol_id
    WHERE ur.tenant_id = NEW.tenant_id
      AND ur.usuario_id = NEW.usuario_id
      AND r.codigo = 'DIRECTOR_TECNICO'
  ) THEN
    RAISE EXCEPTION 'INV-DT-001: user % does not have role DIRECTOR_TECNICO', NEW.usuario_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_designacion_dt_validar_rol
  BEFORE INSERT ON fsj.designacion_director_tecnico
  FOR EACH ROW EXECUTE FUNCTION fsj.designacion_dt_validar_rol();

-- ============================================================================
-- INV-DT-003: a cese only ever sets vigente_hasta + motivo_cese; every
-- other column (including vigente_hasta itself, once set -- cese is final)
-- is immutable. No DELETE either (forbid_delete, Phase 1.1 helper).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.designacion_dt_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.usuario_id IS DISTINCT FROM OLD.usuario_id THEN
    RAISE EXCEPTION 'INV-DT-003: usuario_id cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.caracter IS DISTINCT FROM OLD.caracter THEN
    RAISE EXCEPTION 'INV-DT-003: caracter cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.matricula IS DISTINCT FROM OLD.matricula THEN
    RAISE EXCEPTION 'INV-DT-003: matricula cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde THEN
    RAISE EXCEPTION 'INV-DT-003: vigente_desde cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.vigente_hasta IS NOT NULL AND NEW.vigente_hasta IS DISTINCT FROM OLD.vigente_hasta THEN
    RAISE EXCEPTION 'INV-DT-003: vigente_hasta cannot be modified once set (cese is final)' USING ERRCODE = 'P0001';
  END IF;
  -- motivo_cese is part of the cese and just as final: it may only be written
  -- in the same UPDATE that sets vigente_hasta, never rewritten afterwards.
  IF OLD.vigente_hasta IS NOT NULL AND NEW.motivo_cese IS DISTINCT FROM OLD.motivo_cese THEN
    RAISE EXCEPTION 'INV-DT-003: motivo_cese cannot be modified once the cese is registered' USING ERRCODE = 'P0001';
  END IF;
  -- A motivo_cese without a cese date would mean "ceased with no end date".
  IF NEW.motivo_cese IS NOT NULL AND NEW.vigente_hasta IS NULL THEN
    RAISE EXCEPTION 'INV-DT-003: motivo_cese requires vigente_hasta' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_designacion_dt_validar_update
  BEFORE UPDATE ON fsj.designacion_director_tecnico
  FOR EACH ROW EXECUTE FUNCTION fsj.designacion_dt_validar_update();

CREATE TRIGGER trg_designacion_dt_forbid_delete
  BEFORE DELETE ON fsj.designacion_director_tecnico
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ============================================================================
-- fsj.es_dt_vigente(usuario, fecha): is this user a DT designee (TITULAR or
-- SUPLENTE -- DP-11 does not say suplentes don't count as "vigente" for a
-- specific person, only that simultaneous titular+suplente vigency is
-- unresolved) covering `p_fecha`?
--
-- Deliberately takes only 2 params, matching the plan's signature exactly
-- -- tenant scoping comes from RLS (SECURITY INVOKER, the default, plus
-- FORCE ROW LEVEL SECURITY from fsj.setup_tenant_table), not from an
-- explicit third argument. Caller MUST run inside a transaction with
-- app.tenant_id set (withTenantTransaction) for this to see any rows.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.es_dt_vigente(p_usuario uuid, p_fecha date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM fsj.designacion_director_tecnico d
    WHERE d.usuario_id = p_usuario
      AND d.vigente_desde <= p_fecha
      AND (d.vigente_hasta IS NULL OR d.vigente_hasta >= p_fecha)
  );
$$;

COMMENT ON FUNCTION fsj.es_dt_vigente(uuid, date) IS
  'INV-U04: used by M08/M10/M11/M13 to check DT vigency AT A SPECIFIC BUSINESS DATE (e.g. cierre.fecha), never against "today" implicitly -- pass the correct date explicitly. Relies on RLS for tenant scoping (see comment above); returns false with no app.tenant_id set, by construction.';

GRANT EXECUTE ON FUNCTION fsj.es_dt_vigente(uuid, date) TO fsj_app;
