# SPEC — Libro recetario, anulación, histórico y libros contralor

> Fuente: decisiones del usuario del 2026-09-21 (DP-16, DP-16c, DP-17, DP-31, DP-32, DP-33).
> Fuente de verdad para los puntos 1.11–1.13 y las fases 8–10 del plan. Donde contradice al plan original, manda este documento.
> Las notas **[DEDUCCIÓN]** derivan de combinar decisiones; las **[PENDIENTE]** requieren confirmación.

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

**[PENDIENTE]** Un rectificativo por "error de dato": ¿solo deja sin efecto el asiento original, o además transcribe los datos correctos?

## 2. Asientos históricos (DP-17)

Los asientos históricos son **solo para control y consulta**. No forman parte del libro recetario digital.

- Copian el formato del libro físico, incluido su propio número de asiento.
- Existen solo para el relevamiento de datos.
- **No** consumen el correlativo del libro digital, **no** entran en la cadena de hash, **no** se vinculan a cierres diarios, **no** generan movimientos de stock.

**[DEDUCCIÓN]** Van en una tabla separada (`asiento_historico`), no en `asiento_recetario` con `origen_carga = DIGITALIZACION_HISTORICA`. Mezclarlos rompería INV-L04 (correlativo sin saltos) e INV-C02 (todo asiento vigente de la fecha queda vinculado a un cierre). El valor `DIGITALIZACION_HISTORICA` del enum `OrigenAsiento` se elimina.

## 3. Correlativo e integridad (DP-31 y DP-32, confirmados)

- **DP-31.** El número correlativo lo asigna la base con un **contador transaccional**: una fila por (tenant, libro) bloqueada con `FOR UPDATE` dentro de la misma transacción. No se usa `SEQUENCE`, porque una secuencia pierde números cuando una transacción se revierte y eso viola INV-L04 (sin saltos).
- **Numeración inicial.** Cada tenant tiene su **propio libro digital**, que **arranca en 1**. No continúa la numeración del libro físico, que solo aparece en los asientos históricos (§2). Cada libro contralor tiene también su propia secuencia desde 1.
- **DP-32.** El `hashIntegridad` lo calcula la **base** en un trigger (`pgcrypto`, SHA-256), encadenado con el hash del asiento anterior del mismo libro. La aplicación no lo calcula ni lo envía.

Aplica igual al libro recetario y a cada libro contralor, cada uno con su propia secuencia y su propia cadena.

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

- **INV-C21.** `fsj.cierre_diario_firmar` rechaza firmar una jornada futura (`p_fecha` posterior a la jornada actual del tenant). Una jornada futura firmada bloquearía, vía INV-C03, cualquier movimiento de stock o asiento posterior hasta que el calendario alcance esa fecha — un bloqueo irreversible, porque `cierre_diario` no admite baja ni desvinculación (INV-C04).
- **DP-18b (resuelta, 2026-09-21).** El Director Técnico **puede firmar la jornada en curso**. Es la práctica habitual: el DT cierra el negocio y firma el día completo al irse.
  - Consecuencia: desde la firma, INV-C03 rechaza cualquier movimiento de stock o asiento con fecha de hoy. Lo que se necesite registrar después queda para la jornada siguiente.
  - Requisito de UI (fase 10): antes de firmar el día en curso, la pantalla debe advertir explícitamente que no se podrán registrar más preparaciones, ajustes ni asientos en la jornada de hoy, y mostrar las preparaciones que sigan en estado INICIADA para que el DT decida antes de cerrar.
