# Anular una entrega registrada por error

## Purpose

En el mostrador alguien puede registrar el retiro o el envío de la receta equivocada al elegir otro nombre. Esta funcionalidad permite revertir la entrega registrada por error: la receta vuelve a "todavía no entregada" (`PREPARADA`), reaparece en `/entregas` y se entrega la correcta normalmente. Si también se marcó pagada por error, se puede dejar impaga en el mismo acto (decisión del usuario, 2026-10-17).

## Requirements

### Requirement: A1 — Desde qué estado
La anulación de una entrega solo SHALL permitirse para una receta en estado `ENTREGADA` o `ENVIADA_PEND_FIRMA`. Al anular la entrega, el estado de la receta SHALL volver a `PREPARADA` (la única transición hacia atrás de INV-R08), volviendo a quedar disponible para entrega en `/entregas`.

#### Scenario: Anular entrega de receta ENTREGADA
- **GIVEN** una receta en estado `ENTREGADA`
- **WHEN** el usuario anula la entrega
- **THEN** la receta vuelve al estado `PREPARADA`
- **AND** la receta aparece nuevamente disponible en `/entregas`

#### Scenario: Anular entrega de receta ENVIADA_PEND_FIRMA
- **GIVEN** una receta en estado `ENVIADA_PEND_FIRMA`
- **WHEN** el usuario anula la entrega
- **THEN** la receta vuelve al estado `PREPARADA`
- **AND** la receta aparece nuevamente disponible en `/entregas`

#### Scenario: Rechazo en otro estado
- **GIVEN** una receta en un estado distinto de `ENTREGADA` y `ENVIADA_PEND_FIRMA`
- **WHEN** se intenta anular la entrega
- **THEN** la acción no se permite

### Requirement: A2 — Permiso, operador y motivo
Para anular una entrega, el usuario SHALL contar con el permiso `entregas.registrar`. En una cuenta de sector, la acción SHALL requerir la identificación del operador (`conOperador`). El motivo de la anulación SHALL ser obligatorio. La anulación SHALL ejecutarse sin requerir re-autenticación ni co-firma.

#### Scenario: Anulación exitosa con motivo
- **GIVEN** un usuario con permiso `entregas.registrar`
- **WHEN** anula la entrega ingresando un motivo obligatorio
- **THEN** la entrega se anula sin requerir re-autenticación ni co-firma

#### Scenario: Anulación sin motivo
- **GIVEN** un usuario con permiso `entregas.registrar`
- **WHEN** intenta anular la entrega sin ingresar un motivo
- **THEN** la acción es rechazada exigiendo el motivo obligatorio

#### Scenario: Anulación en cuenta de sector
- **GIVEN** una sesión en una cuenta de sector
- **WHEN** se ejecuta la anulación de entrega
- **THEN** la acción solicita la identificación del operador antes de ejecutarse

#### Scenario: Usuario sin permiso
- **GIVEN** un usuario sin el permiso `entregas.registrar`
- **WHEN** intenta anular la entrega
- **THEN** la acción es rechazada por falta de autorización

### Requirement: A3 — Casos de rechazo
La anulación de la entrega SHALL ser rechazada si la receta ya se encuentra en un lote de archivo. Asimismo, la anulación SHALL ser rechazada si todos los ítems de la receta quedaron sin efecto en el libro recetario, impidiendo que vuelva a `PREPARADA` sin nada que entregar.

#### Scenario: Receta archivada
- **GIVEN** una receta asignada a un lote de archivo
- **WHEN** se intenta anular su entrega
- **THEN** la acción es rechazada

#### Scenario: Todos los ítems sin efecto en el libro
- **GIVEN** una receta cuyos ítems quedaron todos sin efecto en el libro recetario
- **WHEN** se intenta anular su entrega
- **THEN** la acción es rechazada porque no habría nada que entregar

