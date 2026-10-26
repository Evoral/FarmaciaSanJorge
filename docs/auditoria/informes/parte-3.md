# Parte 3 — Integridad del dominio, transacciones, concurrencia y auditoría

- Commit base del informe: `c95ac1f` al inicio, `00afed2` al cierre (otro desarrollador commiteó en paralelo).
- Base de prueba con 0101 aplicada (107/107 migraciones).
- Revisión del auditor del plan: 2026-10-23, contra el código.

## Revisión del auditor del plan

### Veredicto sobre el informe

El más profundo de los tres hasta ahora: verificó en vivo las funciones del libro, la renumeración, los
triggers y los 18 `audit: { skip: true }`, y lo que declara conforme es creíble. Pero exagera el único
BLOCKER y uno de sus hallazgos ya está resuelto en el código.

Desvíos del revisor:
- P3-01 ignora que `openspec/specs/existencia-inicial/spec.md:77` dice que ninguna ruta de la app activa el contralor digital (`tenant.fecha_activacion_contralor` solo se escribe por SQL; confirmado: ningún código lo escribe).
- P3-05: el criterio de cierre que propone ya se cumple (`configurar-numeracion-libro.ts:73-74`).
- Llama P2-01 al arreglo de `crearProductoDesdeFacturaAction` (es P2-04) y cita mal los timestamps de las migraciones 0100 y 0101.

### Verificación por hallazgo

| ID | Original | Revisado | Veredicto | Evidencia de la revisión |
|---|---|---|---|---|
| P3-01 | BLOCKER | WARNING (bloquea habilitar el contralor digital) | CONFIRMADO, NO ALCANZABLE HOY | Brecha documentada como abierta en `openspec/specs/reserva-stock-preparacion/spec.md:117-119` y `openspec/specs/existencia-inicial/spec.md:77-80`. Solo ocurre con `fecha_activacion_contralor` cargada, y la app no tiene forma de cargarla. |
| P3-02 | CRITICAL | WARNING | CONFIRMADO | `excipiente-preparacion.ts:16` bloquea el excipiente en una segunda sentencia, después de las líneas; `confirmarReservasReceta` bloquea todo en una sola ordenada por id. Deadlock posible si dos preparaciones comparten lotes de droga y de excipiente. Postgres aborta una transacción (error genérico, se reintenta): no hay pérdida de datos. |
| P3-03 | CRITICAL | CRITICAL (antes del deploy) | CONFIRMADO | `login.ts`: `candidate.intentosFallidos + 1` con un valor leído fuera de la transacción; el PIN escribe `pinIntentosFallidos` absoluto (`usuario-repository.ts:184`). Peticiones paralelas evitan el bloqueo a los 5 intentos: en el login, sin sesión; en el PIN de 4 dígitos, desde una cuenta de sector, para suplantar a otro empleado. |
| P3-04 | WARNING | WARNING | CONFIRMADO | `0088_pesada_real/migration.sql:87` usa `current_date` (UTC) en lugar de `fsj.jornada_actual(tenant_id)`. Solo afecta entre las 21:00 y las 23:59 de un día en que cambia una designación de DT. |
| P3-05 | WARNING | — | FALSO POSITIVO | La auditoría de `libro.configurarNumeracion` ya registra `numeroInicial` anterior y nuevo y `asientosRenumerados`; el desplazamiento se reconstruye como nuevo − anterior. |
| P3-06 | WARNING | SUGGESTION | CONFIRMADO | Sin trigger BEFORE TRUNCATE. `fsj_app` no tiene TRUNCATE; el riesgo es un TRUNCATE accidental del owner, que de todas formas puede deshabilitar triggers. |
| P3-07 | WARNING | WARNING | CONFIRMADO | `generar-fichas-y-cotizaciones.ts:46-47` decide con `requireSession()` (permisos del sector), no con los del operador. Falla funcional: aviso "No se pudo generar la ficha técnica" cuando el operador no tiene `fichas.generar`. Sin bypass: `generarFichaTecnica` sí valida al operador. |
| P3-08 | WARNING | SUGGESTION | CONFIRMADO | `droga-repository.ts:113-114`: `Number()` solo para el filtro "bajo mínimo" de un listado; viola la regla de `AGENTS.md` pero no afecta montos ni saldos guardados. |
| P3-09 | SUGGESTION | SUGGESTION | CONFIRMADO | Sin idempotencia en existencia inicial ni receta presencial ante reintento tras corte de red. |

