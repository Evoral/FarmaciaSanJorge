# SPEC — Libro recetario, anulación, histórico y libros contralor

> Fuente: decisiones del usuario del 2026-09-21 (DP-16, DP-16c, DP-17, DP-31, DP-32, DP-33).
> Fuente de verdad para los puntos 1.11–1.13 y las fases 8–10 del plan. Donde contradice al plan original, manda este documento.
> Las notas **[DEDUCCIÓN]** derivan de combinar decisiones; las **[PENDIENTE]** requieren confirmación.
> El pago de la receta (marca `pagada`, migración 0071) es una dimensión aparte: no es un estado de la receta ni forma parte de esta máquina de estados. Ver `docs/specs/pago-receta.md`.

## 1. Corrección de asientos (DP-16 y DP-16c)

**Principio:** lo asentado no se deshace. No se borra, no se edita, no se reutiliza su número, no se devuelve droga al stock, y no se modifica una jornada firmada.

| | Jornada abierta (sin cierre) | Jornada firmada |
|---|---|---|
| Asiento original | Pasa a `ANULADO` | **No se toca.** Queda `VIGENTE` en su jornada sellada |
| Dónde se registra | `AnulacionAsiento` en el mismo día | **Asiento rectificativo nuevo** en la jornada en curso, que referencia al original |
| Número correlativo | El original conserva el suyo | El rectificativo toma el siguiente número del libro |
| Stock | El egreso se mantiene | El egreso se mantiene |
| Preparado físico | Se descarta | Se descarta |
| Con droga controlada | Se segrega para inspección | Se segrega para inspección |

Motivos típicos: el paciente no retira, el médico revoca la prescripción, se detecta un error de dato después de asentar.

**Invariantes:**

- **INV-L09 (revisado).** Un asiento nunca se edita. Se corrige por anulación (jornada abierta) o por asiento rectificativo (jornada firmada), siempre con motivo y autorización del DT.
- **INV-L02 (revisado).** La transición `VIGENTE → ANULADO` solo es posible mientras la jornada del asiento no tiene `CierreDiario`. Coherente con INV-C03.
- **INV-L18.** Un asiento rectificativo referencia exactamente un asiento original de una jornada **firmada**, con fecha anterior a la propia. No existe un rectificativo sin original.
- **INV-L19.** Un asiento original tiene a lo sumo un rectificativo de anulación.
- **INV-L20.** Anular o rectificar un asiento no genera movimientos de stock ni asientos contralor de reversión.

**[DEDUCCIÓN]** El rectificativo es un `AsientoRecetario` con origen `RECTIFICATIVO` (nuevo valor de enum): numerado, encadenado en el hash y vinculado al cierre de la jornada en curso, que el DT firma como cualquier otro asiento. Así la corrección queda en el libro del día en que se hace, que es lo que exige no tocar la jornada sellada.

**[DEDUCCIÓN]** Al consultar el libro, un asiento con rectificativo se muestra como "sin efecto por asiento Nº X", aunque en la base siga `VIGENTE` (su jornada está sellada y su hash forma parte del cierre).

**[PENDIENTE]** "Se segrega para inspección": no está definido si el sistema lleva registro del preparado segregado (listado pendiente, fecha de inspección o destrucción) o si es solo una práctica física.

**[RESUELTO -- D1/D2/D3/D4, decisión del usuario 2026-09-23]** Un rectificativo por "error de dato": SOLO deja sin efecto el asiento original -- NO transcribe datos correctos (D3). La corrección de un dato mal cargado se hace dando de alta una receta y una preparación nuevas, con los datos correctos; el asiento rectificativo únicamente marca el original "sin efecto" y copia su snapshot congelado (paciente/médico/fórmula) sin líneas de detalle.

