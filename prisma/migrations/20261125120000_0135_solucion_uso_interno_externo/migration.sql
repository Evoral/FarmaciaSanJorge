-- 0135_solucion_uso_interno_externo
--
-- A solución is now loaded as internal or external use: an external-use etiqueta may print red (0130's
-- etiqueta_hoja.formas_fondo_rojo), so the farmacia needs to tell them apart.
--   1. SOLUCION is renamed SOLUCION_USO_INTERNO: every solución loaded so far was for internal use (user decision
--      2026-11-25). Renaming keeps every row, array element and stored reference pointing at the same value.
--   2. SOLUCION_USO_EXTERNO is added right after it.
-- No function or trigger names 'SOLUCION' (only 0011's CREATE TYPE). Frozen texts (etiqueta.contenido, asiento
-- formula_texto) keep what they printed.
--
-- Rollback: prisma/rollbacks/0135_solucion_uso_interno_externo.down.sql (as a NEW forward migration).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'fsj' AND t.typname = 'forma_farmaceutica' AND e.enumlabel = 'SOLUCION'
  ) THEN
    ALTER TYPE fsj.forma_farmaceutica RENAME VALUE 'SOLUCION' TO 'SOLUCION_USO_INTERNO';
  END IF;
END
$$;

ALTER TYPE fsj.forma_farmaceutica ADD VALUE IF NOT EXISTS 'SOLUCION_USO_EXTERNO' AFTER 'SOLUCION_USO_INTERNO';
