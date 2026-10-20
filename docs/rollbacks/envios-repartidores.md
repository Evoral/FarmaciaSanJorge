# Rollback — Envíos con repartidor (migración 0093)

Spec: `docs/specs/envios-repartidores.md`.

## Código

Revertir los commits de la feature. Los cortes ya implementados tocan (los siguientes cortes agregan sus archivos aquí):

- Corte 1 (migración): `prisma/migrations/20261020120000_0093_repartidores_envio/migration.sql`, `prisma/schema.prisma` (modelo `Repartidor`, `Entrega.repartidorId`, `EntregaAnulada.repartidorId`), `modules/auth/domain/permisos.ts` (`repartidores.gestionar`), `shared/errors/mensajes-invariantes.ts` (INV-ENT-005).
- Corte 2 (catálogo): `modules/repartidores/**` (nuevo), `app/(app)/catalogos/repartidores/**` (nuevo), `app/(app)/nav-sections.ts` (entrada "Repartidores"), `modules/README.md`, `modules/usuarios/domain/roles.ts` (etiqueta del grupo), `modules/auditoria/domain/presentacion.ts` (entidad `repartidor`), `shared/labels/field-labels.ts` (`soloActivos`), `tests/unit/repartidores-*.test.ts`.
- Corte 3 (registrar envío): `modules/entregas/domain/entrega.ts` (reglas E1-E5), `modules/entregas/application/registrar-entrega.ts` (`repartidorId`, `superRefine`, E3/E4, auditoría), `modules/entregas/infrastructure/entrega-repository.ts` (`insertEntrega`, `getRepartidorParaAsignar`, `hayRepartidoresActivos`, `getRepartidorDeEntrega`, `RecetaParaEntrega.domicilioPaciente`, `EntregaRow.repartidorId`), `modules/entregas/application/get-entrega-estado.ts`, `modules/entregas/ui/{actions.ts,registrar-entrega-form.tsx,entrega-acciones.tsx}`, `app/(app)/entregas/[recetaId]/page.tsx`, `app/(app)/@modal/(.)entregas/[recetaId]/page.tsx`, `shared/ui/combobox.tsx` (marca de campo inválido con `FIELD_ERROR_EVENT`), `shared/labels/field-labels.ts` (`repartidorId`), `tests/unit/entregas-{validacion,command-flows,authorization-matrix}.test.ts`.
- Corte 4 (cambiar repartidor): `modules/entregas/application/cambiar-repartidor.ts` (nuevo), `modules/entregas/ui/{cambiar-repartidor-form,envio-pendiente}.tsx` (nuevos), `cambiarRepartidorAction` en `modules/entregas/ui/actions.ts`, `cambiarRepartidorDeEntrega` en el repositorio.
- Corte 5 (anular): `modules/entregas/infrastructure/entrega-repository.ts` (`moverEntregaAAnuladas` copia `repartidor_id`), `docs/specs/anular-entrega.md` (regla A10). Si se revierte solo este corte, el INSERT vuelve a la lista de columnas anterior: `entrega_anulada.repartidor_id` queda `NULL`.
- Corte 6 (exportar envíos): `modules/entregas/domain/hoja-envios.ts`, `modules/entregas/application/imprimir-envios-pdf.ts`, `modules/entregas/infrastructure/envios-pdf.ts` (nuevos), `modules/entregas/ui/exportar-envios-dialog.tsx` (nuevo), `app/api/entregas/envios/pdf/route.ts` (nuevo), `app/(app)/entregas/page.tsx` (botón en el `PageHeader`), `modules/entregas/infrastructure/entrega-repository.ts` (`listEnviosDeRepartidor`, `getFarmaciaParaHoja`, `zonaHorariaTenant`, `getItemsParaEntregaDeRecetas`), `shared/pdf/hojas.ts` (`negrita`, `altoMinimoFila`: opcionales, no cambian el libro), `tests/unit/entregas-envios-pdf.test.ts`, `tests/db/entrega-repartidor.test.ts` y los fixtures de repartidor de `tests/db/{fixtures,entrega-archivo,entrega-regularizacion}`. Sin tocar la base: revertir este corte no requiere SQL.

Ojo con el orden: mientras 0093 esté aplicada y el código del corte 3 no, registrar un envío falla (INV-ENT-005). Al revertir, revertir el código del corte 3 y aplicar el `.down.sql` en la misma ventana.

Revertir el código primero: sin él, nadie lee `fsj.repartidor` ni escribe `entrega.repartidor_id`.

## Base de datos

Aplicar `prisma/rollbacks/0093_repartidores_envio.down.sql` como una migración **nueva**. Elimina la tabla `fsj.repartidor`, las columnas `repartidor_id` de `fsj.entrega` y `fsj.entrega_anulada` (con su CHECK, FK, índice y el trigger INV-ENT-005) y el permiso `repartidores.gestionar` (junto con sus asignaciones a roles).

El archivo **se niega a correr** mientras exista algún repartidor o algún envío (vigente o anulado) con repartidor: borrarlos perdería quién llevó cada envío.

## Datos

Antes de revertir, exportar `fsj.repartidor` y las columnas `entrega.repartidor_id` / `entrega_anulada.repartidor_id` si se quiere conservar ese historial. Luego, para destrabar el rollback, vaciar esas columnas y la tabla a mano (los envíos vuelven a quedar sin repartidor, que es como estaban antes de la feature). Los envíos pendientes de firma siguen siendo válidos: la máquina de estados no cambió.
