# Plan de auditoría de seguridad e integridad (pre-producción)

Prompt de auditoría para ejecutar en un agente revisor de **solo lectura**. Se ejecuta en
**6 partes**; cada parte = `Bloque común` + el bloque de la parte.

## Protocolo de ejecución

1. Cada parte se ejecuta en una **sesión nueva** del agente revisor (contexto limpio).
2. Se pega el `Bloque común` reemplazando `<N>` por el número de parte, seguido del bloque de la parte.
3. El informe resultante se guarda en `docs/auditoria/informes/parte-<N>.md`.
4. Cada informe lo revisa un segundo agente (auditor del plan) antes de lanzar la siguiente
   parte; la parte siguiente puede ajustarse según lo encontrado.
5. La parte 6 recibe los informes 1–5 y produce el informe consolidado.

| Parte | Alcance |
|---|---|
| 1 | Aislamiento multi-tenant y base de datos |
| 2 | Autenticación, autorización, cuentas de sector y endpoints |
| 3 | Integridad del dominio, transacciones y concurrencia |
| 4 | Entradas no confiables y salidas generadas |
| 5 | Logs, secretos, configuración, infraestructura y dependencias |
| 6 | Cobertura de tests y consolidación final |

---

## Bloque común

```markdown
Actúa como auditor senior de seguridad de aplicaciones, arquitectura multi-tenant y bases de datos, con experiencia en sistemas de salud.

CONTEXTO
Farmacia San Jorge: gestión de recetas magistrales, stock, libro recetario y cierres. Monolito modular multi-tenant sobre Next.js 16 (App Router), React 19, Prisma 7, Postgres en Supabase (schema `fsj`), zod 4 y decimal.js, con deploy previsto en Vercel. Este stack es declarado: verifícalo en el repositorio.
La aplicación todavía no está terminada. El objetivo NO es un veredicto de deploy, sino identificar bloqueantes para producción, riesgos por módulo y pruebas faltantes.
La auditoría se ejecuta en 6 partes. Esta es la PARTE <N>. Limítate a su alcance; si detectas algo que pertenece a otra parte, regístralo en "Observaciones para otras partes" sin profundizar.

BASE DE REVISIÓN
- Al inicio ejecuta `git rev-parse HEAD` y `git status --short` y regístralos en el informe.
- Revisa el árbol de trabajo completo, pero marca como [WIP] los hallazgos en archivos sin commitear.

FUENTES DE VERDAD (leer antes de evaluar)
- `AGENTS.md`: reglas no negociables del repositorio.
- `docs/architecture.md`, `shared/auth/README.md`, `shared/audit/README.md`, `modules/README.md`.
- `docs/specs/*.md`: reglas de negocio aprobadas; contrasta el código contra ellas.
- `docs/plan-implementacion.md`: NO lo leas completo; busca referencias `INV-*` y `DP-*` concretas.
- `docs/propuestas/`: no es fuente de verdad.
- `eslint.config.*`: qué reglas de arquitectura ya se garantizan estáticamente; verifica que existan y que no tengan excepciones en lugar de re-auditarlas a mano.
Lo que digan estos documentos es una afirmación a verificar, no un hecho.

REGLAS OPERATIVAS
Tienes acceso a una base de datos de PRUEBA. Los datos no son sensibles, pero el esquema y su configuración son la referencia auditada: no deben alterarse.

PROHIBIDO
- Cualquier SQL que modifique esquema, permisos o datos: CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE, INSERT, UPDATE, DELETE, COMMENT, CREATE POLICY, etc.
- Migraciones o comandos que alteren la base: `prisma migrate *`, `prisma db push`, `apply_migration`, `scripts/db-*`, `scripts/create-tenant.ts`.
- `npm run dev` (reescribe `AGENTS.md`), `npm install`/`npm ci`, `npm run build`, formateadores y cualquier escritura en el repositorio.
- Imprimir valores de `.env*`, cadenas de conexión o secretos.

PERMITIDO
- SELECT sobre catálogos y vistas de sistema: `pg_class`, `pg_policies`, `pg_roles`, `pg_namespace`, `pg_trigger`, `pg_proc`, `information_schema.*`, `pg_settings`.
- SELECT sobre tablas de `fsj` solo para confirmar un hallazgo concreto, sin volcar datos personales en el informe.
- Herramientas MCP de Supabase de solo lectura: `list_tables`, `list_migrations`, `list_extensions`, `get_advisors`, y `execute_sql` limitado a SELECT.
- `npm run test:db` (corre dentro de una transacción con rollback), solo después de confirmar que la conexión apunta a la base de prueba.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm audit --omit=dev`, `npm ls`, `git log/show/diff`, `rg`.

ANTES DE CUALQUIER CONSULTA A LA BASE
1. Confirma que la conexión apunta a la base de prueba (por ejemplo, comparando host o project ref con el esperado) sin imprimir la cadena de conexión. Si no puedes confirmarlo, detente y pregunta.
2. Verifica que la base tenga aplicadas todas las migraciones del repositorio (`_prisma_migrations` o `list_migrations` contra `prisma/migrations/`). Si hay desfase, infórmalo y aclara qué conclusiones dejan de ser válidas.
3. Si una verificación requiere escribir para probar un escenario (por ejemplo, un acceso cruzado entre tenants), NO la ejecutes: descríbela como prueba propuesta.

METODOLOGÍA
- Para cada control, busca activamente el camino que lo evita (Route Handlers, Server Actions fuera de `defineCommand`/`defineQuery`, scripts, jobs).
- Clasifica cada hallazgo como CONFIRMADO, POTENCIAL o NO VERIFICABLE SIN ENTORNO.
- No declares conforme un control solo porque exista la abstracción que supuestamente lo implementa.
- No afirmes haber ejecutado algo que no ejecutaste. No inventes archivos, líneas ni obligaciones legales.
- Cualquier regla con implicancia legal o profesional se marca como "requiere validación profesional"; su ausencia no es un incumplimiento confirmado salvo que una spec la exija.

SEVERIDAD (relativa a PRODUCCIÓN, no al estado actual)
- BLOCKER: impide salir a producción (fuga entre tenants, bypass de autorización, pérdida de integridad del libro o de la auditoría).
- CRITICAL: fallo grave confirmado con impacto significativo.
- WARNING: debilidad real o validación pendiente.
- SUGGESTION: mejora preventiva.
La confianza se informa por separado: ALTA / MEDIA / BAJA. La falta de evidencia NO es una vulnerabilidad confirmada.

FORMATO DEL INFORME DE LA PARTE
A. Encabezado: número de parte, commit base, estado del árbol, comandos y consultas ejecutados (exactos) y comandos deliberadamente no ejecutados.
B. Resumen: 3 a 5 riesgos principales y conteo por severidad.
C. Tabla de hallazgos: ID (`P<N>-<nn>`) | Severidad | Confianza | Estado | Archivo:línea | Evidencia | Riesgo concreto | Acción recomendada | Criterio de cierre.
D. Cobertura: componentes revisados, pendientes y estado (VERIFICADO Y CONFORME solo con evidencia / HALLAZGOS DETECTADOS / REVISIÓN PARCIAL / NO VERIFICADO).
E. Pruebas propuestas: objetivo, precondiciones, escenario, resultado esperado, entorno requerido y estado (ejecutada / no ejecutada).
F. Verificaciones que solo pueden confirmarse en PRODUCCIÓN, con la consulta SELECT o el paso exacto para que los ejecute una persona.
G. Observaciones para otras partes.

No implementes correcciones. No declares la aplicación segura en términos absolutos.
```

---

## Parte 1 — Aislamiento multi-tenant y base de datos

```markdown
ALCANCE DE LA PARTE 1: AISLAMIENTO MULTI-TENANT Y BASE DE DATOS

En el repositorio
- RLS, políticas y GRANTS en las migraciones SQL escritas a mano de `prisma/migrations/`. Cada tabla de `fsj` con `tenant_id` debe tener RLS habilitado, y forzado (`FORCE ROW LEVEL SECURITY`) si el rol de runtime fuera su dueño.
- `shared/db/transaction.ts` (`withTenantTransaction`, `set_config('app.tenant_id', …, true)`): comportamiento con tenant vacío, contexto ausente o consultas ejecutadas fuera de la transacción con el cliente global.
- Uso de roles: `DATABASE_URL` (runtime, rol `fsj_app`) frente a `DIRECT_URL` (solo `prisma.config.ts` y `scripts/`). Busca cualquier uso de `DIRECT_URL` o de un cliente privilegiado en código de runtime.
- Acceso a datos fuera de `withTenantTransaction`: repositorios o rutas que usen el cliente de Prisma directamente.
- Integridad entre tenants: FKs compuestas, triggers o validaciones que impidan asociar entidades de tenants distintos; comportamiento ante IDs manipulados.
- Pooling: compatibilidad del `set_config` transaccional con Supavisor en modo transacción y riesgo de contexto filtrado entre conexiones reutilizadas.
- Coherencia entre `prisma/schema.prisma`, `prisma/migrations/` y `prisma/rollbacks/*.down.sql` (cada migración reciente tiene su rollback).

Contra la base de prueba (solo SELECT)
- RLS real por tabla de `fsj`: `relrowsecurity` y `relforcerowsecurity` en `pg_class`; lista las tablas con `tenant_id` sin RLS.
- Políticas efectivas en `pg_policies`: USING/WITH CHECK, roles a los que aplican, políticas permisivas que anulen a otras.
- Dueño de cada tabla y atributos de `fsj_app` (`rolbypassrls`, `rolsuper`, pertenencia a roles privilegiados).
- Grants efectivos de `anon`, `authenticated` y `fsj_app` sobre `fsj` (schema, tablas, secuencias, funciones). Si `anon` o `authenticated` tienen `USAGE` o privilegios sobre `fsj`, el schema queda expuesto por la Data API (PostgREST) sin pasar por la aplicación.
- Funciones `SECURITY DEFINER` en `fsj`: quién puede ejecutarlas y si respetan `app.tenant_id`.
- `get_advisors` (security y performance): contrasta cada advertencia con el código.
- Cualquier diferencia entre lo que declaran las migraciones y lo que tiene la base es un hallazgo en sí mismo.

Pruebas propuestas prioritarias
- Lectura y escritura cruzada entre tenants por ID, con `app.tenant_id` de otro tenant y sin contexto.
- Consulta bajo `fsj_app` sin `set_config` previo: debe devolver cero filas o fallar, nunca datos.
```

---

## Parte 2 — Autenticación, autorización, cuentas de sector y endpoints

```markdown
ALCANCE DE LA PARTE 2: AUTENTICACIÓN, AUTORIZACIÓN, CUENTAS DE SECTOR Y ENDPOINTS

Esta parte se ejecuta en paralelo con la parte 1 (RLS y base de datos). No re-audites RLS. Al evaluar IDOR, distingue:
- Acceso cruzado entre tenants: RLS puede mitigarlo; regístralo como POTENCIAL y menciona que su cierre depende de la parte 1.
- Acceso dentro del mismo tenant a un recurso u operación para la que el usuario no tiene permiso: RLS NO lo cubre; es el foco de esta parte.
No ejecutes `npm run test:db` en esta parte (otra parte puede estar usando la base al mismo tiempo).

- `shared/usecase.ts` (`defineCommand`/`defineQuery`): orden efectivo requireSession → authorize → zod → transacción → audit, y diferencias legítimas entre comandos y consultas.
- Todos los Route Handlers de `app/api/**/route.ts`: para cada uno, indica si pasa por un caso de uso de `application/` o accede a datos por otro camino, qué permiso exige y si valida que el recurso pedido por ID pertenece al tenant (IDOR). Preséntalo como tabla.
- Server Actions de `app/` y `modules/*/ui/actions.ts`: alguna que llame a infraestructura directamente o que omita `authorize`.
- `conOperador` (`shared/auth/operador-context.ts`) contra `docs/specs/cuentas-de-sector.md`: todas las acciones de `PERMISOS_CON_PIN_SIEMPRE` y `PERMISOS_CON_PIN_CONFIGURABLES` lo usan; ninguna toma el actor de otra fuente que `session.usuario`; no se puede suplantar al operador.
- PIN y login: límite de intentos, bloqueo, comparación en tiempo constante, algoritmo de hash y parámetros.
- Sesión: cookies (HttpOnly, Secure, SameSite), expiración, revocación, rotación tras login.
- Escalamiento de privilegios en roles personalizables (`docs/specs/roles-personalizables.md`): un usuario puede otorgarse permisos que no tiene.
- `/api/jobs/*`: validación de `CRON_SECRET` (rechazo sin header, comparación en tiempo constante, comportamiento si la variable no está definida).
- `/api/health`: no debe exponer versión, estado de conexión ni datos internos.
- Respuestas de error: no deben revelar stack traces, SQL ni datos de otros tenants.
```

---

## Parte 3 — Integridad del dominio, transacciones y concurrencia

```markdown
ALCANCE DE LA PARTE 3: INTEGRIDAD DEL DOMINIO, TRANSACCIONES Y CONCURRENCIA

- Libro recetario (`docs/specs/libro-recetario-y-contralor.md`): correlatividad y unicidad del número de asiento bajo concurrencia (constraint, lock o secuencia), número inicial configurable (migración 0097) y su fijación por el primer cierre firmado, inmutabilidad de cierres firmados (triggers en la base), trazabilidad de cambios.
- Stock: atomicidad de movimientos, reservas (`reserva-stock-preparacion.md`), pesada real (`pesada-real.md`), reglas de stock negativo, orden de locks y riesgo de deadlock o actualizaciones perdidas.
- Dinero y cantidades: uso de `shared/decimal`; busca aritmética con `number` en precios, costos y cantidades (`reglas-precio.md`, `presupuesto-receta.md`, `pago-receta.md`, `costos-proveedor.md`) y conversiones prematuras a `number`. No marques aritmética no monetaria.
- Compatibilidad de precisión y escala entre Decimal de la aplicación y columnas `numeric` de la base.
- Auditoría: el registro se escribe en la misma transacción que la operación; `fsj_app` no puede hacer UPDATE ni DELETE en tablas de auditoría (verifícalo en grants y triggers de la base).
- Idempotencia y doble envío: operaciones críticas que puedan duplicarse por doble clic o reintento.
- Estados parciales: operaciones con varios pasos que puedan quedar a medias ante un error.
- Formularios: uso de `shared/ui/use-form-submit.ts` y conservación de los datos ingresados ante error (regla de `AGENTS.md`).

Pruebas propuestas prioritarias
- Dos cierres o asientos simultáneos: sin números duplicados ni saltos indebidos.
- Dos consumos simultáneos del mismo lote: sin stock negativo no permitido.
- Fallo inducido a mitad de operación: sin registro de negocio sin su auditoría ni viceversa.
```

---

## Parte 4 — Entradas no confiables y salidas generadas

```markdown
ALCANCE DE LA PARTE 4: ENTRADAS NO CONFIABLES Y SALIDAS GENERADAS

- Upload de logo (`app/api/farmacia/logo/route.ts`, [WIP], `docs/specs/logo-farmacia.md`): validación del tipo real (magic bytes, no solo MIME), tamaño máximo, SVG con scripts, almacenamiento, autorización y tenant.
- Importación de recetas por PDF y QR (`importacion-receta-pdf.md`, `importacion-receta-qr.md`): límites de tamaño y tiempo, librerías de parsing y sus vulnerabilidades conocidas, contenido malicioso, datos extraídos que llegan a la base sin validar.
- Exportaciones XLSX (`app/api/**/xlsx/route.ts`): inyección de fórmulas (celdas que empiezan con `=`, `+`, `-`, `@`).
- Generación de PDF (`app/api/**/pdf/route.ts`): datos de usuario interpolados sin escapar, recursos externos cargados.
- XSS: `dangerouslySetInnerHTML`, URLs construidas con datos de usuario, `href` con `javascript:`.
- Validación zod en todos los puntos de entrada: esquemas permisivos (`passthrough`, `any`, strings sin límite de longitud).
- Headers de seguridad y CSP en `next.config.*`, `proxy` o middleware.
```

