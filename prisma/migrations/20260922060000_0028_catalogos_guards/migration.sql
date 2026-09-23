-- 0028_catalogos_guards
--
-- FASE 4 (4.1-4.3) review findings for unidades/drogas/proveedores. Depends
-- on 0006 (fsj.unidad_medida), 0007 (fsj.droga, fsj.proveedor) and 0008
-- (fsj.partida, the composite FK this migration's lock reasoning is about).
--
-- Three independent fixes, each documented in its own section below:
--   B1  -- proveedor.cuit was never normalized: the format CHECK accepted
--          BOTH "##-########-#" and 11 bare digits, so the same real CUIT
--          could exist twice (dashed vs. not), invisible to the unique
--          index. Normalize existing rows, then tighten the CHECK to
--          exactly 11 digits.
--   M1  -- DP-12 (a droga's unidad_base_id/es_controlada/tipo_control must
--          become immutable once it has partidas) was an [APP]-only check
--          (application/editar-droga.ts) against an UNLOCKED read -- a
--          partida inserted concurrently could slip through. Promote it to
--          a DB trigger, and reason through (and close) the row-lock race
--          between that trigger and a concurrent partida INSERT.
--   m1  -- fsj.unidad_medida is a GLOBAL catalog (DP-39): fsj_app's RLS
--          only lets it see the CURRENT tenant's drogas, so it cannot
--          truthfully count "how many drugs, across every tenant, use this
--          unit" for the edit/baja warning. A SECURITY DEFINER function
--          that returns ONLY a count (never tenant ids/names) closes that
--          gap.

-- ============================================================================
-- B1: normalize fsj.proveedor.cuit to exactly 11 digits (no dashes), then
-- tighten the format CHECK to match.
--
-- Order matters: normalize BEFORE tightening the CHECK, so any row that
-- still has dashes at that point gets fixed rather than rejected outright.
--
-- Duplicate handling: this UPDATE touches every dashed row in one
-- statement. If normalizing two different rows in the SAME tenant would
-- produce the same 11-digit value (i.e. "20-12345678-6" and "20123456786"
-- already coexist for that tenant -- exactly the bug B1 describes), the
-- second row Postgres processes hits `proveedor_cuit_key UNIQUE
-- (tenant_id, cuit)` immediately and raises 23505. Because this migration
-- runs in one transaction (`prisma migrate deploy`), that failure ABORTS
-- the entire migration -- nothing is silently merged, and the tightened
-- CHECK below never lands while the ambiguity is unresolved. As of this
-- migration there are 0 tenants (and 0 proveedores) in every real
-- environment this has been applied to, so this UPDATE is a no-op today;
-- it is written this way so it is still CORRECT the day that stops being
-- true.
-- ============================================================================
UPDATE fsj.proveedor
SET cuit = regexp_replace(cuit, '-', '', 'g')
WHERE cuit LIKE '%-%';

ALTER TABLE fsj.proveedor DROP CONSTRAINT proveedor_cuit_formato_check;

ALTER TABLE fsj.proveedor
  ADD CONSTRAINT proveedor_cuit_formato_check CHECK (cuit ~ '^[0-9]{11}$');

COMMENT ON COLUMN fsj.proveedor.cuit IS
  'FASE 4 finding B1 (migration 0028): always exactly 11 digits, no dashes -- normalized at the application layer (modules/proveedores/domain/proveedor.ts''s cuitString transform) before every INSERT/UPDATE, and enforced here so a bypass of the app layer cannot reintroduce a dashed value. The UI still ACCEPTS dashes on input and DISPLAYS them (modules/proveedores/domain/proveedor.ts''s formatCuit) -- this is a storage-format decision only.';

-- ============================================================================
-- M1: DP-12 as a real DB invariant (INV-DRG-001), not just an [APP] check.
--
-- ----------------------------------------------------------------------------
-- LOCK-CONFLICT REASONING (read this before touching this trigger)
-- ----------------------------------------------------------------------------
-- The naive version of this trigger -- reject the UPDATE if
-- fsj.partida already has a row for this droga -- is NOT enough on its
-- own, because the CHECK it performs and a concurrent fsj.partida INSERT
-- do not automatically serialize against each other. Reasoning through the
-- actual Postgres lock modes involved:
--
-- 1. A plain UPDATE of fsj.droga.es_controlada / tipo_control /
--    unidad_base_id modifies columns that are NOT part of fsj.droga's own
--    PRIMARY KEY or any unique index (those are (id) and (tenant_id, id)),
--    and are not referenced BY any other table's foreign key (the only FK
--    pointing at fsj.droga -- fsj.partida.partida_droga_fkey -- targets
--    (tenant_id, id), not these three columns). Per Postgres's own rule for
--    choosing an implicit row-lock strength on UPDATE, that means this
--    UPDATE takes the WEAKEST lock strong enough for an ordinary update:
--    FOR NO KEY UPDATE.
--
-- 2. A concurrent INSERT into fsj.partida checks
--    partida_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES
--    fsj.droga (tenant_id, id). Since Postgres 9.3, the referential-integrity
--    trigger behind a FK check takes the WEAKEST lock that still prevents
--    the referenced row from being deleted or having its key columns
--    changed: FOR KEY SHARE.
--
-- 3. Postgres's row-lock conflict table
--    (https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)
--    says FOR KEY SHARE conflicts ONLY with FOR UPDATE -- it does NOT
--    conflict with FOR NO KEY UPDATE, FOR SHARE, or another FOR KEY SHARE.
--
-- Putting 1-3 together: a plain UPDATE of the classification columns (FOR
-- NO KEY UPDATE) and a concurrent partida INSERT's FK check (FOR KEY
-- SHARE) do NOT conflict. They can both proceed at the same time, each
-- reading a pre-the-other's-write snapshot of the other's table under READ
-- COMMITTED -- exactly the race this migration exists to close: the
-- classification UPDATE's "does a partida already exist" check can run
-- BEFORE the concurrent partida INSERT becomes visible, and vice versa,
-- so neither side sees the other and both commit.
--
-- CONCLUSION / FIX: the trigger below does NOT rely on the UPDATE
-- statement's own implicit lock. Instead, as its very first action when a
-- classification column is actually changing, it explicitly re-locks the
-- SAME row it is updating with `SELECT ... FOR UPDATE`. A transaction may
-- always upgrade a lock it already holds on a row it is currently
-- modifying (self-conflict is never a thing) -- so this simply raises this
-- transaction's own held lock on that droga row from FOR NO KEY UPDATE to
-- FOR UPDATE for the remainder of the transaction. FOR UPDATE DOES conflict
-- with FOR KEY SHARE (rule 3 above), so from that point on, a concurrent
-- partida INSERT's FK check blocks until this transaction commits or rolls
-- back -- and symmetrically, if the partida INSERT's FOR KEY SHARE was
-- already granted first, THIS trigger's FOR UPDATE request blocks until
-- THAT transaction commits, after which the fresh `EXISTS` check below sees
-- the now-committed partida and correctly rejects the classification
-- change. Either interleaving now serializes correctly; neither can commit
-- a droga classification change and a partida for it against a
-- stale view of the other.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.droga_validar_clasificacion_inmutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tiene_partida boolean;
BEGIN
  IF NEW.es_controlada IS DISTINCT FROM OLD.es_controlada
     OR NEW.tipo_control IS DISTINCT FROM OLD.tipo_control
     OR NEW.unidad_base_id IS DISTINCT FROM OLD.unidad_base_id THEN

    -- See the LOCK-CONFLICT REASONING above: upgrades this transaction's
    -- own lock on this row to FOR UPDATE, which conflicts with the FOR KEY
    -- SHARE lock a concurrent partida INSERT's FK check takes -- serializing
    -- this classification change against any concurrent partida insert for
    -- the same droga.
    PERFORM 1 FROM fsj.droga WHERE id = NEW.id FOR UPDATE;

    SELECT EXISTS (
      SELECT 1 FROM fsj.partida WHERE tenant_id = NEW.tenant_id AND droga_id = NEW.id
    ) INTO v_tiene_partida;

    IF v_tiene_partida THEN
      RAISE EXCEPTION 'INV-DRG-001: droga % classification (unidad_base_id/es_controlada/tipo_control) cannot change once it has partidas', NEW.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.droga_validar_clasificacion_inmutable() IS
  'M1/DP-12 (migration 0028). DB-level reinforcement of modules/drogas/application/editar-droga.ts''s app check -- see this function''s CREATE TRIGGER site for the full lock-conflict reasoning (FOR KEY SHARE vs FOR NO KEY UPDATE vs FOR UPDATE) that makes this actually race-free, not just the app check''s belt-and-suspenders.';

