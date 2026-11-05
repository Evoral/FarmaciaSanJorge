# Rollback: Sugerir lote diluido en droga

The feature adds a `sugerir_dilucion` boolean column to `fsj.droga` (default `false`), exposes it as a switch "Sugerir siempre un lote diluido" in the droga catalog (alta and edición), and suggests a diluted lot or creating a dilución during pesaje (confirmation form and toma workspace) for non-manual líneas whose dose is not below the balance division.

The feature has a **schema change** (migration `prisma/migrations/20261104140000_0120_droga_sugerir_dilucion`), so it is reverted as code + a new forward migration built from `prisma/rollbacks/0120_droga_sugerir_dilucion.down.sql`.

## What the down migration loses

- Drops the `sugerir_dilucion` column on `fsj.droga`. The configuration of which drogas had the switch enabled is lost. Past audit rows (`fsj.registro_auditoria`) retain the previous values in their historical diffs.

## Order

1. Deploy the reverted code **first**: the application stops selecting and updating `sugerirDilucion`, and stops suggesting diluted lots above the balance, running safely against the 0120 schema.
2. Copy `prisma/rollbacks/0120_droga_sugerir_dilucion.down.sql` into a NEW migration folder (next free number, a timestamp later than every existing one) and apply it forward. Never edit or delete the applied 0120 migration.
3. Regenerate Prisma client (`npm run db:generate`).
4. `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `prisma/rollbacks/0120_droga_sugerir_dilucion.down.sql` and this file (optional)
- `prisma/migrations/20261104140000_0120_droga_sugerir_dilucion/` (keep once applied)

## Edited files (revert the sugerir dilución hunks)

- `prisma/schema.prisma`: remove `sugerirDilucion` from model `Droga`.
- `modules/drogas/**`:
  - `modules/drogas/application/crear-droga.ts`: remove `sugerirDilucion` from `crearDrogaInput`, `CrearDrogaInput`, `insertDroga` call, and audit diff.
  - `modules/drogas/application/editar-droga.ts`: remove `sugerirDilucion` from `editarDrogaInput`, `EditarDrogaInput`, `updateDrogaDatos` call, and audit diff.
  - `modules/drogas/infrastructure/droga-repository.ts`: remove `sugerirDilucion` from the select of `getDrogaParaAccion`, `DrogaParaAccion`, `NuevaDrogaInput`, `insertDroga`, `EditarDrogaInput` (the one in droga-repository.ts), and `updateDrogaDatos`.
  - `modules/drogas/ui/actions.ts`: remove `sugerirDilucion` from `crearDrogaAction` and `editarDrogaAction`.
  - `modules/drogas/ui/droga-form.tsx`: remove `sugerirDilucion` from `DrogaFormProps["droga"]`, hidden input `sugerirDilucionEnviado`, and the switch "Sugerir siempre un lote diluido".
  - (Note: the "tiene fórmula" switch in `modules/drogas/ui/formula-editor.tsx` is UI only and may stay).
- `modules/preparaciones/**`:
  - `modules/preparaciones/infrastructure/preparacion-repository.ts`: remove `sugerirDilucion` from `LineaParaPantalla` and the droga query in `getLineasParaPreparacion`.
  - `modules/preparaciones/ui/confirmar-form.tsx`: remove `sugerirDilucion` from `PesadaDeLinea`, remove its calculation in `pesadaDeLinea`, and revert `AvisoBajoLaBalanza` condition back to `pesadas[indice]?.bajoLaBalanza` (removing the `sugerencia` prop).
  - `modules/preparaciones/ui/aviso-bajo-la-balanza.tsx`: remove `sugerencia` prop from `AvisoBajoLaBalanzaProps` and `AvisoBajoLaBalanza`, reverting alert styling and text back to warning only.
  - `modules/preparaciones/ui/pesaje-en-toma.tsx`: revert `AvisoBajoLaBalanza` condition back to `pesada?.bajoLaBalanza` (removing the `sugerencia` prop).
- Specs:
  - `openspec/changes/lotes-elaborados/specs/pesada-real/spec.md`: remove Requirement P14 ("Droga that always suggests a diluted lot") and its scenarios.
  - `openspec/changes/lotes-elaborados/specs/elaboracion-lote/spec.md`: revert the switch mention in Requirement EL3 ("Fórmula").
