# Parte 5 — Configuración, despliegue, operación y observabilidad

- Commit base del informe: `580bf3c`, árbol limpio.
- Revisión del auditor del plan: 2026-10-23, contra el código.

## Revisión del auditor del plan

### Veredicto sobre el informe

Es correcto en lo esencial y no exagera: 0 BLOCKER y 0 CRITICAL es coherente con lo que ya cerraron las partes 1 a 4. Los dos hallazgos más valiosos son P5-05 y P5-08. Los dos son regresiones de los arreglos de las partes 3 y 4 que el auditor del plan no detectó:
- P5-05: se corrió lint solo sobre los otros archivos tocados.
- P5-08: el logo por farmacia se aplicó a los PDF pero no al XLSX.

Desvíos del revisor:
- **Migraciones "pendientes" (107/110).** 0102, 0103 y 0104 están aplicadas en la base de prueba (vía MCP `apply_migration`; el DDL fue verificado en la parte 3). Pero no tienen fila en `public._prisma_migrations`. Lo que falta es el registro, no el esquema.
- **P5-02.** El default de 15 s de `maxDuration` solo vale sin Fluid compute. Con Fluid compute (default en proyectos nuevos de Vercel) el default es 300 s. Depende de la configuración del proyecto, que no está en el repo.

### Verificación por hallazgo

| ID | Original | Revisado | Veredicto | Evidencia de la revisión |
|---|---|---|---|---|
| P5-01 | WARNING | WARNING | CONFIRMADO | `shared/logging/logger.ts` `REDACT_PATHS` no cubre `pin`, `operadorPin`, `domicilio` ni `diagnostico`. Es defensa en profundidad: no hay un log conocido que los emita. El contenido de `err.message`/`cause` no se redacta por ruta. |
| P5-02 | WARNING | WARNING (checklist de deploy) | CONFIRMADO PARCIAL | `vercel.json` no fija `maxDuration`. Los jobs recorren todos los tenants en una invocación. El límite real depende de Fluid compute (300 s) o no (15 s Pro / 10 s Hobby). |
| P5-03 | WARNING | WARNING | CONFIRMADO | `shared/db/transaction.ts` llama `prisma.$transaction(fn)` sin opciones, con el timeout interactivo de Prisma de 5 s. Las importaciones en lote (factura, recetas, existencia inicial) pueden superarlo con la latencia a Supabase. Falla con rollback limpio: no hay datos corruptos, pero la importación grande no entra. |
| P5-04 | WARNING | — (checklist de deploy) | NO ES HALLAZGO DE CÓDIGO | `vercel.json` usa `regions: ["gru1"]`. Hay que confirmar que el proyecto Supabase de producción esté en `sa-east-1`. |
| P5-05 | WARNING | WARNING (bloquea CI) | CONFIRMADO | `receta-form.tsx:338` tiene `setEnvioId` dentro de `useEffect` (`react-hooks/set-state-in-effect`). `npm run lint` falla, y por lo tanto también falla CI. Lo introdujo el arreglo de P3-09. |
| P5-06 | SUGGESTION | SUGGESTION | CONFIRMADO | `server-only` se importa en 8 archivos. Repositorios y casos de uso no lo importan, aunque ESLint ya impide importarlos desde `ui/` cliente. |
| P5-07 | SUGGESTION | SUGGESTION | CONFIRMADO | `next.config.ts:60` incluye `public/logo-etiqueta.png`, que ya no se lee desde que la etiqueta usa el logo del tenant. |
| P5-08 | SUGGESTION | WARNING | CONFIRMADO | `shared/xlsx/xlsx-report.ts` `logo()` incrusta `public/logo.png` (San Jorge) en los XLSX de todos los tenants. Es el mismo problema que se corrigió en los PDF. Otra farmacia exporta con la marca ajena. |

### Clasificación para producción

