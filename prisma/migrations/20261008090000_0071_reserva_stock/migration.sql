-- 0071_reserva_stock
--
-- docs/specs/reserva-stock-preparacion.md. The libro recetario is now written
-- when the etiqueta is printed (end of the lab's process), not when the
-- partidas are chosen. In between, the chosen stock is RESERVED for the
-- preparación (INICIADA): no movimiento_stock, no asiento, but nobody else can
-- draw from it.
--
-- ADDITIVE: one new tenant-scoped table + v_stock_droga subtracts reservas.
-- INV-P04, INV-L08 and INV-L01 are untouched: the confirmation (stock
-- movements, asiento_recetario, asiento_contralor) still runs in ONE
-- transaction, the same code as before -- it only moved to "Imprimir
-- etiqueta".
--
--   - fsj.reserva_stock: one row per (preparación, línea de pesaje, CHOSEN
--     partida). cantidad = what the system's split takes from that partida
--     (physical units; 0 = chosen but not needed by the split -- the row keeps
--     the farmacéutico's choice, which the confirmation re-validates).
--     cantidad_manual (enrase manual líneas) and motivo_apertura_adicional
--     (INV-S18) belong to the línea and are repeated on each of its rows (one
--     table instead of a per-línea one; the app writes them together).
--     Composite FKs to preparacion / linea_pesaje / partida / usuario.
--   - A reserva only counts while its preparación is INICIADA: every
--     availability read joins fsj.preparacion and filters on it, so a leftover
--     row of a CONFIRMADA/DESCARTADA preparación never blocks stock (the app
--     deletes them in the same transaction anyway).
--   - fsj.setup_tenant_table: RLS (enabled + forced) + tenant_isolation policy
--     (INV-T01) + forbid_tenant_id_change (INV-T03).
--   - Grants: SELECT/INSERT via ALTER DEFAULT PRIVILEGES (migration 0000) +
--     DELETE (reservas are released or consumed). No UPDATE: a reserva is
--     never edited, only replaced.
--   - fsj.v_stock_droga: stock_disponible = per non-expired partida,
--     greatest(cantidad_disponible - reserved by INICIADA preparaciones, 0).
--     The physical balance (partida.cantidad_disponible) does not change.
--
-- Numbering: 0070 (20261007210000_0070_receta_domicilio_paciente) is the
-- highest at the time of writing -- re-check before applying.
--
-- *** APPLY 0071 BEFORE DEPLOYING THE CODE THAT USES IT. ***
-- Rollback: prisma/rollbacks/0071_reserva_stock.down.sql (as a NEW forward
-- migration).

CREATE TABLE IF NOT EXISTS fsj.reserva_stock (
  id                         uuid        NOT NULL DEFAULT extensions.gen_random_uuid(),
  tenant_id                  uuid        NOT NULL,
  preparacion_id             uuid        NOT NULL,
  linea_pesaje_id            uuid        NOT NULL,
  partida_id                 uuid        NOT NULL,
  cantidad                   numeric     NOT NULL,
  cantidad_manual            numeric,
  motivo_apertura_adicional  text,
  reservada_por_id           uuid        NOT NULL,
  reservada_en               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT reserva_stock_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT reserva_stock_preparacion_linea_partida_key UNIQUE (tenant_id, preparacion_id, linea_pesaje_id, partida_id),
  CONSTRAINT reserva_stock_preparacion_fkey FOREIGN KEY (tenant_id, preparacion_id) REFERENCES fsj.preparacion (tenant_id, id),
  CONSTRAINT reserva_stock_linea_pesaje_fkey FOREIGN KEY (tenant_id, linea_pesaje_id) REFERENCES fsj.linea_pesaje (tenant_id, id),
  CONSTRAINT reserva_stock_partida_fkey FOREIGN KEY (tenant_id, partida_id) REFERENCES fsj.partida (tenant_id, id),
  CONSTRAINT reserva_stock_reservada_por_fkey FOREIGN KEY (tenant_id, reservada_por_id) REFERENCES fsj.usuario (tenant_id, id),
  CONSTRAINT reserva_stock_cantidad_check CHECK (cantidad >= 0),
  CONSTRAINT reserva_stock_cantidad_manual_check CHECK (cantidad_manual IS NULL OR cantidad_manual > 0),
  CONSTRAINT reserva_stock_motivo_check CHECK (motivo_apertura_adicional IS NULL OR length(btrim(motivo_apertura_adicional)) > 0)
);

-- Availability reads sum the reservas of a partida; the app reads/deletes by preparación.
CREATE INDEX IF NOT EXISTS idx_reserva_stock_partida ON fsj.reserva_stock (tenant_id, partida_id);
CREATE INDEX IF NOT EXISTS idx_reserva_stock_preparacion ON fsj.reserva_stock (tenant_id, preparacion_id);

COMMENT ON TABLE fsj.reserva_stock IS
  '0071. Stock reserved for a preparación INICIADA (docs/specs/reserva-stock-preparacion.md): one row per chosen partida of each línea de pesaje. Only counts while the preparación is INICIADA. Consumed (deleted) by the confirmation at "Imprimir etiqueta", released (deleted) when the preparación is discarded. fsj_app: SELECT/INSERT/DELETE, no UPDATE.';
COMMENT ON COLUMN fsj.reserva_stock.cantidad IS
  '0071. Physical quantity the system''s split takes from this partida (unidad base of the droga); 0 = chosen but not needed by the split.';
COMMENT ON COLUMN fsj.reserva_stock.cantidad_manual IS
  '0071. Enrase manual líneas only: the quantity the farmacéutico registered (same value on every row of the línea).';
COMMENT ON COLUMN fsj.reserva_stock.motivo_apertura_adicional IS
  '0071. INV-S18 motivo for the línea, when given (same value on every row of the línea).';

SELECT fsj.setup_tenant_table('fsj.reserva_stock');

GRANT DELETE ON fsj.reserva_stock TO fsj_app;

-- ============================================================================
-- v_stock_droga: reserved stock is not disponible
-- ============================================================================
CREATE OR REPLACE VIEW fsj.v_stock_droga
WITH (security_invoker = true) AS
SELECT
  d.tenant_id,
  d.id AS droga_id,
  coalesce(
    sum(greatest(p.cantidad_disponible - r.reservado, 0))
      FILTER (WHERE p.fecha_vencimiento IS NULL OR p.fecha_vencimiento >= fsj.jornada_actual(d.tenant_id)),
    0
  ) AS stock_disponible
FROM fsj.droga d
LEFT JOIN fsj.partida p ON p.tenant_id = d.tenant_id AND p.droga_id = d.id
LEFT JOIN LATERAL (
  SELECT coalesce(sum(rs.cantidad), 0) AS reservado
  FROM fsj.reserva_stock rs
  JOIN fsj.preparacion rp ON rp.tenant_id = rs.tenant_id AND rp.id = rs.preparacion_id
  WHERE rs.tenant_id = p.tenant_id AND rs.partida_id = p.id AND rp.estado = 'INICIADA'
) r ON true
GROUP BY d.tenant_id, d.id;

COMMENT ON VIEW fsj.v_stock_droga IS
  'M06/M07. stock_disponible = SUM over non-expired partidas (fecha_vencimiento NULL -- does not expire, 0064 -- or >= fsj.jornada_actual(tenant_id), 0025) of cantidad_disponible minus the stock reserved by INICIADA preparaciones (fsj.reserva_stock, 0071), never below 0 per partida. Do not sum in the application when this view exists (plan §9 M07 "NO HACER").';
