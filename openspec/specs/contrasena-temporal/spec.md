# SPEC — Contraseña temporal, cambio obligatorio y PIN obligatorio

Estado: implementado 2026-10-22 (migración 0097). Reversión: `docs/rollbacks/contrasena-temporal.md`.

> Decisiones del usuario (2026-10-22):
> - El Administrador, al dar de alta un usuario, le **asigna una contraseña temporal**. Reemplaza al código de activación de un solo uso (72 h) y a la pantalla `/activar`.
> - Con esa contraseña la persona **inicia sesión normalmente**. Antes de poder usar el sistema tiene que (1) **cambiar la contraseña** por una propia y (2) **configurar su PIN**.
> - La contraseña temporal **no vence**: vale hasta que la persona la cambie.
> - «Restablecer credencial» funciona igual que el alta: el Administrador asigna una nueva contraseña temporal. **El PIN se conserva**; solo se obliga a cambiar la contraseña.
> - El PIN pasa a ser **obligatorio para todo usuario que no sea cuenta de sector**, también para los que ya estaban activos sin PIN: lo configuran la próxima vez que usen el sistema.
> - La contraseña temporal que escribe el Administrador (alta, «Restablecer credencial» y primer admin de `create-tenant`) necesita **al menos 6 caracteres**, sin exigir mayúscula (2026-10-23). La contraseña que la persona elige para sí misma (paso 1, «Mi cuenta») mantiene la política completa: 12 caracteres y una mayúscula.
> - El usuario cuyo único rol es Administrador no tiene PIN (2026-10-23): el Administrador no ejerce actos operativos. Con otro rol además, sí.
> - Las **cuentas de sector** no tienen PIN; para ellas solo es obligatorio el cambio de contraseña.
> - Mientras una persona tenga pendiente el cambio de contraseña, **no puede identificarse con su PIN en las cuentas de sector** (aunque conserve el PIN tras un restablecimiento).
> - Los usuarios que al desplegar estén `PENDIENTE_ACTIVACION` con un código sin usar: el código deja de servir y el Administrador les asigna una contraseña temporal con «Restablecer credencial».

Las decisiones marcadas **[decisión técnica]** no las tomó el usuario; son la opción por defecto del diseño y se pueden revisar.

## Por qué

El código de activación obligaba a entregar un string de ~43 caracteres que se muestra una sola vez, a usar una pantalla aparte (`/activar`) y a reemitirlo si vencía. Con una contraseña temporal elegida por el Administrador, la entrega es simple y el primer ingreso es el login de siempre. El PIN obligatorio asegura que todo empleado pueda identificarse en las cuentas de sector y en las acciones que piden PIN.

## Alcance

**Entra**
- Alta de usuario con contraseña temporal (`crearUsuario`, formulario `/admin/accesos/usuarios/nuevo`).
- «Restablecer credencial» con contraseña temporal (`restablecerCredencial`, su UI en el detalle del usuario).
- Paso obligatorio de cambio de contraseña y paso obligatorio de PIN después del login, con bloqueo de todo el resto del sistema mientras estén pendientes.
- Bootstrap del primer Administrador de un tenant (`scripts/create-tenant.ts`) con contraseña temporal.
- Retiro del flujo de activación por código (`/activar`, `activarCuenta`, componente `CredencialActivacion`).
- Migración `0097` + rollback.

**No entra**
- Vencimiento de la contraseña temporal (decisión: no vence).
- Envío de la contraseña por mail u otro canal: el Administrador la entrega en mano.
- Cambios a la política de la contraseña que elige la persona (`validatePassword`) o de PIN (`validatePin`). La contraseña temporal tiene su propia política más corta (ver Reglas → Alta).
- Eliminar el valor `PENDIENTE_ACTIVACION` del enum `EstadoUsuario` (queda como estado heredado, ver Modelo).

**Anti-objetivos** (aunque «funcione», sería un error)
- Que un usuario con un paso pendiente pueda ejecutar cualquier caso de uso de negocio o ver datos, aunque sea por una navegación cliente o una Server Action invocada directamente.
- Que la contraseña temporal quede en texto plano en algún lado: BD, auditoría, logs, estado del formulario devuelto al cliente.
- Que restablecer la credencial borre el PIN.

## Modelo

### Columna nueva `usuario.debe_cambiar_password`

`boolean NOT NULL DEFAULT false`. `true` cuando la contraseña vigente la asignó un Administrador (alta, restablecimiento, bootstrap). Vuelve a `false` solo cuando el propio usuario cambia su contraseña.

