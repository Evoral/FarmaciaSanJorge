# Despliegue

FASE 14 puntos 14.1, 14.4, 14.5 (`docs/plan-implementacion.md`). DP-35 RESUELTA (2026-09-25): hosting en **Vercel**, región `gru1` (São Paulo) -- misma región que el proyecto Supabase (`sa-east-1`), para minimizar la latencia entre la app y la base de datos. **No hay operación offline**: la farmacia necesita conectividad a internet para usar el sistema; no existe un modo local/servidor en el sitio.

## 1. Variables de entorno

Fuente de verdad: `shared/env.ts` (validación con zod, la ÚNICA lectura directa de `process.env` fuera de `scripts/**`/`tests/db/**`) y `.env.example` (plantilla comentada). Configurar en **Vercel → Project → Settings → Environment Variables**, con el scope correcto (`Production`/`Preview`/`Development`).

| Variable | Requerida | Usada por | Notas de producción |
|---|---|---|---|
| `NODE_ENV` | No (Vercel la fija) | toda la app | Vercel la setea a `production` en runtime automáticamente; no hace falta declararla a mano. |
| `DATABASE_URL` | Sí | runtime (`shared/db/client.ts`), `prisma migrate deploy` vía `DIRECT_URL` (ver §4) | Connection string del **pooler de Supabase** (Supavisor, modo TRANSACTION, puerto 6543), rol restringido `fsj_app`. Ver §3 para los parámetros obligatorios. |
| `DIRECT_URL` | Sí | SOLO migraciones/bootstrap (`scripts/db-migrate.ts`, `scripts/db-bootstrap.ts`, `scripts/create-tenant.ts`) -- nunca en runtime de la app | Connection directa (puerto 5432), rol owner `postgres`. En Vercel solo hace falta si se dispara una migración desde CI/Vercel (no recomendado, ver §4) -- para migración manual/CI externo alcanza con tenerla en ese entorno, no en el proyecto Vercel. |
| `LOG_LEVEL` | No (default `info`) | `shared/logging/logger.ts` | `info` es razonable para producción; `debug`/`trace` solo para diagnóstico puntual (nunca dejar en `trace` de forma permanente -- volumen de logs). |
| `CRON_SECRET` | Recomendada (opcional a nivel de código, pero sin ella el job nunca corre -- responde 503) | `app/api/jobs/plazos-archivo/route.ts` | Ver §5. Vercel puede generarla y setearla automáticamente al agregar el proyecto a Cron Jobs, o se genera a mano (≥16 caracteres aleatorios) y se pega en ambos lugares (env var + nada más -- Vercel la envía sola en el header `Authorization`). |
| `FSJ_APP_DB_PASSWORD` | Solo para `db:bootstrap` | `scripts/db-bootstrap.ts` (setea el password de `fsj_app`) | NO debe vivir en el proyecto Vercel (no la usa el runtime). Usarla una vez desde una máquina/CI con acceso a `DIRECT_URL`, luego se puede quitar del entorno donde se corrió. |
| `FSJ_DB_TESTS` | No | `tests/db/**` (`npm run test:db`) | Solo desarrollo/CI de tests contra BD real; no aplica a Vercel. |

Ninguna de estas variables se loguea nunca (`shared/logging/logger.ts#REDACT_PATHS` redacta `DATABASE_URL`/`DIRECT_URL` como defensa en profundidad) ni se expone en `/api/health` (§6).

## 2. Setup del proyecto en Vercel

1. Importar el repositorio (framework detectado: Next.js).
2. **Settings → General → Root Directory**: raíz del repo (donde está `package.json`/`next.config.ts`).
3. **Settings → Environment Variables**: cargar `DATABASE_URL`, `LOG_LEVEL` (opcional), `CRON_SECRET` para `Production` (y `Preview` si se usan previews contra una BD de verdad -- si no, dejar `Preview` sin `DATABASE_URL` para que esos builds fallen rápido en vez de pegarle a producción por error).
4. **Settings → Functions → Region** (o via `vercel.json`, ya versionado en el repo -- ver abajo): `gru1` (São Paulo).
5. **Settings → Cron Jobs**: se activa solo con el archivo `vercel.json` del repo (§5) -- no hace falta configurar nada manualmente en el dashboard más que confirmar que aparece listado tras el primer deploy.
6. Plan: **Vercel Hobby es para uso no comercial** (ver Términos de Vercel) -- una farmacia es un uso comercial, por lo que el proyecto necesita **plan Pro** (o superior) como mínimo.

