# Roles personalizables por farmacia (DP-03)

## Purpose

Cada farmacia necesita definir y administrar sus propios roles y permisos según su organización interna, auditando cada modificación y garantizando que el rol Administrador no ejerza actos operativos ni se produzca una escalada de privilegios (DP-03, resuelta el 2026-10-01, revisada el mismo día).

## Requirements

### Requirement: Roles por farmacia y plantilla inicial
Cada farmacia (tenant) SHALL tener sus propios roles en `fsj.rol`. Al crearse una farmacia, SHALL recibir una copia de los roles predefinidos mediante `fsj.seed_roles_tenant(tenant_id)`. Desde la migración 0106, los roles sembrados en una farmacia nueva SHALL ser únicamente Administrador, Director Técnico y Farmacéutico (más SISTEMA); las farmacias preexistentes conservan los roles que ya poseían.

#### Scenario: Tenant nuevo recibe roles predefinidos
- **WHEN** se crea una nueva farmacia
- **THEN** recibe una copia de los roles predefinidos Administrador, Director Técnico y Farmacéutico

#### Scenario: Farmacia preexistente conserva roles anteriores
- **GIVEN** una farmacia creada con anterioridad a la migración 0106
- **WHEN** se consulta el catálogo de roles de la farmacia
- **THEN** conserva los roles predefinidos existentes sin modificaciones

### Requirement: Permiso para gestionar y ver roles
Para crear, editar o eliminar roles, el usuario SHALL contar con el permiso `roles.gestionar` y re-autenticación reciente. Para consultar el listado y detalle de roles, el usuario SHALL contar con el permiso `roles.ver`.

#### Scenario: Creación de rol por usuario con permiso
- **GIVEN** un usuario con permiso `roles.gestionar` y re-autenticación reciente
- **WHEN** solicita crear un nuevo rol
- **THEN** la operación es autorizada

#### Scenario: Rechazo de edición sin permiso roles.gestionar
- **GIVEN** un usuario sin el permiso `roles.gestionar`
- **WHEN** intenta modificar o crear un rol
- **THEN** la acción es rechazada por falta de autorización

#### Scenario: Lectura de roles con roles.ver
- **GIVEN** un usuario con permiso `roles.ver`
- **WHEN** accede al listado de roles
- **THEN** el sistema permite visualizar los roles de la farmacia

### Requirement: Categorías de permisos
Todo permiso en `fsj.permiso` y `PERMISO_CATALOGO` SHALL pertenecer a una de cuatro categorías: `operativo`, `consulta`, `gestion` o `sistema` (lista y criterios en la sección `Categorías de permisos`). La categoría `sistema` no SHALL asignarse a ningún rol. Los permisos de categoría `operativo` solo SHALL pertenecer a roles que los listen explícitamente y nunca al rol ADMINISTRADOR por sí mismo.

#### Scenario: Permiso de sistema no asignable a roles
- **WHEN** se intenta asignar un permiso de categoría `sistema` a un rol
- **THEN** la asignación es rechazada

#### Scenario: Permiso operativo no asignado a Administrador
- **WHEN** se consultan los permisos del rol ADMINISTRADOR
- **THEN** ningún permiso de categoría `operativo` forma parte de sus permisos efectivos

### Requirement: Rol ADMINISTRADOR y permisos efectivos
El rol ADMINISTRADOR SHALL incluir automáticamente todos los permisos de las categorías `consulta` y `gestion` presentes y futuros, sin requerir filas en `fsj.rol_permiso`. El rol ADMINISTRADOR no SHALL tener ningún permiso de la categoría `operativo`.

#### Scenario: Administrador con permisos de consulta y gestión
- **GIVEN** un usuario con el rol ADMINISTRADOR
- **WHEN** ejecuta una acción de categoría `consulta` o `gestion`
- **THEN** la acción es autorizada automáticamente sin requerir asignación en rol_permiso

#### Scenario: Administrador sin permisos operativos
- **GIVEN** un usuario cuyo único rol es ADMINISTRADOR
- **WHEN** intenta ejecutar un acto de categoría `operativo`
- **THEN** la acción es rechazada por falta de permisos

