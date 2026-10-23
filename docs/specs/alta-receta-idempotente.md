# Alta de receta idempotente

Status: implemented (migration 0102). Origin: security audit, finding P3-09.

## Problem

If the response to a manual alta is lost (network cut, timeout) and the user
saves again, a second receta is created for the same prescription.

## Rules

- **R1.** The manual alta form (`modules/recetas/ui/receta-form.tsx`, mode `crear`)
  sends an `envioId` (random UUID) generated once per form instance. It is kept
  across error retries and renewed after a success.
- **R2.** `crearReceta` looks up a receta of the tenant with that `envioId`. If one
  exists it writes nothing and throws `RecetaYaRegistradaError`; the action answers
  success ("La receta ya estaba registrada.") and redirects to that receta, completing
  its fichas/cotizaciones if they are missing (`soloSiDesactualizadas: true`).
- **R3.** `fsj.receta.envio_id` has a partial unique index per tenant
  (`uq_receta_envio`): two concurrent submits that both miss the lookup cannot both commit.
- **R4.** The edit never sends nor changes `envio_id`. Imported recetas (PDF/QR) leave it
  NULL: they already dedupe by `emisor` + `nro_receta_emisor`.
- **R5.** The existencia inicial needs no key: a repeated lote is rejected by
  `partida_lote_unico` / `uq_partida_lote_sin_proveedor`.

Rollback: `docs/rollbacks/alta-receta-idempotente.md`.
