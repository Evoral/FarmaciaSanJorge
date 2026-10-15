# Costos de proveedores (reference prices for cotizaciones)

Status: approved 2026-10-15, not implemented. Rollback:
`docs/rollbacks/costos-proveedor.md`. Module: `modules/costos-proveedor`
(new). Migration: `0077_costos_proveedor` (planned).

## Goal

Today a cotización costs each línea with the `costo_unitario` of the partidas
in stock (open partidas first, then FEFO, blended). The pharmacy wants to quote
with the **reference prices of its suppliers' price lists** instead, keeping
the real purchase cost of every partida untouched.

This feature adds:

1. a store of supplier reference prices (**costos de proveedor**), versioned,
   one vigente price per (droga, proveedor);
2. a section to consult them, edit them by hand and import a supplier price
   list from a file (preview, correct, confirm);
3. a new cost source for cotizaciones and presupuestos, with an explicit
   fallback to today's partida-based costing.

## Vocabulary

- **Costo de proveedor**: the reference price a supplier quotes for a droga.
  Used only to quote. Never a purchase.
- **Costo real (de adquisición)**: `partida.costo_unitario`, what the lot
  actually cost. Unchanged by this feature.
- **Precio informado**: the price as written on the supplier's list, in its
  **unidad de precio** (e.g. $ per kg).
- **Costo unitario**: the precio informado converted to the droga's unidad
  base (e.g. $ per mg), the same convention as `partida.costo_unitario`.
- **Fecha del precio**: the date the price corresponds to (the list's date for
  an import, the date typed for a manual entry).
