# Design — planilla-existencia-inicial

Reuses the alta (`registrarPartidaCompra`), the window (`fsj.relevamiento_inicial_abierto`) and the close. Adds a draft
in front of them and a correction path behind them.

## Data model

### Migration 0124 (delivery 2)

| Object | Purpose |
|---|---|
| `fsj.relevamiento_fila` | The planilla. Tenant, droga?, lote?, fecha_vencimiento?, cantidad?, unidad?, potencia?, costo?, proveedor?, texto_droga? (import), creado_por, timestamps. `setup_tenant_table` (RLS enabled + forced). SELECT/INSERT/UPDATE/DELETE to `fsj_app`. Index on `(tenant_id, droga_id)` and `(tenant_id, proveedor_id)` |
| BEFORE INSERT/UPDATE trigger on it | Refuses when `fsj.relevamiento_inicial_abierto` is false. DELETE stays allowed, so leftovers can be cleared |
| `tipo_movimiento` + `CORRECCION_INICIAL_SUMA`, `CORRECCION_INICIAL_RESTA` | Referenced only inside plpgsql, so adding them in the same transaction is safe (same as 0100). `movimiento_stock_cantidad_check` needs `cantidad > 0`: the sign is in the tipo |
| `fsj.movimiento_stock_aplicar` | Sumas add, restas subtract, and both move `cantidad_inicial` by the same delta in the same UPDATE, so `partida_cantidad_disponible_check` holds |
| BEFORE INSERT trigger on `movimiento_stock` | For the two new tipos: partida of origen `EXISTENCIA_INICIAL`, relevamiento abierto, and for a RESTA on a controlled droga an `autorizado_por_id` that is a DT vigente |
| `fsj.partida_validar_update` | `cantidad_inicial` changes only with `fsj.mov = 'on'`. Today only the missing grant protects it |
| `partida_cantidad_inicial_check` | `cantidad_inicial > 0 OR origen = 'EXISTENCIA_INICIAL'`, so a partida can be taken to zero |
| `fsj.movimiento_stock_validar_contralor` | Exempts the two new tipos, like `INGRESO_INICIAL`. Copy the latest body |
| Permiso `stock.relevamiento.editar` | `plantilla_rol_permisos()`, granted to every role holding `stock.partida.ingresar`. Not PIN-configurable |

`partida_validar_ingreso_compra` (INV-S25) does **not** change. Its constraint trigger is `AFTER INSERT ON fsj.partida`:
it checks the partida's creation, and a later correction never reaches it. "Exactly one ingreso" stays literally true,
because a corrección is not an ingreso.

Copy the latest body of each function being replaced: `movimiento_stock_aplicar` and the ingreso validator were last
redefined in 0111, `partida_validar_update` in 0074, `movimiento_stock_validar_contralor` in 0100.

### Migration 0125 (delivery 3)

| Object | Purpose |
|---|---|
| `fsj.partida_corregir_datos_inicial(p_tenant_id, p_partida_id, p_lote, p_fecha_vencimiento, p_proveedor_id)` | `SECURITY DEFINER`, `SET search_path = fsj, extensions`, refuses `p_tenant_id IS DISTINCT FROM fsj.current_tenant_id()`. Checks origen, window and unused, under a row lock. Sets `fecha_vencimiento` and `fecha_vencimiento_vigente` with the transaction-local flag `fsj.correccion_inicial = 'on'` |
| `fsj.partida_validar_update` | INV-S23 admits the vencimiento change only with that flag |

A function and not column grants: lote, vencimiento and proveedor would otherwise become writable by `fsj_app` on every
partida, and the guards would all fall on a trigger. EXECUTE stays with `fsj_app` by default privileges, never PUBLIC.

### Why `cantidad_inicial` moves

`cantidad_disponible` is the saldo: a stored column moved by delta in `movimiento_stock_aplicar`. Nothing computes a
balance from `cantidad_inicial`; it is displayed, and read by the proveedor trayectoria. Freezing it would need
`disponible <= inicial` relaxed and would show "480 / 100". The immutable record of origin is the `INGRESO_INICIAL`
movement.

## Use cases (`modules/stock`)

