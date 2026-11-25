-- Rollback of 0135_solucion_uso_interno_externo (apply as a NEW forward migration, after reverting the code).
--
-- Postgres can not drop an enum value: SOLUCION_USO_EXTERNO stays, unused. This refuses while any ítem or etiqueta
-- configuration uses it (decide first what those ítems become: there is no correct automatic answer), then renames
-- SOLUCION_USO_INTERNO back to SOLUCION.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fsj.item_receta WHERE forma_farmaceutica = 'SOLUCION_USO_EXTERNO')
     OR EXISTS (SELECT 1 FROM fsj.etiqueta_hoja WHERE 'SOLUCION_USO_EXTERNO' = ANY (formas_fondo_rojo)) THEN
    RAISE EXCEPTION 'Cannot rollback 0135: SOLUCION_USO_EXTERNO is still used by fsj.item_receta or fsj.etiqueta_hoja.formas_fondo_rojo'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'fsj' AND t.typname = 'forma_farmaceutica' AND e.enumlabel = 'SOLUCION_USO_INTERNO'
  ) THEN
    ALTER TYPE fsj.forma_farmaceutica RENAME VALUE 'SOLUCION_USO_INTERNO' TO 'SOLUCION';
  END IF;
END
$$;
