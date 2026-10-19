-- 0090 -- Pesada en borrador (docs/specs/pesada-real.md, "Pesada en la ficha").
--
-- The lab weighs step by step. The lot of every línea and its real weighing
-- moved from the "Marcar como preparada" dialog to the ficha técnica itself, and
-- each línea is saved as soon as it is filled in, so nothing typed while
-- weighing is lost (reload, another PC, another pharmacist). The dialog only
-- confirms: it sends what this table holds (through the form), and the
-- reserva / confirmation re-validates everything as before.
--
--   fsj.pesada_borrador: one row per línea de pesaje (a ficha version), the
--   lots chosen in order and the typed quantities. A draft: no stock, no libro,
--   no contralor. A regenerated ficha has new líneas, so it starts clean.
--
-- Old code + 0090: the table is never read -- unchanged.
-- New code without 0090: the toma page fails to load a Pendiente ítem (it reads the drafts).
-- Rollback: prisma/rollbacks/0090_pesada_borrador.down.sql (as a NEW forward migration).

CREATE TABLE IF NOT EXISTS fsj.pesada_borrador (
  id                         uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                  uuid        NOT NULL,
  linea_pesaje_id            uuid        NOT NULL,
  partida_ids                uuid[]      NOT NULL DEFAULT '{}',  -- in the order the lots are used
  cantidad_real              numeric,                            -- non-manual línea: what the balance showed, línea unit
  cantidad_manual            numeric,                            -- enrase manual línea: the typed quantity, línea unit
  motivo_apertura_adicional  text,
  actualizado_por_id         uuid        NOT NULL,
  actualizado_en             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pesada_borrador_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT pesada_borrador_linea_key UNIQUE (tenant_id, linea_pesaje_id),
  CONSTRAINT pesada_borrador_linea_fkey FOREIGN KEY (tenant_id, linea_pesaje_id) REFERENCES fsj.linea_pesaje (tenant_id, id),
  CONSTRAINT pesada_borrador_actualizado_por_fkey FOREIGN KEY (tenant_id, actualizado_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT pesada_borrador_cantidades_check CHECK ((cantidad_real IS NULL OR cantidad_real > 0) AND (cantidad_manual IS NULL OR cantidad_manual > 0))
);

COMMENT ON TABLE fsj.pesada_borrador IS
  'Migration 0090. Draft of a línea de pesaje''s weighing, saved from the toma workspace while the lab weighs: lots (in order) and typed quantities. Never stock, libro or contralor: the reserva re-validates it.';

SELECT fsj.setup_tenant_table('fsj.pesada_borrador');

REVOKE TRUNCATE ON fsj.pesada_borrador FROM fsj_app;