### Clasificación para producción

**Antes del deploy**
1. ~~P3-03~~ **CORREGIDO** (sin commit aún): los 6 repositorios hacen `UPDATE … SET x = x + 1, bloqueo = CASE/expresión sobre x + 1 … RETURNING x`; la aplicación decide la auditoría de bloqueo con el valor devuelto. Cubre login, reautenticar (PIN), verificador PIN de cuentas de sector, co-firma DT (stock y libro, que también usan reactivar entregas y reanálisis), firma de cierre y destrucción de archivo. Tests unitarios actualizados; sin prueba de concurrencia contra la DB.

**Antes de habilitar el contralor digital**
- ~~P3-01~~ **CORREGIDO**: `registrarPartidaCompra` escribe el asiento INGRESO (con el vale) y `registrarAjusteEnTx` el AJUSTE (ajuste, pérdida y vencimiento pasan por ahí), en la misma transacción, cuando la droga es controlada y el contralor está activo (`requiereAsientoContralor`). Sin prueba contra la base con contralor activo.

**En el tiempo**
- ~~P3-02~~ **CORREGIDO**: reservar, recalcular y registrar pérdida bloquean las partidas candidatas del excipiente en la misma sentencia ordenada por id que las de las líneas (`planificarConsumoEnTx.partidasAdicionales`, `partidasCandidatasExcipienteEnTx`).
- ~~P3-04~~ **CORREGIDO**: migración `0103_pesada_real_jornada` (+ `.down.sql`); spec `openspec/specs/pesada-real/spec.md` y su rollback actualizados.
- ~~P3-07~~ **CORREGIDO**: `generarFichasYCotizaciones` trata el `AuthorizationError` del caso de uso (que ya resuelve al operador) como "sin permiso" silencioso, igual que el chequeo de sesión.
- ~~P3-06~~ **CORREGIDO**: migración `0104_forbid_truncate` (+ `.down.sql`): trigger `BEFORE TRUNCATE` en las 32 tablas con `forbid_update_delete`/`forbid_delete`; aplicada y verificada en la base de prueba. Regla en `docs/architecture.md`.
- ~~P3-08~~ **CORREGIDO**: `dec()` en el filtro bajo mínimo (`droga-repository.ts`) y en `esDecimalPositivo` (`presupuesto.ts`).
- ~~P3-09~~ **CORREGIDO**: alta manual de receta idempotente (`envio_id`, migración `0102_receta_envio_id`, spec `openspec/specs/alta-receta-idempotente/spec.md`). Existencia inicial ya era idempotente por la unicidad de lote.

---

## Informe original del revisor (resumido)

### A. Encabezado
- Ejecutado: `git rev-parse HEAD`, `git status --short`, `git diff` de los archivos sin commitear, `npm run typecheck` (0 errores), `npm run lint` (0 errores, 285 warnings), SELECT sobre `_prisma_migrations`, `pg_proc`, `pg_trigger`, `pg_class`, `pg_event_trigger`, `information_schema.role_table_grants/column_privileges/columns`, `fsj.rol`, `fsj.permiso`, `fsj.rol_permiso`.
- No ejecutado: `npm run dev/build/install`, migraciones, `scripts/*`, `npm test`, `npm run test:db`.

### B. Resumen
Conteo original: BLOCKER 1 · CRITICAL 2 · WARNING 5 · SUGGESTION 1.

