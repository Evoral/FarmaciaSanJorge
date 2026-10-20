# SPEC — Envíos con repartidor y hoja de envíos del repartidor (PDF)

> Estado: **propuesta** 2026-10-20, sin implementar. Reversión (a escribir con el código): `docs/rollbacks/envios-repartidores.md`.
> Decisiones del usuario (2026-10-20, revisadas el mismo día):
> - Los repartidores son un **catálogo propio** (no son usuarios del sistema, no se loguean).
> - Un envío lleva **un solo** repartidor, elegido con un autocomplete que muestra nombre, apellido y teléfono.
> - El domicilio de entrega es **el de la receta** (`receta.domicilio_paciente`); sin domicilio no hay envío.
> - El repartidor de un envío pendiente de firma **se puede cambiar**.
> - "Exportar envíos" genera el PDF **de un repartidor**: los envíos pendientes que tiene asignados, para dárselo y que sepa a dónde ir. Filtros: repartidor (obligatorio) y fecha de envío (por defecto hoy; vacía = todos sus pendientes).

## Alcance

Hoy "Envío" (`ModalidadEntrega.ENVIO`) solo mueve la receta a `ENVIADA_PEND_FIRMA`: no registra quién lleva el preparado ni a dónde. Esta funcionalidad agrega:

1. **Catálogo de repartidores** (alta, edición, activar/desactivar) en Catálogos → Repartidores.
2. **Asignación del repartidor** al registrar un envío, desde el modal de `/entregas/[recetaId]`.
3. **Cambio de repartidor** de un envío ya registrado mientras espera la firma.
4. **Exportar envíos**: PDF imprimible con los envíos de un repartidor, con domicilio, paciente y estado del pago.

**Fuera de alcance (a propósito).** Varios repartidores por envío, un PDF con todos los repartidores juntos, orden de visita o zonas, costo del envío, liquidación a repartidores, seguimiento en tiempo real, firma digital del receptor. Un "Retiro presencial" no lleva repartidor. No se cambia la máquina de estados ni DP-34.

## Modelo

### `fsj.repartidor` (nueva, tabla de tenant vía `fsj.setup_tenant_table`, como `etiqueta_tamano` en 0066)

| Columna | Significado |
|---|---|
| `id` | `uuid` PK. `UNIQUE (tenant_id, id)` para las FK compuestas. |
| `tenant_id` | Tenant (RLS + `forbid_tenant_id_change`). |
| `nombre`, `apellido` | `text NOT NULL`, no vacíos (check `btrim(...) <> ''`), máx. 100. |
| `telefono` | `text NOT NULL`, no vacío, máx. 30, texto libre (sin formato forzado). |
| `activo` | `boolean NOT NULL DEFAULT true`. Desactivar ≠ borrar: no hay DELETE. |
| `creado_en`, `creado_por_id` | Alta (FK compuesta a `usuario`). |

Grants a `fsj_app`: `SELECT, INSERT`, y `UPDATE (nombre, apellido, telefono, activo)`.

### `fsj.entrega.repartidor_id` (columna nueva)

`uuid NULL`, FK compuesta `(tenant_id, repartidor_id)` → `repartidor`. Índice `(tenant_id, repartidor_id)` para el PDF.

- `CHECK (modalidad = 'ENVIO' OR repartidor_id IS NULL)`: un retiro nunca tiene repartidor. Vale para todas las filas existentes, así que se agrega validado.
- **INV-ENT-005** (trigger `BEFORE INSERT OR UPDATE OF repartidor_id`): un `ENVIO` exige `repartidor_id` no nulo. Va como trigger y no como CHECK a propósito: los envíos anteriores a esta funcionalidad tienen `NULL`, y un CHECK fallaría en cualquier UPDATE de esas filas (por ejemplo, al confirmar la firma). El trigger solo mira inserts nuevos y cambios de repartidor.
- Grant: se suma `repartidor_id` al `UPDATE` por columnas de `fsj_app` (hoy solo `firma_recibida`, `firma_recibida_en`).

### `fsj.entrega_anulada.repartidor_id` (columna nueva)

`uuid NULL`, sin FK (es historial, como las demás columnas de la tabla). `moverEntregaAAnuladas` la copia junto con las demás.

### Domicilio

