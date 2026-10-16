# Rollback — Un asiento por receta (D8, migración 0082)

Spec: `docs/specs/libro-recetario-y-contralor.md` §1 D8.

## Antes de que exista algún asiento por receta

1. Desplegar el código anterior (un asiento por ítem: `confirmarPreparacionEnTx` inserta su propio asiento con `preparacion_id`).
2. Aplicar `prisma/rollbacks/0082_asiento_por_receta.down.sql` como migración nueva. Restaura los cuerpos de 0014/0034/0050 y borra `receta_id`, `fsj.asiento_preparacion`, la vista `fsj.v_asiento_sistema_preparacion`, el hash V4 e INV-L24/L25.
3. Revertir `prisma/schema.prisma` y regenerar el cliente.

El orden importa: con el código viejo y la migración aplicada, toda confirmación falla (INV-L07 rechaza `preparacion_id`).

## Después de que exista algún asiento por receta

**No hay rollback completo.** Los asientos `version_hash = 4` son parte del libro legal: inmutables, encadenados y quizá ya firmados en un cierre. El modelo previo no puede representarlos (el CHECK INV-L07 viejo los rechaza y `fsj.verificar_cadena` no podría recalcular su hash). El `.down.sql` se niega a correr en ese caso.

Opción segura: corrección hacia adelante en la aplicación, manteniendo la migración 0082.
