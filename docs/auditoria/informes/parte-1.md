# Parte 1 — Aislamiento multi-tenant y base de datos

- Commit base del informe: `38979569d78dffa8d99caa6f3c3aa7124bb85d1e`
- Revisión del auditor del plan: 2026-10-23, contra `1b6eddb` y la base de prueba (`darnaecixvaezbwjtfjf`, solo SELECT).

## Revisión del auditor del plan

### Veredicto sobre el informe

Pertinente y mayormente correcto. De 10 hallazgos: 5 confirmados (con 2 severidades
ajustadas), 1 confirmado y agravado, 1 por diseño, 1 desactualizado y 2 sugerencias válidas.

Desvíos del revisor:
- Leyó `.env` para confirmar la base de prueba. Las reglas de esta corrida solo prohibían imprimir sus valores (corrección de la revisión inicial); imprimió host y project ref, que no son secretos.
- Citó la migración 0039 como definición de `fsj.cierre_diario_firmar`; la vigente es
  `prisma/migrations/20261022090000_0097_libro_numeracion_inicial/migration.sql:368`. La conclusión se sostiene.
- Las "Observaciones para otras partes" usan una numeración distinta a la del plan. Reasignación:
  `usuario_resolve_login`, `sesion_resolve_tenant`, `resolverActor` → Parte 2; `hash_v2`/`hash_genesis`,
  triggers de correlatividad, `audit: { skip: true }` en `actualizar-plazos.ts`, inmutabilidad de
  `registro_auditoria` → Parte 3; `app/api/farmacia/logo/route.ts` → Parte 4.

### Verificación por hallazgo

| ID | Original | Revisado | Veredicto | Evidencia de la revisión |
|---|---|---|---|---|
| P1-01 | CRITICAL | WARNING | CONFIRMADO | Única función SECURITY DEFINER de `fsj` que recibe `p_tenant_id` sin comparar con `current_tenant_id()` (consulta a `pg_proc`). `libro_configurar_numeracion` sí la tiene (0097:252). El caller pasa el tenant de la sesión, así que no es explotable sin otro bug; es defensa en profundidad sobre la operación legal más sensible. |
| P1-02 | CRITICAL | SUGGESTION | POR DISEÑO | `fsj.tenant` sin RLS es deliberado (0001:108, 0020:61, INV-PL-004) y el UPDATE cruzado está bloqueado por trigger. La política propuesta (`OR current_tenant_id() IS NULL`) anularía la protección. Exposición real: datos institucionales de otras farmacias si un bug de la app los consulta sin filtrar. |
| P1-03 | WARNING | WARNING | CONFIRMADO, NO EXPLOTABLE HOY | Solo `usuario_resolve_login` hace `REVOKE ... FROM PUBLIC` (0010:73). `anon`/`authenticated` no tienen `USAGE` sobre `fsj` (verificado). |
| P1-04 | WARNING | WARNING | CONFIRMADO | `lote_archivo_recetas_asignar_numero` es la única SECURITY DEFINER sin `search_path` (pg_proc; 0042:114). |
| P1-05 | WARNING | WARNING (bloquea deploy) | CONFIRMADO Y AGRAVADO | `20261022100000_0097_contrasena_temporal` está aplicada en la base, no existe en ninguna rama (`git log --all`) y creó `fsj.usuario.debe_cambiar_password`, que ningún código referencia. La base de prueba no representa lo que recibirá producción. |
| P1-06 | WARNING | — | DESACTUALIZADO | 0098 quedó commiteada en `359aa7c`. |
| P1-07 | WARNING | WARNING (bloquea deploy) | CONFIRMADO | `shared/env.ts` exige `DIRECT_URL`; `docs/deploy.md:13` dice que no va en Vercel. Obliga a poner credenciales del owner `postgres` en el runtime o el arranque falla. |
| P1-08 | WARNING | — | POR DISEÑO | El conteo entre tenants es intencional (DP-39, `unidad-repository.ts:169-175`): `unidad_medida` es catálogo global e INV-M04 necesita saber si la usa cualquier tenant. Solo expone un entero. |
| P1-09 | SUGGESTION | SUGGESTION | VÁLIDA | — |
| P1-10 | SUGGESTION | SUGGESTION | NO VERIFICADO | Cantidad (72) no recontada. Rendimiento, no seguridad. |

