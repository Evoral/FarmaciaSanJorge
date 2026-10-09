# SPEC — Pago de la receta (marca pagada / impaga)

> Estado: implementado 2026-10-08 (migración 0071). Reversión: `docs/rollbacks/pago-receta.md`.
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

**El pago NO es un estado de la receta.** No se agregó `PAGADA` a `EstadoReceta`: el pago es una dimensión ortogonal a la máquina de estados de producción y libro (`PENDIENTE_PREPARACION` … `ENTREGADA` / `ANULADA`). Una receta puede estar pagada y pendiente de preparación, o entregada e impaga. La máquina de estados no cambia.

## Reglas

| # | Regla | Dónde se hace cumplir |
|---|---|---|
| P1 | `pagadaEn` y `pagadaPorId` los pone **el servidor** (hora de la transacción y usuario de la sesión). Nunca se aceptan del cliente. Desmarcar limpia las tres columnas. | `setPagoDeReceta` / `insertRecetaConItems` (`receta-repository.ts`); los inputs de los comandos solo llevan el booleano `pagada`. |
| P2 | Se puede registrar el pago **al crear** la receta (carga manual e importación PDF/QR): casilla "Pagada", sin tildar por defecto. | `crearReceta`, `importarReceta` (input `pagada`); `receta-form.tsx`. |
| P3 | Se puede registrar el pago **al entregar**, en la misma transacción que la entrega. La casilla es de solo subida: tildarla marca la receta pagada; si ya estaba pagada se muestra tildada y no se puede bajar desde ahí. | `registrarEntrega` (input `pagada`, solo marca); `registrar-entrega-form.tsx`. |
| P4 | **Entregar una receta impaga está permitido.** No se bloquea: la pantalla de entrega solo muestra un aviso visible ("Receta impaga"). | `registrar-entrega-form.tsx` (aviso); `registrarEntrega` no valida el pago. |
| P5 | El detalle de la receta muestra "Pagada" (con quién y cuándo) o "Impaga", y permite marcar o desmarcar: para registrar un pago hecho entre el alta y la entrega, o corregir un error. | `app/(app)/recetas/[id]/page.tsx`, `pago-receta-form.tsx`, `marcarPagoReceta`. |
| P6 | El pago se puede cambiar en **cualquier estado menos `ANULADA`** (también en `ENTREGADA`: pagar después de entregar es válido). En `ANULADA` se rechaza con "La receta está anulada: no se puede modificar su pago." | `modules/recetas/domain/pago.ts` (`validarPagoModificable`); respaldo en la BD: **INV-R13** (`receta_validar_pago_no_anulada`, migración 0071). Anular una receta pagada no toca la marca: queda como historial. |
| P7 | **Idempotencia.** Pedir el estado que la receta ya tiene es un no-op: marcar una receta ya pagada **no** pisa `pagadaEn` ni `pagadaPorId` (se conserva el primer registro) y no deja fila de auditoría. | `decidirCambioPago` (`domain/pago.ts`); `marcarPagoReceta` y `registrarEntrega`. |
| P8 | Editar la receta (`editarReceta`) **nunca** cambia el pago; el pago se cambia solo desde el detalle (P5). | `editar-receta.ts` omite `pagada` del input. |
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
- **CSV** (`/api/recetas/reporte/export/csv`): columna `Pago` ("Pagada" / "Impaga") y respeta el filtro `pago`. El resumen de filtros de la auditoría de la exportación lo incluye.
- No se agregó un contador de impagas al resumen por estado: ese resumen cuenta por estado y no aplica los demás filtros.
- Sin índice nuevo: el listado no tiene índices para sus otros filtros y `pagada` es un booleano de baja cardinalidad.

## Casos borde

- **Entregada e impaga** y luego se paga: se marca desde el detalle (P5/P6).
- **Envío (`ENVIADA_PEND_FIRMA`):** se puede marcar al registrar el envío o después desde el detalle; confirmar la firma no toca el pago.
- **Marcar dos veces / dos usuarios a la vez:** la receta se bloquea (`SELECT … FOR UPDATE`) antes de leer; el segundo no pisa el primero (P7).
- **Desmarcar y volver a marcar:** `pagadaEn` / `pagadaPorId` pasan a ser los del nuevo registro; el historial anterior queda en la auditoría.
- **Receta anulada:** el detalle no ofrece la acción y el comando y la BD la rechazan (P6).
- **Usuario suspendido o dado de baja:** no puede ser `pagada_por_id` de un registro nuevo (P9); los registros históricos no se revalidan.

## Código que lo implementa

- `prisma/migrations/20261008090000_0071_receta_pagada/migration.sql` y `prisma/rollbacks/0071_receta_pagada.down.sql`.
- `modules/recetas/domain/pago.ts` (reglas puras, filtros y etiquetas).
- `modules/recetas/application/marcar-pago-receta.ts`; `crear-receta.ts`, `importar-receta.ts`, `list-recetas.ts`, `reporte-recetas.ts`.
- `modules/recetas/infrastructure/receta-repository.ts` (`getPagoDeReceta`, `setPagoDeReceta`, alta, detalle, listado).
- `modules/recetas/ui/` (`receta-form.tsx`, `pago-receta-form.tsx`, `recetas-table.tsx`, `actions.ts`) y `app/(app)/recetas/` (`page.tsx`, `[id]/page.tsx`).
- `modules/entregas/` (`application/registrar-entrega.ts`, `application/get-entrega-estado.ts`, `infrastructure/entrega-repository.ts`, `ui/registrar-entrega-form.tsx`).
- `app/api/recetas/reporte/export/csv/route.ts`; `shared/errors/mensajes-invariantes.ts` (INV-R13); `shared/labels/field-labels.ts`.
