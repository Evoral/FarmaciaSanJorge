-- 0129 -- Persisted integrity incidents of the libros (openspec/changes/incidentes-integridad-plataforma; libro spec
-- "Incidente de integridad", plataforma spec P8/P9/P17-P19).
--
--   1. fsj.libro_incidente_integridad: one row per libro and broken asiento number, OPEN while resuelto_en IS NULL.
--      At most one open row per libro (partial unique index). No user column: the browsing user did not cause the
--      quiebre, the row is itself the record. fsj_app: SELECT/INSERT (0000 defaults) plus UPDATE of the three counters
--      only; never DELETE (forbid_delete trigger as well). A resolved row is frozen and detecciones never decreases
--      (INV-L27).
--   2. fsj.libro_incidente_registrar(libro, quiebre): the whole state machine, SECURITY INVOKER so RLS stays in force.
--      It runs when the layout's verification is a real one (cache miss) and the incident is only a record: the
--      source of truth stays fsj.verificar_cadena and the banner never reads this table.
--   3. fsj.plataforma_incidentes_integridad(token, tenant ids, solo abiertos, limit): the ONLY platform door to the
--      table (spec P9 exception). SECURITY DEFINER, validates the platform session first, fixed non-clinical columns.
--
-- Code: modules/libro (registrar-incidentes-integridad) and modules/plataforma. Apply before the code that calls them.
-- Rollback: prisma/rollbacks/0129_libro_incidente_integridad.down.sql (as a NEW forward migration; it DROPS the
-- incident history, export it first).

-- ============================================================================
-- 1. Table
-- ============================================================================
CREATE TABLE fsj.libro_incidente_integridad (
  id                     uuid        PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  libro_id               uuid        NOT NULL,
  primer_quiebre_numero  bigint      NOT NULL,
  detectado_en           timestamptz NOT NULL DEFAULT now(),
  ultima_deteccion_en    timestamptz NOT NULL DEFAULT now(),
  detecciones            integer     NOT NULL DEFAULT 1 CHECK (detecciones >= 1),
  resuelto_en            timestamptz,
  CONSTRAINT libro_incidente_integridad_libro_fkey FOREIGN KEY (tenant_id, libro_id) REFERENCES fsj.libro_rubricado (tenant_id, id),
  CONSTRAINT libro_incidente_integridad_fechas_check CHECK (
    ultima_deteccion_en >= detectado_en AND (resuelto_en IS NULL OR resuelto_en >= detectado_en)
  )
);

COMMENT ON TABLE fsj.libro_incidente_integridad IS
  '0129. A libro hash-chain quiebre seen by a real verification: open while resuelto_en IS NULL, one open row per libro. Never deleted; a resolved row is frozen (INV-L27). No user column. Read by the platform only through fsj.plataforma_incidentes_integridad.';

SELECT fsj.setup_tenant_table('fsj.libro_incidente_integridad');

-- At most one open incident per libro; the DB backstop of the advisory lock in libro_incidente_registrar.
CREATE UNIQUE INDEX uq_libro_incidente_integridad_abierto
  ON fsj.libro_incidente_integridad (tenant_id, libro_id) WHERE resuelto_en IS NULL;

-- The non-partial FK index (history of a libro, newest first).
CREATE INDEX libro_incidente_integridad_libro_idx
  ON fsj.libro_incidente_integridad (tenant_id, libro_id, detectado_en DESC);

-- SELECT/INSERT come from ALTER DEFAULT PRIVILEGES (0000). UPDATE only on the columns a repeated detection or the
-- close touches; the identity columns (libro_id, primer_quiebre_numero, detectado_en) stay immutable for the app.
GRANT UPDATE (ultima_deteccion_en, detecciones, resuelto_en) ON fsj.libro_incidente_integridad TO fsj_app;

CREATE TRIGGER trg_libro_incidente_integridad_forbid_delete
  BEFORE DELETE ON fsj.libro_incidente_integridad
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

CREATE OR REPLACE FUNCTION fsj.libro_incidente_validar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = fsj, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.resuelto_en IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L27: un incidente de integridad se abre sin fecha de resolución' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.resuelto_en IS NOT NULL THEN
    RAISE EXCEPTION 'INV-L27: un incidente de integridad resuelto no se puede modificar' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.detecciones < OLD.detecciones THEN
    RAISE EXCEPTION 'INV-L27: las detecciones de un incidente de integridad no pueden disminuir' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.libro_incidente_validar() IS
  '0129. BEFORE INSERT OR UPDATE on libro_incidente_integridad: INSERT only open, a resolved row is frozen, detecciones never decreases (INV-L27).';

REVOKE ALL ON FUNCTION fsj.libro_incidente_validar() FROM PUBLIC, fsj_app;

CREATE TRIGGER trg_libro_incidente_integridad_validar
  BEFORE INSERT OR UPDATE ON fsj.libro_incidente_integridad
  FOR EACH ROW EXECUTE FUNCTION fsj.libro_incidente_validar();

