# Rollback — Numeración inicial del libro (migration 0097)

Spec: `docs/specs/libro-recetario-y-contralor.md` §3 "Numeración inicial".

## Before you start

The DB rollback is **refused while any libro has `numero_inicial <> 1`**. The restored `fsj.verificar_cadena` counts
every chain from 1, so a libro that continues the physical book would show up as broken at Nº 1. If a tenant already
uses a different first number, don't roll back. Fix forward instead.

## Steps

1. Revert the code (one commit):
   - `modules/libro/{domain/numeracion.ts, infrastructure/numeracion-repository.ts, application/list-numeracion-libros.ts, application/configurar-numeracion-libro.ts, ui/configurar-numeracion-form.tsx}`
   - `configurarNumeracionLibroAction` in `modules/libro/ui/actions.ts`, the "Numeración" tab in `modules/libro/ui/libro-nav.tsx`, `MENSAJES_INVARIANTES_NUMERACION`
   - `app/(app)/libro/numeracion/page.tsx`
   - `modules/cierres/{domain/numeracion.ts, application/list-numeracion-por-fijar.ts}`, `listLibrosPorFijarNumeracion` in `cierre-repository.ts`, the confirmation in `firmar-cierre.ts`, `ui/actions.ts`, `ui/firmar-form.tsx` and `app/(app)/cierres/page.tsx`
   - The `INV-L26` entry in `shared/errors/mensajes-invariantes.ts`, `libro_rubricado` in `modules/auditoria/domain/presentacion.ts`, the two fields in `prisma/schema.prisma`, and the two test mocks of `listLibrosPorFijarNumeracion`
2. Apply `prisma/rollbacks/0097_libro_numeracion_inicial.down.sql` as a **new forward migration**. It restores the
   bodies of `libro_rubricado_validar_update` (0018), `asiento_recetario_validar_update` (0082),
   `asiento_contralor_validar_update` (0014), `cierre_diario_firmar` (0075) and `verificar_cadena` (0087), drops
   `fsj.libro_configurar_numeracion` and the columns `numero_inicial` and `numeracion_fijada_cierre_id`.
3. Restore the spec paragraph to "arranca en 1".

## What stays

The audit records (`entidad = libro_rubricado`) of every change of numbering, and the `numeracionFijada` field in the
audit of the cierre that fixed each libro.