- `fsj_app` recibe `GRANT UPDATE (debe_cambiar_password)` (mismo patrón de grants por columna que la migración 0002).
- **[decisión técnica]** No hay columna «debe configurar PIN»: la obligación se **deriva** de `pin_hash IS NULL AND NOT es_sector`. Así también alcanza a los usuarios ya activos sin PIN y a los que pierden el PIN al ser suspendidos (`cambiarEstadoUsuario` limpia el PIN al salir de `ACTIVO`).

### Estados

- **[decisión técnica]** El usuario nuevo nace `ACTIVO` (con `password_hash` y `debe_cambiar_password = true`). Un insert directo en `ACTIVO` ya está permitido por el trigger (`trg_usuario_validar_transicion_estado` solo mira `UPDATE OF estado`).
- `PENDIENTE_ACTIVACION` deja de usarse para altas nuevas. Sigue existiendo en el enum para los usuarios que estén pendientes al desplegar; su única salida es «Restablecer credencial» (que los pasa a `ACTIVO`) o la baja.
- `login` y `validateSession` siguen exigiendo `estado = ACTIVO`: no cambian.

### `credencial_activacion`

- **[decisión técnica]** La tabla **se conserva** (historial y auditoría de credenciales emitidas), pero el código deja de escribir y de leer en ella.
- La migración `0097` revoca toda credencial viva (`revocada_en = now()` donde `usada_en IS NULL AND revocada_en IS NULL`), para que no quede ninguna fila «activa».

## Reglas

### Alta (`crearUsuario`)

- El formulario agrega **Contraseña temporal** y **Repetir contraseña temporal**, para personas y para cuentas de sector.
- Se valida con la política de contraseña temporal (`validateTemporaryPassword`): al menos 6 caracteres, sin exigir mayúscula. La contraseña que la persona elige después (paso 1) mantiene la política completa (`validatePassword`: 12 caracteres y una mayúscula). Si las dos no coinciden, error de campo.
- Se guarda solo el hash (argon2id, `hashPassword`), con `estado = ACTIVO` y `debe_cambiar_password = true`.
- No se genera código; `CrearUsuarioResult` deja de tener `credencial` y `credencialVenceEn`.
- Al terminar bien, se vuelve al detalle del usuario (o al listado) con un toast. La contraseña **no** se vuelve a mostrar: el Administrador ya la conoce porque la escribió.
- Auditoría: la de hoy (`CREAR` + un `ASIGNAR_ROL` por rol), sin la contraseña ni su hash.
- **[decisión técnica]** Un usuario con un paso pendiente no puede ejecutar acciones de terceros, así que la regla INV-U07 sobre el emisor deja de aplicarse a credenciales nuevas: no se emiten más.

### Restablecer credencial (`restablecerCredencial`)

- Pasa a ser un formulario con **Contraseña temporal** y **Repetir contraseña temporal** (misma validación que el alta).
- Efectos, en una transacción:
  - Guarda el nuevo hash y `debe_cambiar_password = true`.
  - Revoca todas las sesiones del usuario.
  - Resetea `intentos_fallidos` y `bloqueado_hasta`.
  - **No toca el PIN.**
- Estado:
  - `PENDIENTE_ACTIVACION` → `ACTIVO` (salida de los pendientes heredados).
  - `ACTIVO` queda `ACTIVO`.
  - **[decisión técnica]** `SUSPENDIDO` queda `SUSPENDIDO`: restablecer la contraseña no reactiva a nadie. Al reactivarlo podrá entrar con la temporal.
  - `BAJA`: se rechaza, igual que hoy.
- Se mantienen la regla «no sobre sí mismo» y el lock de `admin-guard`.
- Auditoría `RESTABLECER_CREDENCIAL`, sin la contraseña. `valorNuevo` registra el estado resultante.
- `cambiarEstadoUsuario` hoy limpia el PIN al salir de `ACTIVO`. Restablecer ya no saca al usuario de `ACTIVO`, así que el PIN se conserva.

### Pasos obligatorios después del login

Una sesión tiene **pasos pendientes** si:

1. `debe_cambiar_password = true` → paso **Cambiar contraseña**.
2. El paso 1 no está pendiente, `pin_hash IS NULL` y el usuario no es cuenta de sector, ni el usuario técnico SISTEMA (que nunca inicia sesión), ni un usuario cuyo único rol es Administrador (`rol.es_administrador`; con Administrador más otro rol, sí) → paso **Configurar PIN**. `configurarPinObligatorio` rechaza al usuario solo-Administrador («El Administrador no usa PIN.»).