**Antes del deploy**
1. ~~P5-05~~ **CORREGIDO**: la clave de idempotencia se renueva durante el render al llegar un resultado exitoso (patrón "información de renders anteriores"), sin `useEffect`.
2. ~~P5-08 y P5-07~~ **CORREGIDO**: `XlsxReportOptions.logo` recibe el logo del tenant (`getLogoTenant`, PNG o JPEG ajustado a 56 × 56; sin logo o WebP, el banner va sin imagen). Se quitó `outputFileTracingIncludes`: ningún runtime lee `public/`. Spec `openspec/specs/logo-farmacia/spec.md` R7, `openspec/specs/etiqueta-preparado/spec.md` y `DESIGN.md` alineados.
3. ~~P5-03~~ **CORREGIDO**: `withTenantTransaction` y `withPlatformTransaction` usan `maxWait` 10 s y `timeout` 60 s (por debajo del `statement_timeout` de 120 s). Por eso `maxDuration` de la función debe superar los 60 s (checklist P5-02).
4. ~~P5-01~~ **CORREGIDO** (primera parte): `REDACT_PATHS` cubre en tres niveles las variantes de PIN y contraseña, `diagnostico*` y `domicilio*`, con un test.
5. Checklist de deploy:
   - Confirmar Fluid compute o fijar `maxDuration` en `/api/jobs/*` (P5-02).
   - Confirmar la región de Supabase de producción (P5-04).
   - Registrar 0102–0104 en `_prisma_migrations` antes de `npm run test:db` (`prisma migrate resolve --applied <migración>`, lo corre el usuario). En producción entran por `migrate deploy`.

**En el tiempo**
- P5-06: `import "server-only"` en `infrastructure/` y `application/`.
- Redacción del contenido de `err.message`/`cause` (P5-01, segunda parte): requiere un serializador de errores propio.
- 77 FK sin índice: rendimiento, pasa a la parte 6.

---

## Informe original del revisor (resumido)

### A. Encabezado
- Ejecutado:
  - `git rev-parse HEAD`, `git status`;
  - `npm audit` (0 vulnerabilidades), `npm run typecheck` (OK), `npm run lint` (1 error), `npm test` (3600 OK);
  - SELECT sobre `_prisma_migrations`, `pg_proc`, `pg_settings`, `pg_constraint`, `pg_index`.
- No ejecutado: build, deploy, migraciones, `test:db`.

### B. Resumen
Conteo original: BLOCKER 0 · CRITICAL 0 · WARNING 5 · SUGGESTION 3.

### C. Hallazgos (originales)
| ID | Sev. | Resumen |
|---|---|---|
| P5-01 | WARNING | Redacción del logger incompleta: PIN, datos de salud y contenido de errores. |
| P5-02 | WARNING | Sin `maxDuration`; jobs multi-tenant en una sola invocación. |
| P5-03 | WARNING | Timeout de 5 s de la transacción interactiva de Prisma frente a importaciones en lote. |
| P5-04 | WARNING | Región `gru1` frente a la región de Supabase de producción. |
| P5-05 | WARNING | Error de lint en `receta-form.tsx:338` (setState dentro de efecto). |
| P5-06 | SUGGESTION | `server-only` en más módulos de servidor. |
| P5-07 | SUGGESTION | `outputFileTracingIncludes` obsoleto para `logo-etiqueta.png`. |
| P5-08 | SUGGESTION | El XLSX incrusta el logo de San Jorge para todos los tenants. |

### D. Conforme según el revisor
- Crons autenticados con comparación en tiempo constante, e idempotentes.
- Ninguna variable `NEXT_PUBLIC_*` sensible; `DIRECT_URL` no se lee en runtime.
- `statement_timeout` de 120 s.
- 14 funciones `SECURITY DEFINER` con `search_path` fijo.
- `npm audit` sin vulnerabilidades.

### E. Observaciones para otras partes
- Parte 6: migraciones 0102–0104 sin registro y 77 FK sin índice.