### Requirement: Suma de permisos por roles y lectura por request
Un usuario con múltiples roles SHALL poseer la unión de los permisos de todos sus roles asignados. Los cambios en los permisos o roles de un usuario SHALL surtir efecto a partir de la siguiente solicitud del usuario, leyéndose los permisos en cada request sin mediar caché ni token.

#### Scenario: Usuario con múltiples roles
- **GIVEN** un usuario asignado a varios roles de su farmacia
- **WHEN** se determinan sus permisos efectivos
- **THEN** posee la suma de los permisos otorgados por todos sus roles

#### Scenario: Efecto inmediato de cambios en la siguiente solicitud
- **GIVEN** una modificación en los roles o permisos de un usuario
- **WHEN** el usuario realiza su siguiente solicitud
- **THEN** los nuevos permisos entran en vigencia inmediatamente

### Requirement: Permisos base de sesión en todo rol
Al crear o editar cualquier rol, el sistema SHALL incluir obligatoriamente los tres permisos de sesión: `auth.login`, `auth.logout` y `auth.password.cambiar`; sin ellos un usuario no podría cerrar sesión ni re-autenticarse. Dichos permisos no SHALL poder removerse de ningún rol.

#### Scenario: Inclusión automática de permisos de sesión en rol nuevo
- **WHEN** se crea un nuevo rol en la farmacia
- **THEN** el rol incluye obligatoriamente los permisos `auth.login`, `auth.logout` y `auth.password.cambiar`

#### Scenario: Conservación de permisos de sesión al editar rol
- **GIVEN** una edición sobre un rol existente
- **WHEN** se guardan los cambios del rol
- **THEN** los tres permisos base de sesión se conservan

### Requirement: Auditoría de cambios de roles
Toda creación, edición o eliminación de un rol SHALL registrarse en la auditoría bajo las acciones `CREAR_ROL`, `EDITAR_ROL` o `ELIMINAR_ROL` respectivamente, consignando el nombre, la descripción y la lista ordenada de permisos antes y después de la operación.

#### Scenario: Auditoría al crear un rol
- **WHEN** se crea un rol nuevo
- **THEN** se registra una auditoría `CREAR_ROL` con nombre, descripción y lista ordenada de permisos

#### Scenario: Auditoría al editar un rol
- **WHEN** se modifica un rol existente
- **THEN** se registra una auditoría `EDITAR_ROL` consignando los valores anteriores y nuevos

#### Scenario: Auditoría al eliminar un rol
- **WHEN** se elimina un rol
- **THEN** se registra una auditoría `ELIMINAR_ROL` con el detalle del rol eliminado

### Requirement: Conjunto otorgable de un actor
El conjunto otorgable de un actor SHALL estar compuesto por los permisos que el actor posee efectivamente, más todos los permisos de categoría `operativo` si el actor tiene asignado el rol ADMINISTRADOR. Para cualquier otro usuario gestor de roles, el conjunto otorgable SHALL limitarse estrictamente a sus permisos efectivos.

#### Scenario: Conjunto otorgable de un usuario Administrador
- **GIVEN** un usuario con rol ADMINISTRADOR
- **WHEN** gestiona permisos de roles
- **THEN** su conjunto otorgable incluye sus permisos efectivos más todos los permisos operativos

#### Scenario: Conjunto otorgable de un gestor de roles no administrador
- **GIVEN** un usuario con permiso `roles.gestionar` que no es Administrador
- **WHEN** gestiona permisos de roles
- **THEN** su conjunto otorgable se limita exclusivamente a los permisos que posee

### Requirement: Anti-escalada 1 — Restricción de otorgamiento de permisos
Al crear o editar un rol, el usuario no SHALL otorgar ningún permiso que se encuentre fuera de su conjunto otorgable y que el rol no tuviera previamente asignado. Los permisos que el rol ya poseía y que caen fuera del conjunto otorgable del actor SHALL conservarse sin cambios, presentándose deshabilitados en el editor.

#### Scenario: Intento de otorgar permiso no poseído fuera del conjunto otorgable
- **GIVEN** un usuario que intenta agregar a un rol un permiso fuera de su conjunto otorgable
- **WHEN** se valida la solicitud de creación o edición
- **THEN** la operación es rechazada impidiendo la escalada de privilegios

