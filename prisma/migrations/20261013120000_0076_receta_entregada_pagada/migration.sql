-- 0076_receta_entregada_pagada
--
-- docs/specs/pago-receta.md P4 REVISED (user decision, 2026-10-13): a receta
-- only reaches ENTREGADA paid, so every delivered receta keeps its payment
-- record (future finanzas module). Supersedes 0071's "a receta can be
-- delivered and unpaid".
--
-- INV-R14 (BEFORE UPDATE OF estado, pagada): a receta that is ENTREGADA after
-- the UPDATE must be paid, when the UPDATE either moves it INTO ENTREGADA or
-- lowers pagada. Writers mark the payment BEFORE the estado UPDATE
-- (modules/entregas/application/registrar-entrega.ts,
-- confirmar-firma-recibida.ts).
--
-- Existing ENTREGADA + unpaid rows (delivered under 0071's rule) are NOT
-- backfilled or rejected: the trigger only looks at UPDATEs that touch estado
-- or pagada, and paying them later (pagada false -> true) is allowed.
--
-- *** APPLY 0076 TOGETHER WITH THE CODE THAT WRITES THE PAYMENT FIRST. The
-- previous code updates estado before pagada and would hit INV-R14 when an
-- entrega marks the payment. ***
-- Rollback: prisma/rollbacks/0076_receta_entregada_pagada.down.sql (as a NEW
-- forward migration).

CREATE OR REPLACE FUNCTION fsj.receta_validar_entregada_pagada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'ENTREGADA' AND NOT NEW.pagada
     AND (OLD.estado IS DISTINCT FROM 'ENTREGADA' OR OLD.pagada) THEN
    RAISE EXCEPTION 'INV-R14: receta % cannot be ENTREGADA without being paid', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_entregada_pagada() IS
  'INV-R14 (migration 0076): a receta becoming ENTREGADA must be paid, and an ENTREGADA receta cannot go back to unpaid. Rows delivered unpaid before 0076 are left as they are (they can still be paid).';

DROP TRIGGER IF EXISTS trg_receta_validar_entregada_pagada ON fsj.receta;
CREATE TRIGGER trg_receta_validar_entregada_pagada
  BEFORE UPDATE OF estado, pagada ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_entregada_pagada();

COMMENT ON COLUMN fsj.receta.pagada IS
  '0071. Whether the pharmacy was paid for this receta (a simple flag: no amounts, no medio de pago, no facturación). Set at alta, at entrega or from the receta detail. Frozen while ANULADA (INV-R13); required to become ENTREGADA and cannot be lowered once ENTREGADA (INV-R14, 0076).';