No hay columna nueva. El domicilio del envío es `receta.domicilio_paciente` en el momento de imprimir.

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| E1 | Un envío (`ENVIO`) se registra con **un** repartidor; sin repartidor no se puede confirmar. | `registrarEntregaInput` (zod `superRefine`), `domain/entrega.ts`; DB: INV-ENT-005. |
| E2 | Un retiro presencial **no** lleva repartidor; si llega uno, se rechaza. | zod; DB: CHECK de `entrega`. |
| E3 | Solo se puede **asignar** un repartidor **activo** del mismo tenant. Desactivarlo no lo saca de los envíos que ya tiene. | `registrar-entrega.ts` / `cambiar-repartidor.ts` (lectura en la misma tx); tenant por FK compuesta + RLS. |
| E4 | Un envío exige que la receta tenga `domicilio_paciente` no vacío. Sin domicilio, la opción "Envío" del modal queda deshabilitada con el aviso "La receta no tiene domicilio". **Sin link a editar la receta** (hallazgo del corte 3): una receta solo es editable en `PENDIENTE_PREPARACION` (`esEstadoEditable`) y el envío se registra desde `PREPARADA`, así que `/recetas/[id]/editar` redirigiría al detalle. Quien necesite enviar una receta sin domicilio tiene hoy solo el retiro presencial; habilitar la carga del domicilio en una receta ya preparada queda como decisión pendiente (fuera de este corte). | `registrar-entrega.ts` (validación de dominio, código de error nuevo); `registrar-entrega-form.tsx`. |
| E5 | El repartidor se puede **cambiar** solo mientras la receta está en `ENVIADA_PEND_FIRMA`, y el nuevo cumple E3. No se puede quitar (dejar el envío sin repartidor). | `cambiar-repartidor.ts` (mismo lock de receta que `registrarEntrega`); DB: INV-ENT-005. |
| E6 | Al anular una entrega, su repartidor queda en `entrega_anulada.repartidor_id`. Si la receta se vuelve a entregar, se elige de nuevo. | `entrega-repository.ts:moverEntregaAAnuladas`; actualizar `docs/specs/anular-entrega.md`. |
| E7 | Los envíos registrados **antes** de esta funcionalidad no tienen repartidor: siguen válidos y se les puede asignar uno con E5. Mientras no lo tengan, no salen en ningún PDF; el modal muestra "Sin repartidor asignado". | Migración (sin backfill); E8. |
| E8 | El PDF incluye solo envíos del repartidor elegido y con la receta en `ENVIADA_PEND_FIRMA` (salió y no volvió la firma). | `list-envios-de-repartidor` (repo nuevo). |
| E9 | Filtro **fecha de envío** (`entrega.entregada_en`, pasada a día con la misma regla que los filtros de fecha existentes): por defecto **hoy**; vacía = todos sus pendientes. Por defecto hoy porque un envío de días anteriores casi seguro ya se entregó y solo falta confirmar la firma: no tiene que volver a la hoja del repartidor. | Diálogo + query. |
| E10 | El importe (suma de `precio_final` de la última cotización de cada ítem, como en el listado) aparece en el PDF **solo** si quien exporta tiene `cotizaciones.ver`; si no, la columna no existe. | `imprimir-envios-pdf.ts`. |
| E11 | Ningún dato del paciente viaja en la URL del PDF: solo `repartidorId` y `fecha` (DP-24). | `app/api/entregas/envios/pdf/route.ts`. |

## Permisos

| Acción | Permiso |
|---|---|
| ABM de repartidores | **`repartidores.gestionar`** (nuevo, categoría `gestion`: llega solo a ADMINISTRADOR; a los demás roles se lo da el editor de roles). |
| Elegir repartidor al registrar un envío | `entregas.registrar` (ya existente; la acción ya corre en `conOperador`). |
| Cambiar el repartidor de un envío | `entregas.registrar`. Ese permiso está en `PERMISOS_CON_PIN_CONFIGURABLES`, así que la Server Action nueva va envuelta en `conOperador`. |
| Exportar envíos (PDF) | `entregas.registrar` (es quien ve `/entregas`). Columna de importe: además `cotizaciones.ver` (E10). |
| Buscar repartidores en los autocompletes | `entregas.registrar` o `repartidores.gestionar`. |