Siempre en ese orden: el PIN se pide recién después del cambio de contraseña.

**Paso 1 — Cambiar contraseña**
- Pide la nueva contraseña dos veces y muestra los requisitos (`NewPasswordFields`).
- **[decisión técnica]** No pide la contraseña actual: la temporal se acaba de usar para iniciar sesión.
- **[decisión técnica]** La nueva no puede ser igual a la temporal.
- Si sale bien: guarda el hash, `debe_cambiar_password = false`, revoca las **otras** sesiones (la actual sigue, igual que `cambiarPassword`) y audita `MODIFICAR` con motivo «Cambio de contraseña temporal por el propio usuario».

**Paso 2 — Configurar PIN**
- Pide el PIN dos veces, con la misma validación de `validatePin` (4 dígitos, no triviales).
- No pide la contraseña (decisión del usuario).
- Audita lo mismo que `configurarPin` hoy, sin el PIN ni su hash.

**Bloqueo** (las dos capas son obligatorias)
- **Páginas**: el layout de `app/(app)` redirige a la pantalla del paso pendiente. Las pantallas de los pasos viven **fuera** de `app/(app)` (grupo propio con layout mínimo, sin sidebar), para no generar bucles de redirección.
- **Sesión**: **[decisión técnica]** el bloqueo vive en `requireSession()`, no solo en `shared/usecase.ts`. Hay llamadores que usan `requireSession()` directamente (route handlers de `/api`, `page.tsx`, algunos casos de uso como `confirmar-preparacion.ts` o `anular-asiento.ts`) y un bloqueo solo en `defineCommand` / `defineQuery` los dejaría afuera. Con pasos pendientes, `requireSession()` lanza un error tipado (por ejemplo `PasosPendientesError`). Solo lo evitan, con una opción explícita (por ejemplo `requireSession({ permitirPasosPendientes: true })`), los casos de uso y las pantallas del propio flujo: cambiar contraseña, configurar PIN y logout. Esto cubre Server Actions llamadas directamente, navegaciones cliente que no re-renderizan el layout, `@modal` y `/api`.
- **Formularios abiertos**: **[decisión técnica]** si el bloqueo salta en una Server Action (caso típico: un usuario sin PIN con un formulario largo abierto en el momento del despliegue), el error tipado vuelve como un error del formulario («Antes de seguir tenés que configurar tu PIN», con link al paso). `use-form-submit` solo resetea si sale bien, así que lo escrito se conserva.
- La sesión expone el estado (por ejemplo `pasosPendientes: ("cambiar-password" | "configurar-pin")[]`), cargado junto con el resto de la sesión en `findSesionCompletaByTokenHash`.
- Desde las pantallas de los pasos el usuario siempre puede **cerrar sesión**.
- El login, al terminar bien, redirige directo al primer paso pendiente si lo hay.

### Identificación por PIN en cuentas de sector

Un empleado con `debe_cambiar_password = true` **no puede identificarse como operador** en una cuenta de sector, aunque tenga PIN. Se aplica en los dos lugares donde hoy se decide quién es operador válido (`openspec/specs/cuentas-de-sector/spec.md`):
- La lista de operadores candidatos (`operadores-repository.ts`) lo excluye.
- La verificación del PIN (`verificarOperadorEnTx` y su tabla de decisión `OperadorPolicy`) lo rechaza aunque el PIN sea correcto. Se trata como cualquier operador no válido: no suma intentos fallidos de PIN.

Cuando cambia su contraseña, vuelve a poder identificarse sin hacer nada más.

Lo mismo vale para la **co-firma del Director Técnico** (stock, libro y pesada real, que reutiliza la verificación de stock): un DT con `debe_cambiar_password = true` no puede co-firmar aunque su contraseña sea correcta. La tabla `decideCoFirma` devuelve `DEBE_CAMBIAR_PASSWORD` justo después de `INACTIVO` y antes de comparar la contraseña, así que no suma intentos fallidos ni bloquea; el mensaje al operador es el mismo genérico de siempre y el motivo interno queda en la auditoría. El selector de DT de la co-firma no lista a esos DT.

### Eliminar PIN