#### Scenario: Conservación de permisos preexistentes fuera del alcance del actor
- **GIVEN** un rol que contiene permisos que el usuario que lo edita no posee
- **WHEN** se guardan las modificaciones del rol
- **THEN** dichos permisos preexistentes se conservan intactos en el rol

### Requirement: Anti-escalada 2 — Prohibición de editar o eliminar rol propio
Un usuario no SHALL editar ni eliminar ningún rol que tenga asignado a su propio usuario en la farmacia.

#### Scenario: Intento de editar un rol asignado al propio usuario
- **GIVEN** un usuario que intenta editar un rol que tiene asignado
- **WHEN** se procesa la solicitud
- **THEN** la acción es rechazada impidiendo auto-modificación

#### Scenario: Intento de eliminar un rol asignado al propio usuario
- **GIVEN** un usuario que intenta eliminar un rol que tiene asignado
- **WHEN** se procesa la solicitud
- **THEN** la acción es rechazada

### Requirement: Anti-escalada 3 — Restricción en la asignación de roles a usuarios
Nadie SHALL asignar a un usuario un rol que contenga permisos fuera del conjunto otorgable del actor que realiza la asignación (`crearUsuario` o `cambiarRoles`). Un usuario con rol ADMINISTRADOR SHALL poder asignar roles que contengan permisos operativos.

#### Scenario: Administrador asigna rol con permisos operativos
- **GIVEN** un usuario con rol ADMINISTRADOR
- **WHEN** asigna a un usuario un rol con permisos operativos
- **THEN** la asignación es permitida

#### Scenario: Usuario no administrador intenta asignar rol con permisos que no posee
- **GIVEN** un usuario sin rol ADMINISTRADOR que intenta asignar un rol con permisos fuera de su conjunto
- **WHEN** se procesa `crearUsuario` o `cambiarRoles`
- **THEN** la asignación es rechazada

### Requirement: Anti-escalada 4 — Protección del último administrador
Las protecciones de «último administrador activo» SHALL seguir ligadas al código `ADMINISTRADOR`.

#### Scenario: Rechazo al intentar remover el rol ADMINISTRADOR del único administrador activo
- **GIVEN** el único usuario con rol `ADMINISTRADOR` activo de la farmacia
- **WHEN** una operación intenta dejar a la farmacia sin administradores activos
- **THEN** las protecciones del sistema impiden la operación validando el código inmutable `ADMINISTRADOR`

### Requirement: INV-ROL-001 — Inmutabilidad de código y marca de administrador
En la tabla `fsj.rol`, las columnas `codigo` y `es_administrador` SHALL ser inmutables una vez creado el rol. El atributo `es_administrador` solo SHALL ser verdadero para el rol con código `ADMINISTRADOR`.

#### Scenario: Intento de modificar código de un rol
- **GIVEN** un rol existente en la base de datos
- **WHEN** se intenta actualizar el valor de su columna `codigo`
- **THEN** la base de datos rechaza la modificación por INV-ROL-001

#### Scenario: Intento de modificar atributo es_administrador
- **GIVEN** un rol existente
- **WHEN** se intenta modificar la columna `es_administrador`
- **THEN** la base de datos rechaza la modificación

### Requirement: INV-ROL-002 — Intocabilidad de ADMINISTRADOR y SISTEMA
Los roles predefinidos `ADMINISTRADOR` y `SISTEMA` no SHALL poder modificarse ni eliminarse en ninguna farmacia, y sus conjuntos de permisos no SHALL ser editados ni recibir filas en `fsj.rol_permiso`.

#### Scenario: Intento de modificar o eliminar el rol ADMINISTRADOR
- **WHEN** se intenta editar el nombre, descripción o permisos del rol ADMINISTRADOR, o eliminarlo
- **THEN** la operación es rechazada tanto por la aplicación como por INV-ROL-002

#### Scenario: Intento de modificar o eliminar el rol SISTEMA
- **WHEN** se intenta modificar o eliminar el rol SISTEMA
- **THEN** la operación es rechazada