`vercel.json` (ya en el repo):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["gru1"],
  "crons": [
    { "path": "/api/jobs/plazos-archivo", "schedule": "0 6 * * *" }
  ]
}
```

## 3. Base de datos: pooler de Supabase en modo transacción

El runtime (`shared/db/client.ts`) usa **Prisma 7 con el driver adapter `@prisma/adapter-pg`** (paquete `pg`/node-postgres), NO el motor nativo de Prisma -- esto importa para las recomendaciones de abajo, que difieren de la guía genérica de Prisma+PgBouncer.

- **`pgbouncer=true`** en `DATABASE_URL`: mantenido como parámetro requerido (documentado en `.env.example`) siguiendo la recomendación oficial de Supabase para clientes Prisma contra Supavisor en modo transacción. Con el adapter `pg`, Prisma no nombra prepared statements por defecto (`@prisma/adapter-pg` solo los nombra si se pasa `statementNameGenerator`, que este proyecto no usa), así que el riesgo clásico de "prepared statement does not exist" es menor que con el motor nativo -- aun así se mantiene el parámetro por ser la guía oficial de la plataforma y no tener costo.
- **Tamaño del pool (`max`)**: `pg.Pool` por defecto abre hasta 10 conexiones. Como Vercel corre cada instancia serverless con su propio proceso (y por lo tanto su propia instancia del singleton `getPrismaClient()`), un `max` alto multiplica por la cantidad de instancias calientes concurrentes y puede agotar el presupuesto de conexiones de Supavisor. `shared/db/client.ts` fija `max: 3` explícitamente en el `PoolConfig` que recibe `PrismaPg` (no es configurable por variable de entorno a propósito: es una constante de la topología Vercel+Supavisor, no un ajuste por-deploy).
- **Compatibilidad de `withTenantTransaction` (RLS multi-tenant) con el pooler transaccional**: `shared/db/transaction.ts#withTenantTransaction` ejecuta `SELECT set_config('app.tenant_id', $1, true)` (el tercer argumento `true` = local a la transacción) **dentro de la misma transacción interactiva de Prisma** (`prisma.$transaction(async (tx) => {...})`) que las queries subsiguientes. Con el adapter `pg`, una transacción interactiva de Prisma mantiene **un único cliente del pool** desde `BEGIN` hasta `COMMIT`/`ROLLBACK` -- exactamente lo que Supavisor en modo transacción espera: asigna una conexión de backend real por transacción del cliente, no por query suelta. Como `set_config(..., true)` y las queries que dependen de `app.tenant_id` para RLS viajan siempre juntas dentro del mismo bloque `$transaction`, nunca cruzan a una conexión de backend distinta -- **es compatible**. El riesgo que este patrón evita a propósito es justamente ejecutar `SET LOCAL`/`set_config` fuera de una transacción explícita: eso SÍ sería inseguro con un pooler transaccional (la siguiente query podría caer en otra conexión de backend sin el `app.tenant_id` seteado). El código ya sigue la disciplina correcta; no se requirió ningún cambio.
- **`withPlatformTransaction`** (operaciones sin tenant, ej. alta de tenant) usa el mismo mecanismo de transacción interactiva, sin `set_config` -- mismo razonamiento, sin riesgo adicional.

## 4. Migraciones -- SIEMPRE manuales/CI, NUNCA en el build de Vercel

`package.json#scripts.build` es `next build` a secas -- **no invoca `prisma migrate deploy` ni ningún script de `scripts/**`**. Esto es intencional y debe mantenerse así: un build de Vercel puede dispararse por cualquier push/PR (incluyendo previews), y una migración no debe correr automáticamente en ese contexto.

Lo único que SÍ corre en cada build/install es `prisma generate`, cableado como `postinstall` (`package.json`):

```json
"postinstall": "prisma generate"
```

`prisma generate` solo lee `prisma/schema.prisma` y escribe el cliente generado (`generated/prisma`, ver el bloque `generator client` del schema) -- no abre conexión a la base, así que es seguro correrlo en cada build sin credenciales de BD disponibles (mismo razonamiento que `shared/env.ts` documenta para la validación lazy de env vars).

**Procedimiento de migración (manual, rol owner, antes de promover un deploy):**

1. Desde una máquina/CI con `DIRECT_URL` apuntando al proyecto Supabase correcto (rol `postgres`, owner -- nunca `fsj_app`):
   ```
   npm run db:migrate
   ```
   (`scripts/db-migrate.ts`: corre `prisma migrate deploy` forzando `DATABASE_URL=$DIRECT_URL` para ese comando puntual -- ver el comentario del script para el porqué).
2. Primera vez sobre una base nueva únicamente, después de `db:migrate`:
   ```
   npm run db:bootstrap
   ```
   (`scripts/db-bootstrap.ts`: crea el login/password del rol `fsj_app` a partir de `FSJ_APP_DB_PASSWORD`; idempotente, se puede re-correr al rotar el password).
3. Recién ENTONCES promover/redeployar la versión de la app en Vercel que espera ese esquema.

Orden en una base completamente nueva: `db:migrate` → `db:bootstrap` → (deploy de la app) → `db:create-tenant` (§5).

## 5. Bootstrap del primer tenant

`scripts/create-tenant.ts` (rol owner vía `DIRECT_URL`, corre BYPASSRLS a propósito -- ver el comentario del script) crea el tenant, su usuario técnico SISTEMA y el primer ADMINISTRADOR con una credencial de activación de un solo uso que se imprime por consola una única vez (nunca se loguea ni se guarda en texto plano):

