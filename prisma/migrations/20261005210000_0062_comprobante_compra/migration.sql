-- 0062_comprobante_compra
--
-- Supplier invoice import for /stock/ingresar (modules/stock/application/
-- leer-factura-compra-pdf.ts + importar-factura-compra.ts): a supplier's
-- PDF invoice (e.g. Droguería Saporiti) lists several drogas, each with
-- one or more lots underneath. Confirming the import creates ONE partida
-- per (droga, lote) in a single transaction, all linked to the invoice.
--
-- ADDITIVE: one new tenant-scoped table, three nullable columns on
-- fsj.partida; existing rows and the manual alta are unaffected.
--
--   1. fsj.comprobante_compra (new): the invoice header -- proveedor, letra,
--      punto de venta + número, fecha de emisión, CAE and totals. Append-only
--      for fsj_app (SELECT/INSERT via ALTER DEFAULT PRIVILEGES, no
--      UPDATE/DELETE): it is a fiscal document, never edited. UNIQUE
--      (tenant, proveedor, letra, punto_venta, numero) is what rejects
--      importing the same invoice twice.
--   2. fsj.partida.comprobante_compra_id: the invoice the lot came in (NULL
--      for manual altas and every existing partida).
--   3. fsj.partida.despacho_importacion / pais_origen: import traceability
--      printed under each lot ("Desp.:23 001 IC04 163776 W", "Orig:CHINA").
--      Insert-only (fsj.partida's UPDATE privilege is per column, 0008 --
--      no new grant).
--
-- Not stored: payment terms, IIBB perceptions, CUFE/QR text -- not needed
-- by any stock, cost or libro rule. Expiry date and purity are NOT on the
-- invoice: the user enters them per lot in the preview, as in the manual
-- alta.
--
-- Numbering: 0061 (20261005180000_0061_quitar_lista_para_retirar) is the
-- highest at the time of writing -- re-check before applying.
--
-- *** APPLY 0062 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0062_comprobante_compra.down.sql (as a NEW
-- forward migration).

-- ============================================================================
-- 1. fsj.comprobante_compra -- tenant-scoped
-- ============================================================================
CREATE TABLE IF NOT EXISTS fsj.comprobante_compra (
  id                 uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  proveedor_id       uuid NOT NULL,
  letra              text NOT NULL,
  punto_venta        text NOT NULL,
  numero             text NOT NULL,
  fecha_emision      date NOT NULL,
  cae                text,
  subtotal           numeric,
  iva                numeric,
  total              numeric,
  registrado_por_id  uuid NOT NULL,
  registrado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT comprobante_compra_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT comprobante_compra_numero_key UNIQUE (tenant_id, proveedor_id, letra, punto_venta, numero),
  CONSTRAINT comprobante_compra_proveedor_fkey FOREIGN KEY (tenant_id, proveedor_id) REFERENCES fsj.proveedor (tenant_id, id),
  CONSTRAINT comprobante_compra_registrado_por_fkey FOREIGN KEY (tenant_id, registrado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT comprobante_compra_letra_check CHECK (letra IN ('A', 'B', 'C', 'M')),
  CONSTRAINT comprobante_compra_punto_venta_check CHECK (punto_venta ~ '^[0-9]{1,5}$'),
  CONSTRAINT comprobante_compra_numero_check CHECK (numero ~ '^[0-9]{1,8}$'),
  CONSTRAINT comprobante_compra_importes_check CHECK (
    (subtotal IS NULL OR subtotal >= 0) AND (iva IS NULL OR iva >= 0) AND (total IS NULL OR total >= 0)
  )
);

COMMENT ON TABLE fsj.comprobante_compra IS
  '0062. Supplier invoice a set of partidas was imported from (/stock/ingresar, "Importar factura"). punto_venta/numero stored without leading zeros. Append-only for fsj_app (no UPDATE/DELETE).';

SELECT fsj.setup_tenant_table('fsj.comprobante_compra');

-- ============================================================================
-- 2-3. fsj.partida: invoice link + import traceability
-- ============================================================================
ALTER TABLE fsj.partida
  ADD COLUMN IF NOT EXISTS comprobante_compra_id uuid,
  ADD COLUMN IF NOT EXISTS despacho_importacion text,
  ADD COLUMN IF NOT EXISTS pais_origen text;

ALTER TABLE fsj.partida
  ADD CONSTRAINT partida_comprobante_compra_fkey FOREIGN KEY (tenant_id, comprobante_compra_id) REFERENCES fsj.comprobante_compra (tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_partida_tenant_comprobante_compra
  ON fsj.partida (tenant_id, comprobante_compra_id)
  WHERE comprobante_compra_id IS NOT NULL;

COMMENT ON COLUMN fsj.partida.comprobante_compra_id IS
  '0062. Invoice the lot was imported from; NULL for a manual alta. Insert-only for fsj_app.';
COMMENT ON COLUMN fsj.partida.despacho_importacion IS
  '0062. Customs clearance (despacho de importación) printed under the lot on the invoice. Insert-only for fsj_app.';
COMMENT ON COLUMN fsj.partida.pais_origen IS
  '0062. Country of origin printed under the lot on the invoice. Insert-only for fsj_app.';
