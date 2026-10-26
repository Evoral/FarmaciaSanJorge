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
La auditoría se ejecuta en 6 partes. Esta es la PARTE <N>. Limítate a su alcance; si detectas algo que pertenece a otra parte, regístralo en "Observaciones para otras partes" sin profundizar, usando esta numeración: 1 aislamiento multi-tenant y base de datos; 2 autenticación, autorización, cuentas de sector y endpoints; 3 integridad del dominio, transacciones, concurrencia y auditoría; 4 entradas no confiables y salidas generadas; 5 logs, secretos, configuración, infraestructura y dependencias; 6 cobertura de tests y consolidación.

BASE DE REVISIÓN
- Al inicio ejecuta `git rev-parse HEAD` y `git status --short` y regístralos en el informe.
- Revisa el árbol de trabajo completo, pero marca como [WIP] los hallazgos en archivos sin commitear.

FUENTES DE VERDAD (leer antes de evaluar)
- `AGENTS.md`: reglas no negociables del repositorio.
- `docs/architecture.md`, `shared/auth/README.md`, `shared/audit/README.md`, `modules/README.md`.
- `openspec/specs/*/spec.md`: reglas de negocio aprobadas; contrasta el código contra ellas.
- `docs/plan-implementacion.md`: NO lo leas completo; busca referencias `INV-*` y `DP-*` concretas.
- `openspec/changes/` (salvo `archive/`): cambios en curso, no son fuente de verdad.
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

CONTEXTO DE LA PARTE 1 (ya cerrada, `docs/auditoria/informes/parte-1.md`; no la re-audites)
- RLS verificado y conforme en las 54 tablas de negocio; `fsj_app` sin BYPASSRLS; `anon`/`authenticated` sin acceso a `fsj`.
- Las funciones SECURITY DEFINER saltean RLS. `fsj.cierre_diario_firmar` y `fsj.libro_configurar_numeracion` validan `p_tenant_id` contra `fsj.current_tenant_id()`; la guarda de `cierre_diario_firmar` y el REVOKE de EXECUTE a PUBLIC están en la migración `0101_security_definer_hardening`, todavía SIN APLICAR en la base de prueba (la base no la refleja).
- `fsj.tenant` no tiene RLS por diseño (INV-PL-004).
- `fsj.usuario.debe_cambiar_password` existe en la base por una migración de otro desarrollador (`0097_contrasena_temporal`) que aún no está en el repositorio. Fuera de alcance: no audites esa funcionalidad.

Al evaluar IDOR, distingue:
- Acceso cruzado entre tenants por tablas: lo cubre RLS (verificado en la parte 1).
- Acceso cruzado a través de funciones SECURITY DEFINER: verifica que todo caller pase el tenant de la sesión y nunca uno tomado de la entrada del usuario.
- Acceso dentro del mismo tenant a un recurso u operación para la que el usuario no tiene permiso: RLS NO lo cubre; es el foco de esta parte.

Pendientes que la parte 1 derivó a esta:
- `fsj.usuario_resolve_login`: SECURITY DEFINER que devuelve el hash antes de fijar el tenant; enumeración de correos y diferencias de tiempo de respuesta entre usuario existente e inexistente.
- `fsj.sesion_resolve_tenant`: resolución del tenant a partir del hash del token de sesión.
- `resolverActor` en `shared/usecase.ts` con cuentas de sector (`esSector = true`) y acciones con PIN.

