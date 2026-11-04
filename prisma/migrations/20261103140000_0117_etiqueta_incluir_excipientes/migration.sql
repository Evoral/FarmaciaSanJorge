-- 0117 -- The excipientes on the preparado's etiqueta (user decision 2026-11-03).
--
-- The legal obligation to declare the excipientes on the label: in the toma workspace, above "Imprimir etiquetas", a
-- switch adds them to the etiqueta's Rp/ list, each marked "(excipiente)". The administrator chooses whether that switch
-- starts on or off (/admin/configuracion/etiquetas); every tenant starts with it OFF (today's label).
--
--   1. fsj.etiqueta_hoja.incluir_excipientes (the tenant's one etiqueta configuration row, migration 0096):
--      NOT NULL DEFAULT false, so every existing row (and create-tenant.ts' insert) reads OFF.
--   2. fsj_app may UPDATE it (0096 grants UPDATE column by column).
--
-- The choice is applied when the etiqueta is generated: it is part of the `etiqueta.contenido` snapshot, so changing
-- the default never alters an etiqueta already generated.
--
-- *** APPLY 0117 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0117_etiqueta_incluir_excipientes.down.sql (as a NEW forward migration).

ALTER TABLE fsj.etiqueta_hoja ADD COLUMN IF NOT EXISTS incluir_excipientes boolean NOT NULL DEFAULT false;

GRANT UPDATE (incluir_excipientes) ON fsj.etiqueta_hoja TO fsj_app;

COMMENT ON COLUMN fsj.etiqueta_hoja.incluir_excipientes IS
  '0117. Whether the toma''s "Incluir excipientes en la etiqueta" switch starts on; the user can still change it before printing. Default off.';
