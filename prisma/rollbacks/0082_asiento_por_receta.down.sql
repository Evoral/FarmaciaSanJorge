-- Rollback of 0082_asiento_por_receta. Apply as a NEW forward migration,
-- AFTER deploying the code that writes one asiento per ítem again
-- (docs/rollbacks/asiento-por-receta.md).
--
-- It REFUSES to run once any por-receta asiento exists (version_hash = 4 or
-- any fsj.asiento_preparacion row): those rows are part of the legal libro
-- (immutable, hash-chained, possibly already signed in a cierre_diario) and
-- cannot be expressed in the pre-0082 model -- the old INV-L07 CHECK would
-- reject them and fsj.verificar_cadena could no longer recompute their
-- hash. Past that point the only safe "rollback" is a forward fix in the
-- application; see the rollback doc. Runs as the migration owner (postgres,
-- BYPASSRLS), so the check sees every tenant.

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.asiento_recetario WHERE version_hash = 4)
     OR EXISTS (SELECT 1 FROM fsj.asiento_preparacion) THEN
    RAISE EXCEPTION 'Rollback of 0082 refused: por-receta asientos (version_hash 4) already exist in the libro recetario -- see docs/rollbacks/asiento-por-receta.md';
  END IF;
END
$do$;

-- 10. INV-R12: back to its 0050 body.
CREATE OR REPLACE FUNCTION fsj.receta_validar_anulacion_libro()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'ANULADA' AND OLD.estado IS DISTINCT FROM 'ANULADA' AND EXISTS (
    SELECT 1
    FROM fsj.item_receta ir
    JOIN fsj.preparacion p ON p.tenant_id = ir.tenant_id AND p.item_receta_id = ir.id AND p.estado = 'CONFIRMADA'
    JOIN fsj.asiento_recetario a ON a.tenant_id = p.tenant_id AND a.preparacion_id = p.id AND a.origen = 'SISTEMA'
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
  'INV-R12 (new, migration 0050). No receta ANULADA while a CONFIRMADA preparacion''s SISTEMA asiento is in effect (VIGENTE, no RECTIFICATIVO). D2''s auto-anulacion passes because it only runs once every item is sin efecto.';

-- 9. fsj.verificar_cadena: back to its 0034 body (versions 1/2/3).
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
  'Recomputes the hash chain of one libro. asiento_recetario rows: recomputed with the function matching their OWN stored version_hash (1/2/3 -- migration 0034). asiento_contralor rows: unchanged V1/V2 trial (migration 0018) -- D4 did not touch that table. Returns the first broken numero_correlativo, or NULL if intact. SECURITY INVOKER: RLS scopes it to the caller''s tenant.';

-- 8. INV-L25.
DROP TRIGGER IF EXISTS trg_asiento_recetario_l25 ON fsj.asiento_recetario;
DROP FUNCTION IF EXISTS fsj.trg_asiento_recetario_check_por_receta();
DROP FUNCTION IF EXISTS fsj.asiento_recetario_validar_por_receta(uuid, uuid);

-- 7. INV-P04: back to its 0014 bodies.
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
      SELECT 1 FROM fsj.asiento_recetario
      WHERE tenant_id = p_tenant_id AND preparacion_id = p_preparacion_id AND origen = 'SISTEMA'
    ) THEN
      RAISE EXCEPTION 'INV-P04: preparacion % is CONFIRMADA but has no SISTEMA asiento_recetario', p_preparacion_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.preparacion_validar_asiento(uuid, uuid) IS NULL;

