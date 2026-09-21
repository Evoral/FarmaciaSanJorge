-- 0011_recetas_items_componentes
--
-- FASE 1, point 1.9: fsj.receta + fsj.item_receta + fsj.componente_item_receta
-- (M09). Depends on 0002 (fsj.usuario), 0006 (fsj.unidad_medida), 0007
-- (fsj.droga, fsj.medico, fsj.paciente).
--
-- Source of truth where it differs from the original plan (per task
-- instructions): docs/specs/ficha-tecnica.md drives the ComponenteItemReceta
-- model (modo_expresion REPLACES es_cantidad_suficiente) and
-- docs/specs/libro-recetario-y-contralor.md drives the receta state machine
-- (anulacion reachable from any non-terminal state, ENTREGADA/ANULADA
-- terminal).
--
-- Deliberately OUT of scope here (per task instructions):
--   - receta.lote_archivo_id -- fsj.lote_archivo_recetas does not exist
--     until FASE 1.14 (another agent/phase). Add the column + composite FK
--     then, the same way movimiento_stock.preparacion_id was added in 0008
--     and constrained in migration 0013.
--   - receta_estado_historial (plan PROPUESTA) -- not required by the task's
--     binding decisions; registro_auditoria (M01) already covers "who did
--     what when" for CAMBIAR_ESTADO/ANULAR. Add it later if a fast
--     per-receta history view turns out to be needed.
--   - item_receta.unidad_medida_id: the plan's M09 table lists both
--     `unidad_medida_id` and `unidad_total_id` on item_receta, which
--     contradicts the ficha-tecnica.md spec's ItemReceta model (only
--     cantidadTotal/unidadTotal + cantidadUnidades/fraccionDosisPorUnidad).
--     Per the task's "sources of truth" ordering, the spec wins: no
--     standalone unidad_medida_id column is created.
--   - cotizacion / regla_precio -- DP-09 unresolved, explicitly out of
--     scope per task instructions.
--
-- DEVIATION (documented, not a DP): "All tables ... never DELETE" is taken
-- literally for these three tables even though plan historia M09.2 implies
-- in-place editing of items/components while PENDIENTE_PREPARACION. No
-- DELETE grant is given below (ALTER DEFAULT PRIVILEGES already only grants
-- SELECT/INSERT, so this is simply "no extra GRANT DELETE", same posture as
-- every other table in this migration set) -- UPDATE is granted broadly on
-- the substantive columns instead (same convention as fsj.droga/fsj.medico
-- in migration 0007), so content edits work; row removal does not. Flagged
-- as a risk in the delivery report: a future UI for "quitar componente"
-- will need a different mechanism (e.g. a soft `fecha_baja`-style marker)
-- since outright DELETE is not granted.

