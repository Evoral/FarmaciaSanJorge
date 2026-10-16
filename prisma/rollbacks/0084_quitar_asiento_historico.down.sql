-- Rollback of 0084_quitar_asiento_historico. Apply as a NEW forward migration, AFTER deploying the code that brings
-- the asientos históricos back (docs/rollbacks/quitar-asiento-historico.md). It recreates the table EMPTY: the rows
-- dropped by 0084 do not come back. The permiso is re-created and granted to every tenant's DIRECTOR_TECNICO role
-- (the 0002/0054 default); roles an administrator customized must be adjusted by hand.

-- Table (0014), its canonical-number CHECK and unique folio (0035), and INV-U07 (0023).
CREATE TABLE IF NOT EXISTS fsj.asiento_historico (
  id                      uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  tipo_libro              fsj.tipo_libro NOT NULL,
  numero_asiento_fisico   text NOT NULL,   -- copies the physical book's own numbering, as text
  fecha_asiento           date NOT NULL,
  paciente_texto          text,
  medico_texto            text,
  formula_texto           text NOT NULL,
  observaciones           text,
  digitalizado_por_id     uuid NOT NULL,
  digitalizado_en         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT asiento_historico_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT asiento_historico_digitalizado_por_fkey FOREIGN KEY (tenant_id, digitalizado_por_id) REFERENCES fsj.usuario (tenant_id, id)
);

COMMENT ON TABLE fsj.asiento_historico IS
  'DP-17, spec section 2: digitized entries from the PHYSICAL book, for reference only. Does NOT consume fsj.contador_correlativo, does NOT enter any hash chain, does NOT link to fsj.cierre_diario, does NOT generate movimiento_stock. Immutable (no UPDATE/DELETE grant, trigger below).';

SELECT fsj.setup_tenant_table('fsj.asiento_historico');

REVOKE UPDATE, DELETE, TRUNCATE ON fsj.asiento_historico FROM fsj_app;

CREATE TRIGGER trg_asiento_historico_forbid_update_delete
  BEFORE UPDATE OR DELETE ON fsj.asiento_historico
  FOR EACH ROW EXECUTE FUNCTION fsj.forbid_update_delete();

ALTER TABLE fsj.asiento_historico
  ADD CONSTRAINT asiento_historico_numero_fisico_canonico_check
  CHECK (numero_asiento_fisico = btrim(numero_asiento_fisico) AND numero_asiento_fisico <> '' AND numero_asiento_fisico !~ '^0[0-9]');
ALTER TABLE fsj.asiento_historico
  ADD CONSTRAINT asiento_historico_fisico_unico UNIQUE (tenant_id, tipo_libro, numero_asiento_fisico);

CREATE TRIGGER trg_asiento_historico_zz_inv_u07_insert
  BEFORE INSERT ON fsj.asiento_historico
  FOR EACH ROW EXECUTE FUNCTION fsj.assert_actor_activo('digitalizado_por_id');

-- Permiso (0054 description) and its default grant.
INSERT INTO fsj.permiso (codigo, descripcion, categoria) VALUES ('libro.historico.digitalizar', 'Digitalizar libros históricos', 'operativo')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO fsj.rol_permiso (tenant_id, rol_id, permiso_id)
SELECT r.tenant_id, r.id, p.id
FROM fsj.rol r
JOIN fsj.permiso p ON p.codigo = 'libro.historico.digitalizar'
WHERE r.codigo = 'DIRECTOR_TECNICO'
ON CONFLICT DO NOTHING;

-- Default role template (0077's body, unchanged).
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
      'entregas.firma.confirmar', 'entregas.registrar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'libro.anulacion.autorizar', 'libro.anulacion.solicitar', 'libro.exportar', 'libro.historico.digitalizar', 'libro.ver',
      'libros.cerrar', 'libros.crear',
      'medicos.gestionar', 'pacientes.gestionar', 'precios.reglas.editar',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'proveedores.gestionar',
      'recetas.anular', 'recetas.crear', 'recetas.editar',
      'reportes.ver',
      'stock.ajuste.autorizar', 'stock.ajuste.registrar', 'stock.partida.costo.corregir', 'stock.partida.ingresar',
      'stock.valorizado.ver', 'stock.ver',
      'usuarios.auditoria.ver'
    ]),
    ('FARMACEUTICO', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.imprimir', 'cierres.reporte', 'cierres.ver',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'drogas.baja', 'drogas.crear', 'drogas.editar', 'drogas.reactivar',
      'entregas.firma.confirmar', 'entregas.registrar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'libro.anulacion.solicitar', 'libro.exportar', 'libro.ver',
      'medicos.gestionar', 'pacientes.gestionar',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'proveedores.gestionar',
      'recetas.anular', 'recetas.crear', 'recetas.editar',
      'reportes.ver',
      'stock.ajuste.registrar', 'stock.partida.ingresar', 'stock.valorizado.ver', 'stock.ver'
    ]),
    ('LABORATORIO', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cotizaciones.ver',
      'drogas.crear', 'drogas.editar',
      'etiquetas.generar', 'etiquetas.imprimir',
      'fichas.generar', 'fichas.imprimir',
      'preparaciones.confirmar', 'preparaciones.descartar', 'preparaciones.iniciar',
      'recetas.crear', 'recetas.editar',
      'stock.ajuste.registrar', 'stock.partida.ingresar', 'stock.ver'
    ]),
    ('ATENCION_PUBLICO', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cotizaciones.calcular', 'cotizaciones.ver',
      'entregas.firma.confirmar', 'entregas.registrar',
      'medicos.gestionar', 'pacientes.gestionar',
      'recetas.crear', 'recetas.editar',
      'stock.ver'
    ]),
    ('SOLO_CONSULTA', ARRAY[
      'auth.login', 'auth.logout', 'auth.password.cambiar',
      'cierres.reporte', 'cierres.ver',
      'libro.exportar', 'libro.ver',
      'reportes.ver',
      'stock.ver'
    ])
  ) AS m(rol_codigo, permisos)
  CROSS JOIN LATERAL unnest(m.permisos) AS c(permiso_codigo)
$$;