Hallazgo adicional de la revisión:
- **P1-11 (SUGGESTION)**: números de migración duplicados (0051, 0071, 0077, 0096, 0097 ×2). Prisma ordena por nombre completo, así que no rompe, pero confunde la trazabilidad de rollbacks.

### Clasificación para producción

**Estado de los arreglos (2026-10-23)**: P1-01, P1-03 y P1-04 en la migración `0101_security_definer_hardening` (sin aplicar); P1-07 en `shared/env.ts` (`DIRECT_URL` fuera del schema de runtime).

**Antes del deploy**
1. P1-01 + P1-04 + P1-03 en una sola migración de hardening (guarda de tenant en `cierre_diario_firmar`, `search_path` en `lote_archivo_recetas_asignar_numero`, `REVOKE ... FROM PUBLIC` + `GRANT` explícito a `fsj_app`) con su `.down.sql`.
2. P1-07: `DIRECT_URL` opcional en `shared/env.ts`, exigida solo por los scripts.
3. P1-05: origen aclarado por el equipo (2026-10-23): es un fix de otro usuario, todavía no integrado al repo. Condición de cierre: su migración (con `.down.sql`) llega a `master` antes del deploy, así la base auditada coincide con la que recibe producción.

**En el tiempo**
- P1-02: evaluar restringir columnas de `fsj.tenant` expuestas a `fsj_app` (vista o grants por columna).
- P1-09: fallar explícitamente ante consultas sin contexto de tenant.
- P1-10: índices en FKs compuestas de tablas de alto volumen, medido con datos reales.
- P1-11: convención de numeración única de migraciones.

---

## Informe original del revisor

### A. Encabezado

- Alcance: Parte 1 — Aislamiento multi-tenant, RLS, políticas, roles y base de datos.
- Commit base: `38979569d78dffa8d99caa6f3c3aa7124bb85d1e`
- Estado del árbol: 11 archivos modificados y 10 sin seguimiento (trabajo de logo de farmacia, migración 0098, `docs/auditoria/`).
- Ejecutado: `git rev-parse HEAD`, `git status --short`, lectura de versiones en `package.json` (Next 16.4.1, React 19.2.8, Prisma 7.10.1, zod 4.6.5, decimal.js 10.6.0), lectura de `.env` sin imprimir secretos, `SELECT migration_name, started_at, finished_at, checksum FROM public._prisma_migrations`, SELECT sobre `pg_class`, `pg_namespace`, `pg_roles`, `pg_auth_members`, `pg_policies`, `pg_proc`, `pg_trigger`, `information_schema.table_constraints`, `information_schema.key_column_usage`, `information_schema.columns`; advisors emulados sobre el catálogo.
- No ejecutado: `npm run dev/build/install`, formateadores, DDL/DML, `prisma migrate *`, `prisma db push`, `apply_migration`, `scripts/db-*`, mutaciones entre tenants.

### B. Resumen

1. `fsj.cierre_diario_firmar` (SECURITY DEFINER) no valida `p_tenant_id` contra `fsj.current_tenant_id()`.
2. `fsj.tenant` sin RLS y con SELECT global para `fsj_app`.
3. 11 funciones SECURITY DEFINER con EXECUTE para PUBLIC; `lote_archivo_recetas_asignar_numero` sin `search_path`.
4. Migración `20261022100000_0097_contrasena_temporal` aplicada en la base y ausente del repo; 0098 aplicada sin commitear.
5. `shared/env.ts` exige `DIRECT_URL` en runtime.

Conteo: BLOCKER 0 · CRITICAL 2 · WARNING 6 · SUGGESTION 2.

