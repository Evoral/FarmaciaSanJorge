# Pago de la receta (marca pagada / impaga)

## Purpose

La farmacia necesita saber qué recetas se pagaron y cuáles no. Una receta lleva una marca **Pagada / Impaga**, con
quién la registró y cuándo.

> Decisión del usuario: la opción **mínima**. Un indicador en la receta, nada más.

## Requirements

### Requirement: Marca Pagada / Impaga

Una receta SHALL llevar una marca **Pagada / Impaga**, con quién la registró y cuándo. El pago se puede registrar al **crear** la receta, al **entregarla**, o después desde el **detalle** de la receta.

#### Scenario: Receta marcada pagada

- **WHEN** se marca pagada una receta
- **THEN** la receta queda Pagada con el usuario que la registró y el momento

#### Scenario: Momentos para registrar el pago

- **WHEN** se crea la receta, se la entrega, o después desde su detalle
- **THEN** se puede registrar el pago

### Requirement: Solo una marca

El pago SHALL ser SOLO una marca de pagada/impaga. No hay tabla de pagos, ni importes, ni señas, ni medios de pago, ni caja, ni cobro, ni facturación.

#### Scenario: Registrar un pago

- **WHEN** se registra el pago de una receta
- **THEN** solo cambia la marca pagada/impaga, con quién y cuándo
- **AND** no se registra importe, seña ni medio de pago

### Requirement: Columnas del pago

`fsj.receta` SHALL tener tres columnas (migración 0071): `pagada` (`boolean NOT NULL DEFAULT false`; las recetas existentes quedan impagas, sin backfill); `pagada_en`, momento en que se marcó pagada (hora del servidor), `NULL` mientras está impaga; `pagada_por_id`, usuario que la marcó (FK compuesta `(tenant_id, pagada_por_id)` → `usuario`, como `registrada_por_id` y `tomada_por_id`), `NULL` mientras está impaga.

#### Scenario: Receta anterior a la migración 0071

- **GIVEN** una receta creada antes de la migración 0071
- **WHEN** se aplica la migración
- **THEN** queda impaga, con `pagada_en` y `pagada_por_id` en `NULL`

### Requirement: Las tres columnas cambian juntas

`receta_pagada_check` SHALL obligar a que las tres columnas cambien juntas: pagada ⇒ `pagada_en` y `pagada_por_id` informados; impaga ⇒ ambos `NULL`.

#### Scenario: Pagada sin momento ni usuario

- **WHEN** se escribe una receta con `pagada = true` y `pagada_en` en `NULL`
- **THEN** la base la rechaza por `receta_pagada_check`

### Requirement: El pago no es un estado de la receta

El pago SHALL ser una dimensión ortogonal a la máquina de estados de producción y libro (`PENDIENTE_PREPARACION` … `ENTREGADA` / `ANULADA`). Una receta puede estar pagada y pendiente de preparación, o impaga hasta su entrega. La máquina de estados no cambia, pero llegar a `ENTREGADA` exige el pago (P4, INV-R14).

#### Scenario: Pagada y pendiente de preparación

- **GIVEN** una receta en `PENDIENTE_PREPARACION`
- **WHEN** se marca pagada
- **THEN** sigue en `PENDIENTE_PREPARACION` y queda pagada

### Requirement: P1 — Momento y usuario los pone el servidor

`pagadaEn` y `pagadaPorId` SHALL ponerlos **el servidor** (hora de la transacción y usuario de la sesión). Nunca se aceptan del cliente. Desmarcar limpia las tres columnas.

#### Scenario: Marcar pagada

- **GIVEN** un usuario con sesión
- **WHEN** marca pagada una receta impaga
- **THEN** `pagadaEn` es la hora de la transacción y `pagadaPorId` es el usuario de la sesión

#### Scenario: Valores enviados por el cliente

- **WHEN** el cliente envía un `pagadaEn` o un `pagadaPorId` con el pedido
- **THEN** no se aceptan: el input del comando solo lleva el booleano `pagada`

#### Scenario: Desmarcar

- **GIVEN** una receta pagada que se puede desmarcar
- **WHEN** se desmarca
- **THEN** `pagada`, `pagada_en` y `pagada_por_id` quedan limpias (impaga, `NULL`, `NULL`)

#### Scenario: Desmarcar y volver a marcar

