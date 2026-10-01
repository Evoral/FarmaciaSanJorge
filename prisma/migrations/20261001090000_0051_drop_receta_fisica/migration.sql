-- 0051_drop_receta_fisica
--
-- Client decision (2026-10-01): a receta can NEVER be "pendiente de receta
-- fisica", and the attribute itself is dropped -- fsj.receta loses
-- receta_fisica_recibida / receta_fisica_recibida_en /
-- receta_fisica_recibida_por_id. This supersedes INV-R07 (no ENTREGADA /
-- RETIRO_PRESENCIAL without receta fisica), INV-R10 / DP-15 (the
-- "pendientes de receta fisica" listing and /regularizacion, migration 0040),
-- INV-ENT-003 (0040/0041) and the standalone "registrar recepcion fisica"
-- (FASE 6 point 6.4): all of them are removed from the app too.
-- Depends on 0002 (permiso catalog), 0011 (fsj.receta), 0016 (INV-R07 on
-- entrega, INV-ARC-006), 0023 (INV-U07 triggers), 0040/0041 (INV-ENT-003,
-- plazo_regularizacion_dias), 0042 (fsj.receta_validar_archivo, latest).
--
-- No backfill: existing rows are test data and the columns simply go away.
--
-- Every DB object that references the three columns is dropped or
-- recreated BEFORE the DROP COLUMN, explicitly (no CASCADE) -- verified by
-- grepping every migration for the column names and taking each function's
-- LATEST definition (plpgsql bodies are not dependency-tracked, so a stale
-- body would only fail at runtime):
--   - 0011: CHECKs receta_entregada_fisica_check (INV-R07) and
--     receta_fisica_recibida_pair_check, FK receta_recibida_por_fkey, the
--     column-level UPDATE grant -> dropped/revoked.
--   - 0016: fsj.entrega_validar_receta_fisica + trg_entrega_validar_receta_fisica
--     (INV-R07 on entrega INSERT) -> dropped.
--   - 0023: trg_receta_zz_inv_u07_update only checked
--     receta_fisica_recibida_por_id -> dropped. trg_receta_zz_inv_u07_insert
--     (registrada_por_id) and fsj.assert_actor_activo itself are untouched
--     (the function is generic: it reads columns by TG_ARGV name).
--   - 0030: only a comment mentions the column -- nothing to do.
--   - 0040/0041: fsj.receta_validar_fisica_no_standalone_en_envio +
--     trg_receta_validar_fisica_no_standalone_en_envio (INV-ENT-003, declared
--     `UPDATE OF receta_fisica_recibida`) -> dropped.
--   - 0042 (latest version of 0016's function): fsj.receta_validar_archivo
--     -> recreated below WITHOUT the receta_fisica_recibida condition
--     (INV-ARC-006 keeps "ENTREGADA or ANULADA, frozen once set";
--     INV-ARC-007 unchanged).
-- No index or view references these columns (fsj.v_grants_legal is generic
-- over pg_attribute).

-- ============================================================================
-- 1. INV-ENT-003 (0040/0041).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_receta_validar_fisica_no_standalone_en_envio ON fsj.receta;
DROP FUNCTION IF EXISTS fsj.receta_validar_fisica_no_standalone_en_envio();

-- ============================================================================
-- 2. INV-R07 on entrega INSERT (0016).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_entrega_validar_receta_fisica ON fsj.entrega;
DROP FUNCTION IF EXISTS fsj.entrega_validar_receta_fisica();

-- ============================================================================
-- 3. INV-U07 (0023) for receta_fisica_recibida_por_id (UPDATE-only trigger).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_receta_zz_inv_u07_update ON fsj.receta;

-- ============================================================================
-- 4. INV-ARC-006 / INV-ARC-007 -- recreated from migration 0042's version,
--    minus the receta_fisica_recibida condition.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_archivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_lote_incluye_controladas boolean;
  v_receta_es_controlada     boolean;
BEGIN
  IF NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id AND NEW.lote_archivo_id IS NOT NULL THEN
    IF NEW.estado NOT IN ('ENTREGADA', 'ANULADA') THEN
      RAISE EXCEPTION 'INV-ARC-006: receta % can only be archived when ENTREGADA/ANULADA', NEW.id
        USING ERRCODE = 'P0001';
    END IF;

    -- INV-ARC-007 (migration 0042): the target lote must already reflect
    -- this receta's controlled/common nature.
    SELECT incluye_controladas INTO v_lote_incluye_controladas
    FROM fsj.lote_archivo_recetas
    WHERE tenant_id = NEW.tenant_id AND id = NEW.lote_archivo_id;

    SELECT EXISTS (
      SELECT 1
      FROM fsj.item_receta ir
      JOIN fsj.componente_item_receta c ON c.tenant_id = ir.tenant_id AND c.item_receta_id = ir.id
      JOIN fsj.droga d ON d.tenant_id = c.tenant_id AND d.id = c.droga_id
      WHERE ir.tenant_id = NEW.tenant_id AND ir.receta_id = NEW.id AND d.es_controlada = true
    ) INTO v_receta_es_controlada;

    IF v_receta_es_controlada AND NOT coalesce(v_lote_incluye_controladas, false) THEN
      RAISE EXCEPTION 'INV-ARC-007: receta % uses a controlled droga and cannot be assigned to lote % (incluye_controladas = false)', NEW.id, NEW.lote_archivo_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF OLD.lote_archivo_id IS NOT NULL AND NEW.lote_archivo_id IS DISTINCT FROM OLD.lote_archivo_id THEN
    RAISE EXCEPTION 'INV-ARC-006: receta.lote_archivo_id cannot change once set' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_archivo() IS
  'INV-ARC-006 (migrations 0016/0051) + INV-ARC-007 (migration 0042): lote_archivo_id is only settable once ENTREGADA/ANULADA (the receta fisica condition was dropped with the column, migration 0051), frozen once set, and a controlled receta can only join a lote with incluye_controladas = true.';

COMMENT ON COLUMN fsj.receta.lote_archivo_id IS
  'M15, deferred from migration 0011. INV-ARC-006: only settable (trg_receta_validar_archivo) when the receta is ENTREGADA or ANULADA; frozen once set.';

-- ============================================================================
-- 5. Constraints and column grant on the three columns (0011), then the
--    columns themselves.
-- ============================================================================
ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_entregada_fisica_check;
ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_fisica_recibida_pair_check;
ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_recibida_por_fkey;

REVOKE UPDATE (receta_fisica_recibida, receta_fisica_recibida_en, receta_fisica_recibida_por_id) ON fsj.receta FROM fsj_app;

ALTER TABLE fsj.receta
  DROP COLUMN receta_fisica_recibida,
  DROP COLUMN receta_fisica_recibida_en,
  DROP COLUMN receta_fisica_recibida_por_id;

-- ============================================================================
-- 6. DP-15's parametro (0040, scripts/create-tenant.ts): only drove the
--    /regularizacion overdue alert. Plain key/value table without a delete
--    guard (same as 0046's rol_permiso reasoning).
-- ============================================================================
DELETE FROM fsj.parametro WHERE clave = 'plazo_regularizacion_dias';

-- ============================================================================
-- 7. Permisos of the removed flows (0002): `recetas.fisica.registrar`
--    (standalone recepcion fisica + pendientes listing) and
--    `regularizacion.ver`. Global catalogs, no delete guard (see 0046).
--    Mirrored in modules/auth/domain/permisos.ts#PERMISO_CODES and
--    tests/db/auth-permisos.test.ts.
-- ============================================================================
DELETE FROM fsj.rol_permiso rp
USING fsj.permiso p
WHERE rp.permiso_id = p.id
  AND p.codigo IN ('recetas.fisica.registrar', 'regularizacion.ver');

DELETE FROM fsj.permiso WHERE codigo IN ('recetas.fisica.registrar', 'regularizacion.ver');
