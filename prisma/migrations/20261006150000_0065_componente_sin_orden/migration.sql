-- 0065_componente_sin_orden
--
-- Client decision (2026-10-06): the order of the drogas inside a receta
-- item means nothing to the farmacia. fsj.componente_item_receta.orden goes
-- away, together with everything that only existed because of it
-- (migration 0011):
--
--   1. V3 ("a CSP componente must occupy the LAST orden"): the deferred
--      constraint trigger trg_componente_csp_orden and its functions
--      fsj.trg_componente_check_csp_orden() /
--      fsj.item_receta_validar_csp_orden(uuid, uuid). The whole rule was
--      about orden, so there is nothing left to recreate. V2 (at most one
--      CSP per item, uq_componente_item_receta_csp_unico) is unaffected.
--   2. UNIQUE componente_item_receta_orden_unico (tenant_id, item_receta_id,
--      orden). It was also the index behind every "componentes of this
--      item" lookup (0051 relied on it, as do V1's deferred trigger and
--      0030's INV-R11 delete path), so idx_componente_item_receta_tenant_item
--      (tenant_id, item_receta_id) replaces it.
--   3. The column itself (its column-level UPDATE grant from 0011 goes with
--      it).
--
-- The display/calculation order is now derived by the app (componentes
-- with a quantity first, then CS, then CSP; ties by droga name --
-- modules/elaboracion/domain/orden-componentes.ts). Nothing persisted is
-- recomputed from it: linea_pesaje.orden, detalle_asiento.orden and
-- asiento_recetario.formula_texto are frozen snapshots, so the libro's hash
-- chain (fsj.asiento_recetario_hash_v3 / fsj.verificar_cadena, 0034) is
-- unaffected. No other SQL object reads componente_item_receta.orden
-- (0012, 0030, 0042 and 0051 only join on item_receta_id / droga_id).
--
-- Numbering: 0064 (20261006120000_0064_partida_vencimiento_opcional) is the
-- highest at the time of writing -- re-check before applying.
--
-- *** APPLY 0065 TOGETHER WITH THE CODE THAT NO LONGER WRITES orden: the
-- previous code inserts it (column gone), and the new code omits it (NOT
-- NULL, no default, before 0065). ***
-- Rollback: prisma/rollbacks/0065_componente_sin_orden.down.sql (as a NEW
-- forward migration; the original order is lost, it is rebuilt with the
-- rule above).

DROP TRIGGER IF EXISTS trg_componente_csp_orden ON fsj.componente_item_receta;
DROP FUNCTION IF EXISTS fsj.trg_componente_check_csp_orden();
DROP FUNCTION IF EXISTS fsj.item_receta_validar_csp_orden(uuid, uuid);

CREATE INDEX IF NOT EXISTS idx_componente_item_receta_tenant_item
  ON fsj.componente_item_receta (tenant_id, item_receta_id);

COMMENT ON INDEX fsj.idx_componente_item_receta_tenant_item IS
  '0065: componentes of an item (V1 deferred trigger, INV-R11 deletes, every read of an item''s fórmula). Replaces the UNIQUE (tenant_id, item_receta_id, orden) dropped with the orden column.';

ALTER TABLE fsj.componente_item_receta DROP CONSTRAINT IF EXISTS componente_item_receta_orden_unico;
ALTER TABLE fsj.componente_item_receta DROP COLUMN IF EXISTS orden;

COMMENT ON TABLE fsj.componente_item_receta IS
  'M09 / docs/specs/ficha-tecnica.md "ComponenteItemReceta". modo_expresion REPLACES the diagram''s es_cantidad_suficiente boolean (binding decision). V1 (>=1 component per item) and V2 (<=1 CSP per item) are enforced by 0011; the componentes of an item have no order (0065 dropped orden and V3).';

COMMENT ON COLUMN fsj.componente_item_receta.es_principio_activo IS
  'Snapshot written by the app on insert: true iff the droga''s clase is DROGA (0063) at that moment. Not kept in sync with later catalog changes.';