- `shared/usecase.ts` (`defineCommand`/`defineQuery`): orden efectivo requireSession → authorize → zod → transacción → audit, y diferencias legítimas entre comandos y consultas.
- Todos los Route Handlers de `app/api/**/route.ts`: para cada uno, indica si pasa por un caso de uso de `application/` o accede a datos por otro camino, qué permiso exige y si valida que el recurso pedido por ID pertenece al tenant (IDOR). Preséntalo como tabla.
- Server Actions de `app/` y `modules/*/ui/actions.ts`: alguna que llame a infraestructura directamente o que omita `authorize`.
- `conOperador` (`shared/auth/operador-context.ts`) contra `openspec/specs/cuentas-de-sector/spec.md`: todas las acciones de `PERMISOS_CON_PIN_SIEMPRE` y `PERMISOS_CON_PIN_CONFIGURABLES` lo usan; ninguna toma el actor de otra fuente que `session.usuario`; no se puede suplantar al operador.
- PIN y login: límite de intentos, bloqueo, comparación en tiempo constante, algoritmo de hash y parámetros.
- Sesión: cookies (HttpOnly, Secure, SameSite), expiración, revocación, rotación tras login.
- Escalamiento de privilegios en roles personalizables (`openspec/specs/roles-personalizables/spec.md`): un usuario puede otorgarse permisos que no tiene.
- `/api/jobs/*`: validación de `CRON_SECRET` (rechazo sin header, comparación en tiempo constante, comportamiento si la variable no está definida).
- `/api/health`: no debe exponer versión, estado de conexión ni datos internos.
- Respuestas de error: no deben revelar stack traces, SQL ni datos de otros tenants.
```

---

## Parte 3 — Integridad del dominio, transacciones y concurrencia

```markdown
ALCANCE DE LA PARTE 3: INTEGRIDAD DEL DOMINIO, TRANSACCIONES Y CONCURRENCIA

CONTEXTO DE LAS PARTES 1 Y 2 (cerradas, `docs/auditoria/informes/`; no las re-audites)
- RLS, roles, grants y funciones SECURITY DEFINER: auditados en la parte 1. La migración `0101_security_definer_hardening` está en el repositorio pero SIN APLICAR en la base de prueba: `npm run test:db` probablemente falle en su verificación inicial de migraciones; si pasa, no lo reportes como hallazgo.
- Autenticación, permisos y cuentas de sector: auditados en la parte 2.
- `npm test` pasa completo en el entorno del equipo; si en tu entorno falla, regístralo como limitación de entorno, no como hallazgo.
- `fsj.usuario.debe_cambiar_password` (`0097_contrasena_temporal`) es trabajo de otro desarrollador fuera del repositorio: fuera de alcance.

Pendientes que las partes 1 y 2 derivaron a esta:
- `fsj.hash_v2`, `fsj.hash_genesis` y los triggers de correlatividad `asiento_recetario_preparar` y `asiento_contralor_preparar`.
- `fsj.libro_configurar_numeracion` (migración 0097): renumera asientos y recalcula la cadena de hashes; verifica que no pueda romper la correlatividad ni la cadena, y su interacción con `fsj.cierre_diario_firmar` (mismo advisory lock).
- Inmutabilidad de `fsj.registro_auditoria` frente a UPDATE, DELETE y TRUNCATE, incluidos roles administrativos.
- Casos de uso con `audit: { skip: true }` y auditoría manual: `modules/usuarios/application/cambiar-roles.ts`, `crear-usuario.ts` y `actualizar-plazos.ts`; verifica que la auditoría manual sea completa y quede en la misma transacción.
- Co-firma del DT en `modules/stock/application/registrar-ajuste.ts`: la contraseña se valida en una transacción previa a la del ajuste; evalúa la ventana entre ambas (por ejemplo, el DT deja de ser vigente entre la validación y el commit).
- Funcionalidades recientes que tocan stock: existencia inicial y relevamiento inicial (migración 0100).

Alcance general
- Libro recetario (`openspec/specs/libro-recetario-y-contralor/spec.md`): correlatividad y unicidad del número de asiento bajo concurrencia (constraint, lock o secuencia), número inicial configurable (migración 0097) y su fijación por el primer cierre firmado, inmutabilidad de cierres firmados (triggers en la base), trazabilidad de cambios.
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

CONTEXTO DE LAS PARTES 1 A 3 (cerradas, `docs/auditoria/informes/`; no las re-audites)
- RLS, roles, grants y funciones SECURITY DEFINER: parte 1. La migración `0101_security_definer_hardening` ya está aplicada en la base de prueba.
- Autenticación, permisos, cuentas de sector y autorización de Route Handlers: parte 2. Aquí solo interesa qué hace cada endpoint con la entrada y la salida, no quién puede llamarlo.
- Transacciones, concurrencia, contadores de intentos e integridad del libro: parte 3.
- `npm test` pasa completo en el entorno del equipo; si en tu entorno falla, regístralo como limitación de entorno, no como hallazgo.
- Rate limiting se resuelve en Vercel Firewall (condición de deploy ya registrada): no lo reportes como hallazgo.

