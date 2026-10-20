-- 0093_repartidores_envio
--
-- docs/specs/envios-repartidores.md (user decision 2026-10-20): an ENVIO now records WHO carries the preparado.
-- Repartidores are a catalogue of their own (not usuarios, they never log in); an envio carries exactly one.
--
--   1. fsj.repartidor: tenant-scoped catalogue (nombre, apellido, telefono, activo). Soft delete via activo: fsj_app
--      has no DELETE. Created like fsj.etiqueta_tamano (0066): fsj.setup_tenant_table (RLS + INV-T01/INV-T03),
--      SELECT/INSERT through the default privileges of 0000, UPDATE per column. No seed rows: a farmacia starts with
--      an empty list.
--   2. fsj.entrega.repartidor_id (NULL), composite FK to fsj.repartidor, index for the "hoja de envios" query, and:
--        - CHECK: only an ENVIO may carry a repartidor (every existing row satisfies it, so it is added validated).
--        - INV-ENT-005 [BD] (trigger, NOT a CHECK): a new ENVIO, or a change of repartidor_id on an ENVIO, needs a
--          non-null repartidor. It is a trigger on purpose: the envios registered before this migration have NULL
--          and stay valid (docs/specs/envios-repartidores.md E7); a CHECK would fail on ANY later UPDATE of those
--          rows, e.g. "confirmar firma recibida". The trigger only looks at INSERTs and at UPDATEs that name
--          repartidor_id.
--        - repartidor_id joins fsj_app's column-limited UPDATE grant on fsj.entrega ("cambiar repartidor"). The
--          INV-ENT-001 guard (0016) does not list it, so it stays updatable.
--   3. fsj.entrega_anulada.repartidor_id (NULL, no FK: history like the rest of the table).
--   4. Permiso repartidores.gestionar (category gestion: ADMINISTRADOR gets it through es_administrador, 0054; no
--      change to fsj.plantilla_rol_permisos()). Mirrored in modules/auth/domain/permisos.ts#PERMISO_CATALOGO.
--
-- Numbering: 0092 (20261019190000_0092_excipiente_stock) is the highest at the time of writing -- re-check before
-- applying.
--
-- *** APPLY 0093 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Caveat: INV-ENT-005 rejects an ENVIO INSERT without repartidor, and the code before "registrar envio con
-- repartidor" (docs/specs/envios-repartidores.md, plan item 3) inserts none. Between applying 0093 and deploying
-- that code, registering an ENVIO fails (RETIRO_PRESENCIAL, firma confirmation and anulacion are unaffected).
-- Apply 0093 together with the deploy of item 3, or accept that window.
-- Rollback: prisma/rollbacks/0093_repartidores_envio.down.sql (as a NEW forward migration).

-- ============================================================================
-- 1. fsj.repartidor
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.repartidor (
  id             uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  nombre         text        NOT NULL,
  apellido       text        NOT NULL,
  telefono       text        NOT NULL,
  activo         boolean     NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  creado_por_id  uuid        NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT repartidor_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT repartidor_creado_por_fkey FOREIGN KEY (tenant_id, creado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT repartidor_nombre_check CHECK (length(btrim(nombre)) > 0 AND length(nombre) <= 100),
  CONSTRAINT repartidor_apellido_check CHECK (length(btrim(apellido)) > 0 AND length(apellido) <= 100),
  CONSTRAINT repartidor_telefono_check CHECK (length(btrim(telefono)) > 0 AND length(telefono) <= 30)
);

COMMENT ON TABLE fsj.repartidor IS
  '0093 (docs/specs/envios-repartidores.md). People who carry the envios of a farmacia. Not usuarios (they never log in). Managed with repartidores.gestionar; soft delete via activo (no DELETE for fsj_app).';

SELECT fsj.setup_tenant_table('fsj.repartidor');

GRANT UPDATE (nombre, apellido, telefono, activo) ON fsj.repartidor TO fsj_app;

-- ============================================================================
-- 2. fsj.entrega.repartidor_id
-- ============================================================================
ALTER TABLE fsj.entrega ADD COLUMN IF NOT EXISTS repartidor_id uuid;

ALTER TABLE fsj.entrega
  ADD CONSTRAINT entrega_repartidor_fkey
  FOREIGN KEY (tenant_id, repartidor_id) REFERENCES fsj.repartidor (tenant_id, id);

ALTER TABLE fsj.entrega
  ADD CONSTRAINT entrega_repartidor_solo_envio_check
  CHECK (modalidad = 'ENVIO' OR repartidor_id IS NULL);

CREATE INDEX IF NOT EXISTS entrega_repartidor_idx ON fsj.entrega (tenant_id, repartidor_id);

COMMENT ON COLUMN fsj.entrega.repartidor_id IS
  '0093. Who carries an ENVIO. NULL for RETIRO_PRESENCIAL (CHECK) and for the envios registered before 0093 (INV-ENT-005 only looks at new rows and at changes of this column).';

GRANT UPDATE (repartidor_id) ON fsj.entrega TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.entrega_validar_repartidor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.modalidad = 'ENVIO' AND NEW.repartidor_id IS NULL THEN
    RAISE EXCEPTION 'INV-ENT-005: an ENVIO entrega (receta %) needs a repartidor', NEW.receta_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.entrega_validar_repartidor() IS
  'INV-ENT-005 (migration 0093, docs/specs/envios-repartidores.md): an ENVIO entrega is inserted with a repartidor, and its repartidor can be changed but never removed. A trigger and not a CHECK: envios registered before 0093 have NULL and must stay updatable (confirmar firma).';

CREATE TRIGGER trg_entrega_validar_repartidor
  BEFORE INSERT OR UPDATE OF repartidor_id ON fsj.entrega
  FOR EACH ROW EXECUTE FUNCTION fsj.entrega_validar_repartidor();

-- ============================================================================
-- 3. fsj.entrega_anulada.repartidor_id (history: no FK)
-- ============================================================================
ALTER TABLE fsj.entrega_anulada ADD COLUMN IF NOT EXISTS repartidor_id uuid;

COMMENT ON COLUMN fsj.entrega_anulada.repartidor_id IS
  '0093. The repartidor the anulada entrega had (NULL for a retiro or a pre-0093 envio). No FK: history, like the rest of the table.';

-- ============================================================================
-- 4. Permiso repartidores.gestionar
-- ============================================================================
INSERT INTO fsj.permiso (codigo, categoria, descripcion) VALUES
  ('repartidores.gestionar', 'gestion', 'Gestionar el catálogo de repartidores de envíos')
ON CONFLICT (codigo) DO NOTHING;
