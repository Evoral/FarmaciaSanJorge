-- 0111_corregir_potencia_partida
--
-- User decision (2026-10-30, openspec/changes/corregir-potencia-partida/proposal.md):
-- Allow editing a lot's declared purity (potencia_declarada) from /partidas/[id].
-- Purity correction affects ONLY future preparations; past consumptions already took an
-- immutable snapshot (movimiento_stock.potencia_aplicada) and are unaffected.
--
-- 1. fsj_app grant: UPDATE (potencia_declarada) on fsj.partida.
-- 2. New permission: stock.partida.potencia.corregir (category 'gestion').
-- 3. Update fsj.plantilla_rol_permisos() for DIRECTOR_TECNICO.
-- 4. Grant permission to existing DIRECTOR_TECNICO roles.
--
-- Rollback: prisma/rollbacks/0111_corregir_potencia_partida.down.sql.

-- 1. Column update grant for fsj_app
GRANT UPDATE (potencia_declarada) ON fsj.partida TO fsj_app;

-- 2. Insert new permission
INSERT INTO fsj.permiso (codigo, categoria, descripcion)
VALUES ('stock.partida.potencia.corregir', 'gestion', 'Corregir la pureza (potencia) de una partida. Aplica solo a futuras preparaciones.')
ON CONFLICT (codigo) DO NOTHING;

-- 3. Update default role template (DIRECTOR_TECNICO gets stock.partida.potencia.corregir)
CREATE OR REPLACE FUNCTION fsj.plantilla_rol_permisos()
RETURNS TABLE (rol_codigo text, permiso_codigo text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT m.rol_codigo, c.permiso_codigo
  FROM (VALUES
    ('DIRECTOR_TECNICO', ARRAY[
      'archivo.destruccion.gestionar', 'archivo.lotes.gestionar', 'auditoria.ver',
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.firmar', 'cierres.folio.corregir', 'cierres.imprimir', 'cierres.reporte', 'cierres.ver',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'drogas.baja', 'drogas.crear', 'drogas.editar', 'drogas.reactivar',
      'entregas.registrar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'libro.anulacion.autorizar', 'libro.anulacion.solicitar', 'libro.exportar', 'libro.ver',
      'libros.cerrar', 'libros.crear',
      'medicos.gestionar', 'pacientes.gestionar', 'precios.reglas.editar',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'proveedores.gestionar',
      'recetas.anular', 'recetas.crear', 'recetas.editar',
      'reportes.ver',
      'stock.ajuste.autorizar', 'stock.ajuste.registrar', 'stock.partida.costo.corregir', 'stock.partida.ingresar',
      'stock.partida.potencia.corregir',
      'stock.valorizado.ver', 'stock.ver',
      'usuarios.auditoria.ver'
    ]),
    ('FARMACEUTICO', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.imprimir', 'cierres.reporte', 'cierres.ver',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'drogas.baja', 'drogas.crear', 'drogas.editar', 'drogas.reactivar',
      'entregas.registrar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'libro.anulacion.solicitar', 'libro.exportar', 'libro.ver',
      'medicos.gestionar', 'pacientes.gestionar',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'proveedores.gestionar',
      'recetas.anular', 'recetas.crear', 'recetas.editar',
      'reportes.ver',
      'stock.ajuste.registrar', 'stock.partida.ingresar', 'stock.valorizado.ver', 'stock.ver'
    ])
  ) AS m(rol_codigo, permisos)
  CROSS JOIN LATERAL unnest(m.permisos) AS c(permiso_codigo);
$$;

-- 4. Backfill to existing DIRECTOR_TECNICO roles
INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id)
SELECT r.tenant_id, r.id, p.id
FROM fsj.rol r
CROSS JOIN fsj.permiso p
WHERE r.codigo = 'DIRECTOR_TECNICO'
  AND p.codigo = 'stock.partida.potencia.corregir'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;