Pendientes que las partes 1 a 3 derivaron a esta
- Logo (`app/api/farmacia/logo/route.ts` [WIP], `openspec/specs/logo-farmacia/spec.md`): tipo real por magic bytes (no solo MIME ni extensión), SVG con scripts o referencias externas, tamaño máximo, almacenamiento en `bytea`, y el `Content-Type`/`Content-Disposition`/`X-Content-Type-Options` con que se sirve de vuelta.
- Parsers de archivos subidos por el usuario:
  - `modules/recetas/domain/receta-pdf-parser.ts` y la extracción con `unpdf` (`openspec/specs/importacion-receta-pdf/spec.md`).
  - Lectura de QR con `jsqr` y `modules/recetas/infrastructure/receta-rcta-api.server.ts` (`openspec/specs/importacion-receta-qr/spec.md`): la URL o el dato que sale del QR, ¿puede hacer que el servidor consulte un host arbitrario (SSRF)? Timeouts, tamaño de respuesta, validación de lo que devuelve la API externa.
  - `modules/stock/domain/factura-compra-pdf-parser.ts` (importación de factura de compra).
  - `modules/costos-proveedor/infrastructure/leer-xls.server.ts` y `leer-xlsx.server.ts` (`openspec/specs/costos-proveedor/spec.md`): librería usada, vulnerabilidades conocidas (prototype pollution, ReDoS, zip bomb), límites de filas y tamaño.
  - Para todos: límite de tamaño antes de parsear, límite de tiempo, y validación zod de lo extraído antes de que llegue a la base.
- Exportaciones XLSX con `exceljs` (`app/api/**/xlsx/route.ts`, `openspec/specs/exportaciones-excel/spec.md`): inyección de fórmulas en celdas de texto que empiezan con `=`, `+`, `-`, `@`, tabulación o retorno de carro; nombres de paciente, médico, producto y observaciones son texto libre.
- PDF con `pdfkit` (`app/api/**/pdf/route.ts`): texto libre interpolado, fuentes o imágenes cargadas desde rutas o URLs derivadas de datos de usuario, nombre de archivo en `Content-Disposition`.

Alcance general
- XSS: `dangerouslySetInnerHTML`, URLs construidas con datos de usuario, `href`/`src` con `javascript:` o `data:`, `redirect()` con destinos tomados de la petición (open redirect).
- Validación zod en todos los puntos de entrada (Server Actions, Route Handlers, query params de exportaciones): esquemas permisivos (`passthrough`, `any`, `unknown` sin refinar), strings sin `max()`, arrays sin límite, números sin rango, fechas sin rango en exportaciones que puedan pedir años de datos.
- Límites de cuerpo: `serverActions.bodySizeLimit` en `next.config.ts` y su coherencia con los tamaños máximos de cada upload; Route Handlers que leen `request.formData()`/`arrayBuffer()` sin límite propio.
- Headers de seguridad y CSP en `next.config.ts` y `proxy.ts`: CSP, `frame-ancestors`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; `Cache-Control` en respuestas con datos de pacientes (PDF y XLSX).
- Mensajes de error: que las respuestas de error de parsers y exportaciones no devuelvan stack traces ni contenido interno.

Pruebas propuestas prioritarias (describe, no ejecutes las que requieran escribir en la base)
- Subir como logo un SVG con `<script>` y un PNG con extensión renombrada: rechazo o neutralización.
- Exportar un XLSX con un paciente cuyo nombre sea `=HYPERLINK("http://x","y")`: la celda debe quedar como texto.
- PDF de receta y XLSX de costos sobredimensionados o malformados: rechazo por tamaño o error controlado, sin colgar el proceso.
- QR que apunte a un host distinto del esperado: el servidor no lo consulta.
```

---

## Parte 5 — Logs, secretos, configuración, infraestructura y dependencias

```markdown
ALCANCE DE LA PARTE 5: LOGS, SECRETOS, CONFIGURACIÓN, INFRAESTRUCTURA Y DEPENDENCIAS

