# Control table: contrasena-temporal

Original: `git show HEAD:openspec/specs/contrasena-temporal/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its
"SPEC — " prefix. CT1–CT9 keep their IDs. Rules without an ID (Modelo, Reglas de alta, Pasos obligatorios,
Eliminar PIN, Primer Administrador, Despliegue) became requirements without a number. No number was computed.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Estado blockquote (status, 0097, rollbacks) + Decisiones del usuario (2026-10-22, 2026-10-23, 2026-10-26) | `## Estado` (verbatim) | — | Decisiones also in `## Purpose`. |
| Por qué ¶1 | `## Por qué` (verbatim) | — | Non-normative context. |
| Alcance: Entra, No entra, Anti-objetivos | `## Alcance` (verbatim) | — | Non-normative scope boundaries. |
| Modelo: Columna debe_cambiar_password, Estados, credencial_activacion | `## Modelo` (verbatim) | — | Architecture notes and schema changes kept verbatim. |
| Reglas: Alta (política de contraseñas, 6 chars temporal / 8 chars y mayúscula definitiva) | "Política de longitud y complejidad de contraseñas" | "Asignación de contraseña temporal válida", "Elección de contraseña definitiva por el usuario" (direct) | — |
| Reglas: Alta (`crearUsuario`, campos temporal y repetir, hash argon2id, ACTIVO, toast) | "Alta de usuario con contraseña temporal" | "Alta exitosa de usuario individual", "Contraseñas no coincidentes en el alta" (direct) | — |
| Reglas: Restablecer credencial (`restablecerCredencial`, hash, revocación sesiones, reseteo intentos, rechazo de BAJA) | "Restablecimiento de credenciales por Administrador" | "Restablecimiento a usuario activo o pendiente de activación", "Restablecimiento a usuario suspendido", "Restablecimiento de credencial a usuario en estado BAJA" (direct) | — |
| Reglas: Pasos obligatorios (orden estricto, paso 1 nueva distinta de temporal, paso 2 PIN) | "Secuencia de pasos obligatorios tras inicio de sesión" | "Secuencia completa de pasos obligatorios", "Revocación de otras sesiones al cambiar contraseña temporal", "Rechazo de contraseña nueva idéntica a la temporal" (direct) | — |
| Reglas: Bloqueo en dos capas (páginas fuera de `(app)`, requireSession y error en formulario) | "Bloqueo estricto de navegación y casos de uso por pasos pendientes" | "Redirección de pantalla por paso pendiente", "Invocación de Server Action con formulario abierto" (direct) | — |
| Reglas: Eliminar PIN (`/cuenta` sin eliminar PIN, panel ausente, servidor rechaza configurarPin) | "Eliminación de la opción de eliminar PIN" | "Consulta de opciones en /cuenta", "Panel de PIN ausente para Administrador exclusivo" (direct) | — |
| Reglas: Primer Administrador (`scripts/create-tenant.ts` contraseña temporal, sin código) | "Bootstrap del Administrador inicial de tenant" | "Ejecución de create-tenant" (direct) | — |
| Reglas: Despliegue (usuarios pendientes de activación y activos sin PIN, salida restablecer o baja) | "Migración y tratamiento de usuarios pendientes de activación" | "Intento de uso de código de activación revocado" (direct) | — |
| Decisiones / Alcance: Contraseña temporal no vence | "Vigencia indefinida de la contraseña temporal" | "Inicio de sesión con contraseña temporal sin vencimiento" (direct) | Promovido de sección no normativa. |
| Reglas: Auditoría de alta y restablecimiento sin contraseña | "Auditoría de alta y restablecimiento sin contraseña en claro" | "Registro de auditoría en alta y restablecimiento de credenciales" (direct) | Promovido de sección no normativa. |
| Reglas: Paso 2 no pide contraseña | "Ausencia de contraseña en el paso obligatorio de PIN" | "Configuración de PIN en paso obligatorio sin requerir contraseña" (direct) | Promovido de sección no normativa. |
| CT1 (hash argon2id, nunca en claro ni auditado) | CT1 — Almacenamiento y auditoría segura de contraseña temporal | "Creación o restablecimiento de usuario con contraseña temporal" (direct) | Section kept verbatim in `## Invariantes nuevas`. |
| CT2 (bloqueo general por debe_cambiar_password = true) | CT2 — Bloqueo general por cambio de contraseña pendiente | "Usuario con cambio de contraseña pendiente intenta ejecutar caso de uso" (direct) | — |
| CT3 (bloqueo general por falta de PIN) | CT3 — Bloqueo general por PIN pendiente | "Usuario sin PIN intenta ejecutar caso de uso ordinario" (direct) | — |
| CT4 (debe_cambiar_password = false solo por cambio del titular) | CT4 — Desactivación de debe_cambiar_password únicamente por el titular | "Titular completa cambio de contraseña" (direct) | — |
| CT5 (restablecer credencial no toca pin_hash) | CT5 — Preservación de PIN en restablecimiento de credenciales | "Restablecimiento de credencial a usuario con PIN" (direct) | — |
| CT6 (cuentas de sector sin pasos pendientes, aunque fila anterior tenga flag) | CT6 — Exención de pasos pendientes y prohibición de cambio de clave en cuentas de sector | "Inicio de sesión de cuenta de sector", "Intento de cambiar contraseña desde cuenta de sector" (direct) | — |
| CT7 (empleado con cambio de clave pendiente no es operador con PIN) | CT7 — Inhabilitación de operador con cambio de contraseña pendiente | "Exclusión del listado de operadores", "Rechazo de PIN de operador con cambio pendiente" (direct) | — |
| CT8 (DT con cambio de clave pendiente no co-firma en stock/libro/pesada, mensaje genérico) | CT8 — Inhabilitación de co-firma de Director Técnico con cambio pendiente | "Intento de co-firma por DT con contraseña temporal" (direct) | — |
| CT9 (usuario exclusivamente Administrador sin paso PIN, con otro rol sí) | CT9 — Exención de PIN para usuarios exclusivamente Administradores | "Administrador sin otros roles", "Administrador con rol operativo adicional" (direct) | — |
| Pantallas | `## Pantallas` (verbatim) | — | Reference table kept verbatim. |
| Invariantes nuevas | `## Invariantes nuevas` (verbatim) | — | Reference table kept verbatim. |
| Código | `## Código` (verbatim) | — | Non-normative reference. |
| Desviaciones | `## Desviaciones` (verbatim) | — | Non-normative reference. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 20 requirements, 31 scenarios, 0 derived.

## Conflicts and stale points (kept as written)

None found in the text.

`openspec validate contrasena-temporal --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.