| Use case | Permiso | Notes |
|---|---|---|
| `guardarFilaRelevamiento` | `stock.relevamiento.editar` | Upsert by client-generated id. Last save wins: it is a draft |
| `quitarFilaRelevamiento` | `stock.relevamiento.editar` | |
| `getPlanillaRelevamiento` | `stock.ver` | Rows with state, what passed, counters, Faltan cargar |
| `pasarGrupoAStock` | `stock.partida.ingresar` | One group per transaction, called in a loop by the action |
| `corregirCantidadInicial` | `stock.partida.ingresar` | `lockPartidaParaAccion`, fresh read, `deltaCorreccion`. Co-firma through `verificarCoFirmaDt` for a controlled RESTA, in the shape of `registrarAjusteStock` |
| `corregirDatosPartidaInicial` | `stock.partida.ingresar` | Calls the 0125 function |
| `importarPlanillaExcel` | `stock.relevamiento.editar` | `leer-xlsx.server.ts` and the row-state pattern of `importacion-lista.ts` |

Pure domain in `domain/existencia-inicial.ts`: `estadoFila`, `agruparFilas`, `conflictosGrupo`, `deltaCorreccion`.

`pasarGrupoAStock` locks the group's rows (`FOR UPDATE`), takes `lockTenantRelevamientoCompartido` so a close serializes
with it, and then:

1. Looks up the partida by droga + proveedor + lote.
2. None: `registrarPartidaCompra` with `origen: "EXISTENCIA_INICIAL"`.
3. Exists, origen `EXISTENCIA_INICIAL`, no conflict: lock it and insert a `CORRECCION_INICIAL_SUMA`, observación
   "Frasco adicional del relevamiento".
4. Exists, other origen, or conflict: throw; the rows stay with the reason.
5. Delete the rows, in that same transaction.

The Server Action wraps the loop in `conOperador` (one PIN per request) and handles up to 100 groups per press. Any
remaining groups stay in the planilla and the message states how many.

`registrarPartidaCompra`: the future-vencimiento check applies only to `origen === "COMPRA"`. The DB has never required
it (`trg_partida_validar_vencimiento` only refuses NULL for a `DROGA`).

The costo default is resolved at pass time, with the query behind `costoSugeridoExistenciaInicialAction`.

The close (`cerrar-relevamiento-inicial.ts`) gains `descartarFilas`; it counts rows under its existing `FOR UPDATE`.

## UI

- `app/(app)/partidas/partidas-tabs.tsx` over `SectionTabs`, rendered by each list page like `ClientesTabs`.
- `app/(app)/partidas/existencia-inicial/page.tsx`, stays under the `stock.ver` layout guard.
- `modules/stock/ui/planilla-existencia-inicial.tsx`: rows in a container-query grid that becomes cards at narrow widths
  (`@container`, no horizontal scroll at 375px); `agregarYEnfocar` + `data-fila`. Save on leaving a row.
- Below the planilla, the partidas already passed; each opens a correction `<dialog>` (remounted with `key={apertura}`)
  that offers cantidad and costo when used, plus lote, vencimiento and proveedor when unused. Costo uses the existing
  correction and its permiso.
- `relevamiento-inicial-panel.tsx`: loses `children`, moves to the tab, gains Faltan cargar, corrections and discard.
- `partidas/ingresar/page.tsx`: loses the panel.
- Banner next to the bajo mínimo one in `app/(app)/layout.tsx`, fed by a `resumenRelevamiento` query.

## Reads to revisit

Sign and tipo are inferred from these lists:

- `shared/labels/enum-labels.ts`, `app/(app)/reportes/kardex/page.tsx` (tones and the `tipo` filter),
  `app/api/stock/kardex/export/xlsx/route.ts`, `modules/stock/application/kardex-movimientos.ts`, `reporte-kardex.ts`,
  `modules/proveedores/domain/trayectoria.ts`.
- SQL views and functions filtering `movimiento_stock.tipo`.
- `contarExistenciaInicialPorDroga` should exclude anuladas; the label "envases" becomes "partidas".

## Risks

- Lowering a non-controlled droga needs no DT, so during the window a faltante could be booked as a correction. Accepted:
  it is onboarding, every correction is in the kardex and audited, and the DT sees the list before closing.
- `ALTER TYPE ... ADD VALUE` cannot be undone in a down migration without rebuilding the type. Handle it as the 0100
  rollback does.
- `/partidas` and the libro must not break on `cantidad_inicial = 0`.
- 0125 relaxes INV-S23, and 0124 touches the movement trigger: review by a different agent/vendor.