- **D1.** La autorización del rectificativo vive en una tabla propia, `fsj.rectificacion_asiento` (migración 0033) -- tenant, `asientoRectificativoId` único, `motivo`, `autorizadoPorId` (debe ser DT vigente hoy, mismo chequeo que `anulacion_asiento_validar`), `registradoPorId`. **INV-L21 (nuevo):** todo asiento RECTIFICATIVO tiene exactamente una `rectificacion_asiento` -- validado en ambas direcciones (inmediato del lado `rectificacion_asiento`; con un constraint trigger DEFERRABLE INITIALLY DEFERRED del lado `asiento_recetario`, porque el asiento se inserta ANTES de su autorización en la misma transacción). El comando `rectificarAsiento` (`modules/libro/application/rectificar-asiento.ts`, mismo permiso `libro.anulacion.solicitar` y misma co-firma de DT que `anularAsiento`) solo aplica a asientos SISTEMA cuya jornada YA está firmada -- si la jornada sigue abierta, el mensaje remite a `anularAsiento` en su lugar.
- **D2 (revisado, decisión del usuario 2026-09-23, reemplaza la versión original de D2; REEMPLAZADO para asientos nuevos por D8, 2026-10-16 -- se conserva como descripción de los asientos por ítem ya existentes).** El libro recetario se registra y se corrige POR ÍTEM: una receta puede tener varios `item_receta`, cada uno con su propia preparación y (una vez confirmada) su propio asiento SISTEMA; anular o rectificar UN asiento afecta SOLO a ese ítem. En la MISMA transacción, tras el INSERT del lado del asiento, se recalcula el estado de TODOS los ítems de la receta (`todosLosItemsSinEfecto`, `modules/libro/infrastructure/receta-coupling-repository.ts`): un ítem está "sin efecto" cuando su preparación llegó a `CONFIRMADA` y su asiento SISTEMA está `ANULADO` o ya tiene un rectificativo. La receta pasa a `ANULADA` con `motivoAnulacion = "Todos los ítems quedaron sin efecto (último: asiento Nº X): <motivo>"` (y se audita) SOLO cuando, después de esta operación, TODOS sus ítems quedaron sin efecto. Si al menos un ítem sigue pendiente de preparación o tiene un asiento `VIGENTE` sin rectificativo, la receta queda SIN CAMBIOS. Si la receta ya está `ENTREGADA` (estado terminal), se deja como está de todas formas -- en ambos casos la operación sobre el asiento sigue adelante. No se agregó una columna de estado por ítem (`item_receta` no la tiene): el estado "sin efecto" se deriva en cada cálculo, nunca se persiste. **Nota para FASE 11:** la entrega debe excluir los ítems cuyo asiento esté "sin efecto".
- **D4.** Hash V3 (migración 0034): `asiento_recetario.version_hash` (2 = existente, 3 = nuevo) y el hash ahora incluye las líneas de `detalle_asiento` (orden, descripción, cantidad, unidad, línea de pesaje). Requiere insertar los `detalle_asiento` ANTES del `asiento_recetario` (id generado por la app) y que la FK `detalle_asiento → asiento_recetario` sea DEFERRABLE INITIALLY DEFERRED. **INV-L22 (nuevo):** un asiento SISTEMA exige al menos un detalle ya insertado. **INV-L23 (nuevo):** un detalle no puede insertarse una vez que su asiento ya existe (congela el conjunto hasheado). `fsj.verificar_cadena` recalcula cada fila con la función que corresponde a su propio `version_hash`.
- **D7.** Los comandos de verificación de co-firma del DT (`verificarCoFirmaDtLibro`, y el equivalente de stock) ahora exigen el re-auth reciente del SOLICITANTE (`requireRecentReauth`) ANTES de evaluar la contraseña del DT -- así un operador con el step-up vencido no puede gastar intentos de la contraseña del DT antes de que su propio comando final (`anularAsiento`/`rectificarAsiento`/`registrarAjusteStock`) lo rechace por falta de re-auth. **Revertido para stock (decisión del usuario, 2026-09-29):** el ajuste de stock ya no exige el re-auth del solicitante; alcanza con la contraseña del DT en el mismo acto. El libro (`anularAsiento`/`rectificarAsiento`) mantiene D7.