Alta del permiso según `docs/specs/roles-personalizables.md` (catálogo `PERMISO_CATALOGO` + insert en `fsj.permiso` en la migración).

## Auditoría

| Hecho | Registro |
|---|---|
| Alta / edición / activar / desactivar repartidor | `CREAR` / `MODIFICAR` sobre `repartidor`, con valor anterior y nuevo. |
| Registrar envío | El `CAMBIAR_ESTADO` actual de la entrega suma `repartidorId` al valor nuevo. |
| Cambiar repartidor | `MODIFICAR` sobre la entrega, con `repartidorId` anterior y nuevo. |
| Exportar envíos | A definir en el diseño: seguir lo que hacen hoy las otras impresiones de PDF (`cierres.imprimir`, `etiquetas.imprimir`). Si ellas auditan, esta también, porque expone datos de pacientes. |

## Pantallas

### Catálogos → Repartidores (`/catalogos/repartidores`)

- Listado (nombre, apellido, teléfono, activo) con búsqueda por texto y filtro activo/inactivo.
- Alta y edición con un **mismo** formulario (convención "Edit offers what the alta offers").
- Botón activar/desactivar.
- Entrada nueva en `catalogosSections` (`app/(app)/nav-sections.ts`).
- Plantilla: `modules/medicos`, simplificada con `activo` como `etiqueta-tamanos`.

### Modal de entrega (`/entregas/[recetaId]` y su pop-up)

- **Registrar** (receta `PREPARADA`): al elegir "Envío" aparecen:
  - El domicilio de la receta (solo lectura), para que quien registra lo confirme de un vistazo.
  - **Repartidor**: `Combobox` (`shared/ui/combobox.tsx`) sobre una Server Action de búsqueda de repartidores **activos**. Cada opción muestra "Apellido, Nombre · teléfono". Obligatorio para habilitar "Registrar".
  - Si no hay repartidores activos: aviso "No hay repartidores cargados", con link a Catálogos → Repartidores si tiene `repartidores.gestionar`.
  - Si la receta no tiene domicilio: "Envío" deshabilitado (E4).
  - Ante un error, la selección se conserva (`useFormSubmit`).
- **Pendiente de firma** (`ENVIADA_PEND_FIRMA`): muestra el domicilio y el repartidor asignado (nombre, apellido, teléfono), y un botón **"Cambiar repartidor"** que abre el mismo autocomplete. Si es un envío viejo sin repartidor, dice "Sin repartidor asignado" y el botón es "Asignar repartidor".

### Listado de entregas (`/entregas`)

Botón **"Exportar envíos"** en las acciones del `PageHeader`. Abre un diálogo con:

- **Repartidor** (obligatorio): el mismo `Combobox`. Lista activos e inactivos (un inactivo puede tener envíos pendientes); los inactivos se marcan "(inactivo)".
- **Fecha de envío**: precargada con hoy; se puede limpiar para traer todos sus pendientes.
- **Exportar**: abre `GET /api/entregas/envios/pdf?repartidorId=<uuid>&fecha=AAAA-MM-DD` en una pestaña nueva (`inline`), lista para imprimir o guardar.

## PDF "Hoja de envíos"

A4 apaisado (`OPCIONES_HOJA_LIBRO`), tabla con `dibujarTabla` y `numerarHojas` (`shared/pdf/hojas.ts`).

**Encabezado.**
- Nombre y teléfono de la farmacia (para que el repartidor tenga a quién llamar).
- Título "Hoja de envíos".
- **Repartidor**: apellido, nombre y teléfono.
- Filtro: "Fecha de envío: 20/10/2026" o "Todos los pendientes".
- Fecha y hora de generación, y quién la generó.

**Una fila por envío**, ordenadas por fecha de envío y luego por Nº de receta:

| Columna | Contenido |
|---|---|
| Nº receta | `numeroInterno`. |
| Enviada | Fecha y hora de `entregada_en`. |
| Paciente | Apellido, Nombre y DNI (si tiene). |
| Teléfono | Teléfono del paciente (o "—"). |
| Domicilio | `receta.domicilio_paciente`. |
| Preparados | Cantidad de ítems entregables (excluye los `itemsExcluidos`). |
| Pago | "Pagada" o **"IMPAGA — cobrar"**, destacado: el repartidor tiene que saber que cobra. |
| Importe | Solo con `cotizaciones.ver` (E10); "incompleto" si falta cotizar algún ítem. |
| Recibió | Celda en blanco para la firma y aclaración de quien recibe. |

