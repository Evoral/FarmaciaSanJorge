# Control table: cuentas-de-sector

Original: `git show HEAD:openspec/specs/cuentas-de-sector/spec.md`.

Spanish kept throughout; only the CLI keywords (SHALL/MUST, GIVEN/WHEN/THEN/AND) are English. The title drops its
"SPEC — " prefix. S1–S12, INV-SEC-001 e INV-SEC-002 keep their IDs. Rules without an ID (Modelo, Acciones configurables,
Casos a tener presentes, Cómo viaja la credencial, Pantallas) became requirements without a number. No number was
computed.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Estado blockquote (status, 0077/0078, rollbacks) + Decisiones del usuario (2026-10-13, 2026-10-21, 2026-10-26) | `## Estado` (verbatim) | — | Decisiones also in `## Purpose`. |
| Alcance ¶1–¶3 + Fuera de alcance | `## Alcance` (verbatim) | — | Non-normative context. |
| Alcance: Actos propios del DT nunca en cuenta de sector | "Incompatibilidad de actos propios del Director Técnico en cuentas de sector" | "Intento de realizar acto propio del Director Técnico desde cuenta de sector" (direct) | Promovido de sección no normativa. |
| Modelo: Tabla de elementos | `## Modelo` (verbatim) | — | Reference table kept verbatim. |
| Modelo: PIN 4 dígitos (`AUTH_POLICY.pinLength`) | "Longitud y hashing de PIN" | "Configuración de PIN de 4 dígitos", "Intento de configurar PIN con longitud fuera del rango permitido" (direct) | — |
| Modelo: Unicidad de PIN por farmacia (decisión 2026-10-26) | "Unicidad de PIN por farmacia" | "Empleado elige PIN ya en uso por otro empleado de la misma farmacia" (direct); "Empleados de farmacias distintas configuran el mismo PIN" (**derived**) | — |
| S1 (rechazo sin empleado antes de tx, todo comando presente o futuro) | S1 — Rechazo de acción con PIN sin empleado identificado | "Solicitud a acción con PIN sin empleado identificado en cuenta de sector" (direct) | — |
| S2 (verificación en cada acción, múltiples comandos una vez) | S2 — Verificación de PIN en cada acción | "Dos acciones consecutivas en la misma cuenta de sector", "Acción que encadena múltiples comandos en una única solicitud" (direct) | — |
| S3 (intersección de permisos sector y empleado, auditoría denegado) | S3 — Intersección de permisos entre sector y empleado | "Empleado y sector con permisos habilitados", "Empleado sin permiso para la acción aunque el sector lo tenga" (direct) | — |
| S4 (atribución al empleado como session.usuario) | S4 — Atribución de la acción al empleado | "Atribución de preparación o entrega a nombre del empleado" (direct) | — |
| S5 (auditoría contexto.terminal y contexto.verificacion PIN) | S5 — Auditoría con contexto de terminal de sector y método PIN | "Registro de auditoría de acción ejecutada en cuenta de sector" (direct) | — |
| S6 (acciones sin PIN atribuidas a cuenta de sector) | S6 — Atribución de acciones sin PIN a la cuenta de sector | "Ejecución de acción de mostrador sin PIN" (direct) | — |
| S7 (condiciones para operador: ACTIVO, no sector, no técnico, con PIN, sin temp pw pendiente) | S7 — Condiciones para calificar como operador | "Empleado activo con PIN y sin cambio de contraseña pendiente", "Usuario con cambio de contraseña temporal pendiente" (direct) | — |
| S8 (intentos fallidos, bloqueo al quinto, desbloqueo) | S8 — Límite de intentos fallidos y bloqueo de PIN | "Quinto intento consecutivo de PIN incorrecto" (direct); "Desbloqueo de PIN por el titular" (**derived**) | — |
| S9 (auditoría de rechazo operador / AUTORIZAR sin PIN) | S9 — Auditoría de intentos de identificación rechazados | "Registro de auditoría ante PIN incorrecto" (direct) | — |
| S10 (prohibición ADMINISTRADOR/DT y permisos vedados sustraídos) | S10 — Exclusión de roles y permisos vedados en cuentas de sector | "Asignación de rol o permisos vedados a cuenta de sector", "Permisos vedados sustraídos de los permisos efectivos de cuenta de sector" (direct) | — |
| S11 (sin reautenticación por contraseña en cuenta de sector, salvo reanclarLibro) | S11 — Exclusión de reautenticación por contraseña en cuentas de sector | "Ejecución de comando en cuenta de sector sin reautenticación por contraseña" (direct) | Conflicto con código documentado abajo. |
| S12 (consultas y sesiones individuales sin PIN, DT donde autoriza) | S12 — Ausencia de PIN en consultas y en sesiones individuales | "Consulta ejecutada en cuenta de sector", "Sesión individual realizando acción sensible", "Acción que requiere autorización del Director Técnico" (direct) | — |
| Acciones configurables: reglas no configurables (recetas.anular no se deshace, cotizaciones.calcular se recalcula solo) | "Configuración de acciones con PIN y reglas no configurables" | "Modificación de acción configurable", "Anulación de receta en cuenta de sector" (direct) | Se restauran motivos originales. |
| Acciones configurables: valores por defecto (sembrado inicial) | "Valores por defecto de acciones con PIN" | "Sembrado inicial de acciones con PIN por defecto" (direct) | Promovido de sección no normativa. |
| Acciones configurables: config.editar audit (conjunto antes y después) | "Auditoría y aplicación de cambios en PIN por acción" | "Modificación de configuración de PIN por acción" (direct) | Promovido de sección no normativa. |
| Casos a tener presentes: Co-firma DT + Guardar receta con fichas | "Co-firma de DT y generación de fichas técnicas en cuenta de sector" | "Ajuste de stock en cuenta de sector", "Guardado de receta con generación de fichas técnicas" (direct) | — |
| Casos a tener presentes: Crear producto en importación facturas | "Bloqueo de creación directa de droga en importación de facturas" | "Creación directa de droga en importación de facturas desde cuenta de sector" (direct) | — |
| Casos a tener presentes: DT se identifica con PIN en actos no exclusivos | "Identificación del Director Técnico con PIN en actos no exclusivos" | "Director Técnico se identifica con PIN para acto operativo no exclusivo" (direct) | Promovido de sección no normativa. |
| Casos a tener presentes: rol LABORATORIO incluye recetas.crear y recetas.editar | "Permisos de recetas en el rol LABORATORIO" | "Operador con rol LABORATORIO en mesa de trabajo" (direct) | Promovido de sección no normativa. |
| Verificación (preparada para biometría) | `## Verificación (preparada para biometría)` (verbatim) | — | Non-normative architecture note. |
| Cómo viaja la credencial (conOperador) | "Manejo de operador en Server Actions mediante conOperador" | "Ejecución de Server Action con conOperador", "Server Action sin conOperador ejecutada desde cuenta de sector" (direct) | Conflicto menor documentado abajo. |
| Pantallas: Alta de cuenta de sector (nombre, email, pw definitiva, SECTOR-<NOMBRE>) | "Alta de cuenta de sector con credencial definitiva" | "Creación exitosa de cuenta de sector", "Conflicto por nombre duplicado de sector en la misma farmacia" (direct) | Section kept verbatim in `## Pantallas`. |
| Pantallas: Edición y detalle de cuenta de sector + restablecimiento | "Edición y restablecimiento de credenciales en cuentas de sector" | "Edición de datos de cuenta de sector", "Restablecimiento de credencial de cuenta de sector" (direct) | — |
| Pantallas: Mi cuenta (/cuenta nota y restricción cambiarPassword) | "Restricción de autoservicio en Mi cuenta para cuentas de sector" | "Acceso a /cuenta desde cuenta de sector", "Invocación de cambiarPassword para cuenta de sector" (direct) | — |
| Invariantes: INV-SEC-001 | "INV-SEC-001 — Prohibición de roles administrativos y de DT en cuentas de sector" | "Validación de invariante INV-SEC-001" (direct) | Section kept verbatim in `## Invariantes nuevas`. |
| Invariantes: INV-SEC-002 | "INV-SEC-002 — Inmutabilidad del atributo es_sector" | "Intento de cambiar la condición de cuenta de sector" (direct) | — |
| Código que lo implementa | same-named section (verbatim) | — | Non-normative reference. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none. 28 requirements, 43 scenarios, 2 derived.

## Derived scenarios reasoning

- **Empleados de farmacias distintas configuran el mismo PIN**: Inferencia de que la restricción de unicidad de PIN aplica dentro de la misma farmacia (tenant) y no entre farmacias distintas.
- **Desbloqueo de PIN por el titular**: Inferencia del reinicio del contador de intentos fallidos al desbloquear el PIN mediante reautenticación o configuración de nuevo PIN (`resetPinLockout` en código).

## Conflicts and stale points (kept as written)

- Re-autenticación en numeración de libro: El caso de uso `libro.numeracion.configurar` también exige `requireRecentReauth` (`configurar-numeracion-libro.ts:36`), contradiciendo S11 que solo exceptúa a `reanclarLibro`. Se mantuvo el texto de S11 tal como fue escrito.
- Envoltura con conOperador en recetas.anular: La acción `recetas.anular` (`PERMISOS_CON_PIN_SIEMPRE`) también se envuelve con `conOperador` (`recetas/ui/actions.ts:193`) aunque el requisito indica "acción configurable". Se mantuvo el texto como fue escrito.

`openspec validate cuentas-de-sector --type spec --strict`: valid (CLI 1.14.1); CLI text check: OK.
