-- 0006_unidades_medida
--
-- FASE 1, point 1.6: unit-of-measure catalog (M05). Depends on 0000
-- (fsj.forbid_delete lives in 0001, extensions in 0000).
--
-- DP-39 RESUELTA: unidad_medida is a GLOBAL catalog -- no tenant_id, no RLS,
-- shared by every tenant. This means INV-M03/INV-M04 ("a unit that has been
-- used cannot be deleted; its factor cannot change once used") consider
-- usage in ANY tenant, by construction (there is nothing to scope by).
--
-- DP-07 is UNRESOLVED (exact TipoMagnitud values, and how GOTA / UNIDAD
-- INTERNACIONAL / PORCENTAJE behave). Per plan §9 M05, only the
-- unambiguous magnitudes are seeded here (MASA, VOLUMEN, UNIDADES) and only
-- the units whose factor is unambiguous (mcg/mg/g/kg, mcL/mL/L, UNIDAD).
-- GOTA, UNIDAD_INTERNACIONAL and PORCENTAJE are deliberately NOT seeded --
-- adding them (and any other TipoMagnitud value) is left to whoever
-- resolves DP-07.
--
-- DP-06b is UNRESOLVED (mass<->volume conversion via droga.densidad).
-- fsj.convertir() below therefore ONLY converts within the same
-- tipo_magnitud (INV-M01) -- no density-based cross-magnitude conversion is
-- implemented, on purpose.

-- ============================================================================
-- Enum: tipo_magnitud (DP-07 partially resolved -- see header)
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.tipo_magnitud AS ENUM ('MASA', 'VOLUMEN', 'UNIDADES');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON TYPE fsj.tipo_magnitud IS
  'M05. Only the magnitudes that are unambiguous without resolving DP-07 are modeled (MASA, VOLUMEN, UNIDADES). The plan also proposes ACTIVIDAD (UI) and PROPORCION (%) -- NOT added here; add them (ALTER TYPE ... ADD VALUE) once DP-07 resolves, together with the GOTA/UNIDAD_INTERNACIONAL/PORCENTAJE units that depend on them.';

-- ============================================================================
-- unidad_medida (M05) -- GLOBAL catalog, no tenant_id, no RLS (DP-39)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.unidad_medida (
  id             uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  codigo         text NOT NULL,
  nombre         text NOT NULL,
  simbolo        text NOT NULL,
  tipo_magnitud  fsj.tipo_magnitud NOT NULL,
  factor_a_base  numeric(20, 10) NOT NULL,
  es_base        boolean NOT NULL DEFAULT false,
  -- INV-M04 usage marker, maintained by fsj.unidad_medida_marcar_usada()
  -- (called from AFTER INSERT/UPDATE triggers on tables that reference this
  -- unit -- e.g. fsj.droga in migration 0007). DP-39: usage in ANY tenant
  -- counts, which falls out naturally since this table has no tenant_id.
  usada          boolean NOT NULL DEFAULT false,
  fecha_baja     timestamptz,
  motivo_baja    text,
  CONSTRAINT unidad_medida_codigo_key UNIQUE (codigo),
  CONSTRAINT unidad_medida_factor_check CHECK (factor_a_base > 0),
  -- INV-M02 (part 2 of 2): a base unit's factor is always exactly 1.
  CONSTRAINT unidad_medida_base_factor_check CHECK (NOT es_base OR factor_a_base = 1)
);

COMMENT ON TABLE fsj.unidad_medida IS
  'M05. GLOBAL catalog (DP-39 RESUELTA): no tenant_id, no RLS, shared by every tenant. INV-M02: exactly one es_base row per tipo_magnitud (partial unique index below) with factor_a_base = 1 (check above). INV-M04: factor_a_base/tipo_magnitud become immutable once `usada` is true (trigger below).';

-- INV-M02 (part 1 of 2): at most one base unit per tipo_magnitud.
CREATE UNIQUE INDEX IF NOT EXISTS uq_unidad_medida_base_por_magnitud
  ON fsj.unidad_medida (tipo_magnitud)
  WHERE es_base;

-- fsj_app may create/edit units (ADM, unidades.crear/editar/baja -- plan
-- §7); ALTER DEFAULT PRIVILEGES (Phase 0) already grants SELECT+INSERT.
-- `usada` is deliberately NOT in this list: it is only ever written by the
-- SECURITY DEFINER helper below, bypassing the app's own column grants,
-- exactly like fsj.movimiento_stock_aplicar() does for partida.cantidad_disponible
-- (migration 0008).
GRANT UPDATE (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base, fecha_baja, motivo_baja)
  ON fsj.unidad_medida TO fsj_app;

-- ============================================================================
-- INV-M03: no DELETE, ever (FK RESTRICT from referencing tables is the
-- complementary half -- e.g. fsj.droga.unidad_base_id in migration 0007 --
-- but this trigger is what actually blocks it even before any table
-- references a unit).
-- ============================================================================
REVOKE DELETE ON fsj.unidad_medida FROM fsj_app;

CREATE TRIGGER trg_unidad_medida_forbid_delete
  BEFORE DELETE ON fsj.unidad_medida
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ============================================================================
-- INV-M04: once `usada` is true, factor_a_base and tipo_magnitud are
-- immutable. Everything else (codigo, nombre, simbolo, es_base, fecha_baja,
-- motivo_baja) stays editable (ADM only -- enforced by authorize(), not
-- here) even after the unit has been used.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.unidad_medida_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.usada AND NEW.factor_a_base IS DISTINCT FROM OLD.factor_a_base THEN
    RAISE EXCEPTION 'INV-M04: factor_a_base of unidad_medida % cannot change once it has been used', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.usada AND NEW.tipo_magnitud IS DISTINCT FROM OLD.tipo_magnitud THEN
    RAISE EXCEPTION 'INV-M04: tipo_magnitud of unidad_medida % cannot change once it has been used', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.unidad_medida_validar_update() IS
  'INV-M04. `usada` itself can only move false -> true (see fsj.unidad_medida_marcar_usada) -- there is deliberately no path back to false, since "has been used" is a historical fact, not a current-state flag.';

CREATE TRIGGER trg_unidad_medida_validar_update
  BEFORE UPDATE ON fsj.unidad_medida
  FOR EACH ROW EXECUTE FUNCTION fsj.unidad_medida_validar_update();

-- Defense in depth alongside the trigger above: `usada` may only ever go
-- false -> true, never back, regardless of caller.
CREATE OR REPLACE FUNCTION fsj.unidad_medida_validar_usada_no_revierte()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.usada AND NOT NEW.usada THEN
    RAISE EXCEPTION 'INV-M04: unidad_medida.usada cannot revert to false' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_unidad_medida_validar_usada_no_revierte
  BEFORE UPDATE ON fsj.unidad_medida
  FOR EACH ROW EXECUTE FUNCTION fsj.unidad_medida_validar_usada_no_revierte();

-- ============================================================================
-- fsj.unidad_medida_marcar_usada(uuid): marks a unit as used (INV-M04).
-- SECURITY DEFINER so it can write `usada` even though that column is
-- deliberately excluded from fsj_app's UPDATE grant above -- callers are
-- AFTER INSERT/UPDATE triggers on tables that reference a unidad_medida
-- (e.g. fsj.droga in migration 0007), not the application directly.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.unidad_medida_marcar_usada(p_unidad_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
BEGIN
  UPDATE fsj.unidad_medida SET usada = true WHERE id = p_unidad_id AND NOT usada;
END;
$$;

COMMENT ON FUNCTION fsj.unidad_medida_marcar_usada(uuid) IS
  'INV-M04 helper. Call from an AFTER INSERT/UPDATE trigger on any table that references unidad_medida in a way that counts as "used in a calculation" (plan §9 M05) -- see migration 0007 (fsj.droga.unidad_base_id) for the first caller.';

GRANT EXECUTE ON FUNCTION fsj.unidad_medida_marcar_usada(uuid) TO fsj_app;

-- ============================================================================
-- INV-M01: fsj.convertir(valor, origen, destino) -- fails across different
-- tipo_magnitud. No mass<->volume conversion (DP-06b unresolved -- see
-- header comment).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.convertir(p_valor numeric, p_origen uuid, p_destino uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_origen   fsj.unidad_medida%ROWTYPE;
  v_destino  fsj.unidad_medida%ROWTYPE;
BEGIN
  SELECT * INTO v_origen FROM fsj.unidad_medida WHERE id = p_origen;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-M01: origin unit % does not exist', p_origen USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_destino FROM fsj.unidad_medida WHERE id = p_destino;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INV-M01: destination unit % does not exist', p_destino USING ERRCODE = 'P0001';
  END IF;

  IF v_origen.tipo_magnitud <> v_destino.tipo_magnitud THEN
    RAISE EXCEPTION 'INV-M01: cannot convert unidad_medida % (%) into % (%): different tipo_magnitud',
      p_origen, v_origen.tipo_magnitud, p_destino, v_destino.tipo_magnitud
      USING ERRCODE = 'P0001';
  END IF;

  RETURN (p_valor * v_origen.factor_a_base) / v_destino.factor_a_base;
END;
$$;

COMMENT ON FUNCTION fsj.convertir(numeric, uuid, uuid) IS
  'INV-M01. Converts p_valor from unidad p_origen to unidad p_destino via their shared base unit (factor_a_base). Raises INV-M01 when the two units do not share a tipo_magnitud. No density-based mass<->volume conversion (DP-06b unresolved).';

GRANT EXECUTE ON FUNCTION fsj.convertir(numeric, uuid, uuid) TO fsj_app;

-- ============================================================================
-- Seed: only the unambiguous units (plan §9 M05 + point 1.6 scope).
-- GOTA, UNIDAD_INTERNACIONAL and PORCENTAJE are intentionally NOT seeded
-- (DP-07 pending).
-- ============================================================================
INSERT INTO fsj.unidad_medida (codigo, nombre, simbolo, tipo_magnitud, factor_a_base, es_base) VALUES
  ('MICROGRAMO', 'Microgramo', 'mcg', 'MASA', 0.000001, false),
  ('MILIGRAMO',  'Miligramo',  'mg',  'MASA', 0.001,    false),
  ('GRAMO',      'Gramo',      'g',   'MASA', 1,        true),
  ('KILOGRAMO',  'Kilogramo',  'kg',  'MASA', 1000,     false),
  ('MICROLITRO', 'Microlitro', 'mcL', 'VOLUMEN', 0.000001, false),
  ('MILILITRO',  'Mililitro',  'mL',  'VOLUMEN', 1,        true),
  ('LITRO',      'Litro',      'L',   'VOLUMEN', 1000,     false),
  ('UNIDAD',     'Unidad',     'u',   'UNIDADES', 1,       true)
ON CONFLICT (codigo) DO NOTHING;