**Pie.** "Hoja i de n", total de envíos y cuántos están impagos.

**Sin resultados.** El PDF se genera igual, con el encabezado y el texto "Este repartidor no tiene envíos pendientes para este filtro".

**Nombre del archivo.** `envios-<apellido>-<fecha|pendientes>.pdf` (sin datos de pacientes).

## Casos borde

- **Repartidor desactivado con envíos pendientes**: sigue en esos envíos y se puede exportar su hoja. No aparece para asignaciones nuevas.
- **Repartidor editado** (cambia el teléfono): el PDF muestra los datos actuales; no hay snapshot.
- **Dos personas registran o cambian el repartidor a la vez**: el lock de receta de `registrarEntrega` ya serializa, y `cambiarRepartidor` toma el mismo.
- **Anular un envío y volver a registrarlo como retiro**: válido. El repartidor anterior queda solo en `entrega_anulada.repartidor_id`.
- **Domicilio editado después del envío**: el PDF usa el valor vigente de la receta (no se congela).

## Plan de implementación (cortes)

Cada corte es un commit revisable. La migración se aplica antes de desplegar el código que la usa.

1. **Migración 0093 `repartidores_envio`** + `prisma/rollbacks/0093_repartidores_envio.down.sql` + `docs/rollbacks/envios-repartidores.md`: tabla `repartidor`, `entrega.repartidor_id` (CHECK + INV-ENT-005 + grant), `entrega_anulada.repartidor_id`, permiso `repartidores.gestionar`. Modelos Prisma. Test DB de las invariantes.
2. **Módulo `repartidores`** (domain/application/infrastructure/ui) + rutas `/catalogos/repartidores` + navegación + Server Action de búsqueda para el autocomplete. Tests unitarios de validación.
3. **Registrar envío con repartidor**: `registrarEntregaInput` (`repartidorId`), reglas E1–E4, columna en el insert, auditoría, `Combobox` y domicilio en `registrar-entrega-form.tsx`.
4. **Cambiar repartidor**: comando `cambiarRepartidor`, Server Action con `conOperador`, vista del envío pendiente en `entrega-acciones.tsx`.
5. **Anular**: `moverEntregaAAnuladas` copia `repartidor_id`; actualizar `docs/specs/anular-entrega.md`.
6. **Exportar envíos**: query `listEnviosDeRepartidor`, `infrastructure/envios-pdf.ts`, `application/imprimir-envios-pdf.ts`, route `app/api/entregas/envios/pdf/route.ts`, diálogo en `/entregas`.

## Código que lo implementa

A completar con cada corte. Implementados (cortes 1 y 2):

- **Migración 0093** (`prisma/migrations/20261020120000_0093_repartidores_envio/`, rollback `prisma/rollbacks/0093_repartidores_envio.down.sql`): INV-ENT-005 es el trigger `trg_entrega_validar_repartidor`. **Ventana de aplicación:** como el trigger exige repartidor en todo `ENVIO` nuevo y el código anterior al corte 3 no lo manda, registrar un envío falla entre aplicar 0093 y desplegar el corte 3 (retiro presencial, confirmar firma y anular no se ven afectados). Aplicar 0093 junto con el despliegue del corte 3.
- **Módulo** `modules/repartidores/` (`domain/repartidor.ts`, `application/{crear,editar,cambiar-estado,get,list,buscar}-repartidor(es).ts`, `infrastructure/repartidor-repository.ts`, `ui/`). Activar/desactivar es un solo comando (`repartidores.cambiarEstado`, auditado como `MODIFICAR` con `activo` anterior y nuevo, sin motivo).
- **Búsqueda para autocompletes:** `defineQuery` acepta un solo permiso, así que "`entregas.registrar` o `repartidores.gestionar`" son dos queries registradas con el mismo handler (`repartidores.buscar` y `repartidores.buscarGestion`); `buscarRepartidores()` elige la que la sesión puede correr. `modules/repartidores/ui/buscar-repartidores-action.ts` (Server Action, `texto` + `soloActivos`) y `ui/repartidor-search.ts` (`buscarRepartidoresParaCombobox(soloActivos)`: adaptador para el prop `search` de `Combobox`, opción "Apellido, Nombre · teléfono", " (inactivo)" si corresponde).
- **Rutas** `app/(app)/catalogos/repartidores/{layout,page,[id]/page}.tsx` y entrada en `catalogosSections`.
- **Transversal:** `PERMISO_CATALOGO` (`repartidores.gestionar`), etiqueta de grupo en `modules/usuarios/domain/roles.ts`, entidad `repartidor` en `modules/auditoria/domain/presentacion.ts`, mensaje de INV-ENT-005 en `shared/errors/mensajes-invariantes.ts`, etiqueta `soloActivos` en `shared/labels/field-labels.ts`.
- **Tests:** `tests/unit/repartidores-validacion.test.ts`, `tests/unit/repartidores-authorization-matrix.test.ts`. El test DB de las invariantes (corte 1 del plan) queda pendiente: no se pudo correr contra la base compartida.

