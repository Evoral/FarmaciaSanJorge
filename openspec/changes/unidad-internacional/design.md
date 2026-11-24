# Design: Unidades internacionales (U.I.)

Decisions referenced as D1..D8 are the user decisions in `proposal.md`.

## 1. Core idea

The U.I. → grams step already has a home: **the purity correction per partida** (`modules/preparaciones/domain/potencia.ts`,
migration 0058). The ficha stores the ACTIVE requirement (`linea_pesaje.cantidad_a_pesar`); the split converts it to
PHYSICAL weight per lot. Today the active is mass and the lot's factor is a percentage. This change generalizes the
factor: a lot declares either a percentage (mass/mass) or an activity (U.I. per gram). The ficha does not change its
nature, and no new mechanism is introduced.

The ficha can never hold the grams of a U.I. line: it is generated before any lot is chosen, and two lots of the same
droga can carry different U.I./g (precedent: migration 0059 dropped a droga-level purity flag because purity belongs
to the LOT).

## 2. Schema

### 0132 — `tipo_magnitud` ACTIVIDAD

```sql
ALTER TYPE fsj.tipo_magnitud ADD VALUE IF NOT EXISTS 'ACTIVIDAD';
```

Alone in its migration: Postgres does not allow using an enum value in the transaction that added it. Rollback: an
enum value cannot be dropped; the `.down.sql` documents that the value stays and is harmless once no row uses it
(guard: refuse if `unidad_medida` still has an `ACTIVIDAD` row).

### 0133 — unidad, droga, partida, movimiento, INV-S12

- **Seed** (global catalog, no tenant): `UNIDAD_INTERNACIONAL`, nombre `Unidad internacional`, símbolo `U.I.`,
  `ACTIVIDAD`, `factor_a_base` 1, `es_base` true. `ON CONFLICT (codigo) DO NOTHING`. Not a per-tenant seed, so
  `fsj.crear_tenant_interno` is not involved.
- **`fsj.droga.se_dosifica_en_ui boolean NOT NULL DEFAULT false`** (D2). `GRANT UPDATE (se_dosifica_en_ui)` to `fsj_app`.
  CHECK: only `clase = 'DROGA'`. CHECK via trigger: the droga's `unidad_base` is of magnitude `MASA` (the U.I./g factor is
  per gram). Unsetting it is refused while a partida of the droga has `actividad_declarada IS NOT NULL AND
  cantidad_disponible > 0`.
- **`fsj.partida.actividad_declarada numeric NULL`** — U.I. per GRAM of physical lot (D4).
  - `CHECK (actividad_declarada IS NULL OR actividad_declarada > 0)`.
  - `CHECK (actividad_declarada IS NULL OR potencia_declarada IS NULL)`: a lot is either % or U.I., never both.
  - Trigger BEFORE INSERT/UPDATE: `actividad_declarada IS NOT NULL` requires `droga.se_dosifica_en_ui`.
  - `GRANT UPDATE (actividad_declarada)` to `fsj_app` (for "Corregir pureza", like 0111 did for `potencia_declarada`).
    The UPDATE path refuses going NULL ↔ NOT NULL (the kind of a lot never changes, D4).
- **`fsj.movimiento_stock.actividad_aplicada numeric NULL`** — snapshot of the U.I./g used by an EGRESO_PREPARACION
  (sibling of `potencia_aplicada`). `CHECK (actividad_aplicada IS NULL OR potencia_aplicada IS NULL)`.
- **`equivalencia_manual boolean NOT NULL DEFAULT false`** on `fsj.reserva_stock` and `fsj.movimiento_stock` (D5/D6).
  It marks a línea that is NOT `es_enrase_manual` in the ficha but is weighed as a cantidad manual because no
  convertible lot exists. The reserva reuses `cantidad_manual` (today: enrase manual only) for the typed quantity.
