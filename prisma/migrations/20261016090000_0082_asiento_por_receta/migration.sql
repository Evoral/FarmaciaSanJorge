-- 0082_asiento_por_receta
--
-- D8 (user decision, 2026-10-16, docs/specs/libro-recetario-y-contralor.md
-- §1): ONE asiento per receta. Every NEW SISTEMA asiento_recetario covers a
-- whole receta -- all its ítems, confirmed together by "Imprimir etiquetas"
-- (preparaciones.confirmarReservasReceta) -- with one number and one
-- snapshot. The per-ítem SISTEMA asientos already in the libro (D2) are
-- immutable and keep working exactly as before.
--
-- DESIGN:
--   1. asiento_recetario.receta_id (new, nullable, FK (tenant_id, receta_id)
--      -> receta). A por-receta SISTEMA row has preparacion_id NULL,
--      receta_id NOT NULL and version_hash 4 (pinned by the BEFORE INSERT
--      trigger, never by the app); a legacy SISTEMA row keeps
--      preparacion_id NOT NULL, receta_id NULL, version_hash <= 3.
--   2. New table fsj.asiento_preparacion (tenant_id, asiento_recetario_id,
--      preparacion_id, orden): the preparaciones a por-receta asiento
--      covers, in ítem order. UNIQUE (tenant_id, preparacion_id): a
--      preparación is in at most one asiento. Inserted BEFORE its asiento,
--      in the same transaction, against the app-generated asiento id --
--      the same contract as detalle_asiento (migration 0034): the FK to
--      asiento_recetario is DEFERRABLE INITIALLY DEFERRED, the rows are
--      insert-only (no UPDATE/DELETE grant, forbid_update_delete trigger)
--      and cannot be inserted once their asiento exists (INV-L23, extended
--      here), so the hashed set is frozen at asiento insert time.
--   3. INV-L07 (revised): SISTEMA is either legacy (preparacion_id NOT NULL,
--      receta_id NULL, version_hash <= 3) or por receta (preparacion_id
--      NULL, receta_id NOT NULL, version_hash = 4). RECTIFICATIVO unchanged
--      (receta_id NULL as well). The BEFORE INSERT trigger rejects a NEW
--      SISTEMA row with preparacion_id with a clear INV-L07 message: from
--      this migration on, no code path may write a per-ítem asiento.
--   4. INV-L24 (new): at most one SISTEMA asiento per receta -- partial
--      unique index (tenant_id, receta_id) WHERE origen = 'SISTEMA'.
--      Legacy rows have receta_id NULL, so a receta that already had
--      per-ítem asientos at deploy time can still get ONE por-receta
--      asiento for its remaining ítems (D8 "Transición").
--   5. INV-L25 (new): a por-receta SISTEMA asiento has >= 1
--      asiento_preparacion (checked at insert, the rows must already exist
--      for the hash), and every linked preparación belongs to an
--      item_receta of its receta_id (deferred constraint trigger, at
--      COMMIT).
--   6. INV-P04 (revised, both directions): a CONFIRMADA preparación has its
--      SISTEMA asiento -- legacy (asiento_recetario.preparacion_id) OR por
--      receta (asiento_preparacion); a SISTEMA asiento requires every
--      preparación it covers (one for legacy, all its asiento_preparacion
--      rows for por receta) to be CONFIRMADA. A preparación that already has
--      a legacy asiento cannot be linked to a por-receta one.
--   7. Hash V4 (fsj.asiento_recetario_hash_v4, tag 'FSJ-ASIENTO-V4'): V3's
--      fields plus receta_id and the linked preparaciones (orden,
--      preparacion_id, ORDER BY orden, prefixed by their count), before the
--      detalle lines. fsj.verificar_cadena keeps recomputing each row with
--      the function of its own version_hash (1/2/3/4). New RECTIFICATIVO
--      rows stay on V3 (no receta_id, no preparaciones).
--   8. fsj.v_asiento_sistema_preparacion (new view, security_invoker): "the
--      SISTEMA asiento of a preparación", legacy or por receta, one row per
--      (preparación, asiento). Used below by INV-P04 and INV-R12 and by
--      every app reader that goes from a preparación to its asiento (or
--      back) in raw SQL, so the two kinds are resolved in one place.
--   9. INV-R12 (migration 0050) resolves both kinds through that view.
--
-- detalle_asiento is unchanged: a por-receta asiento's lines are those of
-- all its ítems, in ítem order, with a continuous `orden` (assembled by the
-- app, modules/preparaciones/domain/asiento-receta.ts).
--
-- Rollback: prisma/rollbacks/0082_asiento_por_receta.down.sql (as a NEW
-- forward migration) and docs/rollbacks/asiento-por-receta.md. It refuses
-- to run once any version_hash = 4 asiento exists: those rows cannot be
-- expressed in the pre-0082 model.

