# Rollback — Envíos con repartidor (migración 0093)

Spec: `docs/specs/envios-repartidores.md`.

## Código

Revertir los commits de la feature. Los cortes ya implementados tocan (los siguientes cortes agregan sus archivos aquí):

- Corte 1 (migración): `prisma/migrations/20261020120000_0093_repartidores_envio/migration.sql`, `prisma/schema.prisma` (modelo `Repartidor`, `Entrega.repartidorId`, `EntregaAnulada.repartidorId`), `modules/auth/domain/permisos.ts` (`repartidores.gestionar`), `shared/errors/mensajes-invariantes.ts` (INV-ENT-005).
- Corte 2 (catálogo): `modules/repartidores/**` (nuevo), `app/(app)/catalogos/repartidores/**` (nuevo), `app/(app)/nav-sections.ts` (entrada "Repartidores"), `modules/README.md`, `modules/usuarios/domain/roles.ts` (etiqueta del grupo), `modules/auditoria/domain/presentacion.ts` (entidad `repartidor`), `shared/labels/field-labels.ts` (`soloActivos`), `tests/unit/repartidores-*.test.ts`.

Ojo con el orden: mientras 0093 esté aplicada y el código del corte 3 no, registrar un envío falla (INV-ENT-005). Al revertir, revertir el código del corte 3 y aplicar el `.down.sql` en la misma ventana.

Revertir el código primero: sin él, nadie lee `fsj.repartidor` ni escribe `entrega.repartidor_id`.

## Base de datos

Aplicar `prisma/rollbacks/0093_repartidores_envio.down.sql` como una migración **nueva**. Elimina la tabla `fsj.repartidor`, las columnas `repartidor_id` de `fsj.entrega` y `fsj.entrega_anulada` (con su CHECK, FK, índice y el trigger INV-ENT-005) y el permiso `repartidores.gestionar` (junto con sus asignaciones a roles).

El archivo **se niega a correr** mientras exista algún repartidor o algún envío (vigente o anulado) con repartidor: borrarlos perdería quién llevó cada envío.

## Datos

Antes de revertir, exportar `fsj.repartidor` y las columnas `entrega.repartidor_id` / `entrega_anulada.repartidor_id` si se quiere conservar ese historial. Luego, para destrabar el rollback, vaciar esas columnas y la tabla a mano (los envíos vuelven a quedar sin repartidor, que es como estaban antes de la feature). Los envíos pendientes de firma siguen siendo válidos: la máquina de estados no cambió.