**[decisión técnica]** Con el PIN obligatorio, «Eliminar PIN» de `/cuenta` deja de tener sentido para un usuario que no sea de sector. Se quita esa opción (y `eliminarPin`). Cambiar el PIN sigue igual. Para las cuentas de sector se oculta el panel de PIN en `/cuenta`: no tienen PIN.

### Primer Administrador (`scripts/create-tenant.ts`)

- Recibe la contraseña temporal por argumento o prompt. Inserta al Administrador `ACTIVO`, con el hash y `debe_cambiar_password = true`.
- El primer login lo lleva a los dos pasos, como a cualquier usuario.
- Deja de generar e imprimir el código de activación.

### Despliegue

- Los usuarios `PENDIENTE_ACTIVACION` no pueden iniciar sesión (como hoy) y sus códigos quedan revocados por la migración. El Administrador los ve en el listado (filtro y badge «Pendiente») y les asigna una contraseña temporal con «Restablecer credencial».
- Los usuarios activos sin PIN no tienen que hacer nada distinto: en su próxima página o acción el sistema los lleva al paso «Configurar PIN».

## Pantallas

| Pantalla | Cambio |
|---|---|
| `/admin/accesos/usuarios/nuevo` | Agrega «Contraseña temporal» y «Repetir». Quita la pantalla «Usuario creado» con la credencial. Se cambia la descripción («Queda pendiente de activación…»). |
| Detalle del usuario → «Restablecer credencial» | Formulario con «Contraseña temporal» y «Repetir» en vez del botón que mostraba el código. |
| `/login` | Quita el link a `/activar`. Al entrar, redirige al paso pendiente si lo hay. |
| `/activar` | Se elimina (también de `PUBLIC_PATHS` en `proxy.ts`). |
| Paso «Cambiar contraseña» (nueva, fuera de `(app)`) | Nueva contraseña + repetir, requisitos visibles, botón «Cerrar sesión». |
| Paso «Configurar PIN» (nueva, fuera de `(app)`) | PIN + repetir, botón «Cerrar sesión». |
| `/cuenta` | Sin «Eliminar PIN». Sin panel PIN para cuentas de sector ni para el usuario cuyo único rol es Administrador; `configurarPin` además los rechaza en el servidor. |

Todos los formularios usan `shared/ui/use-form-submit.ts` y conservan lo escrito ante un error.

## Invariantes nuevas

| ID | Regla | Dónde |
|---|---|---|
| CT1 | La contraseña temporal nunca se guarda ni se audita en claro; solo su hash argon2id. | `crear-usuario.ts`, `restablecer-credencial.ts`, `create-tenant.ts` |
| CT2 | Con `debe_cambiar_password = true` ningún caso de uso, salvo los del flujo, se ejecuta. | `requireSession` + test |
| CT3 | Un usuario que no es de sector y no tiene PIN no ejecuta ningún caso de uso, salvo los del flujo. | `requireSession` + test |
| CT4 | `debe_cambiar_password` vuelve a `false` solo por el cambio de contraseña del propio usuario. | `cambiar-password.ts` / paso 1 |
| CT5 | Restablecer la credencial no modifica `pin_hash`. | `restablecer-credencial.ts` + test |
| CT6 | Las cuentas de sector nunca reciben el paso «Configurar PIN». | carga de sesión + test |
| CT7 | Un empleado con `debe_cambiar_password = true` no se identifica como operador en una cuenta de sector, aunque su PIN sea correcto. | `verificar-operador.ts`, `operadores-repository.ts` + test |
| CT8 | Un DT con `debe_cambiar_password = true` no puede co-firmar (stock, libro, pesada real) aunque su contraseña sea correcta; no suma intentos fallidos. | `modules/stock/domain/co-firma.ts`, `modules/{stock,libro}/infrastructure/co-firma-repository.ts`, `modules/{stock,libro}/application/verificar-co-firma-dt.ts` + `tests/unit/contrasena-temporal-co-firma.test.ts` |
| CT9 | Un usuario cuyo único rol es Administrador nunca recibe el paso «Configurar PIN»; con Administrador más otro rol, sí. | `esSoloAdministrador` y `derivarPasosPendientes` (`modules/auth/domain/pasos-pendientes.ts`), `validate-session.ts`, `loadPasosPendientes`, `configurar-pin-obligatorio.ts`, `app/(app)/cuenta/page.tsx` + `tests/unit/auth-pasos-pendientes.test.ts`, `tests/unit/auth-configurar-pin-obligatorio.test.ts` |

## Código

