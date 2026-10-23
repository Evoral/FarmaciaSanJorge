# Parte 2 — Autenticación, autorización, cuentas de sector y endpoints

- Commit base del informe: `53d6620c6f9f1e1d848ad789515e9c302f837632` (con los arreglos de la parte 1 sin commitear).
- Revisión del auditor del plan: 2026-10-23, contra el código.

## Revisión del auditor del plan

### Veredicto sobre el informe

Pertinente y bien acotado. Los 3 hallazgos se confirman. Una afirmación de cobertura es falsa
(conOperador, ver P2-04) y el informe deja un dato crítico solo en observaciones: `npm test` falla.

Afirmaciones verificadas: cookie `httpOnly`/`sameSite: lax`/`secure` (`modules/auth/domain/cookie-policy.ts`),
inactividad 30 min y absoluta 12 h (`shared/auth/policy.ts:21,24`), `/api/farmacia/logo` con `auth.login`
(`get-marca-tenant.ts:24`), HSTS en producción (`next.config.ts:36`), `resolverActor` cierra por defecto:
una sesión de sector que ejecuta un permiso con PIN sin `conOperador` recibe `OperadorRequeridoError`
(`shared/usecase.ts:321-328`), así que una acción sin `conOperador` falla, no saltea el PIN.

### Verificación por hallazgo

| ID | Original | Revisado | Veredicto | Evidencia de la revisión |
|---|---|---|---|---|
| P2-01 | WARNING | WARNING | CONFIRMADO | `login.ts`: con email inexistente retorna tras argon2; con email existente abre `withTenantTransaction` (y con clave errónea hace UPDATE). Diferencia de una transacción con la base. Explotable solo con muchas peticiones: el rate limiting (P2-02) lo reduce mucho. |
| P2-02 | WARNING | WARNING (antes del deploy) | CONFIRMADO | Sin limitador en `proxy.ts` ni en el login. Un limitador en memoria no sirve en serverless: la opción viable es una regla de rate limit del Firewall de Vercel sobre `/login`. |
| P2-03 | SUGGESTION | SUGGESTION | CONFIRMADO | `app/api/health/route.ts:53-63`. Exponer `db` es práctica habitual para monitores; impacto bajo. |

Hallazgos adicionales de la revisión:
- **P2-04 (WARNING, CONFIRMADO)**: `crearProductoDesdeFacturaAction` (`modules/stock/ui/actions.ts:56-58`) llama a `crearDroga` (`drogas.crear`, permiso con PIN configurable) sin `conOperador`, contra la regla de `AGENTS.md`. No es un bypass (el caso de uso exige el operador y falla), pero en una cuenta de sector con `drogas.crear` bajo PIN, crear un producto desde una factura siempre falla. La acción recibe un objeto, no `FormData`, así que hoy no puede transportar el PIN.
- **P2-05 (WARNING, según el revisor; no re-ejecutado)**: `npm test` reporta 20 tests fallidos en 10 archivos (`FIELD_LABELS` sin 10 campos nuevos, mocks desactualizados, regresiones en `costos-proveedor-domain` y `recetas-presupuesto`). El CI corre `npm test`, así que está en rojo. `tests/unit/env.test.ts` (cambiado por la parte 1) no figura entre los fallidos.

### Clasificación para producción

**Estado (2026-10-23)**: P2-04 corregido (la acción recibe `FormData` y pasa por `conOperador`; `importar-factura-form.tsx` pide operador y PIN igual que `useFormSubmit`). P2-05 no se reproduce: el equipo corrió `npm test` localmente y pasó completo; los fallos del revisor probablemente vinieron de su entorno. P2-02 queda a cargo del equipo (Firewall de Vercel).

**Antes del deploy**
1. P2-02: regla de rate limit por IP en el Firewall de Vercel para `/login` (configuración, sin código).
2. P2-04: `crearProductoDesdeFacturaAction` debe pasar por `conOperador`.
3. P2-05: dejar `npm test` en verde.

**En el tiempo**
- P2-01: igualar la latencia del login con email inexistente.
- P2-03: payload opaco en `/api/health`, si se decide no exponer el estado de la base.

---

## Informe original del revisor (resumido)

