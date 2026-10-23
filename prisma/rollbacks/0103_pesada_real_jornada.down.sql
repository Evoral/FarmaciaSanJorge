-- Rollback of migration 0103: restores fsj.pesada_real_validar_autorizacion exactly as 0088 left it (current_date).

CREATE OR REPLACE FUNCTION fsj.pesada_real_validar_autorizacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.autorizado_por_id IS NOT NULL AND NOT fsj.es_dt_vigente(NEW.autorizado_por_id, current_date) THEN
    RAISE EXCEPTION 'INV-U05: pesada_real autorizado_por_id % is not a DT vigente today', NEW.autorizado_por_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
