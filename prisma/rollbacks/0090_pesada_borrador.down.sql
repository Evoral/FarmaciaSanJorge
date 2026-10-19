-- Rollback of 0090_pesada_borrador (apply as a NEW forward migration).
-- Drops the drafts of the lots and real weighings typed in the ficha técnica: nothing else references them (a
-- reserva copies what it needs into reserva_stock). The code must be reverted too (the ficha's lot selectors and
-- "Cantidad real pesada" column, docs/specs/pesada-real.md "Pesada en la ficha").

DROP TABLE IF EXISTS fsj.pesada_borrador;