### Requirement: A4 — Preservación de la entrega y borrado condicional
Al anular una entrega, los datos de `fsj.entrega` SHALL copiarse a `fsj.entrega_anulada` (modalidad, quién y cuándo entregó, firma, motivo, quién y cuándo anuló) y borrarse de `fsj.entrega` para conservar a lo sumo una entrega vigente. Según INV-ENT-004, una fila de `fsj.entrega` solo SHALL borrarse si su copia en `fsj.entrega_anulada` ya existe.

#### Scenario: Copia a entrega anulada y borrado de la entrega vigente
- **GIVEN** una receta con una fila en `fsj.entrega`
- **WHEN** se confirma la anulación de la entrega
- **THEN** se inserta la fila correspondiente en `fsj.entrega_anulada` registrando modalidad, entrega, firma, motivo y anulación
- **AND** se borra la fila original de `fsj.entrega`

#### Scenario: INV-ENT-004 garantía de copia previa
- **GIVEN** una fila en `fsj.entrega`
- **WHEN** se procede a borrarla durante la anulación
- **THEN** la base de datos asegura que la fila solo se elimine si su copia en `fsj.entrega_anulada` ya fue insertada

### Requirement: A5 — Orden de operaciones en la transacción
La anulación SHALL ejecutarse en una única transacción respetando el siguiente orden: bloqueo (lock) de la receta, copia y borrado de la fila de entrega, actualización del estado de la receta a `PREPARADA` y, de forma opcional, cambio del pago a impaga (el pago se actualiza con posterioridad al cambio de estado porque INV-R14 no permite desmarcar el pago de una receta `ENTREGADA`).

#### Scenario: Secuencia transaccional de anulación
- **GIVEN** una receta entregada con bloqueo exclusivo en la transacción
- **WHEN** se procesa la anulación
- **THEN** primero se copia y elimina la entrega
- **AND** luego se pasa la receta a `PREPARADA`
- **AND** finalmente se actualiza el pago a impaga si fue solicitado

### Requirement: A6 — Ajuste del pago al anular
El formulario de anulación SHALL mostrar el switch "Pagada", encendido si la receta está pagada. Apagar el switch SHALL dejar la receta impaga (auditado en la receta con origen `anular-entrega`). La acción solo SHALL permitir bajar el pago, nunca subirlo. Tras anular, la receta `PREPARADA` SHALL poder cambiar su pago desde el detalle según la regla P6 de pago-receta.

#### Scenario: Desmarcar pago al anular
- **GIVEN** una receta entregada y pagada
- **WHEN** se anula la entrega apagando el switch "Pagada"
- **THEN** la receta pasa a `PREPARADA` e impaga
- **AND** se audita la modificación del pago en la receta con origen `anular-entrega`

#### Scenario: Mantener receta pagada al anular
- **GIVEN** una receta entregada y pagada
- **WHEN** se anula la entrega manteniendo encendido el switch "Pagada"
- **THEN** la receta pasa a `PREPARADA` conservando su estado de pagada

#### Scenario: Receta impaga no permite marcar pagada
- **GIVEN** una receta entregada e impaga
- **WHEN** se abre el formulario de anulación
- **THEN** la acción no permite marcar la receta como pagada

### Requirement: A7 — Componentes no afectados
La anulación de una entrega SHALL NOT modificar los asientos del libro recetario (cuyo registro corresponde a la preparación), ni los movimientos o saldos de stock, ni las etiquetas de los preparados.

#### Scenario: Invariabilidad de libro, stock y etiquetas
- **GIVEN** una receta entregada con asientos en el libro recetario, stock descontado y etiquetas generadas
- **WHEN** se anula la entrega
- **THEN** los asientos del libro permanecen intactos
- **AND** el stock no sufre movimientos ni reintegros
- **AND** las etiquetas no se alteran

### Requirement: A8 — Auditoría de anulación
La anulación de una entrega SHALL registrar un evento de auditoría con acción `ANULAR` sobre la entidad `entrega` (asociado al ID de la entrega borrada), con el motivo, el estado anterior de la receta, la modalidad de entrega y el estado del pago antes y después de la operación.

#### Scenario: Registro de auditoría ANULAR
- **GIVEN** una receta entregada que se anula con un motivo especificado
- **WHEN** concluye la transacción de anulación
- **THEN** se registra una auditoría `ANULAR` sobre la entidad `entrega` con el ID eliminado
- **AND** el registro incluye motivo, estado anterior, modalidad y pago antes y después