- **GIVEN** una receta pagada que se desmarcó
- **WHEN** se vuelve a marcar pagada
- **THEN** `pagadaEn` / `pagadaPorId` pasan a ser los del nuevo registro
- **AND** el historial anterior queda en la auditoría

### Requirement: P2 — Pago al crear la receta

El pago SHALL poderse registrar **al crear** la receta (carga manual e importación PDF/QR): casilla "Pagada", sin tildar por defecto.

#### Scenario: Alta sin tocar la casilla

- **WHEN** se crea una receta (carga manual o importación PDF/QR) sin tildar "Pagada"
- **THEN** la receta queda impaga

#### Scenario: Alta con la casilla tildada

- **WHEN** se crea una receta con "Pagada" tildada
- **THEN** la receta queda pagada

### Requirement: P3 — Pago al entregar

El pago SHALL poderse registrar **al entregar** (registrar la entrega o confirmar la firma recibida de un envío), en la misma transacción. El pago se escribe **antes** de pasar la receta a `ENTREGADA` (INV-R14).

#### Scenario: Registrar la entrega con el switch activado

- **GIVEN** una receta impaga
- **WHEN** se registra la entrega con el switch "Pagada" activado
- **THEN** la receta queda pagada en la misma transacción que la entrega
- **AND** el pago se escribe antes de pasar la receta a `ENTREGADA`

### Requirement: P3 — Switch "Pagada" de la entrega es de solo subida

El switch "Pagada" de la entrega (registrar la entrega o confirmar la firma recibida) SHALL ser de solo subida: activarlo marca la receta pagada; si ya estaba pagada se muestra activado y bloqueado.

#### Scenario: Receta ya pagada al entregar

- **GIVEN** una receta pagada
- **WHEN** se abre el formulario de entrega o de confirmación de la firma recibida
- **THEN** el switch "Pagada" se muestra activado y bloqueado

### Requirement: P4 — Una receta solo llega a ENTREGADA pagada

**Revisada 2026-10-13: una receta SHALL llegar a `ENTREGADA` solo pagada**, para no perder el registro del pago (futuro módulo de finanzas).

#### Scenario: Receta impaga sin marcar al entregar

- **GIVEN** una receta impaga
- **WHEN** se intenta pasarla a `ENTREGADA` sin marcarla pagada
- **THEN** se rechaza

### Requirement: P4 — Retiro presencial

En un **retiro presencial** la receta pasa a `ENTREGADA` al registrar la entrega, así que SHALL estar pagada o marcarse pagada en ese momento.

#### Scenario: Retiro presencial marcando el pago

- **GIVEN** una receta impaga
- **WHEN** se registra un retiro presencial con el switch "Pagada" activado
- **THEN** la receta queda pagada y `ENTREGADA`

### Requirement: P4 — Envío

Un **envío** SHALL poder registrarse impago y quedar en `ENVIADA_PEND_FIRMA`; al confirmar la firma recibida (pasa a `ENTREGADA`) la receta tiene que estar pagada o marcarse pagada en ese momento.

#### Scenario: Envío impago

- **GIVEN** una receta impaga
- **WHEN** se registra un envío sin marcar el pago
- **THEN** la receta queda impaga en `ENVIADA_PEND_FIRMA`

#### Scenario: Confirmar la firma de un envío impago

- **GIVEN** una receta impaga en `ENVIADA_PEND_FIRMA`
- **WHEN** se confirma la firma recibida sin marcar el pago
- **THEN** se rechaza

#### Scenario: Momentos para marcar el pago de un envío

- **GIVEN** una receta impaga que se envía
- **WHEN** se marca al registrar el envío, después desde el detalle, o al confirmar la firma recibida
- **THEN** el pago queda registrado
- **AND** confirmar la firma exige que quede pagada

### Requirement: P4 — Rechazo sin pago

Una entrega que deja la receta en `ENTREGADA` sin pago SHALL rechazarse con "Para entregar la receta tiene que quedar pagada…"; el botón queda deshabilitado hasta activar el switch.

#### Scenario: Botón deshabilitado

- **GIVEN** una receta impaga que pasaría a `ENTREGADA`
- **WHEN** se abre el formulario de entrega sin activar el switch "Pagada"
- **THEN** el botón queda deshabilitado hasta activarlo
- **AND** si el pedido llega igual, se rechaza con "Para entregar la receta tiene que quedar pagada…"

