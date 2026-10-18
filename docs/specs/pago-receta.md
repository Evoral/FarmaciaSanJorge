# SPEC — Pago de la receta (marca pagada / impaga)

> Estado: implementado 2026-10-08 (migración 0071). Revisado 2026-10-13 (migración 0076): una receta entregada siempre queda pagada (P4). Reversión: `docs/rollbacks/pago-receta.md`, `docs/rollbacks/receta-entregada-pagada.md`.
> Decisión del usuario: la opción **mínima**. Un indicador en la receta, nada más.

## Alcance

La farmacia necesita saber qué recetas se pagaron y cuáles no. Una receta lleva una marca **Pagada / Impaga**, con quién la registró y cuándo. El pago se puede registrar al **crear** la receta, al **entregarla**, o después desde el **detalle** de la receta.

**Fuera de alcance (a propósito).** Esto es SOLO una marca de pagada/impaga. No hay tabla de pagos, ni importes, ni señas, ni medios de pago, ni caja, ni cobro, ni facturación.

> **Relación con el plan.** `docs/plan-implementacion.md` (línea ~44) deja fuera de alcance "Facturación, cobro, AFIP, obras sociales/validación de credencial (DP-30)". Eso **sigue valiendo**: esta funcionalidad no registra cobros ni importes, no emite comprobantes y no toca obras sociales, así que **no reabre DP-30**. Si más adelante se necesitan montos, señas o medios de pago, es un cambio nuevo con su propia decisión (una tabla de pagos); la marca de hoy se podría derivar de ella.

## Modelo

Tres columnas en `fsj.receta` (migración 0071):

| Columna | Significado |
|---|---|
| `pagada` | `boolean NOT NULL DEFAULT false`. Las recetas existentes quedan impagas (sin backfill). |
| `pagada_en` | Momento en que se marcó pagada (hora del servidor). `NULL` mientras está impaga. |
| `pagada_por_id` | Usuario que la marcó (FK compuesta `(tenant_id, pagada_por_id)` → `usuario`, como `registrada_por_id` y `tomada_por_id`). `NULL` mientras está impaga. |

`receta_pagada_check` obliga a que las tres cambien juntas: pagada ⇒ `pagada_en` y `pagada_por_id` informados; impaga ⇒ ambos `NULL`.

