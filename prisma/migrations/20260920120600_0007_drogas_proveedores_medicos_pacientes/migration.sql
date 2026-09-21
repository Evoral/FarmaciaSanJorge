-- 0007_drogas_proveedores_medicos_pacientes
--
-- FASE 1, point 1.7: the drug/supplier/doctor/patient catalogs (M06), all
-- tenant-scoped. Depends on 0001 (fsj.setup_tenant_table, fsj.forbid_delete)
-- and 0006 (fsj.unidad_medida, fsj.unidad_medida_marcar_usada).
--
-- Deliberately OUT of scope here (per plan §9 M06 "NO HACER" and the DPs
-- blocking them, see §21):
--   - droga.factorConversion (DP-06 unresolved) -- not modeled.
--   - droga.densidad for mass<->volume conversion (DP-06b unresolved) --
--     modeled as a nullable column (see below) but NOT used by
--     fsj.convertir() (migration 0006), which only converts within the
--     same tipo_magnitud.
--   - INV-DRG-001 (unidad_base_id/tipo_control immutable once the droga has
--     partidas) -- DP-12 unresolved. NOT enforced. A comment marks where it
--     would go once DP-12 resolves.
--   - medico.matricula uniqueness scope: DP-23 unresolved (jurisdiction?).
--     Implemented as "unique among active rows per tenant" (the narrowest
--     unambiguous interpretation); revisit if DP-23 adds a jurisdiction
--     dimension.
--   - paciente: DP-24 (data-protection policy) is an [APP] concern
--     (authorize + no logging of sensitive fields) -- nothing to enforce in
--     DDL beyond not exposing the columns anywhere by default.
--   - No stock column on droga (INV-S01) -- stock lives exclusively in
--     fsj.partida (migration 0008) and the fsj.v_stock_droga view.

-- ============================================================================
-- Enum: tipo_control (M06)
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.tipo_control AS ENUM ('NINGUNO', 'PSICOTROPICO', 'ESTUPEFACIENTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- droga (M06) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.droga (
  id             uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  nombre         extensions.citext NOT NULL,
  unidad_base_id uuid NOT NULL REFERENCES fsj.unidad_medida (id),
  -- DP-06b unresolved: nullable, unused by fsj.convertir() for now. See
  -- header comment.
  densidad       numeric,
  es_controlada  boolean NOT NULL DEFAULT false,
  tipo_control   fsj.tipo_control NOT NULL DEFAULT 'NINGUNO',
  stock_minimo   numeric NOT NULL DEFAULT 0,
  fecha_baja     timestamptz,
  motivo_baja    text,
  PRIMARY KEY (id),
  CONSTRAINT droga_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT droga_es_controlada_check CHECK (es_controlada = (tipo_control <> 'NINGUNO')),
  CONSTRAINT droga_stock_minimo_check CHECK (stock_minimo >= 0),
  CONSTRAINT droga_densidad_check CHECK (densidad IS NULL OR densidad > 0)
);

COMMENT ON TABLE fsj.droga IS
  'M06. No stock column here on purpose (INV-S01) -- see fsj.v_stock_droga (migration 0008). unidad_base_id references the GLOBAL unidad_medida catalog (DP-39), not a composite FK. INV-DRG-001 (unidad_base_id/tipo_control immutable once used) is NOT enforced -- DP-12 unresolved.';
COMMENT ON COLUMN fsj.droga.densidad IS 'PROPUESTA for INV-M01/DP-06b (mass<->volume conversion). Not consumed by fsj.convertir() -- DP-06b unresolved.';

SELECT fsj.setup_tenant_table('fsj.droga');

-- Uniqueness among non-deleted (vigente) rows only, case-insensitive
-- (citext) -- plan §9 M06 "nombre UNIQUE (ci, entre vigentes)".
CREATE UNIQUE INDEX IF NOT EXISTS uq_droga_nombre_vigente
  ON fsj.droga (tenant_id, nombre)
  WHERE fecha_baja IS NULL;

GRANT UPDATE (nombre, unidad_base_id, densidad, es_controlada, tipo_control, stock_minimo, fecha_baja, motivo_baja)
  ON fsj.droga TO fsj_app;