CONTEXTO DE LAS PARTES 1 A 4 (cerradas, `docs/auditoria/informes/`; no las re-audites)
- RLS, roles, grants y SECURITY DEFINER: parte 1. `DIRECT_URL` (owner, salta RLS) ya NO está en `shared/env.ts`: solo lo leen `scripts/` y `prisma.config.ts`. Verifica que ningún código de runtime lo lea por otra vía (`process.env.DIRECT_URL`).
- Autenticación, permisos y autorización de endpoints (incluidos `app/api/jobs/*`): parte 2. Aquí solo interesa la configuración de los crons, no quién puede llamarlos.
- Concurrencia e integridad: parte 3. Migraciones 0101 a 0104 aplicadas en la base de prueba.
- Entradas y salidas (uploads, parsers, PDF, XLSX, CSP y headers): parte 4. No re-audites headers ni CSP.
- Rate limiting se resuelve en Vercel Firewall (condición de deploy ya registrada): no lo reportes como hallazgo.
- `npm test`, typecheck y lint pasan en el entorno del equipo; si en tu entorno fallan, regístralo como limitación de entorno.
- `.env*`: puedes leer `.env.example` (no tiene secretos), pero NUNCA imprimas valores de `.env`, `.env.local` ni similares; si necesitas saber si una variable existe, informa solo su nombre.

Pendientes que la parte 4 derivó a esta (verificaciones de producción, para el apartado F)
- Egress de las funciones: que solo salgan hacia Supabase y `decrypter.verumrp.com.ar`.
- Límite de cuerpo de la plataforma: un upload de ~5 MB rechazado con 413 antes de llegar a la Server Action (coherente con `serverActions.bodySizeLimit` en `next.config.ts`).
- Headers por `curl -I` en producción: HSTS, `Permissions-Policy`, `Cache-Control` de las exportaciones.