### C. Hallazgos

| ID | Sev. | Conf. | Estado | Ubicación | Evidencia | Riesgo | Acción | Cierre |
|---|---|---|---|---|---|---|---|---|
| P1-01 | CRITICAL | ALTA | CONFIRMADO | 0039 y `pg_proc` | `cierre_diario_firmar(p_tenant_id uuid, …)` SECURITY DEFINER sin guarda de tenant, a diferencia de `libro_configurar_numeracion`. | Firmar y cerrar jornadas de otro tenant pasando un UUID ajeno. | Agregar `IF p_tenant_id IS DISTINCT FROM fsj.current_tenant_id() THEN RAISE EXCEPTION 'INV-T01: cross-tenant execution forbidden' USING ERRCODE = 'P0001'; END IF;` | Con `p_tenant_id` ajeno rechaza con P0001. |
| P1-02 | CRITICAL | ALTA | CONFIRMADO | 0001:107-118 | `fsj.tenant` con `relrowsecurity = false`; `fsj_app` con SELECT. | Enumerar farmacias: CUIT, razón social, teléfonos, domicilios, logos. | RLS con `USING (id = fsj.current_tenant_id() OR fsj.current_tenant_id() IS NULL)`; jobs vía `withPlatformTransaction`. | `SELECT COUNT(*)` bajo `fsj_app` con tenant seteado devuelve 1. |
| P1-03 | WARNING | ALTA | CONFIRMADO | `pg_proc`, migraciones 0011–0019 | 11 SECURITY DEFINER sin `REVOKE ALL … FROM PUBLIC`. | Ejecutables vía PostgREST si en el futuro `anon`/`authenticated` obtienen USAGE sobre `fsj`. | `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fsj FROM PUBLIC;` + GRANT explícito a `fsj_app`. | `has_function_privilege('anon'/'authenticated', …, 'EXECUTE')` = false. |
| P1-04 | WARNING | ALTA | CONFIRMADO | 0016 / `pg_proc` | `lote_archivo_recetas_asignar_numero` con `prosecdef = true`, `proconfig` NULL. | Secuestro de `search_path` (CWE-426). | `SET search_path TO 'fsj', 'extensions'`. | `proconfig` = `search_path=fsj, extensions`. |
| P1-05 | WARNING | ALTA | CONFIRMADO | `_prisma_migrations` | `20261022100000_0097_contrasena_temporal` aplicada y ausente del repo. | Deriva repo/base; fallos en entornos nuevos. | Investigar origen; reincorporar con rollback o limpiar. | 1:1 entre `prisma/migrations/` y `_prisma_migrations`. |
| P1-06 | WARNING | ALTA | CONFIRMADO [WIP] | `…_0098_tenant_logo/` | 0098 aplicada en la base y sin commitear. | HEAD falla contra una base limpia. | Commitear o documentar WIP. | Sin migraciones pendientes en `git status`. |
| P1-07 | WARNING | ALTA | CONFIRMADO | `shared/env.ts:24-26` | `DIRECT_URL: z.string().min(1)`; `shared/db/client.ts` solo usa `DATABASE_URL`. | Siguiendo `docs/deploy.md` el server no arranca; si se configura, expone el owner en runtime. | `.optional()` y validación solo en scripts. | Producción arranca solo con `DATABASE_URL`. |
| P1-08 | WARNING | MEDIA | CONFIRMADO | 0006 / `pg_proc` | `contar_drogas_por_unidad` SECURITY DEFINER cuenta `fsj.droga` sin filtrar tenant. | Conteo global de drogas por unidad visible a cualquier tenant. | Filtrar por tenant o quitar SECURITY DEFINER. | Devuelve solo el conteo del tenant. |
| P1-09 | SUGGESTION | ALTA | CONFIRMADO | `shared/db/transaction.ts:51` | Sin contexto, RLS devuelve 0 filas en silencio. | Errores silenciosos en consultas sueltas. | Validación o política estricta contra el uso directo de `getPrismaClient()`. | Tests que fallan explícitamente sin tenant. |
| P1-10 | SUGGESTION | ALTA | CONFIRMADO | `pg_constraint` / `pg_index` | 72 FKs compuestas sin índice con prefijo de la FK. | Degradación en tablas de alto volumen. | Índices en las FKs faltantes. | Advisor sin FKs desindexadas. |