- **INV-S12** — `CREATE OR REPLACE fsj.linea_pesaje_validar_consumo`, starting from its **latest** definition
  (migration 0088; do not start from 0060 or 0073). 0088 added: a non-manual línea with a `pesada_real` row consumes
  exactly that PHYSICAL `cantidad_real`, converted from the línea's unit to the droga's. For an ACTIVIDAD línea that
  conversion is impossible: its `cantidad_real` is already in the droga's unidad base (see Preparaciones) and is
  compared as is. Then:
  - A línea is consumed manually when `es_enrase_manual` OR its EGRESO_PREPARACION movements have
    `equivalencia_manual = true`; mixed true/false movements on one línea are refused. Manual → positive physical sum.
  - A línea in `ACTIVIDAD`: active sum = `Σ cantidad_en_gramos × actividad_aplicada` (convert the movement's quantity
    from the droga's unidad base to GRAMO). It must cover `cantidad_a_pesar` (U.I.), overshooting by less than
    `0.0001 g × max(actividad_aplicada)`: the app rounds the physical weight UP to `DECIMALES_PESO_FISICO` (4) decimals,
    so the U.I. overshoot scales with the lot's activity. If that rounding changes, change both.
  - Every other línea: unchanged.

Every new column is on an existing table: RLS and policies are already in place. No new FK, so
`tests/db/catalogo-guardas.test.ts` needs no exception. No SECURITY DEFINER function is added.

## 3. Domain and application

### Catalog and conversion
- `shared/decimal/convertir-unidad.ts`: unchanged (it already refuses cross-magnitude, INV-M01).
- Every TS union `TipoMagnitud` (`modules/elaboracion/domain/calcular-ficha-tecnica.ts:28` and siblings) adds
  `"ACTIVIDAD"`; `unidadesBase` resolves `ACTIVIDAD` → U.I.

### Drogas (`modules/drogas`)
- The alta and edit forms (one shared component) offer "Se dosifica en U.I." for clase DROGA.

### Recetas (`modules/recetas`)
- A componente in U.I. requires `droga.se_dosifica_en_ui` (zod refine in the use case + domain check in `receta.ts`).
- Allowed modes: TOTAL, POR_DOSIS, CONCENTRACION with a referencia ("10.000 U.I./g"). U.I. as a percentage (no
  referencia) is refused: `problemaConcentracion` already returns `PORCENTAJE_SIN_MAGNITUD` as long as
  `MAGNITUDES_CONCENTRACION` does not include `ACTIVIDAD` — keep it that way. CS/CSP in U.I. are refused.
- Receta imports (PDF/QR): map "UI", "U.I.", "UI." to `UNIDAD_INTERNACIONAL` where the unit symbols are mapped.

### Ficha técnica (`modules/elaboracion`)
- A U.I. componente produces a línea in U.I. (`cantidad_a_pesar` in U.I., exceso applied as today).
- CSP: an `ACTIVIDAD` component differs in magnitude from a MASA/VOLUMEN total → R4 already makes the CSP an enrase
  manual; in cápsulas R5 already does. No code change, scenarios added (D7).

### Stock (`modules/stock`)
- Domain value object (e.g. `domain/actividad.ts`, pure): parse "X U.I. cada Y <unidad de masa>" → U.I. per gram with
  `decimal.js`; also accepts "Y g cada X U.I.". Rejects non-positive values.
- Every path that creates a partida offers the choice "en gramos (pureza %)" / "en U.I." for a marked droga:
  `ingresar-partida`, `importar-factura-compra`, existencia inicial (`guardar-fila-relevamiento`,
  `importar-planilla-excel`, `pasar-grupo-a-stock`), `elaborar-lote`.
- `elaborar-lote` DILUCION of a U.I. lot: `actividad = actividad_origen × masa_origen / masa_total`, mirroring how
  `modules/stock/domain/elaboracion-lote.ts` computes the diluted lot's potencia (verify the exact formula there).
- `corregir-potencia-partida`: corrects `actividad_declarada` for a U.I. lot with the same guards (permission
  `stock.partida.potencia.corregir`, motivo, no active reserva, audit old/new). The panel shows % or U.I./g per lot.

### Preparaciones (`modules/preparaciones`)
- `potencia.ts`: the factor becomes a tagged type
  `{ tipo: "PORCENTAJE"; valor } | { tipo: "ACTIVIDAD"; uiPorGramo }`.
  `fisicoParaActivo` for ACTIVIDAD: `ui / uiPorGramo` grams → droga's unidad base, rounded UP to
  `DECIMALES_PESO_FISICO`; `activoDesdeFisico` the inverse. The % path is unchanged.
- `reparto-linea.ts` and its callers (`planificarConsumoEnTx`, `construirDatosConfirmacion`, the toma): today the caller
  converts the línea's requirement to the droga's unidad base with `convertirCantidad`, which **throws** for
  ACTIVIDAD → MASA. For an ACTIVIDAD línea the requirement stays in U.I. and only U.I. partidas are candidates; for a
  MASA/VOLUMEN línea only non-U.I. partidas are candidates.
- Fallback (D5/D6), only for a droga with `se_dosifica_en_ui`: no compatible partida → the línea is offered as
  cantidad manual; compatible but not enough → faltante as today, with the option to switch the whole línea to
  cantidad manual. A cantidad manual línea behaves like an enrase manual línea (typed physical quantity, no
  correction, `potencia_aplicada` and `actividad_aplicada` NULL) plus `equivalencia_manual = true`, and is
  highlighted in the reserva, toma, confirmation and preparación detail.
- `pesada-real.ts`: `precisionDeLinea` returns `null` for non-MASA. An ACTIVIDAD línea is weighed in grams: its
  precision comes from the droga's unidad base. `reserva_stock.cantidad_real` for an ACTIVIDAD línea is in the
  droga's unidad base (document it at the column; check every reader).
- Excipiente: no calculation change (D7). The preparación shows "El peso de <droga> (U.I.) no está descontado del
  excipiente" when `pesoDeDrogas` is `null` because of an ACTIVIDAD línea.

### Precios (`modules/precios`)
- `calcular-cotizacion.ts:263` converts the línea to the stock unit and would throw for ACTIVIDAD. For an ACTIVIDAD
  línea: estimate the grams with the first U.I. partida in FEFO order (`fisicoParaActivo`) and cost them; no U.I.
  partida → the línea is `sinPrecio` (existing R27 path). Agent decision (follows the existing pattern); the user may
  override it during review.

### Etiqueta and libro recetario
- No code change (D8). The Rp/ and the asiento's fórmula read the receta's componentes. `formatNumero` prints
  "50.000 U.I.".

## 4. Shared sessions

`corregir-potencia-partida` is already wrapped as its permission requires; nothing new is listed in
`PERMISOS_CON_PIN_*`. The droga marca uses the droga edit permission.

## 5. Risks

- INV-S12 is a deferred constraint trigger on every confirmation: a mistake blocks every preparación. Cover it with
  DB tests (`tests/db`) for %, U.I., enrase manual and equivalencia manual.
- `cantidad_real` semantics change for ACTIVIDAD líneas only: a reader that assumes "the línea's unit" breaks.
- The open change `corregir-potencia-partida` (implemented, not archived) is extended here: archive it first or in the
  same pass, so the deltas do not collide.