### Requirement: INV-ROL-003 — Prohibición de eliminar DIRECTOR_TECNICO
El rol predefinido `DIRECTOR_TECNICO` no SHALL poder ser eliminado en ninguna farmacia.

#### Scenario: Intento de eliminar el rol DIRECTOR_TECNICO
- **WHEN** se solicita la eliminación del rol DIRECTOR_TECNICO
- **THEN** la operación es rechazada por INV-ROL-003

### Requirement: INV-ROL-004 — Prohibición de eliminar rol asignado
Un rol que se encuentre asignado a uno o más usuarios de la farmacia no SHALL poder ser eliminado. La interfaz SHALL informar la cantidad de usuarios que lo tienen asignado al impedir la eliminación.

#### Scenario: Rechazo al eliminar rol que cuenta con usuarios asignados
- **GIVEN** un rol que se encuentra asignado a al menos un usuario
- **WHEN** se intenta eliminar dicho rol
- **THEN** la acción es rechazada informando la cantidad de usuarios asignados

#### Scenario: Eliminación permitida de rol sin usuarios asignados
- **GIVEN** un rol personalizado no protegido que no posee ningún usuario asignado
- **WHEN** se confirma su eliminación
- **THEN** el rol es eliminado exitosamente de la farmacia

### Requirement: INV-ROL-005 — Exclusividad de asignación del rol SISTEMA
El rol `SISTEMA` solo SHALL poder estar asignado al usuario técnico de la farmacia, y no SHALL ser asignable a ningún otro usuario ni mostrarse en la interfaz de gestión.

#### Scenario: Intento de asignar rol SISTEMA a un usuario normal
- **WHEN** se intenta asignar el rol SISTEMA a un usuario en `crearUsuario` o `cambiarRoles`
- **THEN** la asignación es rechazada por esquema y por INV-ROL-005

### Requirement: Restricciones de roles en cuentas de sector
Un usuario marcado como cuenta de sector no SHALL poder recibir los roles `ADMINISTRADOR` ni `DIRECTOR_TECNICO` (INV-SEC-001). Asimismo, la sesión de una cuenta de sector no SHALL poseer ninguno de los permisos listados en `PERMISOS_VEDADOS_A_SECTOR`, aunque alguno de sus roles los incluya.

#### Scenario: Intento de asignar rol ADMINISTRADOR a cuenta de sector
- **GIVEN** un usuario marcado como cuenta de sector
- **WHEN** se intenta asignarle el rol ADMINISTRADOR o DIRECTOR_TECNICO
- **THEN** la operación es rechazada

#### Scenario: Exclusión de permisos vedados en sesión de cuenta de sector
- **GIVEN** una cuenta de sector asignada a un rol que contiene un permiso vedado
- **WHEN** se cargan los permisos efectivos de la sesión
- **THEN** los permisos de `PERMISOS_VEDADOS_A_SECTOR` son sustraídos y no forman parte de la sesión

### Requirement: Comportamiento del editor de roles en la interfaz
El editor de roles (`/admin/accesos/roles/[id]`) SHALL mostrar los permisos agrupados por módulo con su categoría. Los permisos fuera del conjunto otorgable del usuario y los de sesión SHALL mostrarse deshabilitados. El rol `ADMINISTRADOR` SHALL mostrarse en modo de solo lectura.

#### Scenario: Permisos deshabilitados en el editor para permisos fuera del conjunto otorgable
- **GIVEN** el editor de roles abierto por un gestor de roles
- **WHEN** se visualizan los permisos fuera de su conjunto otorgable o de sesión
- **THEN** dichos permisos se exhiben deshabilitados impidiendo su selección

#### Scenario: Visualización de solo lectura para el rol ADMINISTRADOR
- **GIVEN** la navegación al detalle del rol ADMINISTRADOR
- **WHEN** se carga la pantalla
- **THEN** se muestra de solo lectura con la indicación de consulta y gestión sin actos operativos

### Requirement: Eliminación de roles predefinidos editables
Los roles predefinidos editables (`FARMACEUTICO`, `LABORATORIO`, `ATENCION_PUBLICO` y `SOLO_CONSULTA`) SHALL poder eliminarse si nadie los tiene asignados, y una vez eliminados no SHALL recrearse automáticamente.