-- ============================================================================
-- 1. asiento_recetario.receta_id + INV-L07 (revised) + INV-L24.
-- ============================================================================
ALTER TABLE fsj.asiento_recetario ADD COLUMN IF NOT EXISTS receta_id uuid;

ALTER TABLE fsj.asiento_recetario
  ADD CONSTRAINT asiento_recetario_receta_fkey
  FOREIGN KEY (tenant_id, receta_id) REFERENCES fsj.receta (tenant_id, id);

COMMENT ON COLUMN fsj.asiento_recetario.receta_id IS
  'D8 (migration 0082): the receta a por-receta SISTEMA asiento covers (version_hash 4, preparacion_id NULL, its preparaciones in fsj.asiento_preparacion). NULL for legacy per-ítem SISTEMA asientos (preparacion_id NOT NULL, version_hash <= 3) and for RECTIFICATIVO rows.';

COMMENT ON COLUMN fsj.asiento_recetario.preparacion_id IS
  'Legacy per-ítem SISTEMA asientos only (D2, version_hash <= 3). NULL for por-receta SISTEMA asientos (D8, migration 0082 -- see receta_id and fsj.asiento_preparacion) and for RECTIFICATIVO rows. No new row may set it (INV-L07, fsj.asiento_recetario_preparar).';