- **D8 (decisión del usuario, 2026-10-16, reemplaza a D2 para todo asiento nuevo). Un asiento por receta.** Una receta no puede tener dos asientos en el libro recetario: todos sus ítems quedan en **un solo** asiento SISTEMA, con un solo número.
  - **Cuándo se escribe.** Al confirmar la receta completa: "Imprimir etiquetas" de la toma (`preparaciones.confirmarReservasReceta`, R13 de `reserva-stock-preparacion.md`) confirma todos sus ítems en una transacción y escribe UN asiento con todos ellos. No existe la confirmación de un ítem suelto de una receta de varios ítems. El camino heredado `preparaciones.confirmar` (`/preparaciones/[id]`, preparación INICIADA sin reserva, de antes de R16) escribe un asiento por receta con esa sola preparación, y se rechaza si la receta tiene otro ítem vivo que no esté CONFIRMADA: "Esta receta tiene varios ítems: se registran juntos en el libro desde la toma (Imprimir etiquetas)."
  - **Contenido.** Paciente y médico de la receta (un solo snapshot). `formula_texto`: la fórmula de cada ítem en orden de ítem, cada una precedida por "Ítem N: " y separadas por " | ". `detalle_asiento`: las líneas de todos los ítems, en orden de ítem y, dentro de cada uno, en su orden actual; `orden` es correlativo en todo el asiento.
  - **Modelo.** `asiento_recetario.receta_id` (nuevo, FK a `receta`) y tabla nueva `fsj.asiento_preparacion (tenant_id, asiento_recetario_id, preparacion_id, orden)`, con UNIQUE `(tenant_id, preparacion_id)` (una preparación está en a lo sumo un asiento). Las filas de `asiento_preparacion` se insertan ANTES del asiento, como los detalles (FK al asiento DEFERRABLE INITIALLY DEFERRED), son de solo inserción y no pueden insertarse una vez que su asiento existe. Un asiento SISTEMA nuevo tiene `preparacion_id` NULL, `receta_id` NOT NULL y `version_hash = 4`; los asientos SISTEMA existentes (`version_hash` ≤ 3, `preparacion_id` NOT NULL, `receta_id` NULL) no se tocan.
  - **Invariantes.** **INV-L07 (revisado):** SISTEMA es o bien heredado (`preparacion_id` NOT NULL, `receta_id` NULL, `version_hash` ≤ 3) o bien por receta (`preparacion_id` NULL, `receta_id` NOT NULL, `version_hash` = 4); RECTIFICATIVO sin cambios. **INV-L24 (nuevo):** a lo sumo un asiento SISTEMA por receta (`UNIQUE (tenant_id, receta_id) WHERE origen = 'SISTEMA'`). **INV-L25 (nuevo):** un asiento SISTEMA por receta tiene al menos una `asiento_preparacion`, y cada preparación vinculada está CONFIRMADA y es de un ítem de su `receta_id`. **INV-P04 (revisado):** una preparación CONFIRMADA tiene su asiento SISTEMA, heredado (`asiento_recetario.preparacion_id`) o por receta (`asiento_preparacion`).
  - **Hash V4.** Como V3, más `receta_id` y las preparaciones vinculadas en su `orden`. `fsj.verificar_cadena` sigue recalculando cada fila con la función de su propio `version_hash`.
  - **Corrección.** Anular o rectificar un asiento por receta deja sin efecto **todos** sus ítems: la receta pasa a `ANULADA` con el mismo texto de D2 (salvo `ENTREGADA`, que queda como está). Un ítem está "sin efecto" cuando su asiento -- heredado o por receta -- está `ANULADO` o tiene rectificativo.
  - **Transición.** Una receta que al desplegar ya tenía ítems confirmados con asiento por ítem conserva esos asientos; los ítems que le falten se registran juntos en un asiento por receta. Solo esas recetas pueden mostrar más de un asiento, y solo por ese motivo; INV-L24 aplica a los asientos por receta.
  - **Lectura.** Todo lo que hoy va de un asiento a "su" preparación (o al revés) resuelve las dos formas: listado y detalle de `/libro`, exportaciones, "Receta Nº" (por `receta_id`, o por la preparación en los heredados), entrega, etiqueta, contralor, historiales. El listado muestra una fila por asiento.

