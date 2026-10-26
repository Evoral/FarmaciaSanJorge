# Reglas de precio: tramos de margen por costo y precio mínimo

## Purpose

Cómo se calcula el precio final de una preparación a partir de su costo de insumos: tramos de margen por costo y
precio mínimo.

> Fuente: decisión del usuario (2026-10-01). Reemplaza la regla de margen único de DP-09 (migración 0031). Los valores de los ejemplos son configurables por el administrador.

## Requirements

### Requirement: Fórmula del precio final

El precio final de una preparación SHALL calcularse con:

```
precioFinal = max(costo × (1 + margenTramo / 100), precioMinimo)
```

#### Scenario: RP4 — Precio del tramo mayor al piso

- **GIVEN** piso 20.000 y el tramo «costo ≤ 100.000 → +100 %»
- **WHEN** se cotiza un costo de 15.000
- **THEN** el precio del tramo es 30.000 y el precio final es 30.000: no se toca

### Requirement: Costo de una preparación

El costo SHALL ser el costo de insumos de **una** preparación (un ítem / una cotización). Cada ítem se cotiza solo,
también en el presupuesto de una receta con varios ítems: el tramo y el piso se aplican por ítem, nunca sobre el
total de la receta.

#### Scenario: RP8 — Dos ítems de una receta

- **WHEN** se cotizan los dos ítems de una receta
- **THEN** cada uno se cotiza con su propio costo

### Requirement: Origen del costo por línea

El origen del costo SHALL decidirse **por línea**: si la droga tiene un costo de proveedor utilizable, la línea
cuesta toda su cantidad × ese costo (`openspec/specs/costos-proveedor/spec.md`, R25–R28); si no, cae al costo de las partidas en stock
(abiertas primero, luego FEFO, mezcla). El costo de insumos es la suma de las líneas, sea cual sea su origen, y el
tramo y el piso se aplican **una vez** sobre esa suma (R31).

#### Scenario: Ítem con líneas de los dos orígenes

- **GIVEN** un ítem con una droga que tiene un costo de proveedor utilizable y otra que no lo tiene
- **WHEN** se cotiza el ítem
- **THEN** la primera línea cuesta toda su cantidad × el costo de proveedor y la segunda se costea con las partidas en stock
- **AND** el tramo y el piso se aplican una vez sobre la suma de las dos líneas

### Requirement: Tramos

Los tramos SHALL formar una lista ordenada. Cada tramo tiene un tope **inclusive** `costoHasta`; el límite inferior
es el tope del tramo anterior (exclusive) y el primero empieza en 0 (inclusive). El último tramo no tiene tope
(`costoHasta = null`).

#### Scenario: Costo 0 en el primer tramo

- **GIVEN** los tramos «costo ≤ 100.000 → +100 %» y «costo > 100.000 → +70 %»
- **WHEN** se cotiza un costo de 0 (todo enrase manual / sin stock)
- **THEN** usa el tramo +100 %

#### Scenario: Costo por encima del último tope

- **GIVEN** los tramos «costo ≤ 100.000 → +100 %» y «costo > 100.000 → +70 %» (el último sin tope)
- **WHEN** se cotiza un costo de 100.001
- **THEN** usa el tramo +70 %

### Requirement: Límite de un tramo

«Más de X» SHALL ser estrictamente mayor: un costo **igual** al tope de un tramo pertenece a ese tramo.

#### Scenario: RP1 — Costo igual al tope de un tramo

- **GIVEN** los tramos «costo ≤ 100.000 → +100 %» y «costo > 100.000 → +70 %»
- **WHEN** se cotiza un costo de 100.000
- **THEN** usa ese tramo (+100 %): 100.000 → 200.000

#### Scenario: RP2 — Costo apenas mayor al tope

- **GIVEN** los tramos «costo ≤ 100.000 → +100 %» y «costo > 100.000 → +70 %»
- **WHEN** se cotiza un costo de 100.001
- **THEN** usa el tramo siguiente (+70 %) sobre todo el costo: 100.001 → 170.001,70

### Requirement: Margen sobre todo el costo

El margen SHALL aplicarse sobre **todo** el costo, no de forma escalonada.

#### Scenario: Costo en el segundo tramo

- **GIVEN** los tramos «costo ≤ 100.000 → +100 %» y «costo > 100.000 → +70 %»
- **WHEN** se cotiza un costo de 100.001
- **THEN** el precio del tramo es 170.001,70: el +70 % se aplica a los 100.001

### Requirement: Caída de precio en el límite (intencional)

Con «costo ≤ 100.000 → +100 %» y «costo > 100.000 → +70 %»: costo 100.000 → **200.000**; costo 100.001 →
**170.001,70**. El precio baja al cruzar el límite. **Es lo que quiere el negocio**: la caída MUST NOT corregirse ni
suavizarse.

#### Scenario: El precio baja al cruzar el límite

- **GIVEN** «costo ≤ 100.000 → +100 %» y «costo > 100.000 → +70 %»
- **WHEN** se cotizan un costo de 100.000 y uno de 100.001
- **THEN** el costo 100.000 da **200.000** y el costo 100.001 da **170.001,70**
- **AND** no se corrige ni se suaviza

### Requirement: Precio mínimo

Ninguna preparación SHALL cobrarse por debajo del precio mínimo. Se compara contra el precio del tramo, no contra el
costo. 0 = sin piso.

#### Scenario: RP3 — Precio del tramo menor al piso