### D. Cobertura (según el revisor)

| Control | Estado | Observación |
|---|---|---|
| RLS por tabla en `fsj` | VERIFICADO Y CONFORME | 54 tablas con RLS habilitado y forzado. |
| Políticas RLS | VERIFICADO Y CONFORME | 54 políticas `tenant_id = fsj.current_tenant_id()` en lectura y escritura; ninguna `qual = true`. |
| Exclusiones de RLS (`tenant`, `permiso`, `unidad_medida`) | HALLAZGOS | `permiso` y `unidad_medida` son catálogos globales legítimos; `tenant` → P1-02. |
| Atributos de `fsj_app` | VERIFICADO Y CONFORME | `rolbypassrls = false`, `rolsuper = false`, sin membresías privilegiadas. |
| Exposición PostgREST | VERIFICADO Y CONFORME | `anon`/`authenticated` sin USAGE ni privilegios sobre `fsj`. |
| Funciones SECURITY DEFINER | HALLAZGOS | 14 revisadas: P1-01, P1-03, P1-04, P1-08. |
| Integridad referencial entre tenants | VERIFICADO Y CONFORME | 120/128 FKs compuestas con `tenant_id`. |
| Pooling (Supavisor) | VERIFICADO Y CONFORME | `set_config(…, true)` local a la transacción. |
| Migraciones y rollbacks | HALLAZGOS | Rollback en todas desde 0055; P1-05, P1-06. |
| Reglas ESLint | VERIFICADO Y CONFORME | `eslint.config.mjs` prohíbe importar `shared/db/transaction` desde `app/**` y `modules/**`. |

### E. Pruebas propuestas (no ejecutadas)

1. **Firma cruzada de cierre**: como `fsj_app`, con `app.tenant_id` = A, invocar `fsj.cierre_diario_firmar('<B>', …)`. Esperado: rechazo P0001. Requiere base aislada con rollback.
2. **Catálogo de farmacias**: como `fsj_app` con tenant A, `SELECT id, razon_social, cuit, domicilio, telefono_celular, logo FROM fsj.tenant`. Esperado (según el revisor): 1 fila.
3. **Consulta sin contexto**: `SELECT count(*) FROM fsj.paciente` sin `set_config`. Esperado: 0.

### F. Verificaciones en producción

1. Supabase › Settings › API › Exposed schemas no incluye `fsj`. Comprobación: `curl -i -H "apikey: <SUPABASE_ANON_KEY>" https://<PROJECT_REF>.supabase.co/rest/v1/receta` responde 404 o schema inválido.
2. `DATABASE_URL` en Vercel usa el puerto 6543 y `pgbouncer=true`.

### G. Observaciones para otras partes (numeración original del revisor)

- `fsj.usuario_resolve_login`: SECURITY DEFINER que devuelve el hash antes de fijar el tenant; revisar enumeración de correos y tiempos de respuesta.
- `fsj.sesion_resolve_tenant`: resolución del tenant a partir del hash del token.
- `resolverActor` en `shared/usecase.ts` con cuentas de sector (`esSector = true`) y `accion_con_pin`.
- `fsj.hash_v2`, `fsj.hash_genesis`, `asiento_recetario_preparar`, `asiento_contralor_preparar`.
- `audit: { skip: true }` en `actualizar-plazos.ts`; inmutabilidad de `fsj.registro_auditoria` frente a TRUNCATE y DELETE de roles administrativos.
- `app/api/farmacia/logo/route.ts`: magic bytes, SVG/XSS y almacenamiento en bytea.