Alcance
- Logs (`shared/logging/logger.ts` y todos sus puntos de uso, `console.*` sueltos): redacción de tokens, PIN, contraseñas, cookies, cadenas de conexión y datos personales de pacientes (nombre, DNI, domicilio, diagnóstico). Busca objetos completos logueados (`{ input }`, `{ error }` con `cause` que arrastre datos de Prisma).
- Secretos y bundle del cliente: `shared/env.ts`, `.env.example`, variables `NEXT_PUBLIC_*`, módulos de servidor importables desde componentes cliente sin `server-only`, secretos en `next.config.ts`.
- `vercel.json`: crons, su autenticación por secreto y su idempotencia ante doble ejecución; región (cercanía a la base de Supabase); `maxDuration` frente a exportaciones pesadas (PDF/XLSX de hasta 5000 filas).
- Build y scripts: que `build` no ejecute migraciones ni toque la base; `postinstall`; scripts de `scripts/` que lean `DIRECT_URL` y cómo se ejecutan (nunca desde el runtime).
- Prisma con Supavisor: modo transaction (puerto 6543), `connection_limit`, compatibilidad con transacciones interactivas, `set_config(..., true)` por transacción (sin estado de sesión que se filtre entre requests del pool) y timeouts.
- Serverless: estado en memoria entre requests (caches de módulo, `AsyncLocalStorage`), escritura en filesystem, lecturas de `public/` en runtime.
- Dependencias: `npm audit --omit=dev` y `npm ls next react prisma zod exceljs pdfkit unpdf jsqr`. Informa las advertencias como POTENCIALES salvo que confirmes que el código afectado se usa.
- Excepciones a TypeScript estricto y ESLint (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`, `as unknown as`) en código sensible: auth, usecase, db, audit, repositorios.
- Supabase (solo SELECT y herramientas de lectura): `get_advisors` de seguridad y rendimiento; informa qué avisos aplican de verdad al schema `fsj`.

Pruebas propuestas prioritarias (describe, no ejecutes las que requieran escribir)
- Un error de Prisma con datos de paciente en el `where`: qué llega al log.
- Doble ejecución del mismo cron en el mismo minuto: sin efectos duplicados.
- Dos requests concurrentes de tenants distintos sobre el mismo backend del pool: ninguno ve el `app.tenant_id` del otro.
```

---

## Parte 6 — Cobertura de tests y consolidación final

```markdown
ALCANCE DE LA PARTE 6: COBERTURA DE TESTS Y CONSOLIDACIÓN

Entrada: los informes de las partes 1 a 5 están en `docs/auditoria/informes/parte-1.md` … `parte-5.md`. Cada uno tiene dos secciones: "Revisión del auditor del plan" (veredicto, severidad revisada, clasificación y estado CORREGIDO) y el informe original resumido. La severidad y el veredicto de la revisión prevalecen sobre los del informe original, salvo que encuentres evidencia en contra en el código: en ese caso, muéstrala.

ESTADO DE PARTIDA (verifícalo, no lo asumas)
- Los hallazgos marcados CORREGIDO fueron arreglados en commits sobre `master`. Confirma cada uno en el código de HEAD (archivo y línea) y márcalo CERRADO o REABIERTO. No re-audites el resto de las partes.
- Los hallazgos de la parte 5 clasificados "antes del deploy" pueden estar corregidos o no al momento de esta parte: determina su estado en el código.
- Migraciones `0102_receta_envio_id`, `0103_pesada_real_jornada` y `0104_forbid_truncate`: su DDL está aplicado en la base de prueba, pero pueden no tener fila en `public._prisma_migrations`. Verifica el DDL con SELECT sobre catálogos (columna `fsj.receta.envio_id`, índice `uq_receta_envio`, función `fsj.pesada_real_validar_autorizacion`, triggers `trg_*_forbid_truncate`). Si faltan las filas, `npm run test:db` puede fallar en su global-setup: regístralo como limitación de entorno, no como hallazgo, y no intentes registrarlas.

Tareas
1. Inventario de `tests/` (proyectos `unit`, `db` y `e2e`): qué cubre aislamiento entre tenants, permisos y autorización de endpoints, PIN y cuentas de sector, bloqueo por intentos fallidos, concurrencia del libro y del stock, contralor digital, idempotencia (alta de receta, crons) y saneamiento de salidas (PDF, XLSX). Diferencia tests existentes, ejecutados en esta parte y solo propuestos. Puedes ejecutar `npm test`; `npm run test:db` solo tras confirmar que apunta a la base de prueba.
2. Para cada hallazgo CORREGIDO de las partes 1 a 5, indica si hay un test que impida su regresión; si no lo hay, propón uno concreto (archivo, escenario, aserción).
3. Resuelve las "Observaciones para otras partes" de los informes 1 a 5 que nadie haya cerrado. En particular:
   - pruebas T3-01 a T3-06 de la parte 3 (concurrencia, atomicidad, contralor activo, intentos de PIN concurrentes);
   - las 77 FK sin índice de la parte 5: cuáles importan por los filtros y joins reales del código, cuáles no.
4. Detecta hallazgos duplicados o contradictorios entre partes y unifícalos conservando sus IDs originales.

Entregable consolidado (reemplaza al formato de parte)
A. Encabezado: commit base, partes consolidadas, limitaciones generales.
B. Resumen ejecutivo: 5 riesgos principales, conteo por severidad de lo que sigue ABIERTO, estado por módulo (LISTO / CON BLOQUEANTES / NO REVISADO).
C. Tabla única de hallazgos (IDs `P<N>-<nn>`), ordenada por severidad, con columna Estado (ABIERTO / CERRADO / REABIERTO / FALSO POSITIVO) y la evidencia del cierre.
D. Matriz de cobertura por parte y por módulo, incluida la cobertura de tests.
E. Pruebas propuestas priorizadas, indicando cuáles requieren base aislada (escriben o necesitan concurrencia real).
F. Verificaciones pendientes en producción (unificadas de los apartados F de cada parte, sin duplicados).
G. Bloqueantes para producción ordenados por dependencia, separando: obligatorio antes de producción, antes de habilitar un módulo concreto (por ejemplo, el contralor digital), y mejoras posteriores.
```
