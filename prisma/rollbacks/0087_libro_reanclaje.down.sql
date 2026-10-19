-- Rollback of 0087_libro_reanclaje (apply as a NEW forward migration).
-- Restores 0082's fsj.verificar_cadena (no re-anchor exception) and drops fsj.libro_reanclaje. A libro that was
-- re-anchored reports its chain as broken again from the hole: the audit trail (registro_auditoria, entidad
-- libro_reanclaje) keeps the record of who accepted it and why. The code must be reverted too
-- (modules/libro reanclaje use cases, /libro/integridad form, the layout aviso).

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

DROP TABLE IF EXISTS fsj.libro_reanclaje;