### Requirement: A9 — Acción de anulación en el panel de entrega
En la página `/recetas/[id]`, el panel "Entrega" SHALL mostrar la acción "Anular entrega" (formulario con motivo y switch de pago) a usuarios con permiso `entregas.registrar`, mientras la receta se encuentre en estado `ENTREGADA` o `ENVIADA_PEND_FIRMA` y no esté archivada. Dicha acción SHALL presentarse con un botón secundario y panel neutro por tratarse de una corrección simple.

#### Scenario: Visualización de la acción de anular entrega
- **GIVEN** una receta en estado `ENTREGADA` o `ENVIADA_PEND_FIRMA` no archivada
- **WHEN** un usuario con permiso `entregas.registrar` accede a `/recetas/[id]`
- **THEN** el panel "Entrega" presenta el botón secundario "Anular entrega"

#### Scenario: Ocultamiento ante receta archivada
- **GIVEN** una receta entregada que ha sido archivada en un lote
- **WHEN** un usuario con permiso `entregas.registrar` accede a `/recetas/[id]`
- **THEN** la acción "Anular entrega" no se muestra

### Requirement: A9 — Visualización del panel de anulación de receta
Mientras la receta tenga una entrega vigente (`ENTREGADA` o `ENVIADA_PEND_FIRMA`), el panel "Anulación" de la receta SHALL permanecer oculto. Dicho panel SHALL volver a mostrarse en `/recetas/[id]` cuando la receta retorne al estado `PREPARADA` tras anular la entrega.

#### Scenario: Ocultamiento del panel de anulación con entrega vigente
- **GIVEN** una receta con entrega registrada en estado `ENTREGADA` o `ENVIADA_PEND_FIRMA`
- **WHEN** el usuario visualiza el detalle de la receta en `/recetas/[id]`
- **THEN** el panel "Anulación" de la receta no se muestra

#### Scenario: Reaparición del panel de anulación al volver a PREPARADA
- **GIVEN** una receta cuya entrega acaba de ser anulada volviendo a `PREPARADA`
- **WHEN** el usuario visualiza `/recetas/[id]`
- **THEN** el panel "Anulación" de la receta se muestra nuevamente

### Requirement: A10 — Preservación del repartidor en entrega anulada
Al copiar una entrega a `fsj.entrega_anulada`, la columna `repartidor_id` SHALL copiarse como historial sin clave foránea. Si la entrega anulada fue un retiro o un envío previo a la migración 0093, el campo SHALL quedar en `NULL`. Si la receta vuelve a entregarse como envío, el repartidor SHALL elegirse nuevamente; si se entrega como retiro presencial, no SHALL asignarse repartidor.

#### Scenario: Anulación de envío con repartidor asignado
- **GIVEN** una entrega bajo modalidad envío con `repartidor_id` asignado
- **WHEN** se anula la entrega
- **THEN** la fila copiada en `fsj.entrega_anulada` preserva dicho `repartidor_id` sin clave foránea

#### Scenario: Anulación de retiro o envío histórico
- **GIVEN** una entrega correspondiente a retiro presencial o a un envío anterior a la migración 0093
- **WHEN** se anula la entrega
- **THEN** la fila en `fsj.entrega_anulada` registra `repartidor_id` en `NULL`

#### Scenario: Nueva entrega tras la anulación
- **GIVEN** una receta devuelta a `PREPARADA` por anulación de entrega previa
- **WHEN** se registra una nueva entrega
- **THEN** si es un envío se debe seleccionar un nuevo repartidor
- **AND** si es un retiro presencial no lleva repartidor

## Reglas

