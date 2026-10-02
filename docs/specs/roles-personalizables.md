# Roles personalizables por farmacia (DP-03)

**Estado:** RESUELTA el 2026-10-01 — opción (b): editable por tenant y auditada, con ADMINISTRADOR bloqueado.
Revisada el mismo día: **el ADMINISTRADOR no ejerce actos operativos**.
**Migraciones:** `0053_tipo_accion_roles` (valores de auditoría) y `0054_roles_por_tenant` (modelo, categorías, datos, triggers).
**Pantallas:** `/admin/accesos/roles`, `/admin/accesos/roles/nuevo`, `/admin/accesos/roles/[id]`.

## Resumen

- Cada farmacia (tenant) tiene **sus propios roles**. Al crearse una farmacia recibe una copia de los roles predefinidos
  con los mismos permisos que tenían antes de este cambio.
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
`libro.anulacion.autorizar`, `libro.historico.digitalizar`, `cierres.firmar`, `cierres.folio.corregir`, `libros.crear`,
`libros.cerrar`, `entregas.registrar`, `entregas.firma.confirmar`, `archivo.lotes.gestionar`,
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
`usuario_rol` y los lectores SQL (INV-DT-001, el bloqueo de último administrador) siguen funcionando sin cambios; solo
hubo que copiar las filas globales por tenant, reapuntar `usuario_rol` y borrar las globales.

La plantilla por defecto vive en **una sola función**, `fsj.seed_roles_tenant(tenant_id)` (con la matriz en
`fsj.plantilla_rol_permisos()`). La usan el backfill de la migración 0054, el trigger `AFTER INSERT` sobre `fsj.tenant` y
`scripts/create-tenant.ts`.

La migración 0054 **se aborta sola** si:

- alguna asignación no queda apuntando a la copia de su propio tenant del mismo rol;
- algún usuario sin ADMINISTRADOR cambia, en cualquier sentido, su conjunto efectivo de permisos;
- algún usuario pierde un permiso que tenía (el ADMINISTRADOR no tenía ningún permiso operativo, así que no pierde nada);
- algún usuario gana un permiso operativo.

Los usuarios con ADMINISTRADOR ganan los permisos de consulta y gestión que no tenían (por ejemplo `libro.ver`,
`cierres.ver`, `cierres.reporte`, `cotizaciones.ver`, `medicos.gestionar`, `pacientes.gestionar`, `reportes.ver`,
`roles.gestionar`).

## Roles protegidos

| Rol | Permisos | Nombre / descripción | Eliminar | Asignable |
| --- | --- | --- | --- | --- |
| ADMINISTRADOR | **Todos los de consulta y gestión**, siempre (incluidos los futuros); **nunca operativos**. Sin filas en `rol_permiso`. | No | No | Sí |
| DIRECTOR_TECNICO | Editables | Editables | **No** (INV-DT-001 depende del código) | Sí |
| SISTEMA | Ninguno | No | No | **No** (solo el usuario técnico); oculto en toda la UI |
| FARMACEUTICO, ATENCION_PUBLICO, SOLO_CONSULTA | Editables | Editables | Sí, si nadie lo tiene asignado | Sí |
| Roles nuevos | Editables | Editables | Sí, si nadie lo tiene asignado | Sí |

Un administrador que además debe operar (por ejemplo, el farmacéutico dueño) tiene **también** un rol operativo
(FARMACEUTICO, DIRECTOR_TECNICO o uno propio). No hay ninguna restricción extra para asignarse a uno mismo esos roles,
más allá de las existentes: es un caso legítimo y queda auditado (`ASIGNAR_ROL`).

Decisión sobre los predefinidos editables: FARMACEUTICO, ATENCION_PUBLICO y SOLO_CONSULTA no tienen reglas de negocio que
dependan de su código, así que se tratan como cualquier rol: se pueden eliminar si no están asignados. Si se eliminan, no
se recrean solos.

Los tres permisos de sesión (`auth.login`, `auth.logout`, `auth.password.cambiar`) se incluyen **siempre** en todo rol que
se cree o edite: sin ellos un usuario no podría cerrar sesión ni re-autenticarse.

### Dónde se hace cumplir

| Regla | Aplicación | Base de datos |
| --- | --- | --- |
| `codigo` inmutable | No hay forma de enviarlo | INV-ROL-001 |
| ADMINISTRADOR / SISTEMA intocables | `motivoNoEditable` / `motivoNoEliminable` | INV-ROL-002 (también en `rol_permiso`) |
| `es_administrador` solo en ADMINISTRADOR | — | CHECK `rol_es_administrador_solo_admin` |
| ADMINISTRADOR sin operativos | `PERMISOS_DE_ADMINISTRADOR` en el cargador de sesión | Sin filas en `rol_permiso` (INV-ROL-002) |
| DIRECTOR_TECNICO no se elimina | `motivoNoEliminable` | INV-ROL-003 |
| Rol asignado no se elimina (mensaje con la cantidad de usuarios) | `motivoNoEliminable` | INV-ROL-004 + FK compuesta |
| SISTEMA no asignable | zod (`codigoRolAsignableSchema`) + `resolverRolesAAsignar` | INV-ROL-005 |
| Permiso desconocido o `sistema` | zod (`permisosDeRolSchema`, construido desde el catálogo) | FK a `fsj.permiso` |
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
