-- 0103_pesada_real_jornada
--
-- Security audit finding P3-04. fsj.pesada_real_validar_autorizacion (0088)
-- checked the DT co-firma against current_date (server UTC) while the app
-- (esDtVigenteHoy) and every other INV-U05 trigger (0014, 0033) use the
-- farmacia's jornada, fsj.jornada_actual(tenant_id). Between 21:00 and 23:59
-- (UTC-3) of a day whose DT designation changes, the trigger and the app
-- disagreed about who is vigente. Same body otherwise.
--
-- Rollback: prisma/rollbacks/0103_pesada_real_jornada.down.sql (as a NEW
-- forward migration). Code-independent: apply in any order with the app.

CREATE OR REPLACE FUNCTION fsj.pesada_real_validar_autorizacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.autorizado_por_id IS NOT NULL AND NOT fsj.es_dt_vigente(NEW.autorizado_por_id, fsj.jornada_actual(NEW.tenant_id)) THEN
    RAISE EXCEPTION 'INV-U05: pesada_real autorizado_por_id % is not a DT vigente today', NEW.autorizado_por_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
