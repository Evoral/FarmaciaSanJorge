-- Rollback of 0071_receta_pagada. Prisma has no "down": apply this as the body
-- of a NEW forward migration (next free number), together with the code that
-- no longer reads/writes pagada* (docs/rollbacks/pago-receta.md).
--
-- DATA LOSS: dropping the columns discards which recetas were paid, by whom
-- and when. Every change is audited (fsj.registro_auditoria, entidad
-- "receta": CREAR / MODIFICAR entries with `pagada` in valor_anterior /
-- valor_nuevo; "entrega" entries also carry it), so the history remains there.

-- INV-U07 triggers back to their pre-0071 argument lists (0023 / 0057).
DROP TRIGGER IF EXISTS trg_receta_zz_inv_u07_insert ON fsj.receta;
CREATE TRIGGER trg_receta_zz_inv_u07_insert
  BEFORE INSERT ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrada_por_id');

DROP TRIGGER IF EXISTS trg_receta_zz_inv_u07_update ON fsj.receta;
CREATE TRIGGER trg_receta_zz_inv_u07_update
  BEFORE UPDATE ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('tomada_por_id');

-- INV-R13.
DROP TRIGGER IF EXISTS trg_receta_validar_pago_no_anulada ON fsj.receta;
DROP FUNCTION IF EXISTS fsj.receta_validar_pago_no_anulada();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'fsj'
      AND table_name = 'receta'
      AND column_name = 'pagada'
  ) THEN
    REVOKE UPDATE (pagada, pagada_en, pagada_por_id) ON fsj.receta FROM fsj_app;
  END IF;
END
$$;

ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_pagada_check;
ALTER TABLE fsj.receta DROP CONSTRAINT IF EXISTS receta_pagada_por_fkey;

ALTER TABLE fsj.receta
  DROP COLUMN IF EXISTS pagada,
  DROP COLUMN IF EXISTS pagada_en,
  DROP COLUMN IF EXISTS pagada_por_id;
