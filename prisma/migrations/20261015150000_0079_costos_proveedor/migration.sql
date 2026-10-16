-- 0079_costos_proveedor
--
-- docs/specs/costos-proveedor.md (stage E2: schema + permiso). The pharmacy
-- quotes (cotizaciones, presupuestos) with the REFERENCE prices of its
-- suppliers' price lists instead of the real purchase cost of the partidas.
-- The real cost (fsj.partida.costo_unitario) is never touched by this feature
-- (R34): the new tables have no trigger or FK that writes to any stock table.
--
--   1. fsj.lista_precio_proveedor: one imported price list of one proveedor
--      (header only: format, file name, SHA-256 of its bytes, the list's date,
--      rows read / applied, who and when). Tenant-scoped, APPEND-ONLY (no
--      UPDATE/DELETE grant + fsj.forbid_update_delete). UNIQUE (tenant,
--      proveedor, hash_sha256) is what rejects importing the same file twice
--      for the same proveedor (R21).
--   2. fsj.costo_proveedor: the reference price of one droga for one
--      proveedor, VERSIONED like fsj.regla_precio (0031, INV-PR-001): a change
--      never updates a row -- the app closes the vigente version
--      (vigente_hasta = the new one's vigente_desde, same instant) and INSERTs
--      the new one in one transaction (R2). The partial unique index leaves at
--      most one vigente (vigente_hasta IS NULL) per (tenant, droga, proveedor)
--      (R1). fsj_app may UPDATE vigente_hasta only (column grant); the
--      validating trigger (INV-CP-001/002) additionally refuses any other
--      column, closing a row that is already closed and reopening one; DELETE
--      is refused (fsj.forbid_delete, no grant). The price is stored twice:
--      precio_informado (exact, as written on the list, in unidad_precio_id)
--      and costo_unitario (per the droga's unidad base, rounded to 10
--      decimals, R4) -- the conversion itself is application logic
--      (modules/costos-proveedor/domain/costo-proveedor.ts), same as the
--      partida's costo.
--   3. Permiso `costos.proveedor.gestionar` (categoria gestion, R36): importing,
--      editing and dando de baja costos de proveedor. A `gestion` permiso
--      reaches the locked ADMINISTRADOR automatically (es_administrador, 0054)
--      and every other role only through the role editor, so NO rol_permiso
--      row is inserted and fsj.plantilla_rol_permisos() is NOT redefined (no
--      predefined role holds it on new farmacias either).
--
-- Both tables go through fsj.setup_tenant_table (RLS enabled + forced,
-- tenant_isolation policy, forbid_tenant_id_change). unidad_precio_id points
-- at the GLOBAL unidad_medida catalog with a plain FK (no tenant_id there,
-- DP-39), like droga.unidad_base_id. The unidad's magnitud matching the
-- droga's unidad base (R5) is an app rule: it spans two tables and the
-- unidad's magnitud is immutable once used (INV-M04) but a DB trigger for it
-- would be redundant with the command's validation.
--
-- ADDITIVE: two new tables and one catalog row. No existing object changes.
--
-- Numbering: 0079, not 0077. The shared database already has
-- 20261013150000_0077_cuentas_de_sector and 20261013180000_0078_pin_cuatro_digitos
-- applied, which were not in this repository when this migration was written
-- (2026-10-15) -- re-check `prisma migrate status` before applying.
--
-- *** APPLY 0079 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0079_costos_proveedor.down.sql (as a NEW forward
-- migration) -- docs/rollbacks/costos-proveedor.md.

-- ============================================================================
-- 1. fsj.lista_precio_proveedor -- tenant-scoped, append-only
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.lista_precio_proveedor (
  id                 uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  proveedor_id       uuid        NOT NULL,
  -- File format the list was read from. PDF is reserved for a later stage.
  formato            text        NOT NULL,
  nombre_archivo     text        NOT NULL,
  -- SHA-256 of the file's bytes, lowercase hex (R21).
  hash_sha256        text        NOT NULL,
  -- The date the list's prices correspond to (becomes costo_proveedor.fecha_precio of its rows).
  fecha_lista        date        NOT NULL,
  filas_leidas       integer     NOT NULL,
  filas_aplicadas    integer     NOT NULL,
  registrado_por_id  uuid        NOT NULL,
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT lista_precio_proveedor_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT lista_precio_proveedor_hash_key UNIQUE (tenant_id, proveedor_id, hash_sha256),
  CONSTRAINT lista_precio_proveedor_proveedor_fkey FOREIGN KEY (tenant_id, proveedor_id) REFERENCES fsj.proveedor (tenant_id, id),
  CONSTRAINT lista_precio_proveedor_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT lista_precio_proveedor_formato_check CHECK (formato IN ('XLSX', 'PDF')),
  CONSTRAINT lista_precio_proveedor_nombre_archivo_check CHECK (length(btrim(nombre_archivo)) > 0),
  CONSTRAINT lista_precio_proveedor_hash_check CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT lista_precio_proveedor_filas_check CHECK (filas_leidas >= 0 AND filas_aplicadas >= 0 AND filas_aplicadas <= filas_leidas)
);

CREATE INDEX IF NOT EXISTS idx_lista_precio_proveedor_registrado
  ON fsj.lista_precio_proveedor (tenant_id, registrado_en DESC);

COMMENT ON TABLE fsj.lista_precio_proveedor IS
  '0079 (docs/specs/costos-proveedor.md). Header of one imported supplier price list: formato, nombre_archivo, hash_sha256 (the same file can not be imported twice for the same proveedor, R21), fecha_lista, filas_leidas / filas_aplicadas, who and when. The rows it applied are fsj.costo_proveedor rows pointing back through lista_precio_id. Append-only (INV-IMMUTABLE): fsj_app has SELECT/INSERT only.';

SELECT fsj.setup_tenant_table('fsj.lista_precio_proveedor');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.lista_precio_proveedor FROM fsj_app;

DROP TRIGGER IF EXISTS trg_lista_precio_proveedor_forbid_update_delete ON fsj.lista_precio_proveedor;
CREATE TRIGGER trg_lista_precio_proveedor_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.lista_precio_proveedor
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

-- ============================================================================
-- 2. fsj.costo_proveedor -- tenant-scoped, versioned, immutable except the
--    vigente_hasta close.
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.costo_proveedor (
  id                     uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  droga_id               uuid        NOT NULL,
  proveedor_id           uuid        NOT NULL,
  -- The price exactly as written on the list / typed (net of IVA, pesos), per 1 unidad_precio_id (R3, R7).
  precio_informado       numeric     NOT NULL,
  unidad_precio_id       uuid        NOT NULL,
  -- precio_informado converted to the droga's unidad base, 10 decimals half-up (R4).
  costo_unitario         numeric     NOT NULL,
  -- The date the price corresponds to (the list's date for an import).
  fecha_precio           date        NOT NULL,
  -- Product text as written on the supplier's list (NULL for a manual entry).
  descripcion_proveedor  text,
  -- NULL = manual entry (R24).
  lista_precio_id        uuid,
  motivo                 text,
  vigente_desde          timestamptz NOT NULL DEFAULT now(),
  vigente_hasta          timestamptz,
  creado_por_id          uuid        NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT costo_proveedor_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT costo_proveedor_droga_fkey FOREIGN KEY (tenant_id, droga_id) REFERENCES fsj.droga (tenant_id, id),
  CONSTRAINT costo_proveedor_proveedor_fkey FOREIGN KEY (tenant_id, proveedor_id) REFERENCES fsj.proveedor (tenant_id, id),
  -- Global catalog (no tenant_id, DP-39): plain FK, like droga.unidad_base_id.
  CONSTRAINT costo_proveedor_unidad_precio_fkey FOREIGN KEY (unidad_precio_id) REFERENCES fsj.unidad_medida (id),
  CONSTRAINT costo_proveedor_lista_precio_fkey FOREIGN KEY (tenant_id, lista_precio_id) REFERENCES fsj.lista_precio_proveedor (tenant_id, id),
  CONSTRAINT costo_proveedor_creado_por_fkey FOREIGN KEY (tenant_id, creado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT costo_proveedor_precio_informado_check CHECK (precio_informado > 0),
  CONSTRAINT costo_proveedor_costo_unitario_check CHECK (costo_unitario > 0),
  CONSTRAINT costo_proveedor_descripcion_check CHECK (descripcion_proveedor IS NULL OR length(btrim(descripcion_proveedor)) > 0),
  CONSTRAINT costo_proveedor_motivo_check CHECK (motivo IS NULL OR length(btrim(motivo)) > 0),
  CONSTRAINT costo_proveedor_vigencia_check CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

COMMENT ON TABLE fsj.costo_proveedor IS
  '0079 (docs/specs/costos-proveedor.md). Reference price a proveedor quotes for a droga, used only to QUOTE (never a purchase; the real cost stays in fsj.partida.costo_unitario). Versioned (INV-CP-001/002): a change never UPDATEs a row -- the application closes the vigente version (vigente_hasta) and INSERTs a new one with vigente_desde = that same instant, in one transaction; the closed row is the "valor anterior". At most ONE vigente (vigente_hasta IS NULL) per (tenant, droga, proveedor) -- see costo_proveedor_una_vigente_por_par. Never deleted. precio_informado is net of IVA, in pesos, per 1 unidad_precio; costo_unitario is that price per the droga''s unidad base (like partida.costo_unitario).';

COMMENT ON COLUMN fsj.costo_proveedor.precio_informado IS
  'Price exactly as written on the list or typed, net of IVA, pesos, per 1 unidad_precio_id (R3, R7). Kept exact so costo_unitario can always be recomputed.';
COMMENT ON COLUMN fsj.costo_proveedor.costo_unitario IS
  'precio_informado per the droga''s unidad base, rounded to 10 decimals half-up (R4). Computed by the application (modules/costos-proveedor/domain/costo-proveedor.ts#calcularCostoUnidadBase).';

SELECT fsj.setup_tenant_table('fsj.costo_proveedor');

-- INV-CP-001/002: only vigente_hasta may ever be written after insert (the
-- "close" half of the versioning operation, same shape as regla_precio,
-- 0031). No DELETE grant either; forbid_delete is the defense-in-depth backstop.
GRANT UPDATE (vigente_hasta) ON fsj.costo_proveedor TO fsj_app;

CREATE OR REPLACE FUNCTION fsj.costo_proveedor_validar_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Compared as jsonb minus the one writable column, so a column added to the
  -- table later is immutable by default instead of silently writable.
  IF (to_jsonb(NEW) - 'vigente_hasta') IS DISTINCT FROM (to_jsonb(OLD) - 'vigente_hasta') THEN
    RAISE EXCEPTION 'INV-CP-001: costo_proveedor can only be closed (vigente_hasta); every other column is immutable -- close this version and insert a new one instead'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.vigente_hasta IS NOT NULL THEN
    IF NEW.vigente_hasta IS NULL THEN
      RAISE EXCEPTION 'INV-CP-002: a closed costo_proveedor can not be reopened'
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'INV-CP-002: costo_proveedor already closed (vigente_hasta cannot be modified once set)'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fsj.costo_proveedor_validar_update() IS
  'INV-CP-001/002 (0079): a costo_proveedor row is immutable except for ONE write -- setting vigente_hasta the first time (the close). Any other column, closing an already closed row and reopening one are rejected.';

DROP TRIGGER IF EXISTS trg_costo_proveedor_validar_update ON fsj.costo_proveedor;
CREATE TRIGGER trg_costo_proveedor_validar_update
  BEFORE UPDATE ON fsj.costo_proveedor
  FOR EACH ROW EXECUTE FUNCTION fsj.costo_proveedor_validar_update();

DROP TRIGGER IF EXISTS trg_costo_proveedor_forbid_delete ON fsj.costo_proveedor;
CREATE TRIGGER trg_costo_proveedor_forbid_delete
  BEFORE DELETE ON fsj.costo_proveedor
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_delete();

-- R1: at most one vigente costo per (tenant, droga, proveedor). The command
-- must close the current one in the SAME transaction it inserts the new one,
-- or this rejects the insert. Also serves the per-droga lookup of the
-- cotización (vigentes of a droga across proveedores, R26).
CREATE UNIQUE INDEX IF NOT EXISTS costo_proveedor_una_vigente_por_par
  ON fsj.costo_proveedor (tenant_id, droga_id, proveedor_id)
  WHERE vigente_hasta IS NULL;

COMMENT ON INDEX fsj.costo_proveedor_una_vigente_por_par IS
  'R1: at most one OPEN (vigente_hasta IS NULL) costo_proveedor per (tenant, droga, proveedor).';

-- The "Vigentes" listing filtered by proveedor.
CREATE INDEX IF NOT EXISTS idx_costo_proveedor_vigente_proveedor
  ON fsj.costo_proveedor (tenant_id, proveedor_id)
  WHERE vigente_hasta IS NULL;

-- The history of one (droga, proveedor) pair, newest first.
CREATE INDEX IF NOT EXISTS idx_costo_proveedor_historial
  ON fsj.costo_proveedor (tenant_id, droga_id, proveedor_id, vigente_desde DESC);

-- ============================================================================
-- 3. Permiso costos.proveedor.gestionar (R36). Categoria gestion: ADMINISTRADOR
--    gets it automatically (es_administrador, 0054); no rol_permiso row and no
--    change to fsj.plantilla_rol_permisos(). Mirrored in
--    modules/auth/domain/permisos.ts#PERMISO_CATALOGO.
-- ============================================================================
INSERT INTO fsj.permiso (codigo, categoria, descripcion) VALUES
  ('costos.proveedor.gestionar', 'gestion', 'Importar, editar y dar de baja costos de proveedores')
ON CONFLICT (codigo) DO NOTHING;