**Se agrega**
- `prisma/migrations/<timestamp>_0097_contrasena_temporal/migration.sql`: columna, grant y revocación de las credenciales vivas.
- `prisma/rollbacks/0097_contrasena_temporal.down.sql`.
- `docs/rollbacks/contrasena-temporal.md`.
- Las pantallas de los dos pasos y sus Server Actions.
- Los casos de uso del paso 1 y del paso 2 (o variantes de `cambiarPassword` / `configurarPin` sin la contraseña actual, limitadas a sesiones con el paso pendiente).

**Se modifica**
- `modules/usuarios/application/crear-usuario.ts`, `restablecer-credencial.ts`, `infrastructure/usuario-repository.ts`.
- `app/(app)/admin/accesos/usuarios/nuevo/*`, `modules/usuarios/ui/restablecer-credencial.tsx`, `modules/usuarios/ui/actions.ts`.
- `modules/auth/domain/session.ts`, `modules/auth/infrastructure/session-repository.ts`, `validate-session.ts`, `shared/usecase.ts`, `app/(app)/layout.tsx`.
- `app/(auth)/login/*`, `proxy.ts`, `app/(app)/cuenta/*`, `scripts/create-tenant.ts`, `shared/auth/policy.ts`.
- `modules/auth/application/verificar-operador.ts` (y `OperadorPolicy`), `modules/operadores/infrastructure/operadores-repository.ts`.
- `modules/stock/domain/co-firma.ts`, `modules/{stock,libro}/infrastructure/co-firma-repository.ts`, `modules/{stock,libro}/application/verificar-co-firma-dt.ts` (CT8).
- Specs y docs que mencionan la credencial de activación: `openspec/specs/cuentas-de-sector/spec.md`, `shared/auth/README.md`.

**Se elimina**
- `app/(auth)/activar/*`, `modules/auth/application/activar-cuenta.ts`, `modules/auth/domain/activation-policy.ts`, `modules/usuarios/ui/credencial-activacion.tsx`, `modules/auth/application/eliminar-pin.ts`.
- `consumeCredencialActivacion`, `activarUsuario`, `insertCredencialActivacion`, `revokeCredencialesActivas` (también su uso en `suspender-usuario.ts` y `dar-de-baja-usuario.ts`, junto con el `credencialesRevocadas` que devuelven) y `AUTH_POLICY.activationCredentialTtlHours`.
- `token.ts` se conserva: lo usan las sesiones.
- **[decisión técnica]** El permiso `auth.activar` queda en el catálogo (sacarlo de migraciones anteriores no aporta), pero ningún caso de uso lo usa.

**Tests a actualizar**: los de activación (`tests/db/auth-login-activacion.test.ts`, `tests/unit/auth-activation-policy.test.ts`, `auth-policy.test.ts`), los de alta y restablecimiento (`usuarios-crear-usuario-audit`, `cuentas-de-sector-alta`, `usuarios-m3-lock-order`, `roles-personalizables-usecases`, `tests/db/usuarios-admin`, `credenciales-sesiones`, `inv-u07-actor-activo`) y los nuevos de CT2–CT6.

## Desviaciones

Decisiones de implementación que precisan o difieren del texto de arriba.

- CT4: el literal `debeCambiarPassword: false` se admite en dos archivos: el repositorio de usuarios de auth (`modules/auth/infrastructure/usuario-repository.ts`, la única escritura) y `operadores-repository.ts` (un filtro `WHERE` de lectura para CT7). Los filtros de CT8 en los dos `co-firma-repository.ts` son SQL crudo (`u.debe_cambiar_password = false`), no contienen ese literal y por eso no están en la lista.
- Tras crear un usuario se vuelve a su detalle con `?creado=1` y se muestra un toast; no hay un toaster compartido en el layout, así que el detalle lo monta él mismo.
- El error tipado de pasos pendientes (`PASOS_PENDIENTES`) se suma al mapa de códigos HTTP (403) de los route handlers de `/api`. En las Server Actions vuelve como error de formulario con un link al paso.
- Suspender y dar de baja ya no revocan credenciales de activación (no se emiten más): `suspender-usuario.ts` y `dar-de-baja-usuario.ts` dejaron de devolver `credencialesRevocadas`.
- `create-tenant` recibe la contraseña con `--admin-password-temporal` o la pide por consola sin mostrarla.
- Las páginas de los pasos viven en el grupo de rutas `app/(pasos)`; `app/(app)/error.tsx` hace una carga completa para que el layout redirija al paso.