-- ============================================================================
-- 2. fsj.libro_incidente_registrar (SECURITY INVOKER: RLS and grants of the caller apply)
-- ============================================================================
-- p_quiebre = first broken asiento number, NULL when the verification of the libro came out OK.
--   open, same number      -> REPETIDO   (detecciones + 1)
--   open, different number -> ABIERTO    (closes the open one, opens a new one)
--   open, OK               -> CERRADO
--   none, broken           -> ABIERTO
--   none, OK               -> SIN_CAMBIO
-- The advisory lock serializes two instances working on the same libro, so "the number moved" cannot race.
CREATE OR REPLACE FUNCTION fsj.libro_incidente_registrar(p_libro_id uuid, p_quiebre bigint)
RETURNS TABLE (transicion text, incidente_id uuid)
LANGUAGE plpgsql
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_tenant      uuid := fsj.current_tenant_id();
  v_abierto_id  uuid;
  v_abierto_num bigint;
  v_nuevo_id    uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('libro_incidente:' || p_libro_id::text, 0));

  SELECT i.id, i.primer_quiebre_numero
  INTO v_abierto_id, v_abierto_num
  FROM fsj.libro_incidente_integridad i
  WHERE i.tenant_id = v_tenant AND i.libro_id = p_libro_id AND i.resuelto_en IS NULL;

  IF p_quiebre IS NULL THEN
    IF v_abierto_id IS NULL THEN
      RETURN QUERY SELECT 'SIN_CAMBIO'::text, NULL::uuid;
      RETURN;
    END IF;
    UPDATE fsj.libro_incidente_integridad SET resuelto_en = now() WHERE id = v_abierto_id;
    RETURN QUERY SELECT 'CERRADO'::text, v_abierto_id;
    RETURN;
  END IF;

  IF v_abierto_id IS NOT NULL AND v_abierto_num = p_quiebre THEN
    UPDATE fsj.libro_incidente_integridad
    SET detecciones = detecciones + 1, ultima_deteccion_en = now()
    WHERE id = v_abierto_id;
    RETURN QUERY SELECT 'REPETIDO'::text, v_abierto_id;
    RETURN;
  END IF;

  IF v_abierto_id IS NOT NULL THEN
    UPDATE fsj.libro_incidente_integridad SET resuelto_en = now() WHERE id = v_abierto_id;
  END IF;

  INSERT INTO fsj.libro_incidente_integridad (tenant_id, libro_id, primer_quiebre_numero)
  VALUES (v_tenant, p_libro_id, p_quiebre)
  RETURNING id INTO v_nuevo_id;
  RETURN QUERY SELECT 'ABIERTO'::text, v_nuevo_id;
END;
$$;

COMMENT ON FUNCTION fsj.libro_incidente_registrar(uuid, bigint) IS
  '0129. Applies one libro verification result to the incident table (ABIERTO / REPETIDO / CERRADO / SIN_CAMBIO). SECURITY INVOKER on purpose: RLS and grants of fsj_app stay in force. Serialized per libro by an advisory lock.';

-- PUBLIC never; fsj_app reaches it through the default privileges of 0101 (safe: INVOKER + RLS).
REVOKE ALL ON FUNCTION fsj.libro_incidente_registrar(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.libro_incidente_registrar(uuid, bigint) TO fsj_app;

-- ============================================================================
-- 3. fsj.plataforma_incidentes_integridad (the platform's only read of the table)
-- ============================================================================
-- Takes a list of tenant ids (no single p_tenant_id), so the 0119 "refuse a foreign p_tenant_id" rule does not apply:
-- it follows the fsj.plataforma_* exception. The owner role has BYPASSRLS (0119); the join to libro_rubricado is only
-- for the libro tipo. Open incidents first, then newest first.
CREATE OR REPLACE FUNCTION fsj.plataforma_incidentes_integridad(
  p_token_hash     text,
  p_tenant_ids     uuid[],
  p_solo_abiertos  boolean,
  p_limit          integer
)
RETURNS TABLE (
  id                     uuid,
  tenant_id              uuid,
  libro_tipo             text,
  primer_quiebre_numero  bigint,
  detectado_en           timestamptz,
  ultima_deteccion_en    timestamptz,
  detecciones            integer,
  resuelto_en            timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := fsj.plataforma_actor(p_token_hash);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
BEGIN
  IF cardinality(p_tenant_ids) > 100 THEN
    RAISE EXCEPTION 'p_tenant_ids admits at most 100 ids' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT i.id, i.tenant_id, l.tipo::text, i.primer_quiebre_numero, i.detectado_en, i.ultima_deteccion_en,
         i.detecciones, i.resuelto_en
  FROM fsj.libro_incidente_integridad i
  JOIN fsj.libro_rubricado l ON l.tenant_id = i.tenant_id AND l.id = i.libro_id
  WHERE i.tenant_id = ANY (coalesce(p_tenant_ids, ARRAY[]::uuid[]))
    AND (NOT coalesce(p_solo_abiertos, false) OR i.resuelto_en IS NULL)
  ORDER BY (i.resuelto_en IS NULL) DESC, i.detectado_en DESC, i.id
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION fsj.plataforma_incidentes_integridad(text, uuid[], boolean, integer) IS
  '0129 (spec P18). Integrity incidents of the given pharmacies, open first. Validates the platform session first (INV-PLAT-AUTH); returns only incident id, tenant id, libro tipo, numero, dates, count and resolution date.';

REVOKE ALL ON FUNCTION fsj.plataforma_incidentes_integridad(text, uuid[], boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fsj.plataforma_incidentes_integridad(text, uuid[], boolean, integer) TO fsj_app;