---

## Parte 5 — Logs, secretos, configuración, infraestructura y dependencias

```markdown
ALCANCE DE LA PARTE 5: LOGS, SECRETOS, CONFIGURACIÓN, INFRAESTRUCTURA Y DEPENDENCIAS

- `shared/logging/logger.ts` y sus puntos de uso: redacción de tokens, PIN, cookies, cadenas de conexión y datos personales de pacientes.
- `shared/env.ts` y `.env.example`: variables `NEXT_PUBLIC_*`, secretos que puedan llegar al bundle del cliente, módulos de servidor sin `server-only`.
- `vercel.json`: crons y su idempotencia ante una doble ejecución; región; límites de duración de funciones frente a exportaciones pesadas.
- `next.config.*` y `package.json`: el build no ejecuta migraciones; `postinstall` y scripts que tocan la base.
- Prisma con Supavisor: modo de pooling, límite de conexiones del cliente, compatibilidad con transacciones interactivas y timeouts.
- Dependencias de estado local o filesystem incompatibles con serverless.
- `npm audit --omit=dev` y versiones instaladas (`npm ls next react prisma zod`): informa las advertencias como POTENCIALES salvo que confirmes que el código afectado se usa.
- Coherencia de TypeScript estricto y ESLint: excepciones (`eslint-disable`, `@ts-ignore`, `as any`) en código sensible.
```

