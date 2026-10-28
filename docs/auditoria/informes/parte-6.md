# Parte 6 — Cobertura de tests y consolidación final

- Commit base declarado: `0511379`. El informe cita además `aa0050d`, `12419a3` y `f037bb7`: corrió mientras se commiteaban los arreglos de la parte 5.
- Revisión del auditor del plan: 2026-10-23, contra el código y la base de prueba.

## Revisión del auditor del plan

### Veredicto sobre el informe

Sirve como consolidación: el estado CERRADO de cada hallazgo de las partes 1 a 5 coincide con los commits, y no inventa bloqueantes. Las dos conclusiones centrales son correctas:
- No queda nada de código que impida el deploy.
- El contralor digital no debe habilitarse sin una prueba contra la base del camino real de compra y ajuste.

En cambio, las partes del informe que mira la base o la configuración tienen errores, y abajo se corrigen.

Desvíos del revisor:
- **P5-08 figura [WIP].** Está commiteado en `aa0050d` → CERRADO.
- **Lista de "FK críticas" equivocada.** De las seis FK que nombra, cinco ya tienen índice: `movimiento_stock(partida_id)`, `asiento_recetario(receta_id)`, `receta(paciente_id)`, `partida(droga_id)` y `asiento_recetario(libro_id)`. Solo `asiento_recetario(cierre_diario_id)` no lo tiene (SELECT sobre `pg_constraint`/`pg_index`). Las FK de actor (`registrado_por`, `pagada_por`, …) no necesitan índice: un usuario nunca se borra y nadie filtra por ellas.
- **`?pgbouncer=true` en el checklist.** No aplica: la app usa el driver adapter `@prisma/adapter-pg` (`shared/db/client.ts`), y ese parámetro es del query engine de Prisma.
- **`maxDuration: 60`.** Es insuficiente: la transacción ahora puede durar 60 s (P5-03), así que la función necesita más.
- **"Media en DB, falta test de concurrencia".** Subestima: `tests/db/` tiene 54 archivos, entre ellos `contralor.test.ts` (triggers con contralor activo), `cierre-firma-concurrencia.test.ts` y `prisma-relation-loading-concurrency.test.ts`. Lo que falta es el camino de la app sobre esos triggers y la concurrencia de los arreglos de la parte 3.

### Estado consolidado

**Cerrados (verificados en código):**

| Parte | Hallazgos |
|---|---|
| 1 | P1-01, P1-03, P1-04, P1-05, P1-06, P1-07 (P1-08 por diseño) |
| 2 | P2-04 (P2-05 no reproducible) |
| 3 | P3-01 a P3-09 (P3-05 falso positivo) |
| 4 | P4-02, P4-03 y logo del tenant en PDF (P4-01 y P4-05 no son hallazgo) |
| 5 | P5-01 (primera parte), P5-03, P5-05, P5-07, P5-08 (P5-04 pasa al checklist) |

**Abiertos:**
P1-02, P1-09, P1-10, P1-11, P2-01, P2-02 (configuración), P2-03, P4-04, P5-01b, P5-02 (configuración), P5-06.

### Clasificación para producción

**Obligatorio antes de producción (configuración, sin código)**
1. P2-02: regla de rate limit por IP en el Firewall de Vercel para `/login`.
2. P5-02: Fluid compute activo (300 s), o `maxDuration` ≥ 90 s en `/api/jobs/*` y en las páginas con importaciones en lote.
3. P5-04: Vercel `gru1` y Supabase de producción en `sa-east-1`.
4. Supabase: `fsj` fuera de *Exposed schemas*; `DIRECT_URL` ausente en Vercel; `CRON_SECRET` de alta entropía.
5. Producción: `prisma migrate deploy` aplica 0102–0104. Prueba: registrarlas con `prisma migrate resolve --applied` (lo corre el usuario) para habilitar `npm run test:db`.

**Antes de habilitar el contralor digital**
- T3-05: test contra la base que corra `registrarPartidaCompra` y `registrarAjusteEnTx` (no solo los triggers) con `fecha_activacion_contralor` cargada, y verifique el commit y la fila en `asiento_contralor`.

**Trabajo restante (sin deuda técnica), en orden**
1. Tests unitarios de regresión:
   - T3-09: `crearReceta` con un `envioId` repetido devuelve `RecetaYaRegistradaError` sin insertar.
   - T2-04: `crearProductoDesdeFacturaAction` sin operador en una cuenta de sector.
   - T5-03: opciones de `$transaction`.
2. Tests contra la base (requieren el paso 5 de arriba):
   - T3-06: intentos de login y PIN concurrentes;
   - T3-05;
   - T3-03: orden de locks con excipiente;
   - T1-01: `cierre_diario_firmar` con otro tenant;
   - TRUNCATE rechazado.
3. P1-10, índices de las FK que usa el código:
   - `asiento_recetario(tenant_id, cierre_diario_id)`;
   - `movimiento_stock(tenant_id, preparacion_id)`;
   - `receta(tenant_id, medico_id)`;
   - `receta(tenant_id, lote_archivo_id)`.

   Confirmar cada uno contra las consultas reales antes de la migración.
4. P2-03: payload opaco en `/api/health`.
5. P2-01: latencia pareja en el login con email inexistente.
6. P1-09: fallo explícito sin `app.tenant_id`.
7. P5-01b: serializador de errores del logger.
8. P5-06: `import "server-only"` en `infrastructure/` y `application/`.
9. P1-02: columnas de `fsj.tenant` visibles para `fsj_app`.
10. P4-04 es opcional (el tope de 5000 filas ya protege). P1-11 es solo una convención para el futuro: no se renumeran migraciones aplicadas.

---

## Informe original del revisor (resumido)

### A. Encabezado
- Base de prueba `darnaecixvaezbwjtfjf` (pooler `sa-east-1`, rol `fsj_app`).
- Resultados: `npm test` 198 archivos y 3601 tests OK; lint 0 errores (285 warnings); typecheck OK; `npm audit --omit=dev` 0.
- DDL de 0102–0104 verificado. Sin filas en `_prisma_migrations`, por eso `test:db` aborta en el global-setup.
- `tests/e2e/` vacío.

### B. Resumen
- Riesgos principales:
  - rate limit de `/login` (P2-02);
  - contralor sin test contra la base (P3-01);
  - timeout de importaciones (P5-03);
  - concurrencia sin tests reales;
  - FK sin índice.
- Abiertos: 0 BLOCKER, 0 CRITICAL, 3 WARNING (P2-02, P5-02, P5-08 [WIP]), 9 SUGGESTION.
- Estado por módulo: todos LISTO; Stock con bloqueante para el contralor; Auth con la observación del rate limit.

### C. Pruebas propuestas
- Base aislada: T3-06, T3-05, T3-03, T1-01, TRUNCATE.
- Unitarias: T3-09, T2-04, T5-03.

### D. Checklist de producción
- Schemas expuestos de Supabase.
- `DATABASE_URL` al pooler 6543, sin `DIRECT_URL`, región.
- Rate limit en el Firewall.
- Fluid compute o `maxDuration`.
- `CRON_SECRET` y 404 sin token.
- Headers (HSTS `max-age=63072000; includeSubDomains; preload`, nosniff, `X-Frame-Options`, CSP con nonce, cookie `HttpOnly; Secure; SameSite=Lax`).
- `fsj.verificar_cadena` periódico.