### Requirement: P5 — Pago en el detalle

El detalle de la receta SHALL mostrar "Pagada" (con quién y cuándo) o "Impaga", y permitir marcar o desmarcar con el mismo switch del alta (guarda al tocarlo): para registrar un pago hecho entre el alta y la entrega, o corregir un error antes de entregar.

#### Scenario: Marcar desde el detalle

- **GIVEN** un usuario con `recetas.editar` y una receta impaga en `PREPARADA`
- **WHEN** toca el switch del detalle
- **THEN** la receta queda pagada sin otro paso
- **AND** el detalle muestra "Pagada" con quién y cuándo

### Requirement: P5 — Switch bloqueado en una receta entregada y pagada

En el detalle, una receta `ENTREGADA` y pagada SHALL mostrar el switch "Pagada" bloqueado.

#### Scenario: Detalle de una receta entregada y pagada

- **GIVEN** una receta `ENTREGADA` y pagada
- **WHEN** se abre su detalle
- **THEN** el switch "Pagada" está bloqueado

### Requirement: P6 — El pago se cambia en cualquier estado menos ANULADA

El pago SHALL poderse cambiar en **cualquier estado menos `ANULADA`**. En `ANULADA` se rechaza con "La receta está anulada: no se puede modificar su pago." Anular una receta pagada no toca la marca: queda como historial.

#### Scenario: Receta anulada

- **GIVEN** una receta `ANULADA`
- **WHEN** se intenta marcar o desmarcar su pago
- **THEN** el comando y la BD (INV-R13) lo rechazan con "La receta está anulada: no se puede modificar su pago."

#### Scenario: Anular una receta pagada

- **GIVEN** una receta pagada
- **WHEN** se anula
- **THEN** sigue pagada, como historial

### Requirement: P6 — En ENTREGADA solo se puede marcar

En `ENTREGADA` el pago SHALL poderse solo **marcar** (recetas entregadas impagas antes de la migración 0076); desmarcar se rechaza con "La receta ya fue entregada: no se puede marcar como impaga."

#### Scenario: Entregada e impaga

- **GIVEN** una receta entregada impaga antes de la migración 0076
- **WHEN** se marca pagada desde el detalle
- **THEN** queda pagada

#### Scenario: Desmarcar una receta entregada

- **GIVEN** una receta `ENTREGADA` y pagada
- **WHEN** se intenta desmarcar el pago
- **THEN** se rechaza con "La receta ya fue entregada: no se puede marcar como impaga."

### Requirement: Receta anulada sin acción de pago en el detalle

El detalle de una receta anulada SHALL mostrarse sin la acción de pago; el comando y la BD la rechazan (P6).

#### Scenario: Detalle de una receta anulada

- **GIVEN** una receta `ANULADA`
- **WHEN** se abre su detalle
- **THEN** no se ofrece marcar ni desmarcar el pago

### Requirement: P7 — Idempotencia

Pedir el estado de pago que la receta ya tiene SHALL ser un no-op: marcar una receta ya pagada **no** pisa `pagadaEn` ni `pagadaPorId` (se conserva el primer registro) y no deja fila de auditoría.

#### Scenario: Marcar una receta ya pagada

- **GIVEN** una receta pagada por un usuario A
- **WHEN** un usuario B la marca pagada
- **THEN** `pagadaEn` y `pagadaPorId` siguen siendo los del registro de A
- **AND** no se escribe fila de auditoría

### Requirement: Bloqueo de la receta al marcar

Al cambiar el pago, la receta SHALL bloquearse (`SELECT … FOR UPDATE`) antes de leer, para que marcar dos veces o dos usuarios a la vez no pisen el primer registro (P7).

#### Scenario: Dos usuarios a la vez

- **GIVEN** una receta impaga
- **WHEN** dos usuarios la marcan pagada a la vez
- **THEN** el segundo no pisa el primero

### Requirement: P8 — Switch "Pagada" en la edición

**Revisada 2026-10-16:** la edición de la receta (`/recetas/[id]/editar`) SHALL mostrar el mismo switch "Pagada" del alta, con el estado actual, para registrar un pago olvidado en la carga inicial (o corregirlo). Al guardar se aplican las mismas reglas que en el detalle (P6, P7), en la misma transacción de la edición.