-- ============================================================================
-- Enums
-- ============================================================================
DO $do$ BEGIN
  CREATE TYPE fsj.origen_receta AS ENUM ('PRESENCIAL', 'DIGITAL_PDF', 'DIGITAL_FOTO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE fsj.estado_receta AS ENUM (
    'PENDIENTE_PREPARACION',
    'EN_PREPARACION',
    'PREPARADA',
    'LISTA_PARA_RETIRAR',
    'ENVIADA_PEND_FIRMA',
    'ENTREGADA',
    'ANULADA'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- PROPUESTA: the plan/spec never enumerate forma_farmaceutica's exact
-- values. Seeded with the forms that appear in docs/specs/ficha-tecnica.md's
-- own test cases (CAPSULA, COMPRIMIDO, CREMA, JARABE) plus the other common
-- magistral forms. Extend with `ALTER TYPE fsj.forma_farmaceutica ADD VALUE`
-- as new forms are needed -- additive, no data migration required.
DO $do$ BEGIN
  CREATE TYPE fsj.forma_farmaceutica AS ENUM (
    'CAPSULA',
    'COMPRIMIDO',
    'CREMA',
    'GEL',
    'UNGUENTO',
    'JARABE',
    'SOLUCION',
    'SUSPENSION',
    'POLVO',
    'OVULO',
    'SUPOSITORIO',
    'LOCION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON TYPE fsj.forma_farmaceutica IS
  'PROPUESTA (not enumerated in the plan/spec) -- see migration 0011 header. CAPSULA/COMPRIMIDO are treated specially by R3/R5/V4 in the ficha calculator (docs/specs/ficha-tecnica.md) as the only "capsular" forms.';

-- modo_expresion REPLACES the diagram's boolean es_cantidad_suficiente --
-- docs/specs/ficha-tecnica.md, binding decision.
DO $do$ BEGIN
  CREATE TYPE fsj.modo_expresion AS ENUM ('TOTAL', 'POR_DOSIS', 'CS', 'CSP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- ============================================================================
-- receta_numero_contador -- per-tenant counter backing receta.numero_interno
-- ============================================================================
-- PROPUESTA / decision: receta.numero_interno is an internal, informal
-- sequence (format DP-25 is open -- plain integer for now) where GAPS ARE
-- ACCEPTABLE, unlike the legal libro recetario correlativo (INV-L04,
-- migration 1.12) which must never skip. That difference is exactly why
-- this is a plain per-tenant counter row updated with a single
-- `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`, NOT the
-- `contador_correlativo` table the plan reserves for asiento_recetario /
-- asiento_contralor (out of scope here, arrives in 1.12): that table needs
-- FOR-UPDATE-style locking discipline and a hash chain; this one only needs
-- "next integer for this tenant", so a dedicated single-purpose table is
-- simpler and keeps the two concerns from ever being confused. A plain
-- Postgres SEQUENCE was rejected because a per-TENANT sequence can't be
-- created generically without dynamic DDL per tenant.
--
-- No pre-seeding needed for existing or future tenants: the upsert below
-- creates the counter row lazily on the first receta of each tenant.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.receta_numero_contador (
  tenant_id     uuid PRIMARY KEY REFERENCES fsj.tenant (id),
  ultimo_valor  bigint NOT NULL DEFAULT 0
);

COMMENT ON TABLE fsj.receta_numero_contador IS
  'Backs receta.numero_interno (per-tenant, gaps acceptable -- see migration 0011 header). Written ONLY by fsj.receta_asignar_numero_interno(). Not the legal libro recetario correlativo (that is fsj.contador_correlativo, migration 1.12, out of scope here).';

-- Global table (no tenant_id column pattern here -- tenant_id IS the PK),
-- but still needs RLS so cross-tenant reads/writes are blocked exactly like
-- any other tenant-scoped table.
ALTER TABLE fsj.receta_numero_contador ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsj.receta_numero_contador FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fsj.receta_numero_contador;
CREATE POLICY tenant_isolation ON fsj.receta_numero_contador
  USING (tenant_id = fsj.current_tenant_id())
  WITH CHECK (tenant_id = fsj.current_tenant_id());

-- fsj_app never touches this table directly -- only the SECURITY DEFINER
-- trigger function below does. No SELECT/INSERT/UPDATE grant needed (and
-- ALTER DEFAULT PRIVILEGES would otherwise hand out SELECT/INSERT, so
-- revoke both explicitly).
REVOKE INSERT ON fsj.receta_numero_contador FROM fsj_app;

-- ============================================================================
-- receta (M09) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.receta (
  id                              uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                       uuid NOT NULL,
  numero_interno                  bigint NOT NULL, -- assigned by trigger below, never by the app
  paciente_id                     uuid NOT NULL,
  medico_id                       uuid NOT NULL, -- glossary: profesionalId (diagram) -> medico_id
  fecha_creada                    timestamptz NOT NULL DEFAULT now(),
  fecha_prescripcion              date NOT NULL, -- fecha_prescripcion <= hoy is [APP] validation (zod, FASE 4)
  fecha_valida_desde              date,
  fecha_ingreso                   timestamptz NOT NULL DEFAULT now(),
  origen                          fsj.origen_receta NOT NULL,
  estado                          fsj.estado_receta NOT NULL DEFAULT 'PENDIENTE_PREPARACION',
  archivo_adjunto_url             text,
  receta_fisica_recibida          boolean NOT NULL DEFAULT false,
  receta_fisica_recibida_en       timestamptz,
  receta_fisica_recibida_por_id   uuid,
  registrada_por_id               uuid NOT NULL,
  motivo_anulacion                text,
  PRIMARY KEY (id),
  CONSTRAINT receta_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT receta_numero_interno_key UNIQUE (tenant_id, numero_interno),
  CONSTRAINT receta_paciente_fkey FOREIGN KEY (tenant_id, paciente_id) REFERENCES fsj.paciente (tenant_id, id),
  CONSTRAINT receta_medico_fkey FOREIGN KEY (tenant_id, medico_id) REFERENCES fsj.medico (tenant_id, id),
  CONSTRAINT receta_registrada_por_fkey FOREIGN KEY (tenant_id, registrada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT receta_recibida_por_fkey FOREIGN KEY (tenant_id, receta_fisica_recibida_por_id) REFERENCES fsj.usuario (tenant_id, id),
  -- archivo_adjunto_url required for DIGITAL_* origins (task binding decision).
  CONSTRAINT receta_adjunto_digital_check CHECK (
    origen NOT IN ('DIGITAL_PDF', 'DIGITAL_FOTO') OR archivo_adjunto_url IS NOT NULL
  ),
  -- INV-R07 [BD]: ENTREGADA requires receta_fisica_recibida.
  CONSTRAINT receta_entregada_fisica_check CHECK (
    estado <> 'ENTREGADA' OR receta_fisica_recibida
  ),
  -- Anulacion requires a motivo (task binding decision).
  CONSTRAINT receta_anulada_motivo_check CHECK (
    estado <> 'ANULADA' OR motivo_anulacion IS NOT NULL
  ),
  -- receta_fisica_recibida = true and its audit pair are set together.
  CONSTRAINT receta_fisica_recibida_pair_check CHECK (
    receta_fisica_recibida = (receta_fisica_recibida_en IS NOT NULL)
  )
);

COMMENT ON TABLE fsj.receta IS
  'M09. numero_interno is an internal, gap-tolerant counter (fsj.receta_numero_contador), NOT the legal libro recetario correlativo. lote_archivo_id is intentionally absent -- see migration header (FASE 1.14, out of scope).';

SELECT fsj.setup_tenant_table('fsj.receta');

GRANT UPDATE (
  paciente_id, medico_id, fecha_prescripcion, fecha_valida_desde, fecha_ingreso,
  origen, estado, archivo_adjunto_url,
  receta_fisica_recibida, receta_fisica_recibida_en, receta_fisica_recibida_por_id,
  motivo_anulacion
) ON fsj.receta TO fsj_app;

-- ============================================================================
-- receta.numero_interno assignment (BEFORE INSERT, overrides whatever the
-- app sends -- see table comment).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_asignar_numero_interno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fsj, extensions
AS $$
DECLARE
  v_numero bigint;
BEGIN
  INSERT INTO fsj.receta_numero_contador (tenant_id, ultimo_valor)
  VALUES (NEW.tenant_id, 1)
  ON CONFLICT (tenant_id) DO UPDATE
    SET ultimo_valor = fsj.receta_numero_contador.ultimo_valor + 1
  RETURNING ultimo_valor INTO v_numero;

  NEW.numero_interno := v_numero;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_asignar_numero_interno() IS
  'Assigns receta.numero_interno from fsj.receta_numero_contador, upserting the counter row lazily on first use per tenant. SECURITY DEFINER so it can write the counter table, which fsj_app has no direct grant on.';

CREATE TRIGGER trg_receta_asignar_numero_interno
  BEFORE INSERT ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_asignar_numero_interno();

-- ============================================================================
-- INV-R08 / receta state machine (docs/specs/libro-recetario-y-contralor.md
-- overrides the plan where they differ -- anulacion reachable from any
-- non-terminal state; ENTREGADA and ANULADA are terminal; no backwards
-- transitions).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_transicion_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado IN ('ENTREGADA', 'ANULADA') THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> % (% is terminal)', OLD.estado, NEW.estado, OLD.estado
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.estado = 'ANULADA' THEN
    -- Anulacion is reachable from any non-terminal state (spec section 1).
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.estado = 'PENDIENTE_PREPARACION' AND NEW.estado = 'EN_PREPARACION')
    OR (OLD.estado = 'EN_PREPARACION' AND NEW.estado = 'PREPARADA')
    OR (OLD.estado = 'PREPARADA' AND NEW.estado = 'LISTA_PARA_RETIRAR')
    OR (OLD.estado = 'LISTA_PARA_RETIRAR' AND NEW.estado IN ('ENTREGADA', 'ENVIADA_PEND_FIRMA'))
    OR (OLD.estado = 'ENVIADA_PEND_FIRMA' AND NEW.estado = 'ENTREGADA')
  ) THEN
    RAISE EXCEPTION 'INV-R08: invalid receta state transition % -> %', OLD.estado, NEW.estado
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.receta_validar_transicion_estado() IS
  'INV-R08 + docs/specs/libro-recetario-y-contralor.md section 1. No backwards transitions; ANULADA reachable from any non-terminal state; ENTREGADA/ANULADA terminal.';

CREATE TRIGGER trg_receta_validar_transicion_estado
  BEFORE UPDATE OF estado ON fsj.receta
  FOR EACH ROW EXECUTE FUNCTION fsj.receta_validar_transicion_estado();

-- ============================================================================
-- item_receta (M09) -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.item_receta (
  id                          uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                   uuid NOT NULL,
  receta_id                   uuid NOT NULL,
  descripcion                 text,
  forma_farmaceutica          fsj.forma_farmaceutica NOT NULL,
  cantidad_unidades           integer NOT NULL,
  -- V8: default 1, "1/2 dosis" = 0.5.
  fraccion_dosis_por_unidad   numeric NOT NULL DEFAULT 1,
  -- Nullable: required only for CSP in non-capsular forms -- [APP], V4
  -- (depends on forma_farmaceutica, not DB-enforceable per task binding
  -- decision).
  cantidad_total              numeric,
  unidad_total_id             uuid,
  observaciones                text,
  PRIMARY KEY (id),
  CONSTRAINT item_receta_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT item_receta_receta_fkey FOREIGN KEY (tenant_id, receta_id) REFERENCES fsj.receta (tenant_id, id),
  -- unidad_total_id references the GLOBAL unidad_medida catalog (DP-39),
  -- same convention as fsj.droga.unidad_base_id.
  CONSTRAINT item_receta_unidad_total_fkey FOREIGN KEY (unidad_total_id) REFERENCES fsj.unidad_medida (id),
  -- V9.
  CONSTRAINT item_receta_cantidad_unidades_check CHECK (cantidad_unidades > 0),
  -- V8.
  CONSTRAINT item_receta_fraccion_dosis_check CHECK (fraccion_dosis_por_unidad > 0 AND fraccion_dosis_por_unidad <= 1),
  CONSTRAINT item_receta_cantidad_total_check CHECK (cantidad_total IS NULL OR cantidad_total > 0),
  -- Structural pairing: cantidad_total and unidad_total_id are both present
  -- or both absent (which of the two states is REQUIRED given forma/CSP is
  -- V4, [APP]) -- see docs/specs/ficha-tecnica.md.
  CONSTRAINT item_receta_total_pair_check CHECK (
    (cantidad_total IS NULL) = (unidad_total_id IS NULL)
  )
);

COMMENT ON TABLE fsj.item_receta IS
  'M09 / docs/specs/ficha-tecnica.md "ItemReceta". forma_farmaceutica determines whether CAPSULA/COMPRIMIDO rules (R3/R5) apply in the ficha calculator (modules/elaboracion/domain/calcular-ficha-tecnica.ts).';

SELECT fsj.setup_tenant_table('fsj.item_receta');

GRANT UPDATE (
  descripcion, forma_farmaceutica, cantidad_unidades, fraccion_dosis_por_unidad,
  cantidad_total, unidad_total_id, observaciones
) ON fsj.item_receta TO fsj_app;

-- ============================================================================
-- componente_item_receta (M09) -- tenant-scoped
-- docs/specs/ficha-tecnica.md "ComponenteItemReceta": modo_expresion
-- REPLACES es_cantidad_suficiente; unidad_medida is ALWAYS present (spec
-- model table -- unlike the plan's nullable unidad_medida_id).
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.componente_item_receta (
  id                    uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  item_receta_id        uuid NOT NULL,
  droga_id              uuid NOT NULL,
  cantidad              numeric, -- NULL for CS/CSP (V7)
  unidad_medida_id      uuid NOT NULL,
  modo_expresion        fsj.modo_expresion NOT NULL,
  es_principio_activo   boolean NOT NULL DEFAULT false,
  orden                 integer NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT componente_item_receta_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT componente_item_receta_item_fkey FOREIGN KEY (tenant_id, item_receta_id) REFERENCES fsj.item_receta (tenant_id, id),
  CONSTRAINT componente_item_receta_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  -- Global catalog (DP-39), same convention as item_receta.unidad_total_id.
  CONSTRAINT componente_item_receta_unidad_fkey FOREIGN KEY (unidad_medida_id) REFERENCES fsj.unidad_medida (id),
  CONSTRAINT componente_item_receta_orden_unico UNIQUE (tenant_id, item_receta_id, orden),
  -- V6: TOTAL/POR_DOSIS => cantidad NOT NULL AND > 0.
  CONSTRAINT componente_item_receta_v6_check CHECK (
    modo_expresion NOT IN ('TOTAL', 'POR_DOSIS') OR (cantidad IS NOT NULL AND cantidad > 0)
  ),
  -- V7: CS/CSP => cantidad IS NULL.
  CONSTRAINT componente_item_receta_v7_check CHECK (
    modo_expresion NOT IN ('CS', 'CSP') OR cantidad IS NULL
  )
);

COMMENT ON TABLE fsj.componente_item_receta IS
  'M09 / docs/specs/ficha-tecnica.md "ComponenteItemReceta". modo_expresion REPLACES the diagram''s es_cantidad_suficiente boolean (binding decision). V1 (>=1 component per item), V2 (<=1 CSP per item), V3 (CSP must be the last orden) are enforced below.';

SELECT fsj.setup_tenant_table('fsj.componente_item_receta');

GRANT UPDATE (droga_id, cantidad, unidad_medida_id, modo_expresion, es_principio_activo, orden)
  ON fsj.componente_item_receta TO fsj_app;

-- V2: at most one CSP component per item.
CREATE UNIQUE INDEX IF NOT EXISTS uq_componente_item_receta_csp_unico
  ON fsj.componente_item_receta (tenant_id, item_receta_id)
  WHERE modo_expresion = 'CSP';

-- ============================================================================
-- V1: an item_receta has at least one componente_item_receta, checked at
-- COMMIT (DEFERRABLE) -- same two-sided pattern as INV-U02 (migration 0002).
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.item_receta_validar_al_menos_un_componente(p_tenant_id uuid, p_item_receta_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fsj.componente_item_receta
    WHERE tenant_id = p_tenant_id AND item_receta_id = p_item_receta_id
  ) THEN
    RAISE EXCEPTION 'V1: item_receta % must have at least one componente_item_receta', p_item_receta_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_componente_check_al_menos_uno()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fsj.item_receta_validar_al_menos_un_componente(OLD.tenant_id, OLD.item_receta_id);
    RETURN OLD;
  ELSE
    PERFORM fsj.item_receta_validar_al_menos_un_componente(NEW.tenant_id, NEW.item_receta_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_componente_al_menos_uno
  AFTER INSERT OR UPDATE OR DELETE ON fsj.componente_item_receta
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_componente_check_al_menos_uno();

CREATE OR REPLACE FUNCTION fsj.trg_item_receta_check_al_menos_un_componente()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.item_receta_validar_al_menos_un_componente(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_item_receta_al_menos_un_componente
  AFTER INSERT ON fsj.item_receta
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_item_receta_check_al_menos_un_componente();

-- ============================================================================
-- V3: a CSP component (if any) must occupy the LAST orden of its item,
-- checked at COMMIT (DEFERRABLE) -- covers reordering another sibling too,
-- so it is attached to every mutation of componente_item_receta, not just
-- inserts of the CSP row itself.
-- ============================================================================
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

CREATE CONSTRAINT TRIGGER trg_componente_csp_orden
  AFTER INSERT OR UPDATE OR DELETE ON fsj.componente_item_receta
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_componente_check_csp_orden();

-- ============================================================================
-- INV-R01: a receta has at least one item_receta, checked at COMMIT
-- (DEFERRABLE). Only the "removing the last item" / "never adding one"
-- directions matter -- item_receta has no DELETE grant (see header), but
-- the DEFERRABLE trigger on item_receta covers "receta inserted, no item
-- ever added in the same transaction" regardless.
-- ============================================================================
CREATE OR REPLACE FUNCTION fsj.receta_validar_al_menos_un_item(p_tenant_id uuid, p_receta_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fsj.item_receta
    WHERE tenant_id = p_tenant_id AND receta_id = p_receta_id
  ) THEN
    RAISE EXCEPTION 'INV-R01: receta % must have at least one item_receta', p_receta_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fsj.trg_item_receta_check_receta_tiene_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fsj.receta_validar_al_menos_un_item(OLD.tenant_id, OLD.receta_id);
    RETURN OLD;
  ELSE
    PERFORM fsj.receta_validar_al_menos_un_item(NEW.tenant_id, NEW.receta_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_item_receta_receta_tiene_item
  AFTER INSERT OR UPDATE OR DELETE ON fsj.item_receta
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_item_receta_check_receta_tiene_item();

CREATE OR REPLACE FUNCTION fsj.trg_receta_check_tiene_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fsj.receta_validar_al_menos_un_item(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_receta_tiene_item
  AFTER INSERT ON fsj.receta
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fsj.trg_receta_check_tiene_item();
