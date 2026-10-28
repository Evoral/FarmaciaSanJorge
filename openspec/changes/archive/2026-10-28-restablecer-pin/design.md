# Design — Restablecer el PIN de un usuario

> Estado: implementado y archivado 2026-10-28. Sin cambio de esquema (sin migración ni rollback SQL).
> Las reglas vigentes están en `openspec/specs/contrasena-temporal/spec.md` (RP1–RP8); esta tabla es el diseño.
> Decisión del usuario (2026-10-28): el Administrador tiene un botón que **borra el PIN** de un usuario; la próxima vez
> que esa persona use el sistema, se le pide configurar uno nuevo. Pensado para quien se olvidó el PIN.

## Alcance

Hoy el PIN solo lo cambia su titular, desde «Mi cuenta», con su contraseña actual (`configurarPin`). Si alguien se
olvidó el PIN y no sabe (o no puede) hacerlo solo, no hay salida desde la administración. «Restablecer credencial»
cambia la contraseña pero **conserva el PIN** a propósito (`openspec/specs/contrasena-temporal/spec.md`, CT5).

Esta funcionalidad agrega **«Restablecer PIN»** en el detalle del usuario: borra el PIN existente. Como el PIN es
obligatorio (CT3), el paso pendiente **Configurar PIN** aparece solo, sin columna
nueva: la obligación ya se deriva de `pin_hash IS NULL AND NOT es_sector AND NOT soloAdministrador`.

No hace falta un flujo nuevo para el usuario: es el mismo paso `/configurar-pin` que ya existe.

**Fuera de alcance.**
- Que el Administrador elija o vea el PIN nuevo. Nunca: el PIN lo elige y lo conoce solo su titular.
- Avisar al usuario por correo. El Administrador le avisa en persona, igual que con la contraseña temporal.
- Cambiar «Restablecer credencial»: sigue sin tocar el PIN. Son dos botones independientes.

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| RP1 | Lo ejecuta quien tiene `usuarios.credencial.restablecer` (el mismo permiso que «Restablecer credencial»; no se crea uno nuevo). Ese permiso está en `PERMISOS_VEDADOS_A_SECTOR`, así que una cuenta de sector nunca puede ejecutarlo. | `defineCommand` (`permiso`); `permisosEfectivos`. |
| RP2 | **No sobre sí mismo.** Para cambiar el propio PIN está «Mi cuenta» (pide la contraseña actual). Misma regla y mismo mensaje que «Restablecer credencial». | Handler (`esAccionSobreSiMismo`). |
| RP3 | Se rechaza si el usuario destino: es **cuenta de sector** («Las cuentas de sector no usan PIN.»), tiene como **único rol Administrador** («El Administrador no usa PIN.»), está dado de **baja** o **no tiene PIN** («El usuario no tiene un PIN configurado.»). | Handler, sobre la fila bloqueada (RP6). |
| RP4 | Efecto, en una sola transacción: `pin_hash = NULL`, `pin_intentos_fallidos = 0`, `pin_bloqueado = false`, `pin_actualizado_en = now()`. Nada más: **no** toca la contraseña, `debe_cambiar_password`, el estado ni los roles. | Repositorio (`limpiarPin`, misma escritura que ya hace `cambiarEstadoUsuario` al salir de `ACTIVO`). |
| RP5 | **No se cierran las sesiones.** No hace falta: los pasos pendientes se derivan en cada solicitud (`validateSession` → `derivarPasosPendientes`), así que la próxima página o acción del usuario lo lleva a **Configurar PIN**. Si tenía un formulario abierto, el error vuelve como error del formulario y lo cargado se conserva (`use-form-submit`). | `requireSession()` (`PasosPendientesError`), sin cambios. |
| RP6 | Bloquea la fila del destino antes de leerla (`lockUsuarioYAdministradoresActivos`), en el mismo orden que el resto de los comandos de usuarios (`admin-guard.ts`). Así, un doble clic o dos administradores a la vez dan un éxito y un rechazo «no tiene un PIN configurado», nunca dos filas de auditoría. | Handler. |
| RP7 | Auditoría `RESTABLECER_CREDENCIAL` (valor existente de `tipo_accion`, sin migración), `entidad = usuario`, `entidadId` = destino, `motivo` «Restablecimiento de PIN por el Administrador.», `valorAnterior = { pinBloqueado }`, `valorNuevo = { pin: "restablecido", pinBloqueado: false }`. **Nunca** el PIN ni su hash. El motivo lo diferencia de un restablecimiento de contraseña en `/auditoria`. | `defineCommand` (`audit`). |
| RP8 | Mientras no configure uno nuevo, el usuario **no puede identificarse en una cuenta de sector**: desde S8 (2026-10-28) el empleado se identifica solo con su PIN, y un PIN que no coincide con ningún operador se rechaza sin atribuirse a nadie ni sumar intentos. | Sin cambios. |
| RP9 | El PIN nuevo se configura con el paso existente (`configurarPinObligatorio`, `validatePin`: 4 dígitos, no triviales). Si además tiene pendiente el cambio de contraseña, primero cambia la contraseña y después el PIN (orden ya definido). | Sin cambios. |

## Casos a tener presentes

