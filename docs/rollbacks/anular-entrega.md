# Rollback — Anular entrega (migración 0086)

Spec: `docs/specs/anular-entrega.md`.

## Código

Revertir el commit de la feature. Toca:

- `modules/entregas/application/anular-entrega.ts` (nuevo), `modules/entregas/domain/entrega.ts` (`puedeAnularEntrega`, `validarAnularEntrega`), `modules/entregas/infrastructure/entrega-repository.ts` (`moverEntregaAAnuladas`, `desmarcarRecetaPagada`, `recetaEstaArchivada`).
- `modules/entregas/ui/actions.ts` (`anularEntregaAction`), `modules/entregas/ui/anular-entrega-form.tsx` (nuevo).
- `app/(app)/recetas/[id]/page.tsx` (panel "Entrega") y `RecetaDetalle.archivada` en `modules/recetas/infrastructure/receta-repository.ts`.
- `prisma/schema.prisma` (modelo `EntregaAnulada`).

Revertir el código primero: sin él, nadie llama a la transición hacia atrás.

## Base de datos

Aplicar `prisma/rollbacks/0086_anular_entrega.down.sql` como una migración **nueva**. Restaura el INV-R08 de 0061 (`ENTREGADA` vuelve a ser terminal), el `trg_entrega_forbid_delete` de 0016 y revoca el DELETE sobre `fsj.entrega`.

`fsj.entrega_anulada` **se conserva** a propósito: es el único registro de las entregas ya anuladas. Si de verdad hay que borrarla, hacerlo en una migración aparte, después de exportarla.

## Datos

Las recetas cuya entrega ya se anuló quedan como están (`PREPARADA`, o entregadas de nuevo). No hay nada que deshacer en ellas.