#### Scenario: Eliminación de rol predefinido sin usuarios asignados
- **GIVEN** un rol predefinido editable que no posee usuarios asignados
- **WHEN** un administrador solicita su eliminación
- **THEN** el sistema elimina el rol y no lo recrea automáticamente

### Requirement: Asignación de roles operativos al Administrador
Un usuario con rol ADMINISTRADOR SHALL poder asignarse a sí mismo roles que contengan permisos operativos desde la gestión de usuarios, registrándose la operación bajo la auditoría `ASIGNAR_ROL`.

#### Scenario: Administrador se asigna rol operativo
- **GIVEN** un usuario con rol ADMINISTRADOR
- **WHEN** se asigna a sí mismo un rol con permisos operativos
- **THEN** la asignación es permitida y se registra el evento de auditoría `ASIGNAR_ROL`

### Requirement: Ocultamiento de botones y autorización de comandos de roles
En la interfaz de usuario, los botones de escritura SHALL ocultarse si el usuario carece de `roles.gestionar`, y cada comando en el servidor MUST re-validar la autorización independientemente de la interfaz.

#### Scenario: Acceso de usuario sin roles.gestionar a la interfaz y al comando
- **GIVEN** un usuario sin el permiso `roles.gestionar`
- **WHEN** accede a la pantalla de roles o invoca directamente un comando de escritura
- **THEN** la interfaz oculta los botones de escritura y el comando en el servidor rechaza la ejecución

### Requirement: Confirmación y disponibilidad de la acción de eliminar rol
La acción de eliminar un rol en la interfaz MUST solicitar confirmación explícita del usuario y SHALL NOT ofrecerse si el rol se encuentra asignado a algún usuario o protegido por invariantes, explicando el motivo correspondiente.

#### Scenario: Acción de eliminar en rol asignado o protegido
- **GIVEN** un rol que se encuentra asignado o protegido
- **WHEN** se visualiza su detalle en la interfaz
- **THEN** la opción de eliminar no se ofrece y se muestra la explicación del motivo

### Requirement: Unicidad del nombre de rol por farmacia
El nombre de cada rol en `fsj.rol` MUST ser único por farmacia (tenant) sin distinguir mayúsculas de minúsculas.

#### Scenario: Creación de rol con nombre duplicado en diferente caja
- **GIVEN** un rol existente con un nombre determinado en la farmacia
- **WHEN** se intenta crear otro rol con el mismo nombre variando mayúsculas o minúsculas
- **THEN** la base de datos o el comando rechaza la operación por unicidad de nombre

### Requirement: Pertenencia de roles a la farmacia del usuario
Un usuario solo SHALL poder tener asignados roles pertenecientes a su misma farmacia (tenant), garantizado mediante clave foránea compuesta `(tenant_id, rol_id)` en `fsj.usuario_rol`.

#### Scenario: Asignación de rol de otra farmacia
- **GIVEN** un rol perteneciente a una farmacia distinta
- **WHEN** se intenta asignar dicho rol a un usuario
- **THEN** la asignación es rechazada garantizando el aislamiento por farmacia

## Estado

**Estado:** RESUELTA el 2026-10-01 — opción (b): editable por tenant y auditada, con ADMINISTRADOR bloqueado.
Revisada el mismo día: **el ADMINISTRADOR no ejerce actos operativos**.
**Migraciones:** `0053_tipo_accion_roles` (valores de auditoría) y `0054_roles_por_tenant` (modelo, categorías, datos, triggers).
**Pantallas:** `/admin/accesos/roles`, `/admin/accesos/roles/nuevo`, `/admin/accesos/roles/[id]`.

## Resumen

- Cada farmacia (tenant) tiene **sus propios roles**. Al crearse una farmacia recibe una copia de los roles predefinidos.
  Desde la migración 0106 (decisión del usuario 2026-10-26) son solo **Administrador, Director Técnico y Farmacéutico**
  (más el interno SISTEMA); cualquier otro rol (laboratorio, atención al público, solo consulta…) lo crea el
  Administrador a pedido. Las farmacias que ya existían conservan sus roles: 0106 no borra ni cambia ninguno.
