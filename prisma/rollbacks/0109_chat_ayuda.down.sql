-- Rollback of 0109_chat_ayuda. Apply as a NEW forward migration, together
-- with the code reversion (see docs/rollbacks/chat-ayuda.md).
-- The log of past help queries is lost; the permission and any role assignments
-- made by tenant administrators are deleted.

DROP TABLE IF EXISTS fsj.consulta_ayuda;

DELETE FROM fsj.rol_permiso rp
USING fsj.permiso p
WHERE rp.permiso_id = p.id
  AND p.codigo = 'ayuda.consultar';

DELETE FROM fsj.permiso WHERE codigo = 'ayuda.consultar';