- **GIVEN** piso 20.000 y el tramo «costo ≤ 100.000 → +100 %»
- **WHEN** se cotiza un costo de 5.000
- **THEN** el precio del tramo es 10.000 y se cobra el piso: precio final **20.000**
- **AND** se marca `precio_minimo_aplicado`

#### Scenario: Precio del tramo igual al piso

- **GIVEN** piso 20.000 y el tramo «costo ≤ 100.000 → +100 %»
- **WHEN** se cotiza un costo de 10.000
- **THEN** el precio del tramo es 20.000 y el precio final 20.000
- **AND** no se marca como piso aplicado

#### Scenario: RP5 — Costo 0

- **GIVEN** piso 20.000 y el tramo «costo ≤ 100.000 → +100 %»
- **WHEN** se cotiza un costo de 0 (todo enrase manual / sin stock)
- **THEN** el precio del tramo es 0 y el precio final es el piso, 20.000 (piso aplicado)

### Requirement: Validación de los tramos

Una regla de precio SHALL cumplir, sin superposiciones ni huecos por construcción: al menos un tramo;
`costoHasta` > 0 y estrictamente creciente; solo el último tramo es `null`, y el último siempre lo es; todo margen
≥ 0; precio mínimo ≥ 0.

#### Scenario: RP7 — Rechazos

- **WHEN** se guarda una lista de tramos vacía, con topes no crecientes, con un tramo sin tope que no es el último, con el último tramo con tope, o con un margen o un piso negativos
- **THEN** se rechaza

### Requirement: Validación en el dominio y en la base

La validación SHALL hacerse en el dominio (`validarReglasPrecio`, mensajes por tramo en el formulario) y en la base:
CHECKs, índice único `(regla, orden)`, índice parcial «un solo tramo sin tope por versión» y la verificación diferida
**INV-PR-002** al confirmar la transacción.

#### Scenario: Tope no creciente en el formulario

- **WHEN** el administrador guarda un tramo cuyo tope no es mayor que el del tramo anterior
- **THEN** el formulario muestra el mensaje indicando ese tramo

### Requirement: Versionado (INV-PR-001)

`regla_precio` SHALL seguir siendo la cabecera versionada (INV-PR-001): `precio_minimo` + sus tramos en
`regla_precio_tramo` (por tenant, RLS, inmutable). Guardar cierra la versión vigente e inserta la nueva con sus
tramos en una sola transacción. `cotizacion.regla_precio_id` sigue apuntando a la versión usada.

#### Scenario: Guardar una versión nueva

- **GIVEN** una versión vigente usada por una cotización
- **WHEN** el administrador guarda una versión nueva
- **THEN** la vigente se cierra y la nueva se inserta con sus tramos en una sola transacción
- **AND** la cotización sigue apuntando a la versión que usó

### Requirement: Margen de la cabecera obsoleto

`regla_precio.margen` SHALL quedar **obsoleta** (nullable): las versiones nuevas la dejan en NULL.

#### Scenario: Versión nueva

- **WHEN** se guarda una versión nueva
- **THEN** su `regla_precio.margen` queda en NULL

### Requirement: Migración de datos

Cada versión existente (abierta o cerrada) SHALL pasar a tener un tramo sin tope con su margen y
`precio_minimo = 0`, así que los precios no cambian hasta que el administrador guarde una versión nueva.

#### Scenario: Versión anterior a los tramos

- **GIVEN** una versión existente con un margen único
- **WHEN** se aplica la migración
- **THEN** tiene un solo tramo sin tope con ese margen y `precio_minimo = 0`

#### Scenario: RP6 — Un solo tramo sin tope y piso 0

- **GIVEN** una regla con un solo tramo sin tope y piso 0
- **WHEN** se cotiza
- **THEN** el resultado es idéntico al de la regla anterior

### Requirement: Datos aplicados en la cotización

`cotizacion.margen_aplicado` SHALL ser el margen del tramo usado; `cotizacion.precio_minimo_aplicado` indica si el
piso subió el precio.

#### Scenario: Cotización con piso aplicado

- **GIVEN** piso 20.000 y el tramo «costo ≤ 100.000 → +100 %»
- **WHEN** se cotiza un costo de 5.000
- **THEN** `cotizacion.margen_aplicado` es el margen de ese tramo (100) y `cotizacion.precio_minimo_aplicado` indica que el piso subió el precio

### Requirement: Permiso de edición

La regla de precio SHALL editarse con `precios.reglas.editar` (sin cambios de asignación a roles). No hay, por
ahora, ocultamiento del costo según permiso.

#### Scenario: Usuario sin el permiso

- **GIVEN** un usuario sin `precios.reglas.editar`
- **WHEN** intenta guardar una regla de precio
- **THEN** se rechaza

### Requirement: Interfaz

`/admin/configuracion/precios` SHALL mostrar el precio mínimo + lista de tramos (agregar / quitar; la última fila es
«sin tope») y el historial de versiones con sus tramos. La cotización de un ítem MUST mostrar el margen del tramo
aplicado y si se aplicó el precio mínimo.

#### Scenario: Pantalla de configuración

- **WHEN** el administrador abre `/admin/configuracion/precios`
- **THEN** ve el precio mínimo, la lista de tramos con la última fila «sin tope» y el historial de versiones con sus tramos

#### Scenario: Cotización de un ítem

- **WHEN** se muestra la cotización de un ítem
- **THEN** muestra el margen del tramo aplicado y si se aplicó el precio mínimo

## Código

> Código: `modules/precios/domain/regla-precio.ts` (`calcularPrecioFinal`, `validarReglasPrecio`); esquema: migración `0052_regla_precio_tramos`.