## 2. Asientos históricos (DP-17) -- ELIMINADOS (2026-10-16)

**Eliminados por decisión del usuario (2026-10-16, migración 0084):** el sistema ya no digitaliza asientos del libro físico. Se borraron la tabla `fsj.asiento_historico`, el permiso `libro.historico.digitalizar`, la pantalla `/libro/historico` y su código. Rollback: `docs/rollbacks/quitar-asiento-historico.md`. Lo que sigue queda como registro de la decisión original.

Los asientos históricos son **solo para control y consulta**. No forman parte del libro recetario digital.

- Copian el formato del libro físico, incluido su propio número de asiento.
- Existen solo para el relevamiento de datos.
- **No** consumen el correlativo del libro digital, **no** entran en la cadena de hash, **no** se vinculan a cierres diarios, **no** generan movimientos de stock.

**[DEDUCCIÓN]** Van en una tabla separada (`asiento_historico`), no en `asiento_recetario` con `origen_carga = DIGITALIZACION_HISTORICA`. Mezclarlos rompería INV-L04 (correlativo sin saltos) e INV-C02 (todo asiento vigente de la fecha queda vinculado a un cierre). El valor `DIGITALIZACION_HISTORICA` del enum `OrigenAsiento` se elimina.

**D5 (decisión del usuario, 2026-09-23).** Un mismo folio físico no puede digitalizarse dos veces: `UNIQUE (tenant_id, tipo_libro, numero_asiento_fisico)` (migración 0035) -- `fsj.asiento_historico` no tiene una columna propia de "libro físico" más allá de `tipo_libro` (se asume un libro físico por tipo, igual que `fsj.libro_rubricado`). La violación se traduce a un mensaje claro en `crearAsientoHistorico`.

## 3. Correlativo e integridad (DP-31 y DP-32, confirmados)

- **DP-31.** El número correlativo lo asigna la base con un **contador transaccional**: una fila por (tenant, libro) bloqueada con `FOR UPDATE` dentro de la misma transacción. No se usa `SEQUENCE`, porque una secuencia pierde números cuando una transacción se revierte y eso viola INV-L04 (sin saltos).
- **Numeración inicial.** Cada tenant tiene su **propio libro digital**, que **arranca en 1**. No continúa la numeración del libro físico, que solo aparece en los asientos históricos (§2). Cada libro contralor tiene también su propia secuencia desde 1.
- **DP-32.** El `hashIntegridad` lo calcula la **base** en un trigger (`pgcrypto`, SHA-256), encadenado con el hash del asiento anterior del mismo libro. La aplicación no lo calcula ni lo envía.

Aplica igual al libro recetario y a cada libro contralor, cada uno con su propia secuencia y su propia cadena.