- Un administrador puede **crear roles nuevos**, **editar** nombre, descripción y permisos, y **eliminar** roles que nadie
  tenga asignados.
- Cada permiso tiene una **categoría**: `operativo`, `consulta`, `gestion` o `sistema`.
- Un usuario tiene la **suma** de los permisos de todos sus roles. Los cambios rigen desde la próxima acción del usuario
  (los permisos se leen en cada request; no hay caché ni token).
- Todo cambio queda auditado (`CREAR_ROL`, `EDITAR_ROL`, `ELIMINAR_ROL`) con nombre, descripción y la lista ordenada de
  permisos antes y después.

## Categorías de permisos

La fuente única es `PERMISO_CATALOGO` en `modules/auth/domain/permisos.ts`: un objeto `código → categoría` del que se
derivan el tipo `Permiso` y `PERMISO_CODES`. Agregar un código sin categoría **no compila**. La base de datos tiene la
misma información en `fsj.permiso.categoria` (NOT NULL + CHECK), y `tests/db/auth-permisos.test.ts` compara ambas en los
dos sentidos.

| Categoría | Qué es | Quién la recibe |
| --- | --- | --- |
| `operativo` | Registra o autoriza un movimiento en el circuito regulado de la farmacia: stock, recetas, fichas, presupuestos, preparaciones, etiquetas, libro, cierres, libros rubricados, entregas, archivo. | Solo los roles que la listan explícitamente. **Nunca** el ADMINISTRADOR por sí mismo. |
| `consulta` | Ver, imprimir, exportar, reportes. Incluye los permisos de sesión (`auth.login`, `auth.logout`, `auth.password.cambiar`). | ADMINISTRADOR siempre; otros roles según la configuración. |
| `gestion` | Administración y datos maestros: usuarios, roles, configuración, catálogos, precios, designación de DT. | ADMINISTRADOR siempre; otros roles según la configuración. |
| `sistema` | `auth.activar` (titular de una credencial, sin sesión) y `tenants.*` (operador de plataforma). | Ningún rol, nunca. |

Permisos `operativo`: `stock.partida.ingresar`, `stock.ajuste.registrar`, `stock.ajuste.autorizar`, `recetas.crear`,
`recetas.editar`, `recetas.anular`, `fichas.generar`, `cotizaciones.calcular`, `preparaciones.iniciar`,
`preparaciones.descartar`, `preparaciones.confirmar`, `etiquetas.generar`, `libro.anulacion.solicitar`,
`libro.anulacion.autorizar`, `cierres.firmar`, `cierres.folio.corregir`, `libros.crear`,
`libros.cerrar`, `entregas.registrar`, `archivo.lotes.gestionar`,
`archivo.destruccion.gestionar`.

Criterios de clasificación que vale la pena mencionar:

- `stock.partida.costo.corregir` es **gestión**: corrige el costo (dinero) de una partida, no su cantidad, así que no hay
  movimiento de stock. Además el ADMINISTRADOR ya lo tenía.
- `dt.designar` / `dt.cesar` son **gestión**: registran quién es el DT; no son actos del circuito.
- `cierres.imprimir`, `etiquetas.imprimir`, `fichas.imprimir` son **consulta** (imprimir lo ya generado).
- `cotizaciones.calcular` es **operativo** (por decisión explícita), `cotizaciones.ver` es consulta.
- Todo `usuarios.*` es **gestión**, incluidas las lecturas (`usuarios.listar`, `usuarios.ver`, `usuarios.auditoria.ver`).

## Modelo de datos

| Tabla | Alcance | Notas |
| --- | --- | --- |
| `fsj.permiso` | Global | Catálogo de códigos con `categoria`. Espejo 1:1 de `PERMISO_CATALOGO`. Solo lectura para la app. |
| `fsj.rol` | Por tenant | `tenant_id`, `codigo` (único por tenant, inmutable), `nombre` (único por tenant sin distinguir mayúsculas), `descripcion`, `es_administrador`. RLS forzada. |
| `fsj.rol_permiso` | Por tenant | Una fila por par rol↔permiso. FK a `permiso` (un código desconocido es imposible) y FK compuesta `(tenant_id, rol_id)`, `ON DELETE CASCADE`. RLS forzada. |
| `fsj.usuario_rol` | Por tenant | FK compuesta `(tenant_id, rol_id)`: un usuario solo puede tener roles de su farmacia. |

