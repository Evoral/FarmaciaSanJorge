# Rollback — Retiro vencido (migraciones 0094 y 0095)

Spec: `openspec/specs/retiro-vencido/spec.md`.

La funcionalidad se entrega en cortes; este documento cubre todos. Si solo se revierte un corte, aplicar solo la parte que corresponda (ver "Código").

## Orden

1. Pasar a `PREPARADA` las recetas que estén en `RETIRO_VENCIDO` (ver "Datos").
2. Revertir el código.
3. Aplicar `prisma/rollbacks/0095_retiro_vencido.down.sql` como migración **nueva**.
4. Aplicar `prisma/rollbacks/0094_estado_retiro_vencido.down.sql` como migración **nueva** (después de la de 0095).

Ambos `.down.sql` se **niegan a correr** (`RAISE EXCEPTION`) mientras exista una receta en `RETIRO_VENCIDO`. El de 0094 además se niega si hay otra columna tipada `fsj.estado_receta` aparte de `fsj.receta.estado`.

## Código

Revertir los commits de la funcionalidad. Tocan, por corte:

- **Estado (corte 2):** `modules/recetas/domain/receta.ts` (`ESTADOS_RECETA`, `esRecetaEnCurso`), `shared/labels/enum-labels.ts`, `shared/ui/status-badge.tsx`, el inicio (`app/(app)/page.tsx`), `modules/pacientes/domain/trayectoria.ts`, el filtro de `/entregas` (`modules/entregas`, `app/(app)/entregas`) y `prisma/schema.prisma` (valor `RETIRO_VENCIDO`, columna `preparadaEn`).
- **Parámetro (corte 3):** `modules/parametros/domain/parametros-registry.ts` (`dias_retiro_vencido`), `getDiasRetiroVencido` en `modules/entregas/infrastructure`, `scripts/create-tenant.ts`, el texto de `app/(app)/admin/configuracion/parametros/page.tsx`.
- **Job diario (corte 4):** `modules/entregas/domain/retiro-vencido.ts` (cálculo de jornadas), `modules/entregas/application/vencer-retiros.ts`, `modules/entregas/infrastructure/retiro-vencido-repository.ts`, `app/api/jobs/retiros-vencidos/route.ts`, la entrada `/api/jobs/retiros-vencidos` de `vercel.json`, la excepción de `vencer-retiros.ts` en `eslint.config.mjs` y la sección del job en `docs/deploy.md`. **Los crons de Vercel no se actualizan con un Instant Rollback** (`docs/deploy.md` §7): si se revierte solo el despliegue, el cron sigue llamando a una ruta que ya no existe (404, inofensivo) hasta que se redespliegue `vercel.json`. Revertir este corte **antes** que las migraciones: sin el job, nada vuelve a crear recetas en `RETIRO_VENCIDO`.
- **Archivo (corte 6):** `modules/archivo/domain/lote-archivo.ts` (`EstadoRecetaArchivable`, `esRecetaElegibleParaArchivo`), `modules/archivo/domain/mensajes-invariantes.ts`, `modules/archivo/application/conformar-lote.ts`, `modules/archivo/infrastructure/archivo-repository.ts` (tres filtros `IN ('ENTREGADA', 'ANULADA', 'RETIRO_VENCIDO')`) y el texto de `app/(app)/archivo/page.tsx` y `app/(app)/archivo/nuevo/page.tsx`. **Ojo:** una receta `RETIRO_VENCIDO` ya archivada en un lote queda fuera de la reversión simple (el paso 1 no puede pasarla a `PREPARADA`: la base lo rechaza). Hay que sacarla del lote o conservar el estado; el `.down.sql` de 0094 se niega a correr mientras exista.
- **Libro (RV8):** sin cambios de código (`RETIRO_VENCIDO` simplemente no figura en `ESTADOS_TERMINALES_RECETA`); solo el test `tests/unit/libro-receta-coupling.test.ts` y una línea de `openspec/specs/libro-recetario-y-contralor/spec.md`.
- **Reactivar (corte 5):** `modules/entregas/application/reactivar-receta.ts` (comando `entregas.reactivar`), la extensión `retiroVencido` de `modules/entregas/application/get-entrega-estado.ts`, `getRetiroVencidoDeReceta` y `getPreparadosConVencimiento` en `modules/entregas/infrastructure/entrega-repository.ts`, `puedeReactivar` / `validarReactivar` / `preparadosVencidos` / `jornadaVencimientoRetiro` / `camposFaltantesCoFirma` en `modules/entregas/domain/retiro-vencido.ts`, `reactivarRecetaAction` en `modules/entregas/ui/actions.ts`, `modules/entregas/ui/reactivar-form.tsx` y la rama RETIRO_VENCIDO de `entrega-acciones.tsx`, las dos páginas de `/entregas/[recetaId]` (prop `retiroVencido`), el panel "Retiro vencido" de `app/(app)/recetas/[id]/page.tsx` y las etiquetas `dtPassword` / `preparadosVencidos` de `shared/labels/field-labels.ts`. No toca stock ni libro (usa la verificación de co-firma de stock tal cual, sin modificarla). Revertirlo deja las recetas en `RETIRO_VENCIDO` sin forma de reactivarlas desde la app: ver "Datos" para devolverlas a `PREPARADA` **antes** de revertir este corte, o usar la anulación.