#### Scenario: Pago olvidado en la carga inicial

- **GIVEN** una receta impaga en edición
- **WHEN** se activa el switch "Pagada" y se guarda
- **THEN** la receta queda pagada en la misma transacción de la edición

#### Scenario: Edición de una receta ya pagada sin tocar el switch

- **GIVEN** una receta pagada en edición
- **WHEN** se guarda sin cambiar el switch
- **THEN** `pagadaEn` y `pagadaPorId` no cambian y no hay fila de auditoría del pago (P7)

### Requirement: P8 — Espacio de toma de /preparaciones

El espacio de toma de `/preparaciones`, que embebe el formulario sin el switch, no envía `pagada` y SHALL dejar el pago como está.

#### Scenario: Guardar desde el espacio de toma

- **GIVEN** una receta pagada
- **WHEN** se guarda desde el espacio de toma de `/preparaciones`
- **THEN** la receta sigue pagada

### Requirement: P9 — Actor activo

El actor que marca el pago MUST ser un usuario `ACTIVO` (INV-U07).

#### Scenario: Usuario suspendido

- **GIVEN** un usuario suspendido o dado de baja
- **WHEN** se intenta escribirlo como `pagada_por_id` de un registro nuevo
- **THEN** se rechaza

### Requirement: Usuario suspendido o dado de baja

Un usuario suspendido o dado de baja SHALL NOT poder ser `pagada_por_id` de un registro nuevo (P9); los registros históricos no se revalidan.

#### Scenario: Usuario dado de baja después de marcar

- **GIVEN** una receta pagada por un usuario que después se dio de baja
- **WHEN** se lee o se modifica la receta sin tocar el pago
- **THEN** su `pagada_por_id` no se revalida

### Requirement: Permisos existentes

El pago SHALL usar permisos existentes; no se creó ninguno nuevo. Marcar al crear / importar requiere `recetas.crear` (es parte del alta). Ver el pago y filtrar el listado requiere `recetas.crear` (igual que el listado y el detalle).

#### Scenario: Marcar al crear

- **GIVEN** un usuario con `recetas.crear`
- **WHEN** crea o importa una receta con "Pagada" tildada
- **THEN** la receta queda pagada

### Requirement: Permiso para marcar al entregar

Marcar el pago al entregar SHALL requerir `entregas.registrar`: es parte de la entrega; quien entrega puede cobrar en el mostrador sin necesitar `recetas.editar`.

#### Scenario: Quien entrega sin recetas.editar

- **GIVEN** un usuario con `entregas.registrar` y sin `recetas.editar`
- **WHEN** registra una entrega con el switch "Pagada" activado
- **THEN** la receta queda pagada

### Requirement: Permiso para marcar o desmarcar desde el detalle

Marcar / desmarcar el pago desde el detalle SHALL requerir `recetas.editar`: el permiso de modificación de la receta que no es destructivo (`recetas.anular` es solo FAR/DT). ATP/FAR/DT lo tienen en el seed (migración 0002).

#### Scenario: Usuario sin recetas.editar

- **GIVEN** un usuario sin `recetas.editar`
- **WHEN** intenta marcar o desmarcar el pago desde el detalle
- **THEN** se rechaza

### Requirement: Auditoría de todo cambio de pagada

Todo cambio de `pagada` SHALL dejar fila en `fsj.registro_auditoria`, con el valor anterior y el nuevo, escrita en la misma transacción que el cambio. Crear / importar: `receta` CREAR, `pagada` en `valorNuevo`. Detalle: `receta` MODIFICAR, `valorAnterior: { pagada }` / `valorNuevo: { pagada }`, solo si hubo cambio (P7).

#### Scenario: Marcar desde el detalle

- **GIVEN** una receta impaga
- **WHEN** se marca pagada desde el detalle
- **THEN** se escribe una fila `receta` MODIFICAR con `valorAnterior: { pagada: false }` y `valorNuevo: { pagada: true }` en la misma transacción

#### Scenario: Alta pagada

- **WHEN** se crea una receta con "Pagada" tildada
- **THEN** la fila `receta` CREAR lleva `pagada` en `valorNuevo`

### Requirement: Auditoría del pago en la entrega

En la entrega, la fila de `entrega` SHALL incluir `pagada` antes/después y, si la entrega marcó el pago, se agrega una fila `receta` MODIFICAR (`contexto.origen = "entrega"`) para que el historial de la receta quede completo.