CREATE OR REPLACE FUNCTION fsj.asiento_recetario_validar_preparacion(p_tenant_id uuid, p_asiento_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_origen          fsj.origen_asiento;
  v_preparacion_id  uuid;
  v_estado          fsj.estado_preparacion;
BEGIN
  SELECT origen, preparacion_id INTO v_origen, v_preparacion_id
  FROM fsj.asiento_recetario
  WHERE tenant_id = p_tenant_id AND id = p_asiento_id;

  IF v_origen <> 'SISTEMA' THEN
    RETURN;
  END IF;

  SELECT estado INTO v_estado FROM fsj.preparacion WHERE tenant_id = p_tenant_id AND id = v_preparacion_id;

  IF v_estado IS DISTINCT FROM 'CONFIRMADA' THEN
    RAISE EXCEPTION 'INV-P04: asiento_recetario % (SISTEMA) requires its preparacion % to be CONFIRMADA (is %)', p_asiento_id, v_preparacion_id, v_estado
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_validar_preparacion(uuid, uuid) IS NULL;

-- 6. asiento_recetario BEFORE INSERT: back to its 0034 body (V3 for every row).
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
  NEW.version_hash := 3;

  IF NEW.origen = 'RECTIFICATIVO' THEN
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
    SELECT count(*) INTO v_detalles
    FROM fsj.detalle_asiento
    WHERE tenant_id = NEW.tenant_id AND asiento_recetario_id = NEW.id;

    IF v_detalles = 0 THEN
      RAISE EXCEPTION 'INV-L22: a SISTEMA asiento_recetario requires at least one detalle_asiento row, inserted BEFORE it with the same (app-generated) id (asiento %)', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT numero, hash_anterior INTO v_numero, v_hash_anterior
  FROM fsj.contador_correlativo_tomar(NEW.tenant_id, v_libro_id);

  NEW.numero_correlativo := v_numero;
  NEW.hash_anterior := v_hash_anterior;
  NEW.hash_integridad := fsj.asiento_recetario_hash_v3(NEW);

  UPDATE fsj.contador_correlativo
  SET ultimo_valor = v_numero, ultimo_hash = NEW.hash_integridad
  WHERE tenant_id = NEW.tenant_id AND libro_id = v_libro_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.asiento_recetario_preparar() IS
  'BEFORE INSERT on asiento_recetario. D4 (migration 0034): pins version_hash=3 and hashes with fsj.asiento_recetario_hash_v3 (includes detalle_asiento lines, which must already exist under NEW.id -- INV-L22 for SISTEMA). INV-L18 for RECTIFICATIVO unchanged from migration 0018.';

-- 5. Hash V4.
DROP FUNCTION IF EXISTS fsj.asiento_recetario_hash_v4(fsj.asiento_recetario);

-- 4. INV-L01: back to its 0034 body (no receta_id).
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

-- 3. The view.
DROP VIEW IF EXISTS fsj.v_asiento_sistema_preparacion;

-- 2. asiento_preparacion (empty -- checked above).
DROP TABLE IF EXISTS fsj.asiento_preparacion;
DROP FUNCTION IF EXISTS fsj.asiento_preparacion_validar();

-- 1. receta_id, INV-L24, INV-L07 back to its 0014 CHECK.
DROP INDEX IF EXISTS fsj.uq_asiento_recetario_receta;

ALTER TABLE fsj.asiento_recetario DROP CONSTRAINT asiento_recetario_origen_check;
ALTER TABLE fsj.asiento_recetario
  ADD CONSTRAINT asiento_recetario_origen_check CHECK (
    (origen = 'SISTEMA' AND preparacion_id IS NOT NULL AND asiento_original_id IS NULL)
    OR (origen = 'RECTIFICATIVO' AND preparacion_id IS NULL AND asiento_original_id IS NOT NULL)
  );

ALTER TABLE fsj.asiento_recetario DROP CONSTRAINT IF EXISTS asiento_recetario_receta_fkey;
ALTER TABLE fsj.asiento_recetario DROP COLUMN IF EXISTS receta_id;

COMMENT ON COLUMN fsj.asiento_recetario.preparacion_id IS NULL;
COMMENT ON COLUMN fsj.asiento_recetario.version_hash IS
  'Which hash_integridad serialization produced this row: 1 (migration 0014, byte-unsafe), 2 (migration 0018, asiento-only fields), 3 (migration 0034, includes detalle_asiento lines). Existing rows before this migration are 2 (the column default); every row inserted from this migration forward is pinned to 3 by fsj.asiento_recetario_preparar, never by the app.';