Revertir el código primero: sin él, nadie escribe ni lee el estado nuevo, y el `.down.sql` de 0094 deja de encontrar valores que borrar. Si el código revertido todavía muestra `RETIRO_VENCIDO` en alguna pantalla, el tipo de Prisma ya no lo conoce y falla al leer: por eso el paso 1 va **antes**.

## Base de datos

- **0095** (`0095_retiro_vencido.down.sql`): restaura INV-R08 tal como la dejó 0086 y INV-ARC-006 tal como la dejó 0051, elimina el trigger `trg_receta_preparada_en`, su función y la columna `fsj.receta.preparada_en`, y borra las filas del parámetro `dias_retiro_vencido`. La columna `preparada_en` **no se puede recuperar** una vez borrada; es solo un reloj, se recalcula si se vuelve a aplicar 0095 (el backfill usa la última `preparacion.confirmada_en`).
- **0094** (`0094_estado_retiro_vencido.down.sql`): Postgres no permite quitar un valor de un enum, así que recrea `fsj.estado_receta` sin `RETIRO_VENCIDO`, igual que hizo 0061. Para poder cambiar el tipo de la columna elimina y vuelve a crear, sin cambios, los triggers `BEFORE UPDATE OF estado` (INV-R08, INV-ENT-002, INV-R12, INV-R14), los índices parciales `uq_receta_emisor_nro_vigente` e `idx_receta_tenant_tomada_en_curso`, el CHECK `receta_anulada_motivo_check` y el DEFAULT de la columna. Corre en una sola transacción: bloquea `fsj.receta` mientras dura, conviene aplicarla en horario sin mostrador.

## Datos

Las recetas en `RETIRO_VENCIDO` hay que devolverlas a `PREPARADA` **antes** de aplicar los `.down.sql`.

- **Con el código nuevo todavía desplegado:** usar "Reactivar" en `/entregas` (o el acceso desde el detalle de receta) con cada una. Si algún preparado está vencido, exige la co-firma del DT.
- **Por SQL** (como propietario de la base, con el código viejo o nuevo; deja a la receta en `PREPARADA` y el trigger `trg_receta_preparada_en` reinicia el reloj; INV-R08 permite la transición):

  ```sql
  -- Ver cuántas hay y de qué farmacias.
  SELECT tenant_id, count(*) AS recetas, count(*) FILTER (WHERE lote_archivo_id IS NOT NULL) AS archivadas
  FROM fsj.receta WHERE estado = 'RETIRO_VENCIDO' GROUP BY tenant_id;

  UPDATE fsj.receta SET estado = 'PREPARADA'
  WHERE estado = 'RETIRO_VENCIDO' AND lote_archivo_id IS NULL;
  ```

  Este camino no deja registro de auditoría de la reactivación: anotar el motivo del rollback en el ticket del cambio.
- **Recetas archivadas en `RETIRO_VENCIDO`:** INV-R08 no permite sacarlas del estado hacia `PREPARADA` (el lote es inmutable). Hay que decidirlo con la farmacia y el DT: lo habitual es anularlas con un motivo (`ANULADA` sí es alcanzable y sigue siendo archivable), siempre que no tengan un asiento del libro en efecto (INV-R12). No hay forma automática de decidirlo.
- Las recetas que ya habían vuelto a `PREPARADA` (reactivadas) o llegaron a `ENTREGADA`/`ANULADA` no necesitan nada.

## Verificación posterior

```sql
SELECT enum_range(NULL::fsj.estado_receta);                          -- sin RETIRO_VENCIDO
SELECT 1 FROM information_schema.columns
WHERE table_schema = 'fsj' AND table_name = 'receta' AND column_name = 'preparada_en';  -- 0 filas
SELECT 1 FROM fsj.parametro WHERE clave = 'dias_retiro_vencido';     -- 0 filas
```
