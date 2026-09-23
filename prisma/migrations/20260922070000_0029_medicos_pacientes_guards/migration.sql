-- 0029_medicos_pacientes_guards
--
-- FASE 4, points 4.4 (médicos) and 4.5 (pacientes). Depends on 0007
-- (fsj.medico, fsj.paciente) and follows the exact same shape as 0027
-- (proveedor.motivo_baja) and 0028/B1 (proveedor.cuit normalization +
-- tightened CHECK). Two independent additions, one per table:
--
--   1. medico.motivo_baja -- migration 0007 gave fsj.medico only
--      fecha_baja (like fsj.proveedor before 0027). The task's binding
--      decision requires "baja and reactivación con motivo obligatorio"
--      for médicos, same as every other FASE 4 catalog -- add the same
--      display-convenience column droga/unidad_medida/proveedor already
--      have. Purely additive, same reasoning as 0027's header comment.
--
--   2. paciente.motivo_baja + CUIL/DNI format CHECKs -- migration 0007
--      gave fsj.paciente fecha_baja (a PROPUESTA per its own header
--      comment) but no motivo_baja, and left cuil/dni completely
--      unvalidated (free text up to the varchar length). The task's DoD
--      (INV-G01: baja lógica requires a motivo) is the reason to spend
--      this phase's one migration on paciente too. cuil's check-digit
--      algorithm is application-layer (shared/validation/digito-verificador.ts,
--      reused from proveedor.cuit's identical AFIP algorithm) -- this
--      migration only enforces SHAPE, same division of labor as
--      proveedor_cuit_formato_check.
--
-- medico.matricula normalization (DP-23: trim/collapse-whitespace/uppercase,
-- so "MAT-123", "mat-123 " and "mat-123" cannot coexist as different rows)
-- is DELIBERATELY application-layer ONLY here, with NO matching DB CHECK --
-- unlike cuit/cuil/dni. tests/db/catalogos-negocio.test.ts's existing
-- "matricula is unique among vigente rows" test inserts matriculas built
-- from `randomUUID()` (lowercase hex) directly via raw SQL, bypassing the
-- app layer on purpose (these DB tests exist specifically to verify what
-- the DATABASE itself enforces, independent of the app). A CHECK requiring
-- uppercase-normalized matricula would reject that pre-existing, in-baseline
-- test's fixtures and is out of this task's one-migration budget to also
-- revisit. The app's own zod schema (modules/medicos/domain/medico.ts)
-- still normalizes every matricula that goes through crear/editar-medico,
-- which is what actually prevents equivalent values from coexisting for
-- any write that goes through the application.

-- ============================================================================
-- 1. medico.motivo_baja
-- ============================================================================
ALTER TABLE fsj.medico ADD COLUMN IF NOT EXISTS motivo_baja text;

COMMENT ON COLUMN fsj.medico.motivo_baja IS
  'FASE 4 point 4.4. Set together with fecha_baja on baja; cleared (NULL) on reactivación. Full history (including motivo) lives in fsj.registro_auditoria regardless (INV-A01) -- this column is a display convenience, matching droga.motivo_baja / unidad_medida.motivo_baja / proveedor.motivo_baja (migration 0027).';

GRANT UPDATE (motivo_baja) ON fsj.medico TO fsj_app;

-- ============================================================================
-- 2. paciente.motivo_baja
-- ============================================================================
ALTER TABLE fsj.paciente ADD COLUMN IF NOT EXISTS motivo_baja text;

COMMENT ON COLUMN fsj.paciente.motivo_baja IS
  'FASE 4 point 4.5 (INV-G01: baja lógica con motivo obligatorio). Set together with fecha_baja on baja; cleared (NULL) on reactivación. Same shape as proveedor.motivo_baja (migration 0027) -- full history lives in fsj.registro_auditoria (INV-A01), itself access-restricted (auditoria.ver: ADM, DT only) given paciente is health-adjacent data (DP-24).';

GRANT UPDATE (motivo_baja) ON fsj.paciente TO fsj_app;

-- ============================================================================
-- 3. paciente.cuil -- normalize existing rows (strip any non-digit), then
-- tighten to a format CHECK. Same order-of-operations reasoning as 0028/B1
-- (normalize BEFORE the CHECK exists, so an already-dashed/dotted value is
-- fixed rather than rejected outright; if normalizing two rows in the same
-- tenant collides, the second UPDATE this statement processes hits
-- uq_paciente_cuil (migration 0007) immediately and raises 23505, aborting
-- this whole migration transaction -- nothing is silently merged). As of
-- this migration there are 0 tenants in every real environment this has
-- been applied to, so this UPDATE is a no-op today; it is written this way
-- so it stays correct the day that stops being true.
-- ============================================================================
UPDATE fsj.paciente
SET cuil = regexp_replace(cuil, '[^0-9]', '', 'g')
WHERE cuil IS NOT NULL AND cuil !~ '^[0-9]{11}$';

ALTER TABLE fsj.paciente
  ADD CONSTRAINT paciente_cuil_formato_check CHECK (cuil IS NULL OR cuil ~ '^[0-9]{11}$');

COMMENT ON COLUMN fsj.paciente.cuil IS
  'FASE 4 point 4.5. Optional; when present, always exactly 11 digits, no separators -- normalized at the application layer (modules/pacientes/domain/paciente.ts''s cuilString transform, reusing shared/validation/digito-verificador.ts''s AFIP check-digit algorithm, same one proveedor.cuit uses) before every INSERT/UPDATE, enforced here so a bypass of the app layer cannot reintroduce a non-normalized value. The check-digit itself is NOT re-verified here -- application-layer only, same division of labor as proveedor_cuit_formato_check (migration 0007/0028).';

-- ============================================================================
-- 4. paciente.dni -- same treatment: normalize (strip separators such as
-- the conventional "."), then a format CHECK. DNI is 7 or 8 digits
-- (historical DNIs can be 7 digits; current ones are 8) -- both accepted.
-- ============================================================================
UPDATE fsj.paciente
SET dni = regexp_replace(dni, '[^0-9]', '', 'g')
WHERE dni IS NOT NULL AND dni !~ '^[0-9]{7,8}$';

ALTER TABLE fsj.paciente
  ADD CONSTRAINT paciente_dni_formato_check CHECK (dni IS NULL OR dni ~ '^[0-9]{7,8}$');

COMMENT ON COLUMN fsj.paciente.dni IS
  'FASE 4 point 4.5. Optional; when present, 7-8 digits, no separators (no dots) -- normalized at the application layer (modules/pacientes/domain/paciente.ts''s dniString transform) before every INSERT/UPDATE, enforced here so a bypass of the app layer cannot reintroduce a dotted/spaced value.';
