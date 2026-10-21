# Rollback: Etiquetas sobre hoja (posición en la hoja)

Spec: `docs/specs/hoja-etiquetas.md`. The feature has a **schema change**
(migration `prisma/migrations/20261021120000_0096_etiqueta_hoja`), so it is
reverted as code + a new forward migration built from
`prisma/rollbacks/0096_etiqueta_hoja.down.sql`.

## What the down migration loses

- The configured sheet (`fsj.etiqueta_hoja`: ancho, alto, margen) of every
  farmacia. Re-applying 0096 seeds A4 / 5 mm again.
- Nothing else: no position is ever persisted (spec non-goals), and the
  `etiqueta_tamano` rows (0066) are not touched.

## Order

1. Deploy the reverted code **first**: the old PDF route renders on a page of the
   chosen size and ignores `columna` / `fila`, and the old dialogs never read the sheet.
2. Copy `prisma/rollbacks/0096_etiqueta_hoja.down.sql` into a NEW migration and apply it.

## Code

Revert the commits of the feature. They touch `modules/etiqueta-tamanos` (sheet
domain, repository, use cases, admin panel, fit checks in crear / editar /
reactivar), `modules/preparaciones` (`etiqueta-pdf.ts`, `imprimir-etiqueta-pdf.ts`,
`hrefEtiquetaPdf`, the position picker and both print dialogs), the PDF route,
the three pages that render the dialogs, the admin Etiquetas page and
`scripts/create-tenant.ts`.

## After the rollback

The PDF is the etiqueta itself again (page = chosen size, or 100 × 42 mm when a
link names no size). Sizes that only made sense on a sheet are still valid sizes.
