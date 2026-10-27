# Control table: roles-personalizables

Original: `git show HEAD:openspec/specs/roles-personalizables/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its
"SPEC — " prefix. INV-ROL-001 a INV-ROL-005 keep their IDs. Rules without an ID (Resumen, Categorías de permisos,
Modelo de datos, Reglas anti-escalada, Permisos requeridos, UI / Editor) became requirements without a number. No
number was computed.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Estado blockquote + Resumen ¶1 | `## Estado` y `## Resumen` (verbatim) | — | Decisión también en `## Purpose`. |
| Resumen ¶1 (roles por tenant, seed inicial, 0106) | "Roles por farmacia y plantilla inicial" | "Tenant nuevo recibe roles predefinidos", "Farmacia preexistente conserva roles anteriores" (direct) | — |
| Resumen ¶2 + Reglas anti-escalada (permisos `roles.gestionar`, `roles.ver`, re-autenticación) | "Permiso para gestionar y ver roles" | "Creación de rol por usuario con permiso", "Lectura de roles con roles.ver" (direct); "Rechazo de edición sin permiso roles.gestionar" (**derived**) | Conflicto con código documentado abajo. |
| Categorías de permisos ¶1 y tabla | "Categorías de permisos" | "Permiso de sistema no asignable a roles", "Permiso operativo no asignado a Administrador" (direct) | Tabla y criterios preservados en `## Categorías de permisos`. |
| Categorías de permisos: ADMINISTRADOR no tiene operativo, consulta y gestión automáticos | "Rol ADMINISTRADOR y permisos efectivos" | "Administrador con permisos de consulta y gestión" (direct); "Administrador sin permisos operativos" (**derived**) | — |
| Resumen ¶4 (suma de permisos, lectura por request) | "Suma de permisos por roles y lectura por request" | "Usuario con múltiples roles", "Efecto inmediato de cambios en la siguiente solicitud" (direct) | — |
| Triggers y bloqueos: permisos de sesión | "Permisos base de sesión en todo rol" | "Inclusión automática de permisos de sesión en rol nuevo", "Conservación de permisos de sesión al editar rol" (direct) | Se agrega la justificación técnica al requisito. |
| Resumen ¶5 (auditoría CREAR_ROL, EDITAR_ROL, ELIMINAR_ROL) | "Auditoría de cambios de roles" | "Auditoría al crear un rol", "Auditoría al editar un rol", "Auditoría al eliminar un rol" (direct) | — |
| Reglas anti-escalada: definición de conjunto otorgable | "Conjunto otorgable de un actor" | "Conjunto otorgable de un usuario Administrador", "Conjunto otorgable de un gestor de roles no administrador" (direct) | — |
| Reglas anti-escalada 1 | "Anti-escalada 1 — Restricción de otorgamiento de permisos" | "Intento de otorgar permiso no poseído fuera del conjunto otorgable", "Conservación de permisos preexistentes fuera del alcance del actor" (direct) | — |
| Reglas anti-escalada 2 | "Anti-escalada 2 — Prohibición de editar o eliminar rol propio" | "Intento de editar un rol asignado al propio usuario", "Intento de eliminar un rol asignado al propio usuario" (direct) | — |
| Reglas anti-escalada 3 | "Anti-escalada 3 — Restricción en la asignación de roles a usuarios" | "Administrador asigna rol con permisos operativos", "Usuario no administrador intenta asignar rol con permisos que no posee" (direct) | — |
| Reglas anti-escalada 4 | "Anti-escalada 4 — Protección del último administrador" | "Rechazo al intentar remover el rol ADMINISTRADOR del único administrador activo" (**derived**) | — |
| Triggers e Invariantes: INV-ROL-001 | "INV-ROL-001 — Inmutabilidad de código y marca de administrador" | "Intento de modificar código de un rol", "Intento de modificar atributo es_administrador" (direct) | `## Invariantes nuevas` kept verbatim. |
| Triggers e Invariantes: INV-ROL-002 | "INV-ROL-002 — Intocabilidad de ADMINISTRADOR y SISTEMA" | "Intento de modificar o eliminar el rol ADMINISTRADOR", "Intento de modificar o eliminar el rol SISTEMA" (direct) | — |
| Triggers e Invariantes: INV-ROL-003 | "INV-ROL-003 — Prohibición de eliminar DIRECTOR_TECNICO" | "Intento de eliminar el rol DIRECTOR_TECNICO" (direct) | — |
| Triggers e Invariantes: INV-ROL-004 | "INV-ROL-004 — Prohibición de eliminar rol asignado" | "Rechazo al eliminar rol que cuenta con usuarios asignados", "Eliminación permitida de rol sin usuarios asignados" (direct) | — |
| Triggers e Invariantes: INV-ROL-005 | "INV-ROL-005 — Exclusividad de asignación del rol SISTEMA" | "Intento de asignar rol SISTEMA a un usuario normal" (direct) | — |
| Triggers y bloqueos: cuentas de sector (INV-SEC-001, permisos vedados) | "Restricciones de roles en cuentas de sector" | "Intento de asignar rol ADMINISTRADOR a cuenta de sector", "Exclusión de permisos vedados en sesión de cuenta de sector" (direct) | — |
| Editor de roles (UI): agrupamiento, deshabilitados, lectura admin | "Comportamiento del editor de roles en la interfaz" | "Permisos deshabilitados en el editor para permisos fuera del conjunto otorgable", "Visualización de solo lectura para el rol ADMINISTRADOR" (direct) | — |
| Resumen / Decisión predefinidos editables | "Eliminación de roles predefinidos editables" | "Eliminación de rol predefinido sin usuarios asignados" (direct) | Promovido de sección no normativa. |
| Reglas anti-escalada: Administrador asignándose roles operativos | "Asignación de roles operativos al Administrador" | "Administrador se asigna rol operativo" (direct) | Promovido de sección no normativa. |
| Reglas anti-escalada: botones se ocultan y re-autorización | "Ocultamiento de botones y autorización de comandos de roles" | "Acceso de usuario sin roles.gestionar a la interfaz y al comando" (direct) | Promovido de sección no normativa. |
| Editor de roles (UI): confirmación de eliminar y disponibilidad | "Confirmación y disponibilidad de la acción de eliminar rol" | "Acción de eliminar en rol asignado o protegido" (direct) | Promovido de sección no normativa. |
| Modelo de datos / Triggers: lower(nombre) único por tenant | "Unicidad del nombre de rol por farmacia" | "Creación de rol con nombre duplicado en diferente caja" (direct) | Promovido de sección no normativa. |
| Modelo de datos: `fsj.usuario_rol` FK compuesta | "Pertenencia de roles a la farmacia del usuario" | "Asignación de rol de otra farmacia" (direct) | Promovido de sección no normativa. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 25 requirements, 43 scenarios, 3 derived.

## Derived scenarios reasoning

- **Rechazo de edición sin permiso roles.gestionar**: Inferencia del rechazo de la operación ante la falta del permiso exigido por la regla.
- **Administrador sin permisos operativos**: Inferencia del rechazo ante un acto operativo a partir de la prohibición de que ADMINISTRADOR posea permisos operativos.
- **Rechazo al intentar remover el rol ADMINISTRADOR del único administrador activo**: Inferencia de la comprobación del código inmutable `ADMINISTRADOR` para impedir que una farmacia quede sin administradores activos.

## Conflicts and stale points (kept as written)

- Re-autenticación en gestión de roles: The code requires no recent re-auth for role writes (`crear-rol.ts:28`, `editar-rol.ts:43`, `eliminar-rol.ts:29`; `shared/usecase.ts:368`) nor for cambiarRoles (`cambiar-roles.ts:5-7`, user decision 2026-10-21, also `shared/usecase.ts:117`, `shared/auth/README.md:18`). Conflict sits in "Permiso para gestionar y ver roles" and its scenario "Creación de rol por usuario con permiso".

`openspec validate roles-personalizables --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.
