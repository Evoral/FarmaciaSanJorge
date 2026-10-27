# SPEC — Cuentas de sector e identificación del empleado por PIN

> Estado: implementado 2026-10-13 (migración 0077). Reversión: `docs/rollbacks/cuentas-de-sector.md`.
> Decisiones del usuario (2026-10-13): una cuenta por sector; PIN en cada acción, pero solo en las acciones
> configuradas; el mostrador sin PIN; el empleado necesita el permiso en sus propios roles; PIN de 4 dígitos (decidido primero en 6 y cambiado el mismo día, migración 0078);
> cada empleado configura su propio PIN. Decisión del usuario (2026-10-21): se elimina la reautenticación periódica con contraseña en todos los
> actos (la sesión individual ya identifica a quien actúa y, en una cuenta de sector, lo hace el PIN); queda solo la contraseña del DT donde el DT autoriza.

## Alcance

En el mostrador y en el laboratorio varios empleados usan **la misma computadora**. Para no iniciar y cerrar
sesión todo el tiempo, cada puesto tiene una **cuenta de sector**: un usuario cuya sesión se comparte.

En esa sesión compartida, las acciones sensibles (con cuánto se hizo una preparación, qué partida se usó, un
ajuste de stock, el alta de una droga) tienen que decir **quién las hizo**. Para esas acciones el empleado elige
su nombre e ingresa **su PIN**, y la acción queda registrada a su nombre. El resto (lo del mostrador) no pide
nada, para que sea ágil, y queda a nombre de la cuenta del sector.

El **Director Técnico** y cualquier empleado conservan su usuario y su sesión individual, sin cambios. Los actos
propios del DT (firmar el cierre, co-firmas, libros rubricados) **nunca** están disponibles en una cuenta de sector.

**Fuera de alcance.** Biometría (huella, Face ID, WebAuthn): la verificación quedó desacoplada para sumarla
después (ver "Verificación"), pero hoy el único método es el PIN.

## Modelo

| Elemento | Qué es |
|---|---|
| `fsj.usuario.es_sector` | Marca la cuenta de sector. Se define al crear el usuario y no cambia (INV-SEC-002). Nunca junto con `es_tecnico`. |
| `fsj.accion_con_pin (tenant_id, permiso_id)` | Una fila = en una cuenta de sector, esa acción pide el PIN del empleado. Por farmacia. RLS forzada. |
| `fsj.seed_acciones_con_pin(tenant)` | El conjunto por defecto de una farmacia nueva (y el backfill de las existentes). |
| Rol `LABORATORIO` | Rol predefinido nuevo, editable y eliminable como `FARMACEUTICO`. Para el mostrador se usa `ATENCION_PUBLICO`. |

No hay permisos nuevos ni valores nuevos de `tipo_accion`. `registro_auditoria` no cambia de forma: la terminal de
origen va en su `contexto` (JSON).

