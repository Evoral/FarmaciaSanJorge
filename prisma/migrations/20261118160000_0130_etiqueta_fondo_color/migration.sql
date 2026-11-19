-- 0130 -- Configurable red background for preparado etiqueta by forma farmacéutica.
--
-- Some preparation types legally require a red etiqueta (e.g. external-use: cremas). The farmacia can configure
-- which formas farmacéuticas print with a red background, and chooses one red tone from 5 fixed options (with contrast
-- ratio >= 4.5:1 against black text) for all red etiquetas.
--
--   1. fsj.etiqueta_hoja.formas_fondo_rojo: fsj.forma_farmaceutica[] NOT NULL DEFAULT '{}'
--   2. fsj.etiqueta_hoja.tono_fondo_rojo: text NOT NULL DEFAULT 'pastel' with CHECK constraint
--   3. fsj_app may UPDATE both columns (consistent with 0096 and 0117 column grants).
--
-- *** APPLY 0130 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0130_etiqueta_fondo_color.down.sql (as a NEW forward migration).

ALTER TABLE fsj.etiqueta_hoja
  ADD COLUMN IF NOT EXISTS formas_fondo_rojo fsj.forma_farmaceutica[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tono_fondo_rojo text NOT NULL DEFAULT 'pastel';

ALTER TABLE fsj.etiqueta_hoja
  DROP CONSTRAINT IF EXISTS etiqueta_hoja_tono_fondo_rojo_check,
  ADD CONSTRAINT etiqueta_hoja_tono_fondo_rojo_check
    CHECK (tono_fondo_rojo IN ('pastel', 'tenue', 'suave', 'medio', 'intenso'));

GRANT UPDATE (formas_fondo_rojo, tono_fondo_rojo) ON fsj.etiqueta_hoja TO fsj_app;

COMMENT ON COLUMN fsj.etiqueta_hoja.formas_fondo_rojo IS
  '0130. Formas farmacéuticas whose etiqueta prints with a red background. Default empty.';

COMMENT ON COLUMN fsj.etiqueta_hoja.tono_fondo_rojo IS
  '0130. The red tone key (pastel, tenue, suave, medio, intenso) used for all red etiquetas. Default pastel.';