#### Scenario: Entrega que marca el pago

- **GIVEN** una receta impaga
- **WHEN** se registra la entrega con el switch "Pagada" activado
- **THEN** la fila de `entrega` incluye `pagada` antes y después
- **AND** se agrega una fila `receta` MODIFICAR con `contexto.origen = "entrega"`

### Requirement: Columna y filtro Pago en el listado de recetas

El listado `/recetas` SHALL tener una columna **Pago** con una insignia Pagada (verde) / Impaga (ámbar), también en la lista para teléfonos, y un filtro **Pago**: Todas / Pagadas / Impagas (`?pago=pagadas|impagas`), dentro de "Filtros", con su chip de filtro activo.

#### Scenario: Filtrar las impagas

- **WHEN** se elige el filtro Pago "Impagas"
- **THEN** la URL lleva `?pago=impagas`, el listado muestra solo recetas impagas y se ve el chip de filtro activo

### Requirement: Pago en el Excel de recetas

El Excel (`/api/recetas/reporte/export/xlsx`) SHALL tener la columna `Pago` ("Pagada" / "Impaga") y respetar el filtro `pago`. El resumen de filtros de la auditoría de la exportación lo incluye.

#### Scenario: Exportar con el filtro de pago

- **GIVEN** el listado filtrado por `pago=pagadas`
- **WHEN** se exporta el Excel
- **THEN** solo trae recetas pagadas, con la columna `Pago` en "Pagada"
- **AND** el resumen de filtros de la auditoría de la exportación incluye el filtro de pago

### Requirement: Pago en el listado de entregas

Cada fila del listado de entregas (`/entregas`) (2026-10-17) SHALL mostrar el pago ("Pagada" / "Impaga"). Solo visualización (`listEntregasPendientes`, `modules/entregas/infrastructure/entrega-repository.ts`).

#### Scenario: Entrega pendiente impaga

- **GIVEN** una entrega pendiente de una receta impaga
- **WHEN** se abre `/entregas`
- **THEN** su fila muestra "Impaga"

### Requirement: Precio en el listado de entregas

Para quien tiene `cotizaciones.ver`, cada fila de `/entregas` SHALL mostrar el precio: la suma de la cotización vigente de cada ítem (INV-R06), con "Parcial" si algún ítem no tiene cotización o su cotización es parcial/incompleta, y "Sin cotizar" si ninguno la tiene. Solo visualización.

#### Scenario: Todos los ítems cotizados

- **GIVEN** un usuario con `cotizaciones.ver` y una receta cuyos ítems tienen todos una cotización vigente completa
- **WHEN** abre `/entregas`
- **THEN** la fila muestra la suma de esas cotizaciones

#### Scenario: Un ítem sin cotización

- **GIVEN** un usuario con `cotizaciones.ver` y una receta con un ítem cotizado y otro sin cotización
- **WHEN** abre `/entregas`
- **THEN** la fila muestra el precio con "Parcial"

#### Scenario: Ningún ítem cotizado

- **GIVEN** un usuario con `cotizaciones.ver` y una receta sin ninguna cotización
- **WHEN** abre `/entregas`
- **THEN** la fila muestra "Sin cotizar"

#### Scenario: Usuario sin cotizaciones.ver

- **GIVEN** un usuario sin `cotizaciones.ver`
- **WHEN** abre `/entregas`
- **THEN** las filas no muestran el precio

### Requirement: Anular una entrega registrada por error

Una entrega registrada por error SHALL anularse desde `/recetas/[id]` y puede dejar la receta impaga en el mismo acto: `openspec/specs/anular-entrega/spec.md` (A6).

#### Scenario: Anular la entrega y dejar la receta impaga

- **GIVEN** una receta `ENTREGADA` y pagada cuya entrega se registró por error
- **WHEN** se anula la entrega desde `/recetas/[id]` eligiendo dejarla impaga
- **THEN** la receta queda impaga en el mismo acto (A6)

## Estado

> Estado: implementado 2026-10-08 (migración 0071). Revisado 2026-10-13 (migración 0076): una receta entregada siempre queda pagada (P4). Reversión: `docs/rollbacks/pago-receta.md`, `docs/rollbacks/receta-entregada-pagada.md`.
> Decisión del usuario: la opción **mínima**. Un indicador en la receta, nada más.