CREATE TRIGGER trg_droga_validar_clasificacion_inmutable
  BEFORE UPDATE ON fsj.droga
  FOR EACH ROW EXECUTE FUNCTION fsj.droga_validar_clasificacion_inmutable();

-- ============================================================================
-- m1: truthful "how many drugs use this unit" count for the unidad_medida
-- edit/baja screens (DP-39). fsj_app's RLS only exposes the CURRENT
-- tenant's fsj.droga rows, so a plain `SELECT count(*) FROM fsj.droga WHERE
-- unidad_base_id = ...` run as fsj_app would undercount (or, for a tenant
-- with zero matching drogas of its own, wrongly report 0 even though other
-- tenants use it). SECURITY DEFINER bypasses RLS for this ONE narrow,
-- read-only, count-only purpose -- it returns an integer and nothing else
-- (no tenant ids, no droga names, no other columns), so it cannot leak any
-- cross-tenant DATA, only a fact about aggregate usage that the unit's own
-- edit/baja screen needs to warn accurately (task's binding requirement).
-- `SET search_path` is pinned (same convention as
-- fsj.unidad_medida_marcar_usada / fsj.movimiento_stock_aplicar) so this
-- SECURITY DEFINER function cannot be hijacked by a search_path change.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.contar_drogas_por_unidad(p_unidad_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
  SELECT count(*)::integer FROM fsj.droga WHERE unidad_base_id = p_unidad_id;
$$;

COMMENT ON FUNCTION fsj.contar_drogas_por_unidad(uuid) IS
  'm1 (migration 0028). Cross-tenant droga count for a unidad_medida (DP-39 global catalog) -- SECURITY DEFINER so it sees every tenant''s drogas despite RLS, but returns STRICTLY a count (never tenant ids/names/any other column). Used by the unidad edit/baja screens to show a truthful "used by N drugs across every farmacia" warning.';

GRANT EXECUTE ON FUNCTION fsj.contar_drogas_por_unidad(uuid) TO fsj_app;