- **Un asiento por receta (2026-10-16, D8; reemplaza "asientos consecutivos" del 2026-10-14).** "Imprimir etiquetas" (`preparaciones.confirmarReservasReceta`, `docs/specs/reserva-stock-preparacion.md` R13) confirma todos los ítems de la receta en una sola transacción y escribe un solo asiento con todos ellos.
- **Impresión (2026-10-16).** El libro se imprime **una jornada por hoja**, en A4 horizontal: un día puede ocupar varias hojas, dos días nunca comparten una. Cada hoja lleva "Jornada dd/mm/aaaa — Hoja i de n", numerada dentro del día (`shared/pdf/hojas.ts`). La hoja del día es el PDF del cierre firmado (`/api/cierres/[id]/pdf`, `cierre-pdf.ts`), que se abre en una pestaña nueva (no se descarga; se genera en cada pedido): farmacia, jornada, Director Técnico, la tabla de asientos (Nº, paciente, médico y **fórmula de la prescripción completa** -- cada celda crece lo necesario, nunca se corta --; sin columna de estado) y el espacio para la firma y el sello. No lleva hash de lote, datos del mecanismo de firma, demora ni los libros contralor (toda droga, controlada o no, ya figura en la fórmula de su asiento). Al firmar, `/cierres` muestra "Imprimir hoja del día" (sin pasos obligatorios). La exportación PDF de `/libro` usa el mismo formato y empieza cada día en una hoja nueva (`libro-pdf.ts`).
- **Orden de impresión (2026-10-16).** Las hojas se imprimen en orden de fecha: mientras una jornada firmada no se imprimió nunca (`cierre_diario.fecha_impresion` NULL), no se puede imprimir ni reimprimir ninguna jornada posterior; esa y las anteriores, sí. Ejemplo: firmadas del 8 al 11 de octubre y el 8 sin imprimir → solo se puede imprimir el 8 (y reimprimir días anteriores). El servidor lo rechaza con "Primero imprimí la hoja del dd/mm/aaaa: las hojas del libro se imprimen en orden." (`cierres.imprimir.marcar`, `modules/cierres/domain/impresion.ts`); `/cierres`, `/cierres/[id]` y `/libro/dias` deshabilitan el botón y ofrecen la hoja pendiente. La exportación PDF de `/libro` es una consulta, no la hoja oficial: no marca impresión ni sigue esta regla.
- **Fórmula de la prescripción (2026-10-16).** La fórmula de cada ítem en el asiento es la de la receta tal como vino, nunca recortada: **todos** sus componentes (drogas controladas o no y excipientes) con la cantidad prescripta, después el excipiente utilizado como "c.s.p." y al final cantidad y forma, con la fracción de dosis si la hay. Ejemplo: "Minoxidil 5 mg; Finasteride 1 mg; Ludipress c.s.p. — 60 Cápsulas (1 cápsula = ½ dosis)"; una forma no capsular con total: "Crema c.s.p. 100 g". Las líneas pesadas siguen en `detalle_asiento`. (`modules/preparaciones/domain/formula-prescripcion.ts`.) Los asientos anteriores conservan su fórmula (lo asentado no se modifica).
- **Excipiente utilizado (2026-10-16, migración 0083).** En la toma, cuando un ítem queda con stock reservado ("Marcar como preparada"), aparece debajo el campo opcional "Excipiente utilizado". Se guarda al salir del campo (`preparaciones.excipiente.guardar`, permiso `preparaciones.confirmar`, sin re-autenticación; en una cuenta de sector pide el operador) y no cambia el flujo. Al imprimir las etiquetas pasa a la fórmula del asiento, que está en el hash: queda fijo. **INV-P08:** `preparacion.excipiente_texto` solo cambia mientras la preparación está INICIADA.
- **Libro por día (2026-10-16).** `/libro/dias` lista cada día con al menos un asiento, con la cantidad y su firma: Firmada (con "Imprimir hoja"), Sin firmar (deuda, enlace a `/cierres`), En curso (la jornada actual, se firma al día siguiente) o Sin asientos vigentes. Un día sin recetas (fin de semana, feriado, sin pacientes) no figura ni cuenta como deuda. La firma se hace solo en `/cierres`. (`modules/libro/domain/jornadas.ts`, `list-jornadas-libro.ts`.)
- **Receta Nº en el listado (2026-10-14).** `/libro` y la exportación PDF muestran el `numero_interno` de la receta de cada asiento (columna "Receta Nº"), leído por join asiento → preparación → item_receta → receta (un RECTIFICATIVO, por la preparación de su asiento original; sin preparación -- histórico -- "—"). Es SOLO de visualización: no es una columna del asiento, no forma parte de su snapshot `*_texto` ni de su `hashIntegridad`, y no cambia la tabla (`modules/libro/infrastructure/asiento-repository.ts`, `recetaNumeroInterno`). La exportación Excel no la incluye.