---

## Parte 6 — Cobertura de tests y consolidación final

```markdown
ALCANCE DE LA PARTE 6: COBERTURA DE TESTS Y CONSOLIDACIÓN

Entrada: a continuación se adjuntan los informes de las partes 1 a 5.

Tareas
1. Inventario de `tests/` (proyectos unit y db): qué cubre aislamiento entre tenants, permisos, PIN, concurrencia del libro y del stock. Diferencia tests existentes, ejecutados en esta parte y solo propuestos.
2. Resuelve las "Observaciones para otras partes" de los informes 1 a 5 que nadie haya cerrado.
3. Detecta hallazgos duplicados o contradictorios entre partes y unifícalos conservando sus IDs originales.

Entregable consolidado (reemplaza al formato de parte)
A. Encabezado: commit base, partes consolidadas, limitaciones generales.
B. Resumen ejecutivo: 5 riesgos principales, conteo por severidad, estado por módulo (LISTO / CON BLOQUEANTES / NO REVISADO).
C. Tabla única de hallazgos (IDs `P<N>-<nn>`), ordenada por severidad.
D. Matriz de cobertura por parte.
E. Pruebas propuestas priorizadas, indicando cuáles requieren base aislada.
F. Verificaciones pendientes en producción.
G. Bloqueantes para producción ordenados por dependencia, separando: obligatorio antes de producción, antes de habilitar un módulo concreto, y mejoras posteriores.
```
