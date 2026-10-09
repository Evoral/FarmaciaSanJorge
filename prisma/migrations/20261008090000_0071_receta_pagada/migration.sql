-- 0071_receta_pagada
--
-- docs/specs/pago-receta.md. A simple paid/unpaid FLAG on the receta: whether
-- the pharmacy was paid for it, who recorded that and when. No amounts, no
-- payments table, no medios de pago, no facturación (plan "Fuera de alcance:
-- Facturación, cobro" still holds -- DP-30 is not reopened).
--
-- Payment is an ORTHOGONAL dimension to the production/libro state machine:
-- it is deliberately NOT a value of fsj.estado_receta. A receta can be paid
-- and still PENDIENTE_PREPARACION, or ENTREGADA and unpaid.
--
-- ADDITIVE: three columns on fsj.receta; every existing receta stays
-- unpaid (pagada = false, no backfill).
--
--   - pagada: NOT NULL DEFAULT false.
--   - pagada_en / pagada_por_id: set by the SERVER (transaction time and the
--     session's usuario, never client input) when the flag is raised; both
--     cleared when it is lowered.
--   - receta_pagada_check: pagada <=> (pagada_en, pagada_por_id) both set.
--     Modeled after 0057's receta_toma_pair_check.
--   - pagada_por_id: composite FK (tenant_id, pagada_por_id) -> fsj.usuario,
--     same INV-T02 shape as receta_registrada_por_fkey (0011) and
--     receta_tomada_por_fkey (0057). MATCH SIMPLE: a NULL is never checked.
--   - Column-level UPDATE grant: fsj.receta's UPDATE privilege is granted
--     PER COLUMN (0011, 0016, 0049, 0057, 0070), so the three new columns
--     need their own grant. INSERT is table-level (fsj.setup_tenant_table),
--     so a receta can be created already paid without a further grant.
--   - INV-U07 (0023): marking a receta paid is an action, so the actor must
--     be ACTIVO. fsj.assert_actor_activo is generic (TG_ARGV): the INSERT
--     trigger (0023, registrada_por_id) and the UPDATE trigger (0057,
--     tomada_por_id) are recreated with pagada_por_id added. On UPDATE the
--     check only fires on the NULL -> value transition, so unmarking and
--     re-marking is checked again while history is never re-validated.
--
-- Existing receta triggers checked (latest definitions): the state machine
-- (0011 trg_receta_validar_transicion_estado, 0061), 0040's entrega check
-- and 0050's libro guard are all `BEFORE UPDATE OF estado`; 0016/0051's
-- archivo check is `BEFORE UPDATE OF lote_archivo_id`; forbid_tenant_id_change
-- (0001) only looks at tenant_id. NONE fires on, or compares whole rows
-- containing, the new columns, and no trigger freezes a receta once
-- ENTREGADA: payment after delivery is valid and stays writable. RLS
-- (tenant_isolation) is row-based and covers the new columns as-is.
--
-- The one thing that must NOT happen is changing the payment of an ANULADA
-- receta (the app refuses it too: modules/recetas/domain/pago.ts). New DB
-- backstop INV-R13 below, `BEFORE UPDATE OF` the three columns, following the
-- per-column guard pattern of 0016/0050. It only compares OLD.estado, so
-- anulling a paid receta (which does not touch the pagada columns) keeps the
-- flag as history.
--
-- No index: /recetas filters by pagada together with the other filters and
-- orders by fecha_ingreso like today; the table has no index for any of the
-- listado's filters (estado, fechas) either, and pagada is a low-cardinality
-- boolean. Revisit if the listado gets slow.
--
-- Numbering: 0070 (20261007210000_0070_receta_domicilio_paciente) is the
-- highest at the time of writing -- re-check before applying.
--
-- *** APPLY 0071 BEFORE DEPLOYING THE CODE THAT USES IT (the new code reads
-- and writes pagada*). The previous code is unaffected by it. ***
-- Rollback: prisma/rollbacks/0071_receta_pagada.down.sql (as a NEW forward
-- migration).

-- ============================================================================
-- 1. Columns, FK, CHECK, comments, grant.
-- ============================================================================
ALTER TABLE fsj.receta
  ADD COLUMN IF NOT EXISTS pagada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pagada_en timestamptz,
  ADD COLUMN IF NOT EXISTS pagada_por_id uuid;

ALTER TABLE fsj.receta
  ADD CONSTRAINT receta_pagada_por_fkey FOREIGN KEY (tenant_id, pagada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  ADD CONSTRAINT receta_pagada_check CHECK (
    (pagada AND pagada_en IS NOT NULL AND pagada_por_id IS NOT NULL)
    OR (NOT pagada AND pagada_en IS NULL AND pagada_por_id IS NULL)
  );

COMMENT ON COLUMN fsj.receta.pagada IS
  '0071. Whether the pharmacy was paid for this receta (a simple flag: no amounts, no medio de pago, no facturación). Orthogonal to estado: a receta can be paid and pending, or delivered and unpaid. Set at alta, at entrega or from the receta detail; cleared again to fix a mistake. Frozen while ANULADA (INV-R13).';

COMMENT ON COLUMN fsj.receta.pagada_en IS
  '0071. When the receta was marked paid (server time); NULL while unpaid. Set together with pagada and pagada_por_id (receta_pagada_check).';

COMMENT ON COLUMN fsj.receta.pagada_por_id IS
  '0071. Who marked the receta paid (the session''s usuario, never client input); NULL while unpaid. See pagada_en.';

GRANT UPDATE (pagada, pagada_en, pagada_por_id) ON fsj.receta TO fsj_app;

-- ============================================================================
-- 2. INV-R13: the payment of an ANULADA receta cannot change.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_pago_no_anulada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.estado = 'ANULADA' AND (
    NEW.pagada IS DISTINCT FROM OLD.pagada
    OR NEW.pagada_en IS DISTINCT FROM OLD.pagada_en
    OR NEW.pagada_por_id IS DISTINCT FROM OLD.pagada_por_id
  ) THEN
    RAISE EXCEPTION 'INV-R13: the payment of receta % cannot change: it is ANULADA', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_pago_no_anulada() IS
  'INV-R13 (new, migration 0071). pagada/pagada_en/pagada_por_id cannot change once the receta is ANULADA. Does not look at ENTREGADA: payment after delivery is valid.';

DROP TRIGGER IF EXISTS trg_receta_validar_pago_no_anulada ON fsj.receta;
CREATE TRIGGER trg_receta_validar_pago_no_anulada
  BEFORE UPDATE OF pagada, pagada_en, pagada_por_id ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_pago_no_anulada();

-- ============================================================================
-- 3. INV-U07 (0023) on the actor of the payment: the same generic function,
--    pagada_por_id added to the receta's INSERT (0023) and UPDATE (0057)
--    triggers. Both keep their names and the `zz_` ordering (0023's header).
-- ============================================================================
DROP TRIGGER IF EXISTS trg_receta_zz_inv_u07_insert ON fsj.receta;
CREATE TRIGGER trg_receta_zz_inv_u07_insert
  BEFORE INSERT ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('registrada_por_id', 'pagada_por_id');

DROP TRIGGER IF EXISTS trg_receta_zz_inv_u07_update ON fsj.receta;
CREATE TRIGGER trg_receta_zz_inv_u07_update
  BEFORE UPDATE ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('tomada_por_id', 'pagada_por_id');
