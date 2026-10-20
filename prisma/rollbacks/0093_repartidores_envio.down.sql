-- Rollback of 0093_repartidores_envio (apply as a NEW forward migration), AFTER deploying the code that no longer
-- reads fsj.repartidor / entrega.repartidor_id (docs/rollbacks/envios-repartidores.md).
--
-- Refused while an entrega, an entrega_anulada or a repartidor row exists: dropping the columns and the table would
-- lose who carried each envio. Export them first (see the rollback doc) and, if the history may go, clear the
-- columns / table by hand before applying this file.

DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM fsj.entrega WHERE repartidor_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM fsj.entrega_anulada WHERE repartidor_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM fsj.repartidor) THEN
    RAISE EXCEPTION '0093 rollback refused: repartidores or envios with a repartidor exist (export them first, see docs/rollbacks/envios-repartidores.md)';
  END IF;
END $do$;

-- 4. The permiso and every role assignment of it (the role editor can have granted it to custom roles).
DELETE FROM fsj.rol_permiso rp
USING fsj.permiso p
WHERE rp.permiso_id = p.id
  AND p.codigo = 'repartidores.gestionar';

DELETE FROM fsj.permiso WHERE codigo = 'repartidores.gestionar';

-- 3. entrega_anulada
ALTER TABLE fsj.entrega_anulada DROP COLUMN IF EXISTS repartidor_id;

-- 2. entrega
DROP TRIGGER IF EXISTS trg_entrega_validar_repartidor ON fsj.entrega;
DROP FUNCTION IF EXISTS fsj.entrega_validar_repartidor();
REVOKE UPDATE (repartidor_id) ON fsj.entrega FROM fsj_app;
DROP INDEX IF EXISTS fsj.entrega_repartidor_idx;
ALTER TABLE fsj.entrega
  DROP CONSTRAINT IF EXISTS entrega_repartidor_solo_envio_check,
  DROP CONSTRAINT IF EXISTS entrega_repartidor_fkey,
  DROP COLUMN IF EXISTS repartidor_id;

-- 1. repartidor
DROP TABLE IF EXISTS fsj.repartidor;