| # | Regla | Dónde |
|---|---|---|
| A1 | **Desde qué estado.** Solo una receta `ENTREGADA` o `ENVIADA_PEND_FIRMA`. Vuelve a `PREPARADA` (la única transición hacia atrás de INV-R08). | `puedeAnularEntrega` (`modules/entregas/domain/entrega.ts`); BD: `fsj.receta_validar_transicion_estado` (migración 0086). |
| A2 | **Quién.** El mismo permiso que registra la entrega, `entregas.registrar` (el mostrador). En una cuenta de sector la acción pide el operador (`conOperador`). Motivo obligatorio. Sin re-autenticación ni co-firma: es la corrección de un error de mostrador, no un acto del libro. | `anularEntregaCommand` (`modules/entregas/application/anular-entrega.ts`), `anularEntregaAction`. |
| A3 | **Cuándo se rechaza.** (a) La receta ya está en un lote de archivo. (b) Todos sus ítems quedaron sin efecto en el libro: volvería a `PREPARADA` sin nada que entregar. | `validarAnularEntrega`; (a) también en la BD (INV-R08, 0086). |
| A4 | **La entrega no se pierde.** La fila de `fsj.entrega` se copia a `fsj.entrega_anulada` (solo inserción: modalidad, quién y cuándo entregó, firma, más motivo, quién y cuándo anuló) y se borra de `fsj.entrega`. Así una receta sigue teniendo a lo sumo una entrega vigente y la nueva se registra con el flujo normal. **INV-ENT-004 (nuevo):** una fila de `fsj.entrega` solo se borra si su copia en `entrega_anulada` ya existe. | `moverEntregaAAnuladas` (`entrega-repository.ts`); migración 0086. |
| A5 | **Orden en la transacción.** Lock de la receta → copiar y borrar la entrega → receta a `PREPARADA` → (opcional) pago a impaga. El pago va después del cambio de estado porque INV-R14 no deja bajar el pago de una receta `ENTREGADA`. | `anularEntregaCommand`. |
| A6 | **Pago.** El formulario muestra el switch "Pagada" del alta y la entrega, encendido si la receta está pagada; apagarlo deja la receta impaga (auditado en la receta, `origen: anular-entrega`). Solo baja el pago, nunca lo sube. Después de anular, la receta `PREPARADA` también puede cambiar su pago desde el detalle (P6 de `openspec/specs/pago-receta/spec.md`). | `AnularEntregaForm`, `desmarcarRecetaPagada`. |
| A7 | **Qué no toca.** Ni el libro recetario (el asiento registra la preparación, no la entrega), ni el stock, ni las etiquetas. | — |
| A8 | **Auditoría.** `ANULAR` sobre `entrega` (id de la entrega borrada), con el motivo, el estado anterior de la receta, la modalidad y el pago antes/después. | `anularEntregaCommand`. |
| A9 | **Dónde.** Panel "Entrega" en `/recetas/[id]`, con "Anular entrega" (motivo + switch de pago), visible con `entregas.registrar` mientras la receta está `ENTREGADA`/`ENVIADA_PEND_FIRMA` y no archivada. Es una acción simple, no de peligro (botón secundario, panel neutro): no se confunde con anular la receta ni un asiento. Mientras la receta tiene una entrega, el panel "Anulación" de la receta no se muestra (solo podría mostrar el bloqueo del libro); vuelve a aparecer cuando la receta queda `PREPARADA`. | `app/(app)/recetas/[id]/page.tsx`, `modules/entregas/ui/anular-entrega-form.tsx`. |
| A10 | **El repartidor del envío no se pierde.** Al copiar la entrega a `entrega_anulada`, su `repartidor_id` (migración 0093, `openspec/specs/envios-repartidores/spec.md` E6) viaja con la fila: queda como historial, sin FK. Si la receta se vuelve a entregar como envío, el repartidor se elige de nuevo; si se entrega como retiro, no lleva ninguno. Un envío anterior a 0093 (sin repartidor) o un retiro dejan `NULL`. | `moverEntregaAAnuladas` (`entrega-repository.ts`). |

## Alcance

Fuera de alcance: la **devolución del paciente** (un preparado que vuelve de la casa del paciente). Ese preparado no se vuelve a dispensar y no debe volver a `PREPARADA`; queda para otra decisión.

## Reversión

Rollback: `docs/rollbacks/anular-entrega.md`.