-- INV-F03: a droga is never hard-deleted (partidas/movimientos referencing
-- it, once they exist from migration 0008 onward, are additionally
-- protected by the default FK action -- NO ACTION/RESTRICT -- but this
-- trigger is the actual backstop, effective even before any partida
-- exists).
CREATE TRIGGER trg_droga_forbid_delete
  BEFORE DELETE ON fsj.droga
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- INV-M04 support: droga.unidad_base_id counts as "used" for the
-- referenced unidad_medida (plan §9 M05 "mantenida por trigger desde
-- tablas que la referencian").
CREATE OR REPLACE FUNCTION fsj.droga_marcar_unidad_usada()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- NOTE: OLD is not assigned on INSERT (referencing OLD.<field> in that
  -- branch raises "record OLD is not assigned yet"), so TG_OP is checked
  -- FIRST and short-circuits before any OLD access.
  IF TG_OP = 'INSERT' THEN
    PERFORM fsj.unidad_medida_marcar_usada(NEW.unidad_base_id);
  ELSIF NEW.unidad_base_id IS DISTINCT FROM OLD.unidad_base_id THEN
    PERFORM fsj.unidad_medida_marcar_usada(NEW.unidad_base_id);
  END IF;
  RETURN NULL; -- AFTER trigger, return value ignored
END;
$$;

CREATE TRIGGER trg_droga_marcar_unidad_usada
  AFTER INSERT OR UPDATE OF unidad_base_id ON fsj.droga
  FOR EACH ROW EXECUTE FUNCTION fsj.droga_marcar_unidad_usada();

-- ============================================================================
-- proveedor (M06) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.proveedor (
  id            uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  razon_social  text NOT NULL,
  -- Format-only check (11 digits, optionally hyphenated XX-XXXXXXXX-X).
  -- The check-digit algorithm ("validacion de digito verificador" per plan
  -- §9 M06) is application-layer input validation (zod), not a DB
  -- invariant -- deferred to the FASE 4 UI, documented deviation (see
  -- report).
  cuit          text NOT NULL,
  fecha_baja    timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT proveedor_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT proveedor_cuit_key UNIQUE (tenant_id, cuit),
  CONSTRAINT proveedor_cuit_formato_check CHECK (cuit ~ '^[0-9]{2}-?[0-9]{8}-?[0-9]$')
);

COMMENT ON TABLE fsj.proveedor IS
  'M06. cuit format is checked here (11 digits); the check-digit algorithm is left to application-layer validation (zod, FASE 4) -- see migration header.';

SELECT fsj.setup_tenant_table('fsj.proveedor');

GRANT UPDATE (razon_social, cuit, fecha_baja) ON fsj.proveedor TO fsj_app;

CREATE TRIGGER trg_proveedor_forbid_delete
  BEFORE DELETE ON fsj.proveedor
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ============================================================================
-- medico (M06) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.medico (
  id                     uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  nombre                 text NOT NULL,
  apellido               text NOT NULL,
  matricula              text NOT NULL,
  especialidad           text,
  telefono               text,
  direccion_registrada   text,
  fecha_baja             timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT medico_tenant_id_key UNIQUE (tenant_id, id)
);

COMMENT ON TABLE fsj.medico IS
  'M06. matricula uniqueness is scoped to "active rows per tenant" -- DP-23 (jurisdiction?) is unresolved; revisit if it turns out matricula needs a jurisdiction dimension.';

SELECT fsj.setup_tenant_table('fsj.medico');

CREATE UNIQUE INDEX IF NOT EXISTS uq_medico_matricula_vigente
  ON fsj.medico (tenant_id, matricula)
  WHERE fecha_baja IS NULL;

GRANT UPDATE (nombre, apellido, matricula, especialidad, telefono, direccion_registrada, fecha_baja)
  ON fsj.medico TO fsj_app;

CREATE TRIGGER trg_medico_forbid_delete
  BEFORE DELETE ON fsj.medico
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- ============================================================================
-- paciente (M06) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.paciente (
  id                 uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  cuil               varchar(11),
  dni                varchar(8),
  nombre             text NOT NULL,
  apellido           text NOT NULL,
  telefono           text,
  email              text,
  fecha_nacimiento   date,
  nro_credencial     text,
  sexo               text,
  -- PROPUESTA (plan §9 M06: "no esta en el diagrama") -- soft delete,
  -- consistent with the rest of the catalogs.
  fecha_baja         timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT paciente_tenant_id_key UNIQUE (tenant_id, id)
);

COMMENT ON TABLE fsj.paciente IS
  'M06. Health-adjacent data (DP-24, Ley 25.326) -- access restriction and log scrubbing are [APP] concerns (authorize + logger redaction), not enforced in DDL. fecha_baja is a PROPUESTA (not in the original diagram).';

SELECT fsj.setup_tenant_table('fsj.paciente');

-- cuil is unique when present (nullable -- plan §9 M06).
CREATE UNIQUE INDEX IF NOT EXISTS uq_paciente_cuil
  ON fsj.paciente (tenant_id, cuil)
  WHERE cuil IS NOT NULL;

GRANT UPDATE (cuil, dni, nombre, apellido, telefono, email, fecha_nacimiento, nro_credencial, sexo, fecha_baja)
  ON fsj.paciente TO fsj_app;

CREATE TRIGGER trg_paciente_forbid_delete
  BEFORE DELETE ON fsj.paciente
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();
