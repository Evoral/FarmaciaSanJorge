## MODIFIED Requirements

### Requirement: E7 — No línea de pesaje

The excipiente SHALL have **no línea de pesaje**: fichas are immutable and the prescription is not altered, so its
reserva and egreso have `linea_pesaje_id` NULL -- allowed by the DB ONLY for the preparación's excipiente (the
partida's droga = `preparacion.excipiente_droga_id`, a droga of clase EXCIPIENTE) or one of its insumos (migration
0110, `openspec/specs/insumos-preparacion/spec.md` I10). A droga is never both, so the excipiente's línea-less rows
are the ones of its droga.

#### Scenario: Excipiente reserva

- **WHEN** the excipiente is reserved and consumed
- **THEN** its reserva and egreso have `linea_pesaje_id` NULL and the ficha is not changed

#### Scenario: Another droga without a línea

- **WHEN** a reserva or egreso with `linea_pesaje_id` NULL is written for a partida whose droga is neither the preparación's `excipiente_droga_id` nor one of its insumos
- **THEN** the DB refuses it
