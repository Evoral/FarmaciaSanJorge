-- Rollback of 0059_quitar_droga_requiere_correccion_potencia. Prisma has no
-- "down": apply this as the body of a NEW forward migration (next free
-- number). Restores the column exactly as 0058 created it; previous flag
-- values are NOT recovered (all drogas come back as false).

ALTER TABLE fsj.droga
  ADD COLUMN IF NOT EXISTS requiere_correccion_potencia boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fsj.droga.requiere_correccion_potencia IS
  '0058. When true, every NEW partida of this droga must declare potencia_declarada ([APP] rule, stock.partida.ingresar). Existing partidas are unaffected.';

GRANT UPDATE (requiere_correccion_potencia) ON fsj.droga TO fsj_app;