El PIN es el de siempre (migración 0037), ahora de **4 dígitos** (`AUTH_POLICY.pinLength`; la migración 0078 borró los
PIN de 6 dígitos que existían): hash argon2, contador y bloqueo propios. Cada empleado lo
configura desde «Mi cuenta» con su propio usuario; nadie más lo conoce.

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| S1 | Una acción **con PIN** en una cuenta de sector no corre sin un empleado identificado en esa misma solicitud: se rechaza antes de abrir ninguna transacción. Vale para **todo** comando, presente o futuro. | `resolverActor` (`shared/usecase.ts`); `tests/unit/usecase-registry-all-modules.test.ts`. |
| S2 | El PIN se verifica **en cada acción** (no hay "operador activo" por un rato). Una acción que encadena varios comandos lo verifica una sola vez. | `resolverActor`; `shared/auth/operador-context.ts`. |
| S3 | La acción solo se permite si la tiene **la cuenta del sector Y el empleado** en sus propios roles. El de laboratorio no puede firmar nada del mostrador y viceversa. Los permisos del acto son la intersección. | `authorizeAuditado` sobre ambos; un rechazo queda auditado (`ACCESO_DENEGADO`) a nombre del empleado. |
| S4 | Atribución: el handler recibe al empleado como `session.usuario`, así que `registrada_por_id`, `preparada_por_id`, `entregada_por_id`, `registrado_por_id`, etc. y `registro_auditoria.usuario_id` son suyos. | `resolverActor`. Ningún handler cambió. |
| S5 | Toda fila de auditoría a nombre del empleado lleva `contexto.terminal = { usuarioId, usuario, sesionId }` (la cuenta de sector) y `contexto.verificacion` (`"PIN"`). | `shared/audit/index.ts`; visible en `/auditoria`. |
| S6 | Una acción **sin PIN** en una cuenta de sector queda a nombre de la cuenta del sector (decisión explícita para el mostrador). | `resolverActor`. |
| S7 | Puede ser empleado ("operador") un usuario `ACTIVO` de la farmacia que no sea cuenta de sector ni el usuario técnico, y que tenga PIN y no tenga un cambio de contraseña temporal pendiente (`debeCambiarPassword`; no cuenta como intento fallido de PIN, ver `docs/specs/contrasena-temporal.md`). | `decideCandidatoOperador` (`modules/auth/domain/operador-policy.ts`, decisión `DEBE_CAMBIAR_PASSWORD`), `operadores-repository.ts` (el selector solo lista empleados sin cambio pendiente), `verificador-pin.ts`. |
| S8 | Un PIN rechazado suma al contador del empleado; al quinto se bloquea (`AUTH_POLICY.maxFailedPinAttempts`). Lo desbloquea su titular reautenticándose con contraseña o configurando un PIN nuevo. Nunca bloquea la cuenta en sí. | `verificador-pin.ts`; el contador se confirma aunque el acto falle (transacción propia). |
| S9 | Cada identificación rechazada se audita (`entidad = operador`, acción `AUTORIZAR`) a nombre de la cuenta de sector, apuntando al usuario elegido. El PIN nunca se registra. | `verificar-operador.ts`. |
| S10 | Una cuenta de sector nunca tiene `ADMINISTRADOR` ni `DIRECTOR_TECNICO` (y por eso nunca puede ser designada DT), y nunca conserva los permisos de `PERMISOS_VEDADOS_A_SECTOR`, diga lo que diga su rol. | `crearUsuario`; INV-SEC-001; `permisosEfectivos` (`modules/auth/domain/permisos.ts`). |
| S11 | Ningún acto pide reautenticación con contraseña (decisión 2026-10-21; la excepción es `reanclarLibro`, que solo hace el DT): en una cuenta de sector el PIN del empleado identifica al que actúa, y no se le pide además la contraseña de la cuenta. | `defineCommand`. |
| S12 | Las consultas nunca piden PIN. Una sesión individual nunca pide PIN de empleado ni reautenticación con contraseña: la propia sesión identifica a quien actúa. Solo se pide la contraseña **del DT** donde el DT autoriza (co-firma de ajustes y anulaciones, firma de cierre, destrucción de archivo), sea cual sea el perfil de quien opera. | `defineQuery`; `resolverActor`. |
| S13 | La sesión de una cuenta de sector vence tras **4 h sin uso** (decisión del usuario 2026-10-26; una sesión individual, 30 min): el PIN ya protege las acciones con PIN. Las consultas no piden PIN, así que en ese lapso el puesto deja ver datos sin identificarse. El vencimiento absoluto (12 h desde el login) es el mismo para todas. Al vencer, el navegador va directo a `/login`: mientras hay actividad (teclas, clics, scroll) mantiene viva la sesión y, sin actividad, la cierra un poco antes que el servidor. | `AUTH_POLICY.sessionIdleMinutesSector`, `checkSessionLifecycle`; `app/(app)/vigilante-inactividad.tsx`. |

### Acciones configurables

`PERMISOS_CON_PIN_CONFIGURABLES` (`modules/auth/domain/permisos.ts`). Se configuran por permiso, igual que en el
editor de roles: "Confirmar preparaciones" cubre reservar, modificar la reserva, confirmar y registrar una pérdida.

| Acción | Por defecto |
|---|---|
| `drogas.crear`, `drogas.editar`, `drogas.baja`, `drogas.reactivar` | Con PIN |
| `stock.partida.ingresar`, `stock.ajuste.registrar` | Con PIN |
| `fichas.generar`, `etiquetas.generar` | Con PIN |
| `preparaciones.iniciar`, `preparaciones.descartar`, `preparaciones.confirmar` | Con PIN |
| `recetas.crear`, `recetas.editar` | Sin PIN |
| `entregas.registrar` (única de entregas desde 0085: registrar, confirmar firma) | Sin PIN |

**Siempre con PIN** (`PERMISOS_CON_PIN_SIEMPRE`, no configurable; decisión del usuario 2026-10-17): `recetas.anular`. Anular una receta no se deshace, así que en una cuenta de sector siempre queda a nombre del empleado que la anuló. Se suma al conjunto de `fsj.accion_con_pin` al cargar la sesión (`loadPermisosConPin`) y no aparece en «PIN por acción».

`cotizaciones.calcular` no es configurable: el presupuesto se recalcula solo mientras se carga la receta.

La configuración se cambia en **Configuración › PIN por acción** (`config.editar`, auditado con
el conjunto antes y después) y rige desde la próxima acción de cada cuenta de sector.

### Casos a tener presentes

- **El ajuste de stock sigue pidiendo la co-firma del DT** (contraseña del DT en el mismo acto). El PIN dice quién
  registra; la contraseña del DT, quién autoriza. Son dos cosas distintas y las dos quedan.
- **Guardar una receta también genera sus fichas técnicas.** Si la cuenta tiene `fichas.generar` y esa acción pide
  PIN, el formulario de receta lo pide; la receta queda a nombre de la cuenta (si `recetas.*` no pide PIN) y las
  fichas, a nombre del empleado. Una cuenta de mostrador (sin `fichas.generar`) no ve ningún PIN.