Por qué se alteraron las tablas existentes en vez de crear otras: los nombres, los modelos Prisma, el `rol.id` que referencia
`usuario_rol` y los lectores SQL (INV-DT-001, el bloqueo de último administrador, los tests de permisos) se mantienen. La única
diferencia es que `rol` pasa a ser multitenant.

## Triggers y bloqueos (capa de datos)

Todo lo que es una invariante estructural se cuida en Postgres con RLS forzada, constraints y triggers. La aplicación no
puede violarlas ni por error ni por un bug en una Server Action:

| Qué se cuida | Cómo | Dónde |
| --- | --- | --- |
| Inmutabilidad de `codigo` y de `es_administrador` | Trigger `BEFORE UPDATE` | `fsj.trg_rol_inmutable()` |
| ADMINISTRADOR y SISTEMA no se modifican ni se eliminan | Trigger `BEFORE UPDATE OR DELETE` | `fsj.trg_rol_protegido()` |
| ADMINISTRADOR y SISTEMA no tienen filas en `fsj.rol_permiso` | Trigger `BEFORE INSERT OR UPDATE` | `fsj.trg_rol_permiso_no_admin()` |
| DIRECTOR_TECNICO no se elimina | Trigger `BEFORE DELETE` | `fsj.trg_rol_no_eliminar_dt()` |
| Rol asignado no se elimina | FK `RESTRICT` de `usuario_rol` a `rol` | `fsj.usuario_rol_rol_id_fkey` |
| Permisos base de sesión siempre presentes | Trigger `BEFORE INSERT OR UPDATE` sobre `fsj.rol_permiso` | `fsj.trg_rol_permisos_sesion()` |
| SISTEMA solo lo tiene el usuario técnico | Trigger en `fsj.usuario_rol` | `fsj.trg_usuario_rol_sistema()` |
| Unicidad de nombre por tenant | Índice único sobre `(tenant_id, lower(nombre))` | `fsj.rol_tenant_lower_nombre_key` |
| Unicidad de código por tenant | Unique constraint `(tenant_id, codigo)` | `fsj.rol_tenant_codigo_key` |
| Códigos de permiso válidos | FK a `fsj.permiso(codigo)` | `fsj.rol_permiso_permiso_codigo_fkey` |
| Cascada al eliminar rol | FK `ON DELETE CASCADE` | `fsj.rol_permiso_rol_id_fkey` |
| No permisos `sistema` en roles | Trigger `BEFORE INSERT OR UPDATE` | `fsj.trg_rol_permiso_no_sistema()` |
| Aislamiento entre farmacias | Filtro explícito por `tenantId` | RLS forzada + FK compuestas |

## Reglas anti-escalada (capa de aplicación)

Código: `modules/usuarios/domain/roles.ts` (`permisosOtorgables`, `resolverPermisosDeRol`, `permisosFueraDeAlcance`) y
`modules/usuarios/application/roles-asignables.ts`. Probado en `tests/unit/usuarios-roles.test.ts` y
`tests/unit/roles-personalizables-usecases.test.ts`.

**Conjunto otorgable** de un actor = los permisos que tiene, **más todos los operativos si tiene el rol ADMINISTRADOR**.
El administrador no ejerce los actos operativos, pero decide quién puede. Cualquier otro gestor de roles mantiene la regla
estricta: solo lo que tiene.

1. **Nadie otorga un permiso fuera de su conjunto otorgable.** Al crear o editar, un permiso pedido fuera de ese conjunto
   que el rol no tenía se rechaza. Los permisos que el rol ya tiene y están fuera del conjunto **se conservan** (el actor
   no los puede ni dar ni quitar; en el editor aparecen deshabilitados).
2. **Nadie edita ni elimina un rol que tiene asignado.**
3. **Nadie asigna a un usuario un rol con permisos fuera de su conjunto otorgable** (`crearUsuario` / `cambiarRoles`).
   Un ADMINISTRADOR puede asignar roles con permisos operativos.