## Alcance

La farmacia necesita saber qué recetas se pagaron y cuáles no. Una receta lleva una marca **Pagada / Impaga**, con quién la registró y cuándo. El pago se puede registrar al **crear** la receta, al **entregarla**, o después desde el **detalle** de la receta.

**Fuera de alcance (a propósito).** Esto es SOLO una marca de pagada/impaga. No hay tabla de pagos, ni importes, ni señas, ni medios de pago, ni caja, ni cobro, ni facturación.

> **Relación con el plan.** `docs/plan-implementacion.md` (línea ~44) deja fuera de alcance "Facturación, cobro, AFIP, obras sociales/validación de credencial (DP-30)". Eso **sigue valiendo**: esta funcionalidad no registra cobros ni importes, no emite comprobantes y no toca obras sociales, así que **no reabre DP-30**. Si más adelante se necesitan montos, señas o medios de pago, es un cambio nuevo con su propia decisión (una tabla de pagos); la marca de hoy se podría derivar de ella.

## Modelo

Tres columnas en `fsj.receta` (migración 0071):

| Columna | Significado |
|---|---|
| `pagada` | `boolean NOT NULL DEFAULT false`. Las recetas existentes quedan impagas (sin backfill). |
| `pagada_en` | Momento en que se marcó pagada (hora del servidor). `NULL` mientras está impaga. |
| `pagada_por_id` | Usuario que la marcó (FK compuesta `(tenant_id, pagada_por_id)` → `usuario`, como `registrada_por_id` y `tomada_por_id`). `NULL` mientras está impaga. |

`receta_pagada_check` obliga a que las tres cambien juntas: pagada ⇒ `pagada_en` y `pagada_por_id` informados; impaga ⇒ ambos `NULL`.

**El pago NO es un estado de la receta.** No se agregó `PAGADA` a `EstadoReceta`: el pago es una dimensión ortogonal a la máquina de estados de producción y libro (`PENDIENTE_PREPARACION` … `ENTREGADA` / `ANULADA`). Una receta puede estar pagada y pendiente de preparación, o impaga hasta su entrega. La máquina de estados no cambia, pero llegar a `ENTREGADA` exige el pago (P4, INV-R14).

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| P1 | `pagadaEn` y `pagadaPorId` los pone **el servidor** (hora de la transacción y usuario de la sesión). Nunca se aceptan del cliente. Desmarcar limpia las tres columnas. | `setPagoDeReceta` / `insertRecetaConItems` (`receta-repository.ts`); los inputs de los comandos solo llevan el booleano `pagada`. |
| P2 | Se puede registrar el pago **al crear** la receta (carga manual e importación PDF/QR): casilla "Pagada", sin tildar por defecto. | `crearReceta`, `importarReceta` (input `pagada`); `receta-form.tsx`. |
| P3 | Se puede registrar el pago **al entregar** (registrar la entrega o confirmar la firma recibida de un envío), en la misma transacción. El switch "Pagada" es de solo subida: activarlo marca la receta pagada; si ya estaba pagada se muestra activado y bloqueado. El pago se escribe **antes** de pasar la receta a `ENTREGADA` (INV-R14). | `registrarEntrega` y `confirmarFirmaRecibida` (input `pagada`, solo marca); `registrar-entrega-form.tsx`, `confirmar-firma-form.tsx`. |
| P4 | **Revisada 2026-10-13: una receta solo llega a `ENTREGADA` pagada**, para no perder el registro del pago (futuro módulo de finanzas). **Retiro presencial:** la receta pasa a `ENTREGADA` al registrar la entrega, así que tiene que estar pagada o marcarse pagada en ese momento. **Envío:** puede registrarse impaga y quedar en `ENVIADA_PEND_FIRMA`; al confirmar la firma recibida (pasa a `ENTREGADA`) tiene que estar pagada o marcarse pagada en ese momento. Sin pago se rechaza con "Para entregar la receta tiene que quedar pagada…" (el botón queda deshabilitado hasta activar el switch). | `modules/entregas/domain/entrega.ts` (`entregaExigePago`, `validarPagoAlEntregar`); respaldo en la BD: **INV-R14** (`receta_validar_entregada_pagada`, migración 0076). |
| P5 | El detalle de la receta muestra "Pagada" (con quién y cuándo) o "Impaga", y permite marcar o desmarcar con el mismo switch del alta (guarda al tocarlo): para registrar un pago hecho entre el alta y la entrega, o corregir un error antes de entregar. Una receta `ENTREGADA` y pagada muestra el switch bloqueado. | `app/(app)/recetas/[id]/page.tsx`, `pago-receta-form.tsx`, `pago-switch.tsx`, `marcarPagoReceta`. |
| P6 | El pago se puede cambiar en **cualquier estado menos `ANULADA`**. En `ANULADA` se rechaza con "La receta está anulada: no se puede modificar su pago." En `ENTREGADA` solo se puede **marcar** (recetas entregadas impagas antes de la migración 0076); desmarcar se rechaza con "La receta ya fue entregada: no se puede marcar como impaga." | `modules/recetas/domain/pago.ts` (`validarPagoModificable`, `puedeDesmarcarPago`); respaldo en la BD: **INV-R13** (`receta_validar_pago_no_anulada`, migración 0071) e **INV-R14** (migración 0076). Anular una receta pagada no toca la marca: queda como historial. |
| P7 | **Idempotencia.** Pedir el estado que la receta ya tiene es un no-op: marcar una receta ya pagada **no** pisa `pagadaEn` ni `pagadaPorId` (se conserva el primer registro) y no deja fila de auditoría. | `decidirCambioPago` (`domain/pago.ts`); `marcarPagoReceta` y `registrarEntrega`. |
| P8 | **Revisada 2026-10-16:** la edición de la receta (`/recetas/[id]/editar`) muestra el mismo switch "Pagada" del alta, con el estado actual, para registrar un pago olvidado en la carga inicial (o corregirlo). Al guardar se aplican las mismas reglas que en el detalle (P6, P7), en la misma transacción de la edición. El espacio de toma de `/preparaciones`, que embebe el formulario sin el switch, no envía `pagada` y deja el pago como está. | `editarReceta` (input `pagada` opcional) → `aplicarCambioPago` (`marcar-pago-receta.ts`), el mismo camino que `marcarPagoReceta`; `receta-form.tsx`. |
| P9 | El actor que marca el pago debe ser un usuario `ACTIVO` (INV-U07). | Trigger genérico `assert_actor_activo`, ahora con `pagada_por_id` en los triggers de `INSERT` y `UPDATE` de `receta`. |