- **Lista de precios**: one imported file of one proveedor.
- **Fuente** of a cotización línea: `PROVEEDOR` (priced with a costo de
  proveedor) or `PARTIDAS` (today's algorithm).

## Current behaviour (audited 2026-10-15)

Kept here because the new rules are defined against it.

- The only cost source is `fsj.partida.costo_unitario`, per droga unidad base,
  net of IVA, pesos implied (no currency anywhere). Written by
  `modules/stock/application/ingresar-partida.ts#registrarPartidaCompra`
  (rounded to 6 decimals), corrected in place by `corregir-costo-partida.ts`.
- Cotización: `modules/precios/application/calcular-cotizacion.ts` →
  `cotizar-lineas.ts#cotizarLineas` →
  `cotizacion-repository.ts#getPartidasElegiblesDeDroga` (the ONLY place a
  cotización reads a cost) → `modules/precios/domain/calcular-cotizacion.ts#costearLinea`
  → `modules/stock/domain/reparto.ts#proponerReparto`.
  - Order: open partidas (`fecha_apertura` not null) oldest opened first; then
    closed ones FEFO by `fecha_vencimiento_vigente`; no expiry last. Expired
    (vigente date < jornada) and zero-saldo partidas excluded.
  - Blend: Σ cantidad × costo_unitario per partida used.
  - Insufficient stock: costs what exists, records `faltante`, sets
    `esIncompleta`. No stock: subtotal 0.
  - Ignores `ReservaStock` and `potencia_declarada`; ties have no `orderBy`.
    Not changed by this feature (see Out of scope).
- `Cotizacion` is insert-only (migration 0031); vigente = latest
  `calculada_en`; never recomputed automatically.
- Presupuesto (`modules/recetas/application/presupuestar-receta.ts`) costs
  ítems cumulatively against stock, nothing persisted.

## Rules

### Store

| # | Rule | Enforced in |
|---|---|---|
| R1 | A costo de proveedor belongs to one (droga, proveedor) of the tenant. At most **one vigente** per pair. | DB: partial unique index on `(tenant_id, droga_id, proveedor_id) WHERE vigente_hasta IS NULL`. |
| R2 | Each change inserts a **new version** and closes the previous one (`vigente_hasta` = the new one's `vigente_desde`, same instant). Nothing is ever updated except `vigente_hasta` once, and nothing is deleted. The previous version is the "valor anterior". | DB: `GRANT UPDATE (vigente_hasta)` only, validating trigger (no other column, no reopening, no second close), forbid DELETE. App: `registrarCostosProveedor`. |
| R3 | Stored per version: `precio_informado` (> 0, exact as typed), `unidad_precio_id`, `costo_unitario` (> 0, per droga unidad base), `fecha_precio`, `descripcion_proveedor` (text on the list, nullable), `lista_precio_id` (NULL = manual), `motivo` (nullable), `vigente_desde`, `vigente_hasta`, `creado_por_id`. | Migration 0077; zod in the domain. |
| R4 | `costo_unitario = precio_informado / factor(1 unidad_precio → unidad base)`, using `shared/decimal/convertir-unidad.ts` (same arithmetic as `fsj.convertir`), rounded to **10 decimals** half-up. The precio informado is kept exact so the cost can always be recomputed. | Domain `calcularCostoUnidadBase`. |
| R5 | The unidad de precio must have the **same magnitud** as the droga's unidad base and be vigente. No density conversion. | Domain validation per row. |
| R6 | Default unidad de precio by the droga's magnitud: masa → kg, volumen → L, unidad → u. Editable per row. | Domain `unidadPrecioPorDefecto`; UI. |
| R7 | Prices are **net of IVA**, in pesos, like partidas. No currency column (the whole system is pesos-only; a column with a single possible value would be misleading). | Spec; UI labels say "sin IVA". |
| R8 | `fecha_precio` can not be after the jornada actual. | Domain; DB CHECK not possible (jornada is tenant time) → app only. |
| R9 | A new version for a pair whose vigente has a **later** `fecha_precio` is refused (an older list never overwrites a newer price). | Domain `planVersionar`; re-checked inside the command after the lock. |
| R10 | Same precio informado, unidad and `fecha_precio` as the vigente → **sin cambios**, no new version. Same price with a later date → new version (the price is confirmed as of a newer date; it matters for R16 and for the antigüedad shown). | Domain `planVersionar`. |
| R11 | **Dar de baja** a costo de proveedor closes the vigente without replacement. Motivo required. | `darDeBajaCostoProveedor`. |
| R12 | No new costo for a droga or proveedor de baja. Existing ones stay as history. | Command validation. |

### Import (lista de precios)

| # | Rule | Enforced in |
|---|---|---|
| R13 | Flow: choose proveedor → fecha de la lista → file → **read** (validate, parse, match; writes nothing) → editable preview → **confirm**. Nothing is saved before the user confirms. | `leerListaPrecios` (query) + `registrarCostosProveedor` (command). |
| R14 | Accepted formats: **.xlsx** now (read with `exceljs`, already a dependency). PDF later, one parser per supplier layout, once a real sample is available. `.xls` (BIFF8) is **not** accepted: reading it needs a new dependency (the npm `xlsx` package is abandoned at 0.18.5 with known vulnerabilities); the user saves the sheet as .xlsx. | `modules/costos-proveedor/infrastructure/leer-xlsx.server.ts`; domain parsers. |
| R15 | File validation before parsing: is a `File`, not empty, ≤ 1 MiB (same limit as the PDF imports and `next.config.ts` `bodySizeLimit`), `.xlsx` mime/extension, zip signature `PK`; at most 5.000 data rows. Errors are user-readable messages, never a stack trace. | Domain `validarArchivoLista` (sibling of `shared/pdf/validar-archivo-pdf.ts`). |
| R16 | Parsing the received layout ("Lista de medicamentos", Crystal Reports export): header row `DESCRIPCION`, `PRECIO`; one data row per product. Only **base rows** (no presentation suffix) are imported, as price per kg/L/u. Rows with a presentation (`X <n>`, `Bidon X`, `Tambor X`, `Pet X`, `Cuñete X`, `Bolsa X`) are listed as **omitida (presentación)**. Blank rows, the header and page footers (`Page n of m`) are ignored. Other columns (`PRECIO mg`, `mg C/IVA`, `COSTO`) are derived spreadsheet formulas and ignored. | Domain parser `parsers/lista-xlsx-crystal.ts`. |
| R17 | Each parsed row is matched to a droga with the same rules as the invoice import: remembered synonym (`DrogaAlias`) first, then exact normalized name (`resolverDroga`, `normalizarTextoDroga` from `modules/recetas/domain/importacion-receta.ts`). No fuzzy matching, no droga is created. | `leerListaPrecios`. |
| R18 | Row states in the preview: **asociada** (will apply), **sin asociar** (no droga; omitted unless the user picks one), **duplicada** (same droga twice in the file: both rows flagged, the user must omit one), **precio inválido** (missing, ≤ 0 or not a number), **más antigua** (R9), **sin cambios** (R10), **omitida** (presentación or by the user). Each applicable row shows the current vigente price, the new one and the variation %; a variation above ±50 % is highlighted. | Domain `construirVistaPrevia`; UI. |
| R19 | In the preview the user can: pick/change the droga (Combobox), tick "recordar equivalencia" (creates a `DrogaAlias` with the list text on confirm, exactly like the invoice import), change the unidad de precio, correct the price, omit/include a row. Filters by state. | UI `importar-lista-form.tsx`. |
| R20 | Confirm is **all or nothing**: one transaction inserts the `lista_precio_proveedor`, closes and inserts the versions and creates the remembered synonyms; any invalid row rejects the whole confirmation with the row marked (`fields: ["filas.<i>.<campo>"]`), keeping every edit (`shared/ui/use-form-submit.ts`). | `registrarCostosProveedor`. |
| R21 | The same file (SHA-256 of its bytes) can not be imported twice for the same proveedor. | DB unique `(tenant_id, proveedor_id, hash_sha256)`; checked at read time to warn early. |
| R22 | A droga **absent** from an imported list keeps its vigente costo de proveedor (the list may be partial). Removing it is an explicit baja (R11). | By construction: the import only touches the rows it applies. |
| R23 | Concurrency: the preview carries, per row, the id of the vigente it compared against. On confirm, after locking the pair's vigente (`FOR UPDATE`), a different vigente rejects the confirmation ("El costo de X cambió mientras revisabas la lista. Volvé a leer el archivo."). The partial unique index is the last guard. | `registrarCostosProveedor`. |

### Manual edition

| # | Rule | Enforced in |
|---|---|---|
| R24 | A manual entry (add or change one costo) goes through the **same command and validation** as the import, with `lista_precio_id = NULL`: droga, proveedor, precio informado, unidad de precio, fecha del precio (default today), motivo (optional). | `registrarCostosProveedor` with origen MANUAL. |

### Cotización and presupuesto

| # | Rule | Enforced in |
|---|---|---|
| R25 | For each non-manual línea, if the droga has at least one **usable** costo de proveedor, the línea's fuente is `PROVEEDOR`: subtotal = cantidad requerida (the ficha's `cantidadAPesar`, converted to the droga's unidad base) × `costo_unitario`, for the **whole** quantity, whether or not there is stock. | Domain `costearLinea`. |
| R26 | Usable = vigente, proveedor not de baja. With several proveedores, the one with the **latest `fecha_precio`** wins; tie → latest `vigente_desde`. | Infrastructure query + domain `elegirCostoProveedor`. |
| R27 | A droga with no usable costo de proveedor is costed exactly as today (fuente `PARTIDAS`): open first, FEFO, blend, faltante. This is an explicit, visible fallback, never a silent 0. | Domain `costearLinea` (unchanged branch). |
| R28 | Stock is still evaluated for every línea and its `faltante` is still recorded. For a `PROVEEDOR` línea the faltante is **informational** ("sin stock suficiente para prepararla") and does **not** set `esIncompleta`: the cost is complete. `esIncompleta` keeps its meaning "some línea could not be fully costed", which now only happens on `PARTIDAS` líneas. | Domain `calcularCotizacion`. |
| R29 | Manual-enrase líneas and líneas whose unit can not be converted (different magnitud) behave as today (0, `esParcial`), whatever the fuente. | Domain (unchanged). |
| R30 | The presupuesto uses the same per-línea rule; its cumulative stock simulation only affects faltantes and `PARTIDAS` líneas. | `calcularCotizacionesAcumuladas`. |
| R31 | The tramo margin and precio mínimo apply to the resulting costo de insumos exactly as today (`docs/specs/reglas-precio.md`). | `calcularPrecioFinal` (unchanged). |
| R32 | Snapshot: each línea in `cotizacion.detalle` gets `fuente` and, for `PROVEEDOR`, `costoProveedor: { costoProveedorId, proveedorId, proveedorNombre, precioInformado, unidadPrecioSimbolo, costoUnitario, fechaPrecio }`; its `partidas` list is empty. A detalle **without** `fuente` (every cotización calculated before this feature) is read as `PARTIDAS`. No data migration. | Domain types; `get-cotizacion-item.ts`; `cotizacion-detalle.tsx`. |
| R33 | Already generated cotizaciones are **never** recalculated by this feature: they are immutable snapshots. New costs apply when a cotización is calculated (receta created/edited/imported, or "Recalcular"). | By construction (insert-only `cotizacion`). |
| R34 | Calculating a cotización never writes to `costo_proveedor`, `lista_precio_proveedor` or `partida`. Changing a costo de proveedor never writes to `partida`, `movimiento_stock` or `cotizacion`. | DB tests. |

### Permissions

| # | Rule | Enforced in |
|---|---|---|
| R35 | Consulting costos de proveedor and the imported lists: `stock.valorizado.ver` (the permiso that already gates money: comparador, valorizado, costs in the proveedor history). | Queries. |
| R36 | Importing, editing and dando de baja: new permiso **`costos.proveedor.gestionar`** (categoría `gestion`, so ADMINISTRADOR gets it automatically; other roles through the role editor). No existing permiso changes. | `PERMISO_CATALOGO`, migration 0077, `tests/db/auth-permisos.test.ts`. |
| R37 | The cotización detail shows the proveedor and price used to whoever can see the cotización (`cotizaciones.ver`), consistent with `reglas-precio.md` ("no hay ocultamiento del costo según permiso"). | — |

## Interface

Sidebar "Gestión › Costos de proveedores" (next to "Comparador de costos"),
route `/costos-proveedor`, tabs:

1. **Vigentes** (`/costos-proveedor`): droga · proveedor · precio informado
   (+ unidad) · costo por unidad base · fecha del precio (with age) · origen
   (lista / manual) · actions (editar, historial, dar de baja). Filters:
   proveedor and droga as Combobox (UI rollout rule), pagination. "Agregar
   costo" button.
2. **Importar lista** (`/costos-proveedor/importar`): R13–R23.
3. **Listas importadas** (`/costos-proveedor/listas`): proveedor, fecha de la
   lista, archivo, filas leídas / aplicadas, registered by and when.
4. **Historial** of a pair (`/costos-proveedor/historial?droga=&proveedor=`):
   every version, newest first, with precio anterior → nuevo, fecha del
   precio, origen (list name or "manual" + motivo), user, vigencia.

Every PageHeader starts with the Inicio breadcrumbs. Reuse `shared/ui`
(`combobox`, `filter-form`, `pagination`, `page-header`, `status-badge`,
`use-form-submit`, `field-errors`, `toast`) and `shared/format/monto.ts`.

Cotización detail (`modules/precios/ui/cotizacion-detalle.tsx`): a
`PROVEEDOR` línea reads "Costo de proveedor · <proveedor> · $<precio>/<unidad>
· <fecha>"; a `PARTIDAS` línea keeps today's partida breakdown, labeled "Costo
de partidas (sin costo de proveedor)". A `PROVEEDOR` línea with faltante shows
an informational "Sin stock suficiente" note. The presupuesto panel shows the
same fuente per línea.

## Data model (migration 0077)

```
fsj.lista_precio_proveedor            -- append-only (REVOKE UPDATE/DELETE, forbid_update_delete)
  id, tenant_id, proveedor_id → proveedor(tenant_id, id),
  formato ('XLSX' | 'PDF'), nombre_archivo, hash_sha256,
  fecha_lista date, filas_leidas int, filas_aplicadas int,
  registrado_por_id, registrado_en
  UNIQUE (tenant_id, proveedor_id, hash_sha256)

fsj.costo_proveedor                   -- versioned (regla_precio pattern)
  id, tenant_id,
  droga_id → droga(tenant_id, id), proveedor_id → proveedor(tenant_id, id),
  precio_informado numeric > 0, unidad_precio_id → unidad_medida(id),
  costo_unitario numeric > 0, fecha_precio date,
  descripcion_proveedor text NULL,
  lista_precio_id → lista_precio_proveedor(tenant_id, id) NULL,
  motivo text NULL,
  vigente_desde timestamptz, vigente_hasta timestamptz NULL (> vigente_desde),
  creado_por_id
  UNIQUE (tenant_id, droga_id, proveedor_id) WHERE vigente_hasta IS NULL
  INDEX (tenant_id, proveedor_id) WHERE vigente_hasta IS NULL
```

Both tables: `fsj.setup_tenant_table` (RLS + tenant policy). `costo_proveedor`:
only `GRANT UPDATE (vigente_hasta)` to `fsj_app`, trigger validating the
update (R2), forbid DELETE. Permiso row for `costos.proveedor.gestionar`.
Audit entities `costo_proveedor` and `lista_precio_proveedor` (labels in
`modules/auditoria/domain/presentacion.ts`).

## Code (planned)

- `modules/costos-proveedor/domain/`: `costo-proveedor.ts` (validation,
  `calcularCostoUnidadBase`, `unidadPrecioPorDefecto`, `planVersionar`,
  `elegirCostoProveedor`), `importacion-lista.ts` (preview types and states),
  `archivo-lista.ts` (file validation), `parsers/lista-xlsx-crystal.ts`.
- `modules/costos-proveedor/infrastructure/`: `costo-proveedor-repository.ts`,
  `leer-xlsx.server.ts`.
- `modules/costos-proveedor/application/`: `listar-costos-vigentes.ts`,
  `get-historial-costo.ts`, `listar-listas.ts`, `leer-lista-precios.ts`,
  `registrar-costos-proveedor.ts`, `dar-de-baja-costo-proveedor.ts`,
  `costos-proveedor-para-cotizar.ts` (tx-scoped read used by `precios`).
- `modules/costos-proveedor/ui/` + `app/(app)/costos-proveedor/**`.
- Edited: `modules/precios/domain/calcular-cotizacion.ts`,
  `modules/precios/application/cotizar-lineas.ts`, `calcular-cotizacion.ts`,
  `get-cotizacion-item.ts`, `modules/precios/ui/cotizacion-detalle.tsx`,
  `modules/recetas/ui/presupuesto-panel.tsx`, `app/(app)/layout.tsx`,
  `app/(app)/sidebar-nav.tsx`, `modules/auth/domain/permisos.ts`,
  `prisma/schema.prisma`, `modules/README.md`, `docs/specs/presupuesto-receta.md`,
  `docs/specs/reglas-precio.md`.

## Decisions

- **New module, not `proveedores` or `stock`.** Those own the real purchase
  cost (comparador, trayectoria, partidas). A separate module keeps reference
  prices and real costs from being mixed by accident.
- **Versioned rows instead of an updatable price.** Gives the "valor
  anterior" and the full history for free, matches `regla_precio`, and makes
  an accidental overwrite impossible at the DB level.
- **Cost stored per droga unidad base**, like partidas, so the cotización
  multiplies the same way whatever the source; the precio informado is kept
  for display and recomputation.
- **Latest `fecha_precio` wins between proveedores** (user decision
  2026-10-15). Alternatives rejected: cheapest (optimistic, rewards stale
  lists), preferred proveedor per droga (more model and data entry).
- **Fallback to partidas when there is no costo de proveedor** (user decision
  2026-10-15). Alternative rejected: leaving the línea uncosted, which would
  make most cotizaciones incomplete until every list is loaded. Side effect,
  wanted: until the first list is loaded every cotización is identical to
  today's.
- **Only base rows of the received list** (user decision 2026-10-15): in that
  list the base row's PRECIO is per kg/L, while presentation rows are
  inconsistent (some look like a price per package).
- **Net of IVA** (user decision 2026-10-15), like partidas, so the tramo
  margins keep comparing like with like.
- **No automatic recalculation of existing cotizaciones** (user decision
  2026-10-15).
- **.xlsx before PDF**: the sample received is a `.xls`, not a PDF; a PDF
  parser can not be written without the real document. `exceljs` reads .xlsx
  with no new dependency.
- **Synonyms reused for matching** (`DrogaAlias`), same as the invoice import,
  instead of a per-supplier code table: no supplier code is printed on the
  received list, and a second matching mechanism would diverge.

## Out of scope

- Reservas and potencia in the cotización (current divergence from the real
  consumption, documented above).
- Deterministic tie-break in `getPartidasElegiblesDeDroga`.
- `app/(app)/partidas/[id]/page.tsx` shows the raw partida cost with
  `stock.ver` while every other cost view needs `stock.valorizado.ver`.
- A "costo de lista vigente" column in the comparador de costos (stage E6,
  to decide).
- The stale comment in `corregir-costo-partida.ts` ("not referenced by any
  historical snapshot": `cotizacion.detalle` does store it).

## Test cases

- **CP1** precio 40.898 $/kg, droga in mg → costo_unitario 0,040898 $/mg; in g → 40,898 $/g.
- **CP2** unidad de precio of another magnitud → rejected.
- **CP3** precio 0, negative, empty or not a number → precio inválido.
- **CP4** new price for a pair → previous vigente closed at the same instant, one vigente left.
- **CP5** older `fecha_precio` than the vigente → refused (más antigua).
- **CP6** same price and date → sin cambios; same price, later date → new version.
- **CP7** same droga twice in a file → both duplicada, confirm refused until one is omitted.
- **CP8** one invalid row at confirm → nothing written (no lista, no versions, no synonyms).
- **CP9** same file twice → refused.
- **CP10** vigente changed between read and confirm → confirm refused.
- **CP11** parser: presentation rows omitted, header/footer/blank rows ignored, "Sicotrop L4"/"Sedronar L2" kept in the description, numbers given as text parsed.
- **CP12** cotización with costo de proveedor → whole quantity × costo, fuente PROVEEDOR, no `esIncompleta` even without stock, faltante informational.
- **CP13** cotización without costo de proveedor → identical result to today (every existing test unchanged).
- **CP14** two proveedores → latest `fecha_precio` used; proveedor de baja ignored.
- **CP15** receta with mixed fuentes → costo de insumos = sum, tramo applied once per ítem.
- **CP16** old detalle without `fuente` → rendered as PARTIDAS.
- **CP17** DB: one vigente per pair, UPDATE only `vigente_hasta` once, DELETE refused, RLS isolates tenants.
- **CP18** DB: importing/editing costs leaves `partida` and `movimiento_stock` unchanged; calculating a cotización writes nothing in the new tables.
- **CP19** permissions: read with `stock.valorizado.ver`, write with `costos.proveedor.gestionar`, denied otherwise.

## Open

- PDF parser: needs a real PDF of the supplier list.
- Which proveedor (razón social, CUIT) the received list belongs to.
- Whether to warn in the cotización when the costo de proveedor used is older
  than N days (no rule defined; today only its date is shown).