Implementados (cortes 3, 4 y 5):

- **Corte 3, registrar envío.** `modules/entregas/domain/entrega.ts` (reglas puras E1-E5: `mensajeRepartidorSegunModalidad`, `validarDomicilioParaEnvio`, `validarRepartidorAsignable`, `puedeCambiarRepartidor`); `application/registrar-entrega.ts` (`repartidorId` opcional en el input con `superRefine` que marca el campo `repartidorId`; dentro de la tx, tras el lock de la receta, E4 y E3; el `CAMBIAR_ESTADO` suma `repartidorId` al valor nuevo cuando es un envío; INV-ENT-005 se mapea con el `mapDbError` existente); `infrastructure/entrega-repository.ts` (`insertEntrega` escribe `repartidor_id`; copias propias `getRepartidorParaAsignar`, `hayRepartidoresActivos`, `getRepartidorDeEntrega`, porque `modules/entregas` no puede importar la infraestructura de `repartidores`); `application/get-entrega-estado.ts` (suma `domicilioPaciente`, `repartidor` y `hayRepartidoresActivos`); `ui/actions.ts` (lee `repartidorId`, vacío = ausente); `ui/registrar-entrega-form.tsx` (domicilio de solo lectura, `Combobox` "Repartidor" sobre `buscarRepartidoresParaCombobox(true)`, "Envío" deshabilitado sin domicilio, aviso "No hay repartidores cargados" con link a `/catalogos/repartidores` solo con `repartidores.gestionar`, submit deshabilitado sin repartidor); ambas páginas de `/entregas/[recetaId]` pasan los datos. `shared/ui/combobox.tsx` ahora atiende `FIELD_ERROR_EVENT` para que un error del servidor sobre `repartidorId` marque y enfoque el campo.
- **Corte 4, cambiar repartidor.** `application/cambiar-repartidor.ts` (`entregas.repartidor.cambiar`, permiso `entregas.registrar`, mismo lock de receta, solo `ENVIADA_PEND_FIRMA` y entrega `ENVIO`, repartidor activo del tenant; elegir el mismo repartidor que ya tiene se rechaza, así no se audita un cambio idéntico; `MODIFICAR` sobre la entrega con `repartidorId` anterior y nuevo); `cambiarRepartidorAction` (envuelta en `conOperador`); `ui/envio-pendiente.tsx` (domicilio, repartidor con teléfono o "Sin repartidor asignado", botón "Cambiar repartidor" / "Asignar repartidor") y `ui/cambiar-repartidor-form.tsx`; `ui/entrega-acciones.tsx` los muestra encima de "Confirmar retorno", que queda intacto.
- **Corte 5, anular.** `moverEntregaAAnuladas` copia `repartidor_id` (regla A10 de `docs/specs/anular-entrega.md`).
- **Tests:** `tests/unit/entregas-validacion.test.ts` (reglas puras), `tests/unit/entregas-command-flows.test.ts` (ENVIO sin repartidor, RETIRO con repartidor, ENVIO sin domicilio, repartidor inactivo o inexistente, auditoría, `cambiarRepartidor` solo en `ENVIADA_PEND_FIRMA`), `tests/unit/entregas-authorization-matrix.test.ts` (`entregas.repartidor.cambiar`). Sin test DB: no se pudo correr contra la base compartida.