### C. Hallazgos (originales)
| ID | Sev. | Ubicación | Resumen | Acción propuesta |
|---|---|---|---|---|
| P3-01 | BLOCKER | `ingresar-partida.ts:160-246`, `registrar-ajuste.ts:156-246`, `0100/migration.sql:165-199` | Con contralor activo, INGRESO_COMPRA y AJUSTE de drogas controladas fallan al COMMIT por INV-L08 (sin `asiento_contralor`). | Insertar el asiento INGRESO/AJUSTE en la misma transacción. |
| P3-02 | CRITICAL | `reservar-stock-preparacion.ts:70-78`, `recalcular-reserva-stock.ts:71-78`, `excipiente-preparacion.ts:15-17,69` | Lock de partidas en dos sentencias: deadlock AB-BA contra `confirmarReservasReceta`/`registrarPerdidaReserva`. | Un único lock ordenado por id. |
| P3-03 | CRITICAL | `verificar-co-firma-dt.ts` (stock y libro), `verificar-password-firma.ts`, `verificar-password-destruccion.ts`, `login.ts`, `reautenticar.ts`, `verificar-operador.ts` | Lost update en los contadores de intentos: peticiones paralelas evitan el bloqueo. | `UPDATE … SET intentos_fallidos = intentos_fallidos + 1 … RETURNING` o `FOR UPDATE`. |
| P3-04 | WARNING | `0088_pesada_real/migration.sql:87` | `current_date` en lugar de `jornada_actual`. | Migración correctiva. |
| P3-05 | WARNING | `0097`, `anular-asiento.ts:105,116`, `receta-coupling-repository.ts:218` | Trazabilidad de números tras renumerar. | Registrar delta y asientos renumerados. |
| P3-06 | WARNING | `0003_registro_auditoria` | Sin protección BEFORE TRUNCATE en tablas inmutables. | Trigger BEFORE TRUNCATE FOR EACH STATEMENT. |
| P3-07 | WARNING | `generar-fichas-y-cotizaciones.ts:46-48`, `receta-form.tsx:321-325` | Usa la sesión del sector, no la del operador. | Resolver la sesión efectiva del operador. |
| P3-08 | WARNING | `droga-repository.ts:113-114`, `presupuesto.ts:173` | `Number()` sobre cantidades. | `dec(...)`. |
| P3-09 | SUGGESTION | `ingresar-existencia-inicial.ts:43-87`, `crear-receta.ts:141-249` | Sin clave de idempotencia. | Token por envío o aviso de duplicado. |

### D. Conforme según el revisor
- `fsj.hash_v2` (prefijo de longitud, sin colisiones por delimitador), `asiento_recetario_preparar` y `asiento_contralor_preparar` (contador con `FOR UPDATE`, hash calculado en la base, orden fijo de locks entre libros).
- `libro_configurar_numeracion` y `cierre_diario_firmar` comparten el advisory lock por tenant; la renumeración evita colisiones de UNIQUE y recalcula la cadena desde `hash_genesis`.
- `registro_auditoria`: `fsj_app` solo SELECT e INSERT; trigger contra UPDATE/DELETE.
- Los 18 `audit: { skip: true }` auditan dentro de la misma transacción o están excluidos por INV-A01.
- Co-firma del DT en ajustes: la ventana entre transacciones la cierran los triggers `movimiento_stock_validar_ajuste` e INV-U07 (salvo `pesada_real`, P3-04).
- Existencia inicial (0100): INV-S24, INV-S25 y la exención de INGRESO_INICIAL en el contralor coinciden con la spec.
- Columnas `numeric` sin escala restrictiva, compatibles con Decimal.

### E. Pruebas propuestas (no ejecutadas)
T3-01 correlatividad con asientos y cierres simultáneos · T3-02 consumos y reservas simultáneos del mismo lote · T3-03 deadlock reserva vs confirmación con excipiente · T3-04 atomicidad negocio/auditoría ante fallo inducido · T3-05 compras y ajustes de controladas con contralor activo · T3-06 5 intentos fallidos concurrentes dejan `intentos_fallidos = 5` y bloqueo.

### F. Verificaciones en producción
`fsj.verificar_cadena` sin roturas en todos los libros; triggers de inmutabilidad habilitados; `fsj_app` solo SELECT/INSERT en `registro_auditoria`; saldo de cada partida igual a la suma de sus movimientos.

### G. Observaciones para otras partes
- Parte 4: parsers `receta-pdf-parser.ts`, `receta-rcta-api.server.ts`, `factura-compra-pdf-parser.ts`, `leer-xls.server.ts`, `leer-xlsx.server.ts`.
- Parte 5: los jobs diarios recorren todos los tenants en una sola invocación (timeouts de Vercel).
- Parte 6: incorporar T3-01 a T3-06.