## 4. Libros contralor (DP-33)

### Configuración por farmacia

`Tenant.fechaActivacionContralor: DateTime | null`

- `null`: los libros de psicotrópicos y estupefacientes se llevan a mano. El sistema no genera asientos contralor.
- Con fecha: el sistema lleva los libros desde ese momento.

### AsientoContralor

| Campo | Tipo | Nota |
|---|---|---|
| id | UUID | |
| tenantId | UUID | |
| libroId | UUID | LibroRubricado de tipo psicotrópicos o estupefacientes |
| numeroCorrelativo | Long | propio de cada libro |
| fechaAsiento | Date | |
| tipoMovimiento | TipoMovimientoContralor | |
| drogaId | UUID | |
| drogaDescripcion | String | texto congelado |
| cantidad | Decimal | |
| unidadMedida | UnidadMedida | |
| saldoAnterior | Decimal | |
| saldoPosterior | Decimal | |
| movimientoStockId | UUID | null solo en APERTURA |
| asientoRecetarioId | UUID | solo en EGRESO por preparación |
| numeroValeAdquisicion | String | solo en INGRESO |
| cierreDiarioId | UUID | |
| estado | EstadoAsiento | |
| hashIntegridad | String | |
| registradoPorId | UUID | |

Enum `TipoMovimientoContralor`: `APERTURA`, `INGRESO`, `EGRESO`, `AJUSTE`.

Relaciones: `MovimientoStock 1 → 0..1 AsientoContralor`; `AsientoRecetario 1 → 0..* AsientoContralor`; `LibroRubricado 1 ◆— 0..* AsientoContralor`; `AsientoContralor 0..* → 1 Droga`.

`saldoAnterior` hace que cada renglón sea verificable por sí solo.

### Comportamiento

- **Contralor desactivado:** el recetario registra todas las preparaciones, incluidas las que usan drogas controladas. El stock de controladas se descuenta normalmente. No se genera ningún `AsientoContralor`.
- **Contralor activado:** todo lo anterior, y además cada movimiento de stock de una droga controlada genera su asiento en el libro que corresponde.
- **Activación:** exige cargar el saldo de apertura de cada droga controlada, con un asiento `APERTURA` por droga cuyo saldo es el del libro manual y debe coincidir con el stock físico. Los movimientos anteriores a la fecha de activación no generan asientos retroactivos.

### Invariantes

- **INV-L08 (reemplaza la versión anterior).** Si el tenant tiene `fechaActivacionContralor`, todo `MovimientoStock` posterior a esa fecha sobre una droga con `esControlada = true` genera un `AsientoContralor` dentro de la misma transacción. [BD+APP]
- **INV-L11.** El registro en el libro recetario es obligatorio con independencia de la configuración del contralor. Una preparación con droga controlada siempre genera su `AsientoRecetario`. [BD+APP]
- **INV-L12.** `saldoPosterior = saldoAnterior + cantidad` en APERTURA e INGRESO, y `saldoAnterior − cantidad` en EGRESO. En AJUSTE, según su sentido. [BD]
- **INV-L13.** `saldoAnterior` es igual al `saldoPosterior` del último asiento vigente de esa droga en ese libro. Se calcula bajo bloqueo para que dos movimientos simultáneos no lean el mismo saldo. [BD]
- **INV-L14.** `saldoPosterior` nunca es negativo. [BD]
- **INV-L15.** Existe exactamente un asiento APERTURA por droga y libro, y es el primero de su secuencia. [BD]
- **INV-L16.** Un INGRESO exige `numeroValeAdquisicion`. [BD]
- **INV-L17.** Una vez activado, el contralor no se desactiva. Si el cliente decide volver a llevarlo a mano, se registra el cierre con saldo final y fecha, y `fechaActivacionContralor` no vuelve a nulo. [BD+APP]
- INV-L01 (inmutabilidad), INV-L03 (secuencia en base) e INV-C02 (vinculación al cierre diario) aplican a `AsientoContralor` sin cambios.