- **El rol `LABORATORIO` incluye `recetas.crear` y `recetas.editar`**: la mesa de trabajo de la toma lee y edita la
  receta que está preparando, y sus consultas se autorizan con `recetas.crear`.
- **Un DT puede identificarse con su PIN** en una cuenta de sector para actos que no son exclusivos del DT.
- **"Crear producto" dentro de la importación de factura** no pasa por un formulario: si `drogas.crear` pide PIN,
  desde una cuenta de sector se rechaza con un mensaje claro; el alta se hace desde Catálogos › Drogas.
- Cualquiera en la terminal puede agotar los intentos del PIN de un compañero y bloqueárselo. Queda auditado
  (S9). Es el mismo compromiso ya aceptado para la co-firma del DT.

## Verificación (preparada para biometría)

`modules/auth/domain/verificacion-identidad.ts` define el contrato: `MetodoVerificacion`, la unión discriminada
`PruebaDeIdentidad` y la interfaz `VerificadorDeIdentidad`. Hoy hay una implementación, `verificador-pin.ts`.

Agregar un método (WebAuthn, huella): una variante más de `PruebaDeIdentidad`, un verificador más en `VERIFICADORES`
(`modules/auth/application/verificar-operador.ts`) y su entrada en el diálogo. El pipeline, la auditoría
(`contexto.verificacion` registra el método) y los comandos no cambian.

## Cómo viaja la credencial

1. El formulario envía; si la acción pide PIN se abre el diálogo «¿Quién realiza esta acción?»
   (`modules/operadores/ui/operador-provider.tsx`), que agrega `operadorId` + `operadorPin` al mismo `FormData`
   (`shared/ui/use-form-submit.ts`). Lo que el usuario cargó no se pierde. El formulario que declara su `accion`
   lo abre antes del primer envío; el que no, lo abre cuando el servidor responde `operador-required`.
2. La Server Action envuelve su cuerpo en `conOperador(formData, …)` (`shared/auth/operador-context.ts`), que deja
   la credencial disponible para esa solicitud. Ningún esquema zod ni firma de caso de uso la transporta.
3. `defineCommand` la verifica y decide a nombre de quién corre el comando.

Una Server Action nueva que ejecute una acción configurable **debe** envolverse con `conOperador`. Si no lo hace,
en una cuenta de sector el comando se rechaza con un mensaje claro: nunca se atribuye en silencio.

## Pantallas

- **Usuarios › Nuevo usuario**: casilla "Cuenta de sector". Al tildarla el formulario pide solo el **nombre del
  sector** y el **email**; apellido, DNI y matrícula no aplican a un sector. El email sí hace falta: es el usuario
  con el que la cuenta inicia sesión (no tiene que ser una casilla real, el sistema no le envía correos). Como
  `fsj.usuario` exige apellido y DNI, se derivan del nombre (`modules/usuarios/domain/cuenta-de-sector.ts`):
  "Laboratorio" queda como nombre "Sector", apellido "Laboratorio" y DNI `SECTOR-LABORATORIO`, que además impide
  dos cuentas de sector con el mismo nombre. Como a cualquier usuario, el formulario pide una **contraseña temporal**
  (y su repetición): la cuenta nace `ACTIVO` con el cambio de contraseña pendiente y, al ser de sector, ese es su
  único paso obligatorio (`docs/specs/contrasena-temporal.md`).
- **Mi cuenta** (`/cuenta`): para una cuenta de sector no hay panel de PIN (no tiene PIN) y, para nadie, existe
  «Eliminar PIN» (el PIN es obligatorio para quien no es cuenta de sector).
- **Configuración › PIN por acción** (`/admin/configuracion/pin`): un interruptor por acción.
- Diálogo de empleado + PIN en los formularios de laboratorio, stock, drogas, recetas y entregas.
- **Auditoría**: "Realizado desde la cuenta de sector X · identificado con PIN".

## Invariantes nuevas

| Código | Regla |
|---|---|
| INV-SEC-001 | Una cuenta de sector no tiene el rol `ADMINISTRADOR` ni `DIRECTOR_TECNICO`. |
| INV-SEC-002 | `usuario.es_sector` no cambia después del alta. |

## Código

- Dominio y verificación: `modules/auth/domain/{permisos,session,verificacion-identidad,operador-policy}.ts`,
  `modules/auth/application/{verificar-operador,verificador-pin,validate-session}.ts`.
- Pipeline: `shared/usecase.ts` (`resolverActor`), `shared/auth/{operador,operador-context,operador-campos}.ts`,
  `shared/audit/index.ts`.
- Configuración y selector: `modules/operadores/`.
- Tests: `tests/unit/cuentas-de-sector-*.test.ts`, `tests/unit/contrasena-temporal-operadores.test.ts`,
  `tests/unit/usecase-registry-all-modules.test.ts`,
  `tests/db/auth-permisos.test.ts` (plantilla de roles).
