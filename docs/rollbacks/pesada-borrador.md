# Rollback: pesada en la ficha (pesada en borrador)

Spec: `docs/specs/pesada-real.md` P8-P12. Migration 0090.

## What it added

| File | What |
|---|---|
| `prisma/migrations/20261019150000_0090_pesada_borrador/migration.sql` | Table `fsj.pesada_borrador` (one draft per línea de pesaje: lots, typed quantities) |
| `prisma/rollbacks/0090_pesada_borrador.down.sql` | Drops the table |
| `prisma/migrations/20261019170000_0091_pesada_borrador_update/migration.sql` | `GRANT UPDATE` on the draft's fields to `fsj_app` (the save is an upsert; 0090 forgot it) |
| `prisma/rollbacks/0091_pesada_borrador_update.down.sql` | Revokes it |
| `prisma/schema.prisma` | `model PesadaBorrador` |

### New files (delete on rollback)
- `modules/preparaciones/application/guardar-borrador-pesada.ts`
- `modules/preparaciones/ui/pesaje-en-toma.tsx`

### Changed code
- `modules/preparaciones/infrastructure/preparacion-repository.ts`: `getBorradoresDeFicha`, `getLineaParaBorrador`, `getDrogaDePartidas`, `upsertBorradorPesada`.
- `modules/preparaciones/application/get-confirmacion-de-ficha.ts`: the draft as each línea's `reserva`.
- `modules/preparaciones/ui/actions.ts`: `guardarBorradorPesadaAction`.
- `modules/preparaciones/ui/confirmar-form.tsx`: plan/tolerance helpers exported.
- `modules/preparaciones/ui/lineas-ficha-tabla.tsx`: `conExceso` (exceso column hidden when unused), shared pieces exported.
- `app/(app)/preparaciones/recetas/[recetaId]/page.tsx`: loads the data per Pendiente ítem, renders the pesada en la ficha.

## How to revert

1. Revert the code (the commit): "Marcar como preparada" opens the full dialog again.
2. Apply `prisma/rollbacks/0090_pesada_borrador.down.sql` as a NEW forward migration, in the same deploy (it drops the table, so 0091's grant goes with it).
3. `npm run db:generate`.

Nothing else references the drafts: reservas already made keep their own data in `reserva_stock`. Drafts not yet
reserved are lost (the lab re-enters them in the dialog).