## Decisiones

- No se agregó `PAGADA` a `EstadoReceta` (Modelo).
- No se agregó un contador de impagas al resumen por estado: ese resumen cuenta por estado y no aplica los demás filtros. (Listado de recetas)
- Sin índice nuevo: el listado no tiene índices para sus otros filtros y `pagada` es un booleano de baja cardinalidad. (Listado de recetas)

## Código que lo implementa

- `prisma/migrations/20261008090000_0071_receta_pagada/migration.sql` y `prisma/rollbacks/0071_receta_pagada.down.sql`.
- `prisma/migrations/20261013120000_0076_receta_entregada_pagada/migration.sql` y `prisma/rollbacks/0076_receta_entregada_pagada.down.sql` (INV-R14).
- `modules/recetas/domain/pago.ts` (reglas puras, filtros y etiquetas).
- `modules/recetas/application/marcar-pago-receta.ts`; `crear-receta.ts`, `importar-receta.ts`, `list-recetas.ts`, `reporte-recetas.ts`.
- `modules/recetas/infrastructure/receta-repository.ts` (`getPagoDeReceta`, `setPagoDeReceta`, alta, detalle, listado).
- `modules/recetas/ui/` (`receta-form.tsx`, `pago-switch.tsx`, `pago-receta-form.tsx`, `recetas-table.tsx`, `actions.ts`) y `app/(app)/recetas/` (`page.tsx`, `[id]/page.tsx`).
- `modules/entregas/` (`domain/entrega.ts`, `application/registrar-entrega.ts`, `application/confirmar-firma-recibida.ts`, `application/get-entrega-estado.ts`, `infrastructure/entrega-repository.ts`, `ui/registrar-entrega-form.tsx`, `ui/confirmar-firma-form.tsx`).
- `app/api/recetas/reporte/export/xlsx/route.ts`; `shared/errors/mensajes-invariantes.ts` (INV-R13, INV-R14); `shared/labels/field-labels.ts`.