**El pago NO es un estado de la receta.** No se agregó `PAGADA` a `EstadoReceta`: el pago es una dimensión ortogonal a la máquina de estados de producción y libro (`PENDIENTE_PREPARACION` … `ENTREGADA` / `ANULADA`). Una receta puede estar pagada y pendiente de preparación, o impaga hasta su entrega. La máquina de estados no cambia, pero llegar a `ENTREGADA` exige el pago (P4, INV-R14).

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| P1 | `pagadaEn` y `pagadaPorId` los pone **el servidor** (hora de la transacción y usuario de la sesión). Nunca se aceptan del cliente. Desmarcar limpia las tres columnas. | `setPagoDeReceta` / `insertRecetaConItems` (`receta-repository.ts`); los inputs de los comandos solo llevan el booleano `pagada`. |
| P2 | Se puede registrar el pago **al crear** la receta (carga manual e importación PDF/QR): casilla "Pagada", sin tildar por defecto. | `crearReceta`, `importarReceta` (input `pagada`); `receta-form.tsx`. |
| P3 | Se puede registrar el pago **al entregar** (registrar la entrega o confirmar la firma recibida de un envío), en la misma transacción. El switch "Pagada" es de solo subida: activarlo marca la receta pagada; si ya estaba pagada se muestra activado y bloqueado. El pago se escribe **antes** de pasar la receta a `ENTREGADA` (INV-R14). | `registrarEntrega` y `confirmarFirmaRecibida` (input `pagada`, solo marca); `registrar-entrega-form.tsx`, `confirmar-firma-form.tsx`. |
| P4 | **Revisada 2026-10-13: una receta solo llega a `ENTREGADA` pagada**, para no perder el registro del pago (futuro módulo de finanzas). **Retiro presencial:** la receta pasa a `ENTREGADA` al registrar la entrega, así que tiene que estar pagada o marcarse pagada en ese momento. **Envío:** puede registrarse impaga y quedar en `ENVIADA_PEND_FIRMA`; al confirmar la firma recibida (pasa a `ENTREGADA`) tiene que estar pagada o marcarse pagada en ese momento. Sin pago se rechaza con "Para entregar la receta tiene que quedar pagada…" (el botón queda deshabilitado hasta activar el switch). | `modules/entregas/domain/entrega.ts` (`entregaExigePago`, `validarPagoAlEntregar`); respaldo en la BD: **INV-R14** (`receta_validar_entregada_pagada`, migración 0076). |
| P5 | El detalle de la receta muestra "Pagada" (con quién y cuándo) o "Impaga", y permite marcar o desmarcar con el mismo switch del alta (guarda al tocarlo): para registrar un pago hecho entre el alta y la entrega, o corregir un error antes de entregar. Una receta `ENTREGADA` y pagada muestra el switch bloqueado. | `app/(app)/recetas/[id]/page.tsx`, `pago-receta-form.tsx`, `pago-switch.tsx`, `marcarPagoReceta`. |
| P6 | El pago se puede cambiar en **cualquier estado menos `ANULADA`**. En `ANULADA` se rechaza con "La receta está anulada: no se puede modificar su pago." En `ENTREGADA` solo se puede **marcar** (recetas entregadas impagas antes de la migración 0076); desmarcar se rechaza con "La receta ya fue entregada: no se puede marcar como impaga." | `modules/recetas/domain/pago.ts` (`validarPagoModificable`, `puedeDesmarcarPago`); respaldo en la BD: **INV-R13** (`receta_validar_pago_no_anulada`, migración 0071) e **INV-R14** (migración 0076). Anular una receta pagada no toca la marca: queda como historial. |
| P7 | **Idempotencia.** Pedir el estado que la receta ya tiene es un no-op: marcar una receta ya pagada **no** pisa `pagadaEn` ni `pagadaPorId` (se conserva el primer registro) y no deja fila de auditoría. | `decidirCambioPago` (`domain/pago.ts`); `marcarPagoReceta` y `registrarEntrega`. |
| P8 | **Revisada 2026-10-16:** la edición de la receta (`/recetas/[id]/editar`) muestra el mismo switch "Pagada" del alta, con el estado actual, para registrar un pago olvidado en la carga inicial (o corregirlo). Al guardar se aplican las mismas reglas que en el detalle (P6, P7), en la misma transacción de la edición. El espacio de toma de `/preparaciones`, que embebe el formulario sin el switch, no envía `pagada` y deja el pago como está. | `editarReceta` (input `pagada` opcional) → `aplicarCambioPago` (`marcar-pago-receta.ts`), el mismo camino que `marcarPagoReceta`; `receta-form.tsx`. |
| P9 | El actor que marca el pago debe ser un usuario `ACTIVO` (INV-U07). | Trigger genérico `assert_actor_activo`, ahora con `pagada_por_id` en los triggers de `INSERT` y `UPDATE` de `receta`. |

## Permisos

Se reutilizan los existentes; no se creó ninguno nuevo.

| Acción | Permiso | Motivo |
|---|---|---|
| Marcar al crear / importar | `recetas.crear` | Es parte del alta. |
| Marcar al entregar | `entregas.registrar` | Es parte de la entrega; quien entrega puede cobrar en el mostrador sin necesitar `recetas.editar`. |
| Marcar / desmarcar desde el detalle | `recetas.editar` | El permiso de modificación de la receta que no es destructivo (`recetas.anular` es solo FAR/DT). ATP/FAR/DT lo tienen en el seed (migración 0002). |
| Ver el pago y filtrar el listado | `recetas.crear` (igual que el listado y el detalle) | Sin permiso nuevo. |

## Auditoría

Todo cambio de `pagada` deja fila en `fsj.registro_auditoria`, con el valor anterior y el nuevo:

- **Crear / importar:** `receta` CREAR, `pagada` en `valorNuevo`.
- **Detalle:** `receta` MODIFICAR, `valorAnterior: { pagada }` / `valorNuevo: { pagada }`. Solo si hubo cambio (P7).
- **Entrega:** la fila de `entrega` incluye `pagada` antes/después y, si la entrega marcó el pago, se agrega una fila `receta` MODIFICAR (`contexto.origen = "entrega"`) para que el historial de la receta quede completo.

