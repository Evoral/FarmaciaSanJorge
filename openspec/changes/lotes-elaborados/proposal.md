# Propuesta — Lotes elaborados en la farmacia (diluciones y productos propios)

> **Estado:** propuesta aprobada para planificar (User decision 2026-10-29). No implementada.

## Por qué

1. **Dosis por debajo de la balanza.** Desde `35c3a22` la ficha guarda el activo exacto (0,15 mg). Con un lote puro y una
   balanza de 1 mg, la pesada real precargada se redondea a 0 y el servidor la rechaza. Quien prepara sabe resolverlo
   (dilución en el momento o un lote diluido); el sistema tiene que acompañarlo, no trabarlo.
2. **Diluciones con stock propio.** La farmacia prepara diluciones (por ejemplo, droga X al 1 % en lactosa) y las usa en
   varias recetas. Hoy no existen en el sistema: el lote puro, el excipiente y lo que sobra quedan fuera del stock.
3. **Productos que se compran o se elaboran.** Algunos productos (un jarabe simple, una base de crema) se compran
   hechos o se arman con materias primas. Cuando se elaboran, el stock de las materias primas no baja y el producto no
   entra.

## Qué hace

- **"Elaborar lote"**: consume partidas de materias primas y crea **una partida nueva** con `origen = ELABORACION_PROPIA`.
  - **Dilución**: el producto es la *misma* droga que el componente principal. Su `potencia_declarada` se calcula
    (activo / total). El motor de pureza ya existente (0058, R25, INV-S12) la usa sin cambios.
  - **Producto con fórmula**: el producto es otra droga, con una **fórmula guardada** (qué materias primas lleva y cuánto
    de cada una, por cantidad de referencia).
- La pestaña Partidas distingue los lotes elaborados ("Elaborado en farmacia" / "Dilución 1 %") y muestra de qué
  partidas salieron.
- **Costo del lote** (valorizado): costo real de las partidas consumidas dividido por la cantidad producida.
- **Precio** de un producto con fórmula y sin costo de proveedor: la fórmula multiplicada por los costos de proveedor de
  sus materias primas. Si a una le falta el costo, no hay precio (R27), y el mensaje nombra **la materia prima**.
- **Stock de una droga en dos cifras**: físico (lo que hay en los frascos) y activo (lo que rinde para las fichas).
- **Dosis por debajo de la balanza**: el sistema no limita. Precarga la cantidad exacta a descontar y ofrece usar un
  lote diluido de la droga o crear uno (decisión 6).

## Decisiones del usuario (2026-10-29)

1. Las diluciones y los productos propios se modelan como **partidas de una droga**, no como una categoría ni una droga
   aparte. La dilución es una partida de la misma droga con su potencia.
2. Los lotes elaborados no tienen proveedor: tienen su propia regla de unicidad de lote.
3. El stock muestra **físico y activo**. No es un bug, es información que falta.
4. **Sin costo de proveedor no hay precio**, igual que hoy para las drogas (R27). La carga de precios para la
   implementación inicial sin costos queda en la lista de tareas propia del usuario, fuera de este change.
5. La lógica (dominio, base, casos de uso) la implementa este agente. La UI la implementa otro agente, que elige el
   usuario, y este agente la revisa.
6. **D1 — Dosis bajo la balanza: decide quien prepara, el sistema no limita.** Cuando el peso físico esperado de una
   línea es menor que una división de la balanza, la pesada real se precarga con la cantidad **exacta** (no redondeada
   a 0) y la pantalla ofrece usar un lote diluido de la droga o crear uno. La tolerancia P3 sigue igual.
7. **D2 — Drogas controladas: sin límite.** La farmacia lleva hoy el contralor por fuera del sistema (ningún tenant lo
   tiene activado). Si se activa, INV-L08 va a exigir asientos para los movimientos de elaboración de drogas
   controladas: definirlos es parte de esa activación, no de este change.
8. **D3 — Libro recetario: no se asienta.** Solo se asienta lo que dice la receta.

## Decisiones tomadas en el diseño (el usuario puede revertirlas)

- Si una droga tiene **costo de proveedor y fórmula**, el precio sale del costo de proveedor (la regla de hoy). La
  fórmula solo se usa cuando no hay costo de proveedor.
- Fórmulas de **un solo nivel**: un componente no puede tener su propia fórmula (v1).
- Las alertas de stock mínimo comparan contra el **stock activo**.
- El vencimiento del lote elaborado es, por defecto, el del componente que vence antes. Se puede acortar y nunca
  alargar.

## Fuera de alcance

- UI (la hace otro agente; este change define los contratos de los casos de uso).
- Precios iniciales sin costos (lista de tareas del usuario).
- Fórmulas anidadas, versionado de fórmulas y rendimiento teórico distinto de 100 % como dato de la fórmula.

- Asientos del libro contralor para la elaboración de drogas controladas (cuando se active el contralor, decisión 7).
