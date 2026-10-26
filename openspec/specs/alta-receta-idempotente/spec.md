# Alta de receta idempotente

## Purpose

If the response to a manual alta is lost (network cut, timeout) and the user saves again, a second receta is
created for the same prescription. This capability makes the manual alta idempotent. Origin: security audit,
finding P3-09.

## Requirements

### Requirement: R1 — One envioId per form instance

The manual alta form (`modules/recetas/ui/receta-form.tsx`, mode `crear`) SHALL send an `envioId` (random UUID)
generated once per form instance. It is kept across error retries and renewed after a success.

#### Scenario: Retry after an error

- **GIVEN** a manual alta that failed with an error
- **WHEN** the user saves again from the same form
- **THEN** the form sends the same `envioId`

#### Scenario: After a success

- **WHEN** a manual alta succeeds
- **THEN** the form renews its `envioId`

### Requirement: R2 — A repeated envioId creates nothing

`crearReceta` SHALL look up a receta of the tenant with that `envioId`. If one exists it writes nothing and throws
`RecetaYaRegistradaError`; the action answers success ("La receta ya estaba registrada.") and redirects to that
receta, completing its fichas/cotizaciones if they are missing (`soloSiDesactualizadas: true`).

#### Scenario: Response lost, user saves again

- **GIVEN** a receta of the tenant already created with `envioId` X
- **WHEN** the alta is submitted again with `envioId` X
- **THEN** no second receta is written
- **AND** the user sees "La receta ya estaba registrada." and is redirected to the existing receta
- **AND** its fichas/cotizaciones are completed if they are missing

### Requirement: R3 — Unique index per tenant

`fsj.receta.envio_id` MUST have a partial unique index per tenant (`uq_receta_envio`), so two concurrent submits
that both miss the lookup can not both commit.

#### Scenario: Two concurrent submits

- **GIVEN** two submits with the same `envioId` that both miss the lookup
- **WHEN** both try to commit
- **THEN** they can not both commit

### Requirement: R4 — Edit and imports do not use envio_id

The edit SHALL never send nor change `envio_id`. Imported recetas (PDF/QR) leave it NULL: they already dedupe by
`emisor` + `nro_receta_emisor`.

#### Scenario: Editing a receta

- **WHEN** a receta is edited
- **THEN** its `envio_id` is neither sent nor changed

#### Scenario: Imported receta

- **WHEN** a receta is imported from a PDF or a QR
- **THEN** its `envio_id` is NULL
- **AND** duplicates are detected by `emisor` + `nro_receta_emisor`

### Requirement: R5 — Existencia inicial needs no key

The existencia inicial MUST NOT need an idempotency key: a repeated lote is rejected by `partida_lote_unico` /
`uq_partida_lote_sin_proveedor`.

#### Scenario: Repeated lote

- **WHEN** the same lote is loaded twice in the existencia inicial
- **THEN** the second one is rejected by `partida_lote_unico` / `uq_partida_lote_sin_proveedor`

## Status

Implemented (migration 0102). Rollback: `docs/rollbacks/alta-receta-idempotente.md`.