### A. Encabezado
- Stack confirmado: Next 16.4.1, React 19.2.8, Prisma 7.10.1, zod 4.6.5, decimal.js 10.6.0, `@node-rs/argon2` 2.2.1.
- Ejecutado: `git rev-parse HEAD`, `git status --short`, `npm test` (183 archivos ok, 10 fallidos; 3.537 tests ok, 20 fallidos), `npm run lint` (0 errores, 285 warnings; reglas de límites conformes), inspección de `shared/usecase.ts`, `proxy.ts`, 18 Route Handlers, Server Actions, `shared/auth/`, `modules/auth/`, `modules/usuarios/`.
- No ejecutado: `npm run dev/build/install`, comandos destructivos, consultas a la base (las funciones de login y sesión se revisaron en las migraciones 0009 y 0010).

### B. Resumen
Conteo: BLOCKER 0 · CRITICAL 0 · WARNING 2 · SUGGESTION 1. Pipeline de casos de uso y cuentas de sector evaluados como conformes.

### C. Hallazgos
| ID | Sev. | Conf. | Ubicación | Riesgo | Acción | Cierre |
|---|---|---|---|---|---|---|
| P2-01 | WARNING | ALTA | `modules/auth/application/login.ts:61-118` | Enumeración de emails por diferencia de latencia (transacción solo si el usuario existe). | Igualar la latencia del caso inexistente. | 500 pares de peticiones sin diferencia significativa. |
| P2-02 | WARNING | ALTA | `proxy.ts:82-120`, `app/(auth)/login/actions.ts:35-53` | Sin rate limit por IP: DoS de CPU por argon2 y password spraying. | Rate limit en el borde (Vercel Firewall) o middleware. | Más de 10 peticiones/min por IP reciben 429 antes de `login()`. |
| P2-03 | SUGGESTION | ALTA | `app/api/health/route.ts:53-63` | Expone el estado de la base a terceros. | Payload opaco. | Sin clave `db`. |

### D. Cobertura (según el revisor)
- Pipeline `defineCommand`/`defineQuery`: conforme (requireSession → authorize → resolverActor → zod → transacción → audit; queries sin auditoría; inyección de sesión solo en `NODE_ENV === "test"`).
- 18 Route Handlers: 17 pasan por un caso de uso con permiso y tenant de la sesión; `/api/health` es público (P2-03). Los jobs iteran tenants con su propio `withTenantTransaction`.
- Server Actions: ninguna importa infraestructura ni transacciones.
- Cuentas de sector: conforme según el revisor (corregido por P2-04).
- Login y PIN: argon2id, bloqueo a los 5 intentos (15 min login; PIN bloqueado hasta reactivación), dummy hash para emails inexistentes.
- Sesión: rotación al login, revocación individual y masiva.
- `fsj.sesion_resolve_tenant` y `fsj.usuario_resolve_login`: `search_path` fijo y REVOKE a PUBLIC.
- Roles: no se pueden otorgar permisos que no se tienen; nadie edita un rol que tiene asignado.
- `CRON_SECRET`: comparación SHA-256 con `timingSafeEqual`; 503 si falta, 404 si es inválido.
- Errores: `toSafeError`/`actionError` ocultan stack, SQL e invariantes; devuelven `requestId`.

### E. Pruebas propuestas (no ejecutadas)
1. Canal lateral de tiempo en login (staging, 1.000 peticiones alternadas).
2. Bloqueo del PIN al 5.º intento en cuenta de sector sin bloquear la cuenta.
3. Un usuario individual que inyecta `operadorId`/`operadorPin` en el FormData: la acción se registra a su nombre.

### F. Verificaciones en producción
1. Cookie `fsj_session` con HttpOnly, Secure, SameSite=Lax; header `Strict-Transport-Security`.
2. `curl -i https://<dominio>/api/health`.
3. `/api/jobs/plazos-archivo` sin header o con secreto inválido responde 404; los crons de Vercel registran 200.

### G. Observaciones para otras partes
- Parte 3: `audit: { skip: true }` con auditoría manual en `modules/usuarios/application/cambiar-roles.ts` y `crear-usuario.ts`; co-firma del DT en `registrar-ajuste.ts` validada en una transacción previa al commit del ajuste.
- Parte 4: validación de tipo del logo (SVG); inyección de fórmulas en XLSX (`exceljs`) y texto libre en PDF (`pdfkit`).
- Parte 5: `CRON_SECRET` opcional; propagación de `x-request-id` en los transportes de Pino.
- Parte 6: 20 tests unitarios fallidos (ver P2-05).
