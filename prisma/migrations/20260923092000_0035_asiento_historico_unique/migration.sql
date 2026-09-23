-- 0035_asiento_historico_unique
--
-- D5 (user decision, 2026-09-23): a physical book entry (fsj.asiento_historico,
-- DP-17/spec section 2) must be digitized at most once. Read migration
-- 0014's fsj.asiento_historico DDL first: its only column identifying
-- WHICH physical book an entry belongs to is `tipo_libro`
-- (RECETARIO/PSICOTROPICO/ESTUPEFACIENTE) -- there is no separate "numero
-- de libro fisico" column (each tenant is assumed to keep one physical
-- book per tipo, same assumption fsj.libro_rubricado already makes for the
-- digital side). So the natural key for "this physical entry" is
-- (tenant_id, tipo_libro, numero_asiento_fisico) -- the UNIQUE constraint
-- below avoids a duplicate digitalization of the same physical folio (e.g.
-- two operators digitizing the same page, or the same operator
-- resubmitting after a UI retry).
--
-- FIX 3 (jd-fix-agent, 2026-09-23): `numero_asiento_fisico` is `text`, so
-- "7", "07", and " 7" are three DIFFERENT strings that would otherwise
-- defeat the UNIQUE constraint below. Canonical form (mirrored at the app
-- level by modules/libro/domain/numero-asiento-fisico.ts, which every
-- caller now runs through BEFORE insert): trimmed; if purely digits, no
-- leading zeros (single "0" is the canonical form for an all-zero value);
-- any other value (e.g. "12-bis") is kept as trimmed text, verbatim. The
-- CHECK constraint below re-validates that shape independently in the DB
-- -- NOT added as NOT VALID, because the DO block right before it already
-- guarantees every EXISTING row is canonical (or fails the deploy with a
-- clear message) before the constraint is ever asked to hold.
--
-- FIX 2 (jd-fix-agent, 2026-09-23): adding a UNIQUE constraint straight to
-- a table that may already have duplicate (post-canonicalization) rows
-- would fail the deploy with Postgres's own opaque
-- "duplicate key value violates unique constraint" error, naming a row but
-- not explaining WHY or what to do about it. The second DO block below
-- detects any such duplicate group FIRST and RAISEs a clear exception
-- listing tenant/tipo_libro/numero, so a failed deploy tells an operator
-- exactly what to fix (merge or renumber the physical entries) instead of
-- leaving them to reverse-engineer a bare unique-violation.

-- FIX 3 guard: every EXISTING row must already be canonical (trimmed,
-- non-empty, no leading zero) before the CHECK constraint below can be
-- added without NOT VALID. Fails the deploy with a clear, actionable
-- message instead of an opaque CHECK violation.
DO $$
DECLARE
  v_no_canonicos text;
BEGIN
  SELECT string_agg(
    format('tenant %s / tipo_libro %s / numero_asiento_fisico %L', tenant_id, tipo_libro, numero_asiento_fisico),
    E'\n'
  )
  INTO v_no_canonicos
  FROM fsj.asiento_historico
  WHERE numero_asiento_fisico <> btrim(numero_asiento_fisico)
     OR numero_asiento_fisico = ''
     OR numero_asiento_fisico ~ '^0[0-9]';

  IF v_no_canonicos IS NOT NULL THEN
    RAISE EXCEPTION E'Migration 0035: the following fsj.asiento_historico rows have a NON-CANONICAL numero_asiento_fisico (untrimmed, empty, or a leading zero) and must be corrected (canonicalized per modules/libro/domain/numero-asiento-fisico.ts) before this migration can add its CHECK/UNIQUE constraints:\n%', v_no_canonicos;
  END IF;
END $$;

-- FIX 2 guard: no (tenant_id, tipo_libro, numero_asiento_fisico) group may
-- already have more than one row -- checked AFTER the canonical-shape
-- guard above, since two rows only collide once their numero is read
-- canonically (the guard above already forces every row's raw text to
-- equal its own canonical form, so a plain GROUP BY here is equivalent to
-- grouping by the canonicalized value).
DO $$
DECLARE
  v_duplicados text;
BEGIN
  SELECT string_agg(
    format('tenant %s / tipo_libro %s / numero %s (%s filas)', tenant_id, tipo_libro, numero_asiento_fisico, cantidad),
    E'\n'
  )
  INTO v_duplicados
  FROM (
    SELECT tenant_id, tipo_libro, numero_asiento_fisico, count(*) AS cantidad
    FROM fsj.asiento_historico
    GROUP BY tenant_id, tipo_libro, numero_asiento_fisico
    HAVING count(*) > 1
  ) dup;

  IF v_duplicados IS NOT NULL THEN
    RAISE EXCEPTION E'Migration 0035: the following (tenant, tipo_libro, numero_asiento_fisico) already have MORE THAN ONE fsj.asiento_historico row and must be resolved manually (merge or renumber) before this migration can add its UNIQUE constraint:\n%', v_duplicados;
  END IF;
END $$;

ALTER TABLE fsj.asiento_historico
  ADD CONSTRAINT asiento_historico_numero_fisico_canonico_check
  CHECK (numero_asiento_fisico = btrim(numero_asiento_fisico) AND numero_asiento_fisico <> '' AND numero_asiento_fisico !~ '^0[0-9]');

COMMENT ON CONSTRAINT asiento_historico_numero_fisico_canonico_check ON fsj.asiento_historico IS
  'FIX 3 (jd-fix-agent, migration 0035): numero_asiento_fisico must already be in its canonical form (trimmed, non-empty, no leading zero on a purely numeric value) -- mirrors modules/libro/domain/numero-asiento-fisico.ts, which every INSERT path (crear-asiento-historico.ts) runs the value through first. Keep the two in sync.';

ALTER TABLE fsj.asiento_historico
  ADD CONSTRAINT asiento_historico_fisico_unico UNIQUE (tenant_id, tipo_libro, numero_asiento_fisico);

COMMENT ON CONSTRAINT asiento_historico_fisico_unico ON fsj.asiento_historico IS
  'D5 (migration 0035): a physical book entry is digitized at most once. Natural key = (tenant_id, tipo_libro, numero_asiento_fisico) -- fsj.asiento_historico has no separate "libro fisico" column (migration 0014 DDL), one physical book per tipo is assumed, same as fsj.libro_rubricado. Mapped to a clear Spanish message in modules/libro/application/crear-asiento-historico.ts. Relies on asiento_historico_numero_fisico_canonico_check (this migration) to make "same folio" mean the same thing at the DB level that modules/libro/domain/numero-asiento-fisico.ts means at the app level.';