ALTER TABLE fsj.asiento_recetario DROP CONSTRAINT asiento_recetario_origen_check;
ALTER TABLE fsj.asiento_recetario
  ADD CONSTRAINT asiento_recetario_origen_check CHECK (
    (origen = 'SISTEMA' AND asiento_original_id IS NULL AND (
      (preparacion_id IS NOT NULL AND receta_id IS NULL AND version_hash <= 3)
      OR (preparacion_id IS NULL AND receta_id IS NOT NULL AND version_hash = 4)
    ))
    OR (origen = 'RECTIFICATIVO' AND preparacion_id IS NULL AND receta_id IS NULL AND asiento_original_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT asiento_recetario_origen_check ON fsj.asiento_recetario IS
  'INV-L07 (revised by migration 0082, D8): SISTEMA legacy (preparacion_id, version_hash <= 3) or por receta (receta_id, version_hash = 4); RECTIFICATIVO references its original only.';

-- INV-L24: at most one SISTEMA asiento per receta (legacy rows have
-- receta_id NULL and never collide).
CREATE UNIQUE INDEX IF NOT EXISTS uq_asiento_recetario_receta
  ON fsj.asiento_recetario (tenant_id, receta_id)
  WHERE origen = 'SISTEMA';

COMMENT ON COLUMN fsj.asiento_recetario.version_hash IS
  'Which hash_integridad serialization produced this row: 1 (migration 0014, byte-unsafe), 2 (migration 0018, asiento-only fields), 3 (migration 0034, includes detalle_asiento lines), 4 (migration 0082, por-receta SISTEMA: V3 plus receta_id and the asiento_preparacion rows). Pinned by fsj.asiento_recetario_preparar, never by the app: 4 for every new SISTEMA row, 3 for every new RECTIFICATIVO row.';

-- ============================================================================
-- 2. fsj.asiento_preparacion.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.asiento_preparacion (
  id                     uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  asiento_recetario_id   uuid NOT NULL,
  preparacion_id         uuid NOT NULL,
  orden                  integer NOT NULL,   -- 1..n, ítem order within the asiento
  PRIMARY KEY (id),
  CONSTRAINT asiento_preparacion_tenant_id_key UNIQUE (tenant_id, id),
  -- A preparación is in at most one por-receta asiento (D8).
  CONSTRAINT asiento_preparacion_preparacion_key UNIQUE (tenant_id, preparacion_id),
  CONSTRAINT asiento_preparacion_orden_unico UNIQUE (tenant_id, asiento_recetario_id, orden),
  CONSTRAINT asiento_preparacion_asiento_fkey FOREIGN KEY (tenant_id, asiento_recetario_id) REFERENCES fsj.asiento_recetario (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT asiento_preparacion_preparacion_fkey FOREIGN KEY (tenant_id, preparacion_id) REFERENCES fsj.preparacion (tenant_id, id),
  CONSTRAINT asiento_preparacion_orden_check CHECK (orden >= 1)
);

COMMENT ON TABLE fsj.asiento_preparacion IS
  'D8 (migration 0082). The preparaciones a por-receta SISTEMA asiento_recetario covers, in ítem order. Inserted BEFORE the asiento (app-generated id, deferred FK) and frozen once it exists (INV-L23); immutable (no UPDATE/DELETE grant, forbid_update_delete trigger). Hashed into the asiento (V4).';

SELECT fsj.setup_tenant_table('fsj.asiento_preparacion');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.asiento_preparacion FROM fsj_app;

CREATE TRIGGER trg_asiento_preparacion_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.asiento_preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- INV-L23 (extended to asiento_preparacion) + INV-P04's uniqueness direction
-- across the two kinds: a preparación that already has a legacy SISTEMA
-- asiento cannot be linked to a por-receta one.
CREATE OR REPLACE FUNCTION fsj.asiento_preparacion_validar()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.asiento_recetario WHERE tenant_id = NEW.tenant_id AND id = NEW.asiento_recetario_id) THEN
    RAISE EXCEPTION 'INV-L23: cannot insert asiento_preparacion for asiento_recetario % -- that asiento already exists, so its hashed preparacion set is frozen', NEW.asiento_recetario_id
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM fsj.asiento_recetario
    WHERE tenant_id = NEW.tenant_id AND preparacion_id = NEW.preparacion_id AND origen = 'SISTEMA'
  ) THEN
    RAISE EXCEPTION 'INV-P04: preparacion % already has a (legacy) SISTEMA asiento_recetario', NEW.preparacion_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_preparacion_validar() IS
  'Migration 0082 (D8). BEFORE INSERT on asiento_preparacion: INV-L23 (the asiento must not exist yet -- rows are inserted BEFORE it) and INV-P04 uniqueness across kinds (no por-receta link for a preparación with a legacy SISTEMA asiento).';

CREATE TRIGGER trg_asiento_preparacion_validar
  BEFORE INSERT ON fsj.asiento_preparacion
  FOR EACH ROW EXECUTE FUNCTION fsj.asiento_preparacion_validar();

-- ============================================================================
-- 3. fsj.v_asiento_sistema_preparacion: the SISTEMA asiento of a
-- preparación, legacy or por receta. The por-receta branch joins the asiento
-- so an asiento_preparacion row whose asiento is not inserted yet (same
-- transaction, deferred FK) is never reported.
-- ============================================================================
CREATE OR REPLACE VIEW fsj.v_asiento_sistema_preparacion
WITH (security_invoker = true) AS
SELECT a.tenant_id, a.preparacion_id, a.id AS asiento_recetario_id
FROM fsj.asiento_recetario a
WHERE a.origen = 'SISTEMA' AND a.preparacion_id IS NOT NULL
UNION ALL
SELECT ap.tenant_id, ap.preparacion_id, ap.asiento_recetario_id
FROM fsj.asiento_preparacion ap
JOIN fsj.asiento_recetario a ON a.tenant_id = ap.tenant_id AND a.id = ap.asiento_recetario_id AND a.origen = 'SISTEMA';

COMMENT ON VIEW fsj.v_asiento_sistema_preparacion IS
  'D8 (migration 0082). One row per (preparación, its SISTEMA asiento_recetario): legacy per-ítem asientos (asiento_recetario.preparacion_id) and por-receta asientos (fsj.asiento_preparacion). At most one row per preparación (uq_asiento_recetario_preparacion, asiento_preparacion_preparacion_key, fsj.asiento_preparacion_validar). security_invoker: RLS of the underlying tables applies.';

GRANT SELECT ON fsj.v_asiento_sistema_preparacion TO fsj_app;

-- ============================================================================
-- 4. INV-L01: receta_id joins the frozen column list (0034 body + receta_id).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cierre_diario_id IS DISTINCT FROM OLD.cierre_diario_id THEN
    IF OLD.cierre_diario_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L01: asiento_recetario.cierre_diario_id cannot change once set' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(current_setting('fsj.cierre', true), '') <> 'on' THEN
      RAISE EXCEPTION 'INV-L01: asiento_recetario.cierre_diario_id can only be set by fsj.cierre_diario_firmar()' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF OLD.estado <> 'VIGENTE' OR NEW.estado <> 'ANULADO' THEN
      RAISE EXCEPTION 'INV-L01: invalid asiento_recetario.estado transition % -> %', OLD.estado, NEW.estado
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.cierre_diario_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L02: cannot anular asiento % -- its jornada (%) is already signed; use a rectificativo instead', OLD.id, OLD.fecha_asiento
        USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(current_setting('fsj.anula', true), '') <> 'on' THEN
      RAISE EXCEPTION 'INV-L09: asiento_recetario.estado can only change via fsj.anulacion_asiento' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.libro_id IS DISTINCT FROM OLD.libro_id
     OR NEW.numero_correlativo IS DISTINCT FROM OLD.numero_correlativo
     OR NEW.fecha_asiento IS DISTINCT FROM OLD.fecha_asiento
     OR NEW.origen IS DISTINCT FROM OLD.origen
     OR NEW.preparacion_id IS DISTINCT FROM OLD.preparacion_id
     OR NEW.receta_id IS DISTINCT FROM OLD.receta_id
     OR NEW.asiento_original_id IS DISTINCT FROM OLD.asiento_original_id
     OR NEW.paciente_texto IS DISTINCT FROM OLD.paciente_texto
     OR NEW.medico_texto IS DISTINCT FROM OLD.medico_texto
     OR NEW.formula_texto IS DISTINCT FROM OLD.formula_texto
     OR NEW.version_hash IS DISTINCT FROM OLD.version_hash
     OR NEW.hash_integridad IS DISTINCT FROM OLD.hash_integridad
     OR NEW.hash_anterior IS DISTINCT FROM OLD.hash_anterior
     OR NEW.registrado_por_id IS DISTINCT FROM OLD.registrado_por_id
  THEN
    RAISE EXCEPTION 'INV-L01: asiento_recetario rows are immutable except cierre_diario_id (once) and estado VIGENTE->ANULADO' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 5. fsj.asiento_recetario_hash_v4: V3 + receta_id + the linked
-- preparaciones (orden, preparacion_id, ORDER BY orden), count-prefixed.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_hash_v4(r fsj.asiento_recetario)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = fsj, extensions
AS $$
DECLARE
  v_prep     RECORD;
  v_detalle  RECORD;
  v_np       integer := 0;
  v_preps    text[] := ARRAY[]::text[];
  v_n        integer := 0;
  v_lineas   text[] := ARRAY[]::text[];
BEGIN
  FOR v_prep IN
    SELECT orden, preparacion_id
    FROM fsj.asiento_preparacion
    WHERE tenant_id = r.tenant_id AND asiento_recetario_id = r.id
    ORDER BY orden
  LOOP
    v_np := v_np + 1;
    v_preps := v_preps || ARRAY[v_prep.orden::text, v_prep.preparacion_id::text];
  END LOOP;

  FOR v_detalle IN
    SELECT orden, descripcion, cantidad, unidad_texto, linea_pesaje_id
    FROM fsj.detalle_asiento
    WHERE tenant_id = r.tenant_id AND asiento_recetario_id = r.id
    ORDER BY orden
  LOOP
    v_n := v_n + 1;
    v_lineas := v_lineas || ARRAY[
      v_detalle.orden::text,
      v_detalle.descripcion,
      v_detalle.cantidad::text,
      v_detalle.unidad_texto,
      v_detalle.linea_pesaje_id::text
    ];
  END LOOP;

  RETURN fsj.hash_v2(
    ARRAY[
      'FSJ-ASIENTO-V4',
      r.tenant_id::text,
      r.libro_id::text,
      r.numero_correlativo::text,
      to_char(r.fecha_asiento, 'YYYY-MM-DD'),
      r.origen::text,
      r.preparacion_id::text,
      r.asiento_original_id::text,
      r.receta_id::text,
      r.paciente_texto,
      r.medico_texto,
      r.formula_texto,
      r.hash_anterior,
      v_np::text
    ]
    || v_preps
    || ARRAY[v_n::text]
    || v_lineas
  );
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_hash_v4(fsj.asiento_recetario) IS
  'hash_integridad V4 of a por-receta SISTEMA asiento_recetario (tag FSJ-ASIENTO-V4, migration 0082): V3''s asiento fields plus receta_id (after asiento_original_id), then the count of its asiento_preparacion rows followed by each (orden, preparacion_id) ORDER BY orden, then the count of its detalle_asiento lines followed by each (orden, descripcion, cantidad, unidad_texto, linea_pesaje_id) ORDER BY orden. Used by the BEFORE INSERT trigger and by fsj.verificar_cadena.';

GRANT EXECUTE ON FUNCTION fsj.asiento_recetario_hash_v4(fsj.asiento_recetario) TO fsj_app;

-- ============================================================================
-- 6. asiento_recetario BEFORE INSERT ("preparar"): 0034 body, plus D8:
-- version_hash 4 for SISTEMA (3 for RECTIFICATIVO), INV-L07 (no new legacy
-- row), INV-L25 (>= 1 asiento_preparacion already inserted), V4 hash.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_preparar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_libro_id       uuid;
  v_numero         bigint;
  v_hash_anterior  text;
  v_original       fsj.asiento_recetario%ROWTYPE;
  v_detalles       bigint;
  v_preparaciones  bigint;
BEGIN
  SELECT id INTO v_libro_id
  FROM fsj.libro_rubricado
  WHERE tenant_id = NEW.tenant_id AND tipo = 'RECETARIO' AND fecha_cierre IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L03: tenant % has no open RECETARIO libro_rubricado', NEW.tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  NEW.libro_id := v_libro_id;
  NEW.fecha_asiento := fsj.jornada_actual(NEW.tenant_id);
  NEW.estado := 'VIGENTE';
  NEW.cierre_diario_id := NULL;

  IF NEW.origen = 'RECTIFICATIVO' THEN
    -- D8: a rectificativo has no receta_id nor preparaciones of its own; it
    -- stays on V3 (unchanged since migration 0034).
    NEW.version_hash := 3;

    SELECT * INTO v_original
    FROM fsj.asiento_recetario
    WHERE tenant_id = NEW.tenant_id AND id = NEW.asiento_original_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INV-L18: asiento_original_id % not found', NEW.asiento_original_id USING ERRCODE = 'P0001';
    END IF;
    IF v_original.origen <> 'SISTEMA' THEN
      RAISE EXCEPTION 'INV-L18: rectificativo must reference a SISTEMA asiento (% is %)', NEW.asiento_original_id, v_original.origen
        USING ERRCODE = 'P0001';
    END IF;
    IF v_original.cierre_diario_id IS NULL THEN
      RAISE EXCEPTION 'INV-L18: asiento_original_id % belongs to a jornada that is not yet signed', NEW.asiento_original_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_original.fecha_asiento >= NEW.fecha_asiento THEN
      RAISE EXCEPTION 'INV-L18: rectificativo fecha_asiento (%) must be AFTER the original''s fecha_asiento (%)', NEW.fecha_asiento, v_original.fecha_asiento
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- D8: every SISTEMA asiento inserted from this migration forward is por
    -- receta and hashed V4, regardless of what the app sent.
    NEW.version_hash := 4;

    -- INV-L07 (revised): no new legacy per-ítem asiento.
    IF NEW.preparacion_id IS NOT NULL THEN
      RAISE EXCEPTION 'INV-L07: a new SISTEMA asiento_recetario covers a whole receta (receta_id + asiento_preparacion), never a single preparacion_id (asiento %)', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.receta_id IS NULL THEN
      RAISE EXCEPTION 'INV-L07: a new SISTEMA asiento_recetario requires receta_id (asiento %)', NEW.id
        USING ERRCODE = 'P0001';
    END IF;

    -- INV-L22 (D4): its detalle_asiento rows were inserted ALREADY, against
    -- NEW.id (app-generated -- see migration 0034 header).
    SELECT count(*) INTO v_detalles
    FROM fsj.detalle_asiento
    WHERE tenant_id = NEW.tenant_id AND asiento_recetario_id = NEW.id;

    IF v_detalles = 0 THEN
      RAISE EXCEPTION 'INV-L22: a SISTEMA asiento_recetario requires at least one detalle_asiento row, inserted BEFORE it with the same (app-generated) id (asiento %)', NEW.id
        USING ERRCODE = 'P0001';
    END IF;

    -- INV-L25 (D8): and so were its asiento_preparacion rows (hashed below).
    SELECT count(*) INTO v_preparaciones
    FROM fsj.asiento_preparacion
    WHERE tenant_id = NEW.tenant_id AND asiento_recetario_id = NEW.id;

    IF v_preparaciones = 0 THEN
      RAISE EXCEPTION 'INV-L25: a SISTEMA asiento_recetario requires at least one asiento_preparacion row, inserted BEFORE it with the same (app-generated) id (asiento %)', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- RECETARIO is the lowest-ranked counter: locking it alone respects the
  -- global counter lock order (migration 0018 header, B1).
  SELECT numero, hash_anterior INTO v_numero, v_hash_anterior
  FROM fsj.contador_correlativo_tomar(NEW.tenant_id, v_libro_id);

  NEW.numero_correlativo := v_numero;
  NEW.hash_anterior := v_hash_anterior;
  NEW.hash_integridad := CASE NEW.version_hash
    WHEN 4 THEN fsj.asiento_recetario_hash_v4(NEW)
    ELSE fsj.asiento_recetario_hash_v3(NEW)
  END;

  UPDATE fsj.contador_correlativo
  SET ultimo_valor = v_numero, ultimo_hash = NEW.hash_integridad
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_preparar() IS
  'BEFORE INSERT on asiento_recetario. D8 (migration 0082): SISTEMA rows are por receta -- version_hash=4, receta_id required, preparacion_id refused (INV-L07), >= 1 detalle_asiento (INV-L22) and >= 1 asiento_preparacion (INV-L25) already inserted under NEW.id, hashed with fsj.asiento_recetario_hash_v4. RECTIFICATIVO rows: version_hash=3, V3 hash, INV-L18 unchanged.';

-- ============================================================================
-- 7. INV-P04 (revised, both directions).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.preparacion_validar_asiento(p_tenant_id uuid, p_preparacion_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_estado fsj.estado_preparacion;
BEGIN
  SELECT estado INTO v_estado FROM fsj.preparacion WHERE tenant_id = p_tenant_id AND id = p_preparacion_id;

  IF v_estado = 'CONFIRMADA' THEN
    IF NOT EXISTS (
      SELECT 1 FROM fsj.v_asiento_sistema_preparacion
      WHERE tenant_id = p_tenant_id AND preparacion_id = p_preparacion_id
    ) THEN
      RAISE EXCEPTION 'INV-P04: preparacion % is CONFIRMADA but has no SISTEMA asiento_recetario (legacy or por receta)', p_preparacion_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_asiento(uuid, uuid) IS
  'INV-P04, preparación side (revised by migration 0082): a CONFIRMADA preparación has its SISTEMA asiento, legacy (asiento_recetario.preparacion_id) or por receta (asiento_preparacion) -- via fsj.v_asiento_sistema_preparacion. Deferred constraint trigger trg_preparacion_asiento_p04 (migration 0014).';

CREATE OR REPLACE FUNCTION fsj.asiento_recetario_validar_preparacion(p_tenant_id uuid, p_asiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_origen          fsj.origen_asiento;
  v_preparacion_id  uuid;
  v_estado          fsj.estado_preparacion;
  v_link            RECORD;
BEGIN
  SELECT origen, preparacion_id INTO v_origen, v_preparacion_id
  FROM fsj.asiento_recetario
  WHERE tenant_id = p_tenant_id AND id = p_asiento_id;

  IF v_origen <> 'SISTEMA' THEN
    RETURN;
  END IF;

  IF v_preparacion_id IS NOT NULL THEN
    -- Legacy per-ítem asiento (D2): unchanged since migration 0014.
    SELECT estado INTO v_estado FROM fsj.preparacion WHERE tenant_id = p_tenant_id AND id = v_preparacion_id;

    IF v_estado IS DISTINCT FROM 'CONFIRMADA' THEN
      RAISE EXCEPTION 'INV-P04: asiento_recetario % (SISTEMA) requires its preparacion % to be CONFIRMADA (is %)', p_asiento_id, v_preparacion_id, v_estado
        USING ERRCODE = 'P0001';
    END IF;
    RETURN;
  END IF;

  -- Por-receta asiento (D8): every preparación it covers.
  FOR v_link IN
    SELECT ap.preparacion_id, p.estado
    FROM fsj.asiento_preparacion ap
    LEFT JOIN fsj.preparacion p ON p.tenant_id = ap.tenant_id AND p.id = ap.preparacion_id
    WHERE ap.tenant_id = p_tenant_id AND ap.asiento_recetario_id = p_asiento_id
    ORDER BY ap.orden
  LOOP
    IF v_link.estado IS DISTINCT FROM 'CONFIRMADA' THEN
      RAISE EXCEPTION 'INV-P04: asiento_recetario % (SISTEMA, por receta) requires its preparacion % to be CONFIRMADA (is %)', p_asiento_id, v_link.preparacion_id, v_link.estado
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_validar_preparacion(uuid, uuid) IS
  'INV-P04, asiento side (revised by migration 0082): a SISTEMA asiento requires every preparación it covers to be CONFIRMADA -- its preparacion_id (legacy) or all its asiento_preparacion rows (por receta). Deferred constraint trigger trg_asiento_recetario_p04 (migration 0014).';

-- ============================================================================
-- 8. INV-L25 (deferred): every preparación of a por-receta asiento belongs
-- to an item_receta of its receta_id.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.asiento_recetario_validar_por_receta(p_tenant_id uuid, p_asiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_origen     fsj.origen_asiento;
  v_receta_id  uuid;
  v_ajena      uuid;
BEGIN
  SELECT origen, receta_id INTO v_origen, v_receta_id
  FROM fsj.asiento_recetario
  WHERE tenant_id = p_tenant_id AND id = p_asiento_id;

  IF v_origen IS DISTINCT FROM 'SISTEMA' OR v_receta_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fsj.asiento_preparacion WHERE tenant_id = p_tenant_id AND asiento_recetario_id = p_asiento_id) THEN
    RAISE EXCEPTION 'INV-L25: asiento_recetario % (SISTEMA, por receta) has no asiento_preparacion', p_asiento_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT ap.preparacion_id INTO v_ajena
  FROM fsj.asiento_preparacion ap
  LEFT JOIN fsj.preparacion p ON p.tenant_id = ap.tenant_id AND p.id = ap.preparacion_id
  LEFT JOIN fsj.item_receta ir ON ir.tenant_id = p.tenant_id AND ir.id = p.item_receta_id
  WHERE ap.tenant_id = p_tenant_id AND ap.asiento_recetario_id = p_asiento_id
    AND ir.receta_id IS DISTINCT FROM v_receta_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'INV-L25: preparacion % of asiento_recetario % does not belong to an item of its receta %', v_ajena, p_asiento_id, v_receta_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_validar_por_receta(uuid, uuid) IS
  'INV-L25 (migration 0082, D8): a por-receta SISTEMA asiento has >= 1 asiento_preparacion, each of a preparación of an item_receta of its receta_id. Deferred: checked at COMMIT by trg_asiento_recetario_l25.';

CREATE OR REPLACE FUNCTION fsj.trg_asiento_recetario_check_por_receta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.asiento_recetario_validar_por_receta(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_asiento_recetario_l25
  AFTER INSERT ON fsj.asiento_recetario
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_asiento_recetario_check_por_receta();

-- ============================================================================
-- 9. fsj.verificar_cadena: 0034 body, plus version_hash 4.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.verificar_cadena(p_tenant uuid, p_libro uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = fsj, extensions
AS $$
DECLARE
  v_tipo          fsj.tipo_libro;
  v_esperado      bigint := 1;
  v_prev          text := fsj.hash_genesis();
  v_v2_visto      boolean := false;
  v_rec           fsj.asiento_recetario%ROWTYPE;
  v_con           fsj.asiento_contralor%ROWTYPE;
  v_hash_esperado text;
  v_ult_valor     bigint;
  v_ult_hash      text;
BEGIN
  SELECT tipo INTO v_tipo FROM fsj.libro_rubricado WHERE tenant_id = p_tenant AND id = p_libro;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-L03: libro % not found for tenant %', p_libro, p_tenant USING ERRCODE = 'P0001';
  END IF;

  IF v_tipo = 'RECETARIO' THEN
    FOR v_rec IN
      SELECT * FROM fsj.asiento_recetario
      WHERE tenant_id = p_tenant AND libro_id = p_libro
      ORDER BY numero_correlativo
    LOOP
      IF v_rec.numero_correlativo <> v_esperado OR v_rec.hash_anterior IS DISTINCT FROM v_prev THEN
        RETURN v_esperado;
      END IF;

      v_hash_esperado := CASE v_rec.version_hash
        WHEN 4 THEN fsj.asiento_recetario_hash_v4(v_rec)
        WHEN 3 THEN fsj.asiento_recetario_hash_v3(v_rec)
        WHEN 2 THEN fsj.asiento_recetario_hash_v2(v_rec)
        ELSE fsj.asiento_recetario_hash_v1(v_rec)
      END;
      IF v_rec.hash_integridad IS DISTINCT FROM v_hash_esperado THEN
        RETURN v_rec.numero_correlativo;
      END IF;

      v_prev := v_rec.hash_integridad;
      v_esperado := v_esperado + 1;
    END LOOP;
  ELSE
    FOR v_con IN
      SELECT * FROM fsj.asiento_contralor
      WHERE tenant_id = p_tenant AND libro_id = p_libro
      ORDER BY numero_correlativo
    LOOP
      IF v_con.numero_correlativo <> v_esperado OR v_con.hash_anterior IS DISTINCT FROM v_prev THEN
        RETURN v_esperado;
      END IF;
      IF v_con.hash_integridad = fsj.asiento_contralor_hash_v2(v_con) THEN
        v_v2_visto := true;
      ELSIF v_v2_visto OR v_con.hash_integridad IS DISTINCT FROM fsj.asiento_contralor_hash_v1(v_con) THEN
        RETURN v_con.numero_correlativo;
      END IF;
      v_prev := v_con.hash_integridad;
      v_esperado := v_esperado + 1;
    END LOOP;
  END IF;

  -- Tail check: the counter must agree with the last row (detects removed
  -- trailing rows, or a counter advanced without a row).
  SELECT ultimo_valor, ultimo_hash INTO v_ult_valor, v_ult_hash
  FROM fsj.contador_correlativo
  WHERE tenant_id = p_tenant AND libro_id = p_libro;
  IF FOUND AND (v_ult_valor <> v_esperado - 1 OR v_ult_hash IS DISTINCT FROM v_prev) THEN
    RETURN v_esperado;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fsj.verificar_cadena(uuid, uuid) IS
  'Recomputes the hash chain of one libro. asiento_recetario rows: recomputed with the function matching their OWN stored version_hash (1/2/3 -- migration 0034; 4 -- migration 0082, por-receta SISTEMA). asiento_contralor rows: unchanged V1/V2 trial (migration 0018). Returns the first broken numero_correlativo, or NULL if intact. SECURITY INVOKER: RLS scopes it to the caller''s tenant.';

-- ============================================================================
-- 10. INV-R12 (migration 0050): both kinds, through the view.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_anulacion_libro()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'ANULADA' AND OLD.estado IS DISTINCT FROM 'ANULADA' AND EXISTS (
    SELECT 1
    FROM fsj.item_receta ir
    JOIN fsj.preparacion p ON p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA'
    JOIN fsj.v_asiento_sistema_preparacion v ON v.tenant_id = p.tenant_id AND v.preparacion_id = p.id
    JOIN fsj.asiento_recetario a ON a.tenant_id = v.tenant_id AND a.id = v.asiento_recetario_id
    WHERE ir.tenant_id = NEW.tenant_id AND ir.receta_id = NEW.id
      AND NOT (
        a.estado = 'ANULADO'
        OR EXISTS (SELECT 1 FROM fsj.asiento_recetario r WHERE r.tenant_id = a.tenant_id AND r.asiento_original_id = a.id)
      )
  ) THEN
    RAISE EXCEPTION 'INV-R12: receta % cannot be ANULADA while an asiento_recetario of its preparaciones is still in effect', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_anulacion_libro() IS
  'INV-R12 (migration 0050, revised by 0082 for por-receta asientos). No receta ANULADA while a CONFIRMADA preparacion''s SISTEMA asiento -- legacy or por receta, via fsj.v_asiento_sistema_preparacion -- is in effect (VIGENTE, no RECTIFICATIVO). D2/D8''s auto-anulacion passes because it only runs once every item is sin efecto.';
