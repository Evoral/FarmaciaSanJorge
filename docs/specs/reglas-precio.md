# SPEC — Reglas de precio: tramos de margen por costo y precio mínimo

> Fuente: decisión del usuario (2026-10-01). Reemplaza la regla de margen único de DP-09 (migración 0031). Los valores de los ejemplos son configurables por el administrador.
> Código: `modules/precios/domain/regla-precio.ts` (`calcularPrecioFinal`, `validarReglasPrecio`); esquema: migración `0052_regla_precio_tramos`.

## Fórmula

```
precioFinal = max(costo × (1 + margenTramo / 100), precioMinimo)
```

| Regla | Detalle |
|---|---|
| Costo | El costo de insumos de **una** preparación (un ítem / una cotización). Cada ítem se cotiza solo, también en el presupuesto de una receta con varios ítems: el tramo y el piso se aplican por ítem, nunca sobre el total de la receta. |
| Tramos | Lista ordenada. Cada tramo tiene un tope **inclusive** `costoHasta`; el límite inferior es el tope del tramo anterior (exclusive) y el primero empieza en 0 (inclusive). El último tramo no tiene tope (`costoHasta = null`). |
| Límite | «Más de X» es estrictamente mayor: un costo **igual** al tope de un tramo pertenece a ese tramo. |
| Margen | Se aplica sobre **todo** el costo, no de forma escalonada. |
| Precio mínimo | Ninguna preparación se cobra por debajo del precio mínimo. Se compara contra el precio del tramo, no contra el costo. 0 = sin piso. |

### Caída de precio en el límite (intencional)

Con «costo ≤ 100.000 → +100 %» y «costo > 100.000 → +70 %»: costo 100.000 → **200.000**; costo 100.001 → **170.001,70**. El precio baja al cruzar el límite. **Es lo que quiere el negocio**: no se corrige ni se suaviza.

### Ejemplos (piso 20.000, tramos del ejemplo anterior)

| Costo | Tramo | Precio del tramo | Precio final |
|---|---|---|---|
| 5.000 | +100 % | 10.000 | **20.000** (piso aplicado) |
| 10.000 | +100 % | 20.000 | 20.000 (igual al piso: no se marca como piso aplicado) |
| 15.000 | +100 % | 30.000 | 30.000 |
| 100.000 | +100 % | 200.000 | 200.000 |
| 100.001 | +70 % | 170.001,70 | 170.001,70 |
| 0 (todo enrase manual / sin stock) | +100 % | 0 | 20.000 (piso aplicado) |

## Validación (sin superposiciones ni huecos por construcción)

- Al menos un tramo.
- `costoHasta` > 0 y estrictamente creciente; solo el último tramo es `null`, y el último siempre lo es.
- Todo margen ≥ 0; precio mínimo ≥ 0.

Se valida en el dominio (`validarReglasPrecio`, mensajes por tramo en el formulario) y en la base: CHECKs, índice único `(regla, orden)`, índice parcial «un solo tramo sin tope por versión» y la verificación diferida **INV-PR-002** al confirmar la transacción.

## Modelo y versionado

- `regla_precio` sigue siendo la cabecera versionada (INV-PR-001): `precio_minimo` + sus tramos en `regla_precio_tramo` (por tenant, RLS, inmutable). Guardar cierra la versión vigente e inserta la nueva con sus tramos en una sola transacción. `cotizacion.regla_precio_id` sigue apuntando a la versión usada.
- `regla_precio.margen` queda **obsoleta** (nullable): las versiones nuevas la dejan en NULL.
- Migración de datos: cada versión existente (abierta o cerrada) pasa a tener un tramo sin tope con su margen y `precio_minimo = 0`, así que los precios no cambian hasta que el administrador guarde una versión nueva.
- `cotizacion.margen_aplicado` = margen del tramo usado; `cotizacion.precio_minimo_aplicado` indica si el piso subió el precio.

## Permisos

Se edita con `precios.reglas.editar` (sin cambios de asignación a roles). No hay, por ahora, ocultamiento del costo según permiso.

## Interfaz

`/admin/configuracion/precios`: precio mínimo + lista de tramos (agregar / quitar; la última fila es «sin tope»), historial de versiones con sus tramos. La cotización de un ítem muestra el margen del tramo aplicado y si se aplicó el precio mínimo.

## Casos de prueba

- **RP1** — Costo igual al tope de un tramo: usa ese tramo (100.000 → 200.000).
- **RP2** — Costo apenas mayor al tope: tramo siguiente sobre todo el costo (100.001 → 170.001,70).
- **RP3** — Precio del tramo menor al piso: se cobra el piso y se marca `precio_minimo_aplicado`.
- **RP4** — Precio del tramo mayor al piso: no se toca (15.000 → 30.000).
- **RP5** — Costo 0: precio = piso.
- **RP6** — Un solo tramo sin tope y piso 0: idéntico a la regla anterior.
- **RP7** — Rechazos: lista vacía, topes no crecientes, tramo sin tope que no es el último, último tramo con tope, margen o piso negativos.
- **RP8** — Dos ítems de una receta: cada uno se cotiza con su propio costo.
