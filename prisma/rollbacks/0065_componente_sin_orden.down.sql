-- Rollback of 0065_componente_sin_orden. Apply as a NEW forward migration,
-- together with the code that writes orden again. The original order is
-- lost: orden is rebuilt per item (0-based, as the app used to write it)
-- with the app's display rule -- componentes with a quantity first, then CS,
-- then CSP; ties by droga name, then id -- which also leaves the CSP last,
-- so V3 holds for every existing item.
ALTER TABLE fsj.componente_item_receta ADD COLUMN orden integer;

UPDATE fsj.componente_item_receta c
SET orden = n.orden
FROM (
  SELECT
    c2.tenant_id,
    c2.id,
    (row_number() OVER (
      PARTITION BY c2.tenant_id, c2.item_receta_id
      ORDER BY CASE c2.modo_expresion WHEN 'CS' THEN 1 WHEN 'CSP' THEN 2 ELSE 0 END, d.nombre, c2.id
    ) - 1)::integer AS orden
  FROM fsj.componente_item_receta c2
  JOIN fsj.droga d ON d.tenant_id = c2.tenant_id AND d.id = c2.droga_id
) n
WHERE n.tenant_id = c.tenant_id AND n.id = c.id;

ALTER TABLE fsj.componente_item_receta ALTER COLUMN orden SET NOT NULL;
ALTER TABLE fsj.componente_item_receta
  ADD CONSTRAINT componente_item_receta_orden_unico UNIQUE (tenant_id, item_receta_id, orden);
DROP INDEX IF EXISTS fsj.idx_componente_item_receta_tenant_item;

GRANT UPDATE (orden) ON fsj.componente_item_receta TO fsj_app;

-- V3, exactly as migration 0011 created it.
CREATE OR REPLACE FUNCTION fsj.item_receta_validar_csp_orden(p_tenant_id uuid, p_item_receta_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_csp_orden  integer;
  v_max_orden  integer;
BEGIN
  SELECT orden INTO v_csp_orden
  FROM fsj.componente_item_receta
  WHERE tenant_id = p_tenant_id AND item_receta_id = p_item_receta_id AND modo_expresion = 'CSP';

  IF NOT FOUND THEN
    RETURN; -- no CSP component, nothing to check
  END IF;

  SELECT max(orden) INTO v_max_orden
  FROM fsj.componente_item_receta
  WHERE tenant_id = p_tenant_id AND item_receta_id = p_item_receta_id;

  IF v_csp_orden <> v_max_orden THEN
    RAISE EXCEPTION 'V3: CSP componente of item_receta % must have the last orden (has %, max is %)',
      p_item_receta_id, v_csp_orden, v_max_orden
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_componente_check_csp_orden()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fsj.item_receta_validar_csp_orden(OLD.tenant_id, OLD.item_receta_id);
    RETURN OLD;
  ELSE
    PERFORM fsj.item_receta_validar_csp_orden(NEW.tenant_id, NEW.item_receta_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_componente_csp_orden ON fsj.componente_item_receta;
CREATE CONSTRAINT TRIGGER trg_componente_csp_orden
  AFTER INSERT OR UPDATE OR DELETE ON fsj.componente_item_receta
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_componente_check_csp_orden();

COMMENT ON TABLE fsj.componente_item_receta IS
  'M09 / docs/specs/ficha-tecnica.md "ComponenteItemReceta". modo_expresion REPLACES the diagram''s es_cantidad_suficiente boolean (binding decision). V1 (>=1 component per item), V2 (<=1 CSP per item), V3 (CSP must be the last orden) are enforced below.';

COMMENT ON COLUMN fsj.componente_item_receta.es_principio_activo IS NULL;
