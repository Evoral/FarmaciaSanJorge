-- Rollback of 0076_receta_entregada_pagada. Apply as a NEW forward migration,
-- AFTER deploying the code that allows delivering an unpaid receta again
-- (docs/rollbacks/receta-entregada-pagada.md). No data is lost.

DROP TRIGGER IF EXISTS trg_receta_validar_entregada_pagada ON fsj.receta;
DROP FUNCTION IF EXISTS fsj.receta_validar_entregada_pagada();

COMMENT ON COLUMN fsj.receta.pagada IS
  '0071. Whether the pharmacy was paid for this receta (a simple flag: no amounts, no medio de pago, no facturación). Orthogonal to estado: a receta can be paid and pending, or delivered and unpaid. Set at alta, at entrega or from the receta detail; cleared again to fix a mistake. Frozen while ANULADA (INV-R13).';