4. Las protecciones de "último administrador activo" siguen ligadas al código `ADMINISTRADOR`.

Las escrituras de roles requieren `roles.gestionar` **y re-autenticación reciente** (igual que `cambiarRoles`). Leer
roles sigue requiriendo `roles.ver`. Los botones de escritura se ocultan sin `roles.gestionar`, pero eso es solo UX: cada
comando vuelve a autorizar.

## Editor de roles (UI)

- Permisos agrupados por módulo (el prefijo antes del primer punto), con descripción legible, "Todos" por módulo y una
  pequeña etiqueta con la categoría (Operativo / Consulta / Gestión).
- Los permisos fuera del conjunto otorgable del actor y los de sesión aparecen deshabilitados.
- ADMINISTRADOR se muestra de solo lectura: "Permisos: consulta y gestión (sin actos operativos)".
- Eliminar pide confirmación y no se ofrece si el rol está asignado o protegido (se explica el motivo).

## Cómo agregar un permiso nuevo al catálogo y proteger un endpoint

1. **Código:** agregar `"modulo.accion": "<categoria>"` en `PERMISO_CATALOGO` (`modules/auth/domain/permisos.ts`), en el
   lugar de su módulo. La categoría es obligatoria: sin ella no compila. Criterio: si registra o autoriza un movimiento
   en el circuito regulado, es `operativo`.
2. **Migración:** una migración nueva que lo inserte en el catálogo global, **con su categoría** (la columna no tiene
   valor por defecto):

   ```sql
   INSERT INTO fsj.permiso (codigo, categoria, descripcion) VALUES
     ('modulo.accion', 'gestion', 'Descripción legible en español')
   ON CONFLICT (codigo) DO NOTHING;
   ```

   La descripción es la que ve el administrador en el editor de roles.
3. **Endpoint:** declarar el permiso en el caso de uso; el pipeline llama a `authorize()` antes que nada:

   ```ts
   export const miComando = defineCommand({
     name: "modulo.accion",
     permiso: "modulo.accion",
     input: z.object({ ... }),
     audit: { entidad: "...", accion: TipoAccion.MODIFICAR },
     handler: async ({ tx, session, input }) => { ... },
   });
   ```

   Para ocultar el botón en la UI usar `can(session, "modulo.accion")` (solo UX).
4. **Quién lo recibe:**
   - Si es de **consulta o gestión, ADMINISTRADOR lo recibe automáticamente**; no hace falta ninguna fila.
   - Si es **operativo**, nadie lo tiene hasta que un administrador lo agregue a un rol desde la UI
     (`/admin/accesos/roles/[id]`).
   - Los demás roles de las farmacias existentes lo reciben **desde la UI**. Si se quiere que algún rol predefinido lo
     tenga de entrada en farmacias existentes, la misma migración puede insertar en `fsj.rol_permiso` por `codigo` de rol
     y `tenant_id` (sabiendo que pisa una decisión que el administrador pudo haber tomado).
   - Para que las **farmacias nuevas** lo tengan en un rol predefinido, redefinir `fsj.plantilla_rol_permisos()` en esa
     migración y actualizar `EXPECTED_ROL_PERMISOS` en `tests/db/auth-permisos.test.ts`.
5. **Tests:** `tests/db/auth-permisos.test.ts` compara códigos y categorías del catálogo TS con `fsj.permiso` en ambos
   sentidos. Si es operativo, sumarlo a `OPERATIVOS_APROBADOS` en `tests/unit/usuarios-roles.test.ts` (la lista de
   operativos está fijada a propósito: cambiarla es una decisión de producto).

## Invariantes nuevas

| Código | Regla |
| --- | --- |
| INV-ROL-001 | `rol.codigo` y `rol.es_administrador` no cambian. |
| INV-ROL-002 | ADMINISTRADOR y SISTEMA no se modifican ni se eliminan, y sus permisos no se tocan. |
| INV-ROL-003 | DIRECTOR_TECNICO no se elimina. |
| INV-ROL-004 | Un rol asignado a algún usuario no se elimina. |
| INV-ROL-005 | SISTEMA solo lo tiene el usuario técnico de la farmacia. |
