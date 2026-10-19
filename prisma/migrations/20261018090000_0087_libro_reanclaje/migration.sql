-- 0087_libro_reanclaje
--
-- A libro whose hash chain has a HOLE (rows removed from the middle: the first row after the hole points to a
-- hash_anterior that no longer exists) can be re-anchored by the DT from /libro/integridad. A re-anchor is a
-- permanent, append-only record that accepts exactly ONE hole: the chain expected `numero_esperado` and the next
-- existing row is `desde_numero`, whose stored hash_anterior is `hash_anterior_aceptado`.
--
--   - Rows are never renumbered nor re-hashed: the printed libro keeps matching the database.
--   - fsj.verificar_cadena accepts the hole only when a re-anchor matches it EXACTLY (same libro, same expected
--     number, same next row, same hash_anterior). A different or later tampering is still reported.
--   - A hole is only re-anchorable when the next row has a HIGHER number than expected. A row at the expected
--     number with a wrong hash_anterior or hash_integridad (content edited) is never accepted.
--
-- docs/specs/libro-recetario-y-contralor.md ("Reanclaje de la cadena"). Rollback:
-- prisma/rollbacks/0087_libro_reanclaje.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. fsj.libro_reanclaje (append-only).
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.libro_reanclaje (
  id                     uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  libro_id               uuid        NOT NULL,
  numero_esperado        bigint      NOT NULL,   -- the first missing numero_correlativo (where the chain broke)
  desde_numero           bigint      NOT NULL,   -- the first existing row after the hole
  hash_anterior_aceptado text        NOT NULL,   -- that row's stored hash_anterior, accepted as the new link
  motivo                 text        NOT NULL,
  registrado_por_id      uuid        NOT NULL,
  registrado_en          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT libro_reanclaje_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT libro_reanclaje_hueco_key UNIQUE (tenant_id, libro_id, desde_numero),
  CONSTRAINT libro_reanclaje_libro_fkey FOREIGN KEY (tenant_id, libro_id) REFERENCES fsj.libro_rubricado (tenant_id, id),
  CONSTRAINT libro_reanclaje_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT libro_reanclaje_numeros_check CHECK (numero_esperado >= 1 AND desde_numero > numero_esperado),
  CONSTRAINT libro_reanclaje_motivo_check CHECK (length(btrim(motivo)) > 0)
);

COMMENT ON TABLE fsj.libro_reanclaje IS
  'Migration 0087. A DT-authorized acceptance of ONE hole in a libro hash chain (rows missing between numero_esperado and desde_numero). Immutable (no UPDATE/DELETE grant, forbid_update_delete trigger). fsj.verificar_cadena skips the hole only when a row matches it exactly.';

SELECT fsj.setup_tenant_table('fsj.libro_reanclaje');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.libro_reanclaje FROM fsj_app;

CREATE TRIGGER trg_libro_reanclaje_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.libro_reanclaje
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

CREATE TRIGGER trg_libro_reanclaje_zz_inv_u07_insert
  BEFORE INSERT ON fsj.libro_reanclaje
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrado_por_id');

-- ============================================================================
-- 2. fsj.verificar_cadena: 0082 body, plus the re-anchor exception in both loops.
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
        -- Re-anchored hole: skip it only when a registered re-anchor matches it exactly.
        IF v_rec.numero_correlativo > v_esperado AND EXISTS (
          SELECT 1 FROM fsj.libro_reanclaje r
          WHERE r.tenant_id = p_tenant AND r.libro_id = p_libro
            AND r.numero_esperado = v_esperado
            AND r.desde_numero = v_rec.numero_correlativo
            AND r.hash_anterior_aceptado = v_rec.hash_anterior
        ) THEN
          v_esperado := v_rec.numero_correlativo;
          v_prev := v_rec.hash_anterior;
        ELSE
          RETURN v_esperado;
        END IF;
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
        IF v_con.numero_correlativo > v_esperado AND EXISTS (
          SELECT 1 FROM fsj.libro_reanclaje r
          WHERE r.tenant_id = p_tenant AND r.libro_id = p_libro
            AND r.numero_esperado = v_esperado
            AND r.desde_numero = v_con.numero_correlativo
            AND r.hash_anterior_aceptado = v_con.hash_anterior
        ) THEN
          v_esperado := v_con.numero_correlativo;
          v_prev := v_con.hash_anterior;
        ELSE
          RETURN v_esperado;
        END IF;
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
  'Recomputes the hash chain of one libro. asiento_recetario rows: recomputed with the function matching their OWN stored version_hash (1/2/3 -- migration 0034; 4 -- migration 0082, por-receta SISTEMA). asiento_contralor rows: unchanged V1/V2 trial (migration 0018). A hole in the numbering is skipped ONLY when a fsj.libro_reanclaje row (migration 0087) matches it exactly. Returns the first broken numero_correlativo, or NULL if intact. SECURITY INVOKER: RLS scopes it to the caller''s tenant.';