### Deducciones y pendientes

- **[DEDUCCIÓN]** El libro al que va cada asiento sale de `Droga.tipoControl`: PSICOTROPICO → libro de psicotrópicos; ESTUPEFACIENTE → libro de estupefacientes.
- **[DEDUCCIÓN]** Un EGRESO por preparación que consume dos partidas de la misma droga genera **dos** asientos contralor, uno por movimiento (relación `MovimientoStock 1 → 0..1`).
- **[DEDUCCIÓN]** Como hay un INGRESO con vale, la carga de una partida de droga controlada con contralor activo exige `numeroValeAdquisicion`.
- **[DEDUCCIÓN]** Anular o rectificar un asiento recetario no revierte sus asientos contralor (INV-L20): el egreso de stock se mantiene, y el libro contralor lo refleja.
- **[CONFLICTO]** AJUSTE "según su sentido" (INV-L12) choca con DP-21b, que dice que todo ajuste resta. **Se asume que el AJUSTE contralor siempre resta.**
- **[CONFLICTO]** `AsientoContralor.libroId` necesita `LibroRubricado`, cuyo modelo quedó diferido a la consulta con la Asociación de Farmacias (DP-38). **Se asume una entidad mínima** (tipo, número, fecha de rúbrica, expediente, fecha de cierre), sin folios. Los folios siguen diferidos.
- **[PENDIENTE]** Una droga controlada dada de alta **después** de la activación: ¿se genera automáticamente su APERTURA con saldo 0 antes de su primer movimiento?
- **[PENDIENTE]** Un sobrante de droga controlada entra como partida nueva (DP-21b), pero INV-L16 exige vale de adquisición para todo INGRESO, y un sobrante no tiene vale.
- **[PENDIENTE]** Nombres del enum `TipoLibro`: el diagrama usa `PSICOTROPICO` / `ESTUPEFACIENTE` (singular). Se mantiene el singular para no duplicar términos del glosario.

## 5. Firma de la jornada

- **INV-C21.** `fsj.cierre_diario_firmar` rechaza firmar la jornada en curso o una futura (`p_fecha >= jornada_actual` del tenant, migración 0075). Solo se firman jornadas anteriores. Una jornada futura firmada bloquearía, vía INV-C03, cualquier movimiento de stock o asiento posterior hasta que el calendario alcance esa fecha — un bloqueo irreversible, porque `cierre_diario` no admite baja ni desvinculación (INV-C04).
- **DP-18b (revisada, 2026-10-13, migración 0075).** El cierre diario se hace **al día siguiente**: el Director Técnico firma la jornada anterior, nunca la jornada en curso. Reemplaza la decisión del 2026-09-21 ("puede firmar la jornada en curso").
  - La jornada de hoy no aparece en "pendientes de firma" ni en la alerta del layout hasta que empieza la jornada siguiente (`listJornadasPendientes` / `getResumenPendientes` filtran `fecha < jornada_actual`).
  - Ya no hace falta la advertencia de UI previa a firmar el día en curso (preparaciones INICIADA): firmar la jornada anterior nunca bloquea registros de hoy.