Todas se escriben en la misma transacción que el cambio.

## Listado de recetas (`/recetas`)

- Columna **Pago** con una insignia Pagada (verde) / Impaga (ámbar), también en la lista para teléfonos.
- Filtro **Pago**: Todas / Pagadas / Impagas (`?pago=pagadas|impagas`), dentro de "Filtros", con su chip de filtro activo.
- **Excel** (`/api/recetas/reporte/export/xlsx`): columna `Pago` ("Pagada" / "Impaga") y respeta el filtro `pago`. El resumen de filtros de la auditoría de la exportación lo incluye.
- No se agregó un contador de impagas al resumen por estado: ese resumen cuenta por estado y no aplica los demás filtros.
- Sin índice nuevo: el listado no tiene índices para sus otros filtros y `pagada` es un booleano de baja cardinalidad.

## Listado de entregas (`/entregas`) (2026-10-17)

Cada fila muestra el pago ("Pagada" / "Impaga") y, para quien tiene `cotizaciones.ver`, el precio: la suma de la cotización vigente de cada ítem (INV-R06), con "Parcial" si algún ítem no tiene cotización o su cotización es parcial/incompleta, y "Sin cotizar" si ninguno la tiene. Solo visualización (`listEntregasPendientes`, `modules/entregas/infrastructure/entrega-repository.ts`).

Una entrega registrada por error se anula desde `/recetas/[id]` y puede dejar la receta impaga en el mismo acto: `docs/specs/anular-entrega.md` (A6).

## Casos borde

- **Entregada e impaga** (solo recetas entregadas antes de la migración 0076, que no se corrigen solas): se marca desde el detalle (P5/P6). Una vez pagada, no se puede volver a impaga.
- **Envío (`ENVIADA_PEND_FIRMA`):** se puede marcar al registrar el envío, después desde el detalle, o al confirmar la firma recibida; confirmar la firma exige que quede pagada (P4).
- **Marcar dos veces / dos usuarios a la vez:** la receta se bloquea (`SELECT … FOR UPDATE`) antes de leer; el segundo no pisa el primero (P7).
- **Desmarcar y volver a marcar:** `pagadaEn` / `pagadaPorId` pasan a ser los del nuevo registro; el historial anterior queda en la auditoría.
- **Receta anulada:** el detalle no ofrece la acción y el comando y la BD la rechazan (P6).
- **Usuario suspendido o dado de baja:** no puede ser `pagada_por_id` de un registro nuevo (P9); los registros históricos no se revalidan.

## Código que lo implementa

- `prisma/migrations/20261008090000_0071_receta_pagada/migration.sql` y `prisma/rollbacks/0071_receta_pagada.down.sql`.
- `prisma/migrations/20261013120000_0076_receta_entregada_pagada/migration.sql` y `prisma/rollbacks/0076_receta_entregada_pagada.down.sql` (INV-R14).
- `modules/recetas/domain/pago.ts` (reglas puras, filtros y etiquetas).
- `modules/recetas/application/marcar-pago-receta.ts`; `crear-receta.ts`, `importar-receta.ts`, `list-recetas.ts`, `reporte-recetas.ts`.
- `modules/recetas/infrastructure/receta-repository.ts` (`getPagoDeReceta`, `setPagoDeReceta`, alta, detalle, listado).
- `modules/recetas/ui/` (`receta-form.tsx`, `pago-switch.tsx`, `pago-receta-form.tsx`, `recetas-table.tsx`, `actions.ts`) y `app/(app)/recetas/` (`page.tsx`, `[id]/page.tsx`).
- `modules/entregas/` (`domain/entrega.ts`, `application/registrar-entrega.ts`, `application/confirmar-firma-recibida.ts`, `application/get-entrega-estado.ts`, `infrastructure/entrega-repository.ts`, `ui/registrar-entrega-form.tsx`, `ui/confirmar-firma-form.tsx`).
- `app/api/recetas/reporte/export/xlsx/route.ts`; `shared/errors/mensajes-invariantes.ts` (INV-R13, INV-R14); `shared/labels/field-labels.ts`.