| Caso | Qué pasa |
|---|---|
| El usuario tiene el PIN **bloqueado** (5 intentos fallidos en la reautenticación con PIN; la identificación en cuenta de sector ya no bloquea, S8) | Se restablece igual. Es otra forma de salir del bloqueo (además de reautenticarse con contraseña). |
| El usuario está **SUSPENDIDO** o **PENDIENTE_ACTIVACION** | No tiene PIN (`cambiarEstadoUsuario` lo borra al salir de `ACTIVO`) → RP3 «no tiene un PIN configurado». El botón no se muestra. |
| El usuario tiene **un cambio de contraseña pendiente** | Se permite. Al entrar hace los dos pasos en orden (RP9). |
| El usuario es **DT** | Se permite. La co-firma del DT usa su **contraseña**, no el PIN: sigue pudiendo co-firmar. Su propia sesión pasa al paso Configurar PIN en la próxima solicitud. |
| El usuario está **en uso en una cuenta de sector** en ese momento | La acción en curso se rechaza con el error de PIN y el formulario conserva lo cargado. Su PIN anterior ya no lo identifica hasta que configure uno nuevo. |
| El usuario cambia su PIN desde «Mi cuenta» al mismo tiempo | Las dos escrituras se serializan por el lock de la fila. Si gana el cambio del usuario, el restablecimiento se aplica después y lo borra (el usuario lo vuelve a configurar); si gana el restablecimiento, el cambio del usuario deja un PIN que él conoce. En ningún orden queda un PIN que nadie conoce. |
| El Administrador hace **doble clic** o la pantalla está **desactualizada** | El segundo envío se rechaza con «El usuario no tiene un PIN configurado.» (RP6). Un solo registro de auditoría. |
| El Administrador también tiene otro rol (y PIN propio) | RP2: no puede restablecer el suyo desde aquí; usa «Mi cuenta». |

## Pantalla

**Usuarios › detalle** (`app/(app)/admin/accesos/usuarios/[id]/page.tsx`), en el panel lateral «Estado y credencial»,
debajo de «Credencial»:

- Panel **PIN**, visible solo si quien mira puede restablecer (`can(session, "usuarios.credencial.restablecer")`), no es
  uno mismo, el destino no es cuenta de sector ni solo-Administrador y no está dado de baja.
- Muestra el estado actual: «Configurado», «Bloqueado por intentos fallidos» o «Sin configurar (se le pedirá al
  ingresar)».
- Si hay PIN, botón **«Restablecer PIN»** con el patrón de dos pasos que ya usan Suspender / Dar de baja
  (`CollapsibleActionCard` + confirmación, sin motivo). Texto de ayuda: «Borra el PIN actual. La próxima vez que
  ingrese, la persona tendrá que configurar uno nuevo. No cierra sus sesiones ni cambia su contraseña.»
- Al terminar bien: toast «PIN restablecido.» y el panel pasa a «Sin configurar».
- El texto del panel «Credencial» («su PIN se conserva») no cambia.
- La ayuda del permiso (`modules/usuarios/domain/ayuda-permisos.ts`) suma que también permite restablecer el PIN (de
  paso se corrigió: todavía hablaba del código de activación, reemplazado por la contraseña temporal).

## Código

- Caso de uso: `modules/usuarios/application/restablecer-pin.ts` (`defineCommand`, nombre `usuarios.pin.restablecer`,
  permiso `usuarios.credencial.restablecer`, audit `RESTABLECER_CREDENCIAL`).
- Repositorio (`modules/usuarios/infrastructure/usuario-repository.ts`): `limpiarPin`, que comparte con
  `cambiarEstadoUsuario` la misma escritura (`datosPinLimpio`), y `loadUsuarioParaRestablecerPin`, que lee la fila ya
  bloqueada (estado, cuenta de sector, solo-Administrador, si tiene PIN y si está bloqueado; nunca el hash). Es un
  loader propio y no una extensión de `loadUsuarioParaAccion`, para no cargarles columnas de PIN a los demás comandos.
- Lectura del estado del PIN para el panel: `getUsuarioDetalle` suma `pinConfigurado`, `pinBloqueado` y
  `soloAdministrador` (nunca el hash).
- Server Action en `modules/usuarios/ui/actions.ts`; componente `modules/usuarios/ui/restablecer-pin.tsx`.
- No ejecuta una acción de `PERMISOS_CON_PIN_*`, así que **no** se envuelve en `conOperador`.
- No requiere `permitirPasosPendientes`: lo ejecuta el Administrador desde su propia sesión.

## Tests

- Unitarios del handler: rechaza sobre sí mismo, cuenta de sector, solo-Administrador, BAJA y sin PIN; en el caso
  válido limpia los cuatro campos y audita sin el PIN ni su hash.
- `tests/unit/usecase-registry-all-modules.test.ts` lo cubre por estar registrado (sin cambio en la lista de
  `permitirPasosPendientes` de `tests/unit/auth-pasos-registry.test.ts`).
- Derivación: un usuario con `pin_hash = NULL` tras el restablecimiento tiene el paso `configurar-pin`. Ya lo cubre
  `tests/unit/auth-pasos-pendientes.test.ts` («an individual usuario without PIN must configure it»): la derivación no
  guarda historia, así que «tenía PIN y lo perdió» es el mismo caso.
- `tests/unit/usuarios-restablecer-pin.test.ts`.

## Reversión

Sin esquema nuevo: revertir el commit. Los PIN ya borrados no se recuperan (no se guardan), y no hace falta: esos
usuarios ya configuraron uno nuevo o lo harán en su próximo ingreso.