```
npm run db:create-tenant -- \
  --tenant-razon-social="Farmacia San Jose S.R.L." \
  --tenant-cuit="30-12345678-9" \
  --tenant-nombre-fantasia="Farmacia San Jose" \
  --tenant-domicilio="..." \
  --tenant-matricula-farmacia="..." \
  --tenant-zona-horaria="America/Argentina/Mendoza" \
  --admin-email="admin@ejemplo.com" \
  --admin-nombre="..." \
  --admin-apellido="..." \
  --admin-dni="..."
```

Entregar la credencial impresa al primer ADM por un canal fuera de banda (DP-05: hoy solo se soporta entrega en persona/pantalla). No existe todavía una consola de operador de plataforma (DP-37 sin resolver) -- este script ES el mecanismo de alta hasta que se resuelva.

## 6. Job diario: plazos de archivo (Vercel Cron)

`app/api/jobs/plazos-archivo/route.ts` mueve lotes `EN_ARCHIVO` a `PLAZO_CUMPLIDO` (FASE 12 punto 12.2). `vercel.json` lo agenda a las `0 6 * * *` (06:00 UTC = 03:00 Argentina, sin horario de verano).

Vercel Cron invoca el `path` configurado con **`GET`** y, si `CRON_SECRET` está seteado como env var del proyecto, agrega automáticamente el header `Authorization: Bearer <CRON_SECRET>` (comportamiento documentado en https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs, verificado contra la doc vigente). La ruta ahora acepta ambos transportes con el mismo secreto y la misma comparación constant-time (`crypto.timingSafeEqual` sobre digests SHA-256):

- `GET` + `Authorization: Bearer <CRON_SECRET>` -- lo que envía Vercel Cron.
- `POST` + `x-cron-secret: <CRON_SECRET>` -- transporte previo a FASE 14, mantenido para cualquier otro invocador (cron de otro host, disparo manual).

Sin `CRON_SECRET` configurada, la ruta responde `503` en cualquiera de los dos casos (nunca ejecuta el job sin secreto). Sin credencial o con una incorrecta, responde `404` (no revela que la ruta existe -- mismo criterio 404-no-403 del resto de la app).

Tests: `tests/unit/archivo-plazos-job.test.ts` cubre ambos transportes (secreto no configurado, header/bearer ausente, incorrecto, correcto).

## 7. Rollback

- **App**: Vercel conserva cada deployment inmutable -- usar **Instant Rollback** desde el dashboard (o `vercel rollback`) para volver al deployment anterior en segundos. Los cron jobs activos **no** se actualizan con un rollback (siguen la config del deployment activo hasta que se los deshabilite/actualice manualmente -- ver la doc de Vercel Cron).
- **Base de datos**: no hay rollback automático de migraciones (`prisma migrate deploy` no soporta down-migrations). Antes de una migración riesgosa: snapshot manual (`pg_dump` vía `DIRECT_URL`) o esperar a que 14.3 (backups, diferido) esté resuelto. Si una migración deja el esquema en un estado incompatible con el código ya desplegado, el camino seguro es escribir y aplicar una migración correctiva hacia adelante, no revertir el deployment de la app sin revertir también el esquema.

## 8. Pendiente

Explícitamente fuera de alcance en este ciclo (FASE 14), por decisión del usuario:

- **14.2 -- Rate limiting global**: no implementado. Sin mitigación a nivel de plataforma contra abuso/fuerza bruta más allá de lo que ya hace `shared/auth/policy.ts` (intentos/bloqueo por usuario, si aplica) -- revisar antes de exponer el sistema a tráfico no confiable.
- **14.3 -- Backups cifrados + prueba de restauración (DP-35)**: no implementado. Acción pendiente: confirmar el plan de Supabase contratado (PITR -- point-in-time recovery -- solo está disponible desde el plan Pro de Supabase en adelante; el plan Free no lo ofrece) y documentar/ejecutar al menos una prueba de restauración real antes de ir a producción con datos reales de pacientes.
- **Tests de BD (`npm run test:db`) contra este cambio**: no corridos como parte de esta tarea (instrucción explícita del usuario). `shared/db/client.ts` cambió (pool `max: 3`) -- de bajo riesgo (no cambia comportamiento funcional, solo el tamaño del pool), pero conviene correr `npm run test:db` igual antes de mergear.
- **E2E de regresión del flujo principal**: explícitamente salteado en este ciclo (decisión del usuario). Punto 14.6 del plan queda PENDIENTE.
- **14.6 -- Revisión de seguridad completa**: no realizada como parte de este trabajo; sigue pendiente como punto separado.
- **CSP y Subresource Integrity / reporting**: no se configuró `report-uri`/`report-to` para violaciones de CSP (no hay endpoint de reporting en este alcance) -- si se agregan scripts de terceros en el futuro, revisar `proxy.ts#buildContentSecurityPolicy` primero (dominio a agregar a `script-src`/`connect-src`, nunca `'unsafe-inline'`).