- **DP-18 (resuelta, 2026-09-24, FASE 10 punto 10.1).** "En término" ya no es un valor fijo (la misma jornada): se agrega el parámetro por tenant `plazo_firma_dias` (entero ≥ 0, default 0, editable por ADM en `/admin/configuracion/parametros`). `fsj.cierre_diario_calcular_fuera_de_termino` (migración 0038) recalcula: `fuera_de_termino = jornada_actual(tenant) > (fecha + plazo_firma_dias)`. Con el default 0 el comportamiento es idéntico al anterior. **Migración 0075 (DP-18b revisada):** el plazo se cuenta desde el día siguiente a la jornada: `fuera_de_termino = jornada_actual > (fecha + 1 + plazo_firma_dias)`; con el default 0, firmar al día siguiente es en término y cualquier día posterior queda fuera de término. `fsj.cierre_diario_firmar` no cambia de firma, solo delega en esa función.
- **DP-18c (resuelta, 2026-09-24, FASE 10 punto 10.1).** `motivo_demora` pasa de texto libre a un enum `fsj.motivo_demora` (migración 0039): `AUSENCIA_DT`, `FALLA_SISTEMA`, `FARMACIA_CERRADA`, `OTRO`. `OTRO` exige `motivo_demora_detalle` no vacío (CHECK `cierre_diario_motivo_demora_otro_detalle_check`); las otras tres opciones no lo exigen (aunque la UI permite agregarlo siempre como detalle libre). Migración de datos: todo valor preexistente que no coincidía exactamente con una de las 4 etiquetas pasa a `OTRO`, y si `motivo_demora_detalle` estaba vacío se completa con el texto original (para no perder información). `fsj.cierre_diario_firmar` sigue recibiendo `p_motivo_demora` como `text` (compatibilidad de firma) y lo castea a `fsj.motivo_demora` en el INSERT; un valor inválido es rechazado por Postgres con el error estándar de enum. La app valida contra el mismo enum (zod) antes de llegar a la base.
- **DP-18d (resuelta, 2026-09-24, FASE 10 punto 10.1).** Una jornada sin ningún asiento (ni recetario ni contralor) no exige firma: no aparece en el listado de "pendientes de firma" ni en la alerta del layout (FASE 10 punto 10.3) -- `modules/cierres/infrastructure/cierre-repository.ts#listJornadasPendientes` solo selecciona fechas con al menos un asiento VIGENTE sin vincular. Firmarla igual (con `cantidad_asientos = 0`) sigue siendo posible y válido (nada en la BD lo impide, `cierre_diario_cantidad_asientos_check` solo exige `>= 0`); simplemente nunca se fuerza.
- **DP-19 (resuelta, 2026-09-24).** No se implementa firma `DIGITAL_CERTIFICADA` ni sello de tiempo de tercero (TSA, RFC 3161) en este alcance. `mecanismo_firma` sigue siendo `CREDENCIALES_DT` (contraseña completa del DT, nunca PIN) y `sello_tiempo`/`fecha_firma` son la hora del servidor (`now()`, INV-C20) -- no hay integración externa.
- **DP-21 (resuelta, 2026-09-24, FASE 10 punto 10.2).** Comprobante de cierre en A4, generado server-side (`modules/cierres/infrastructure/cierre-pdf.ts`, pdfkit vía `shared/pdf/pdf-document.ts`), desacoplado del cálculo de folios (M13b sigue diferido a la Asociación de Farmacias, DP-38). Contenido exacto: datos de la farmacia (razón social/nombre de fantasía, CUIT, matrícula, domicilio -- datos editables del tenant), fecha de la jornada, DT (nombre, apellido, matrícula -- snapshot `matricula_dt`), listado de asientos recetario de ese cierre ordenados por número (Nº, paciente, médico, fórmula, estado visual incluyendo anulado / sin efecto por rectificativo -- vía `modules/libro/domain/estado-visual.ts`), listado de asientos contralor de ese cierre (Nº, libro, droga, movimiento, cantidad, saldo posterior), `cantidad_asientos`, `hash_lote`, `sello_tiempo`/`fecha_firma`, fuera de término + motivo (con su detalle), y un área en blanco para "Firma y sello del Director Técnico". Ruta `app/api/cierres/[id]/pdf`, permiso `cierres.imprimir` (DT/FAR). La primera impresión fija `fecha_impresion`/`impreso_por_id` (columna con grant de UPDATE, solo si todavía es NULL -- el trigger INV-C04 la congela después); toda impresión (primera o reimpresión) se audita (`TipoAccion.IMPRIMIR_CIERRE`).
