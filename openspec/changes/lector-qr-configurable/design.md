# Design: configurable QR reader mode

Decision and scope: `proposal.md`. Behavior: `specs/importacion-receta-qr/spec.md` (delta).

## Model

```
modo efectivo = modo del equipo (browser)  ?? modo de la farmacia (fsj.parametro)  ?? CAMARA
```

- `ModoLectorQr = "CAMARA" | "LECTOR"`, `MODO_LECTOR_QR_POR_DEFECTO = "CAMARA"`.
- The equipo value is `"FARMACIA" | ModoLectorQr`; `"FARMACIA"` (or nothing stored) means "follow the farmacia".
- Any unknown stored value, on either level, is ignored (treated as absent). A pure resolver does this.

The mode is presentation only. The server never reads the equipo value and does not check the mode when reading a
QR: `leerRecetaQrAction` is unchanged. Hiding the camera button is not a security control.

## Domain (pure)

New `modules/recetas/domain/modo-lector-qr.ts`:

- `MODOS_LECTOR_QR`, `ModoLectorQr`, `MODO_LECTOR_QR_POR_DEFECTO`, Spanish labels ("Cámara", "Lector USB").
- `parseModoLectorQr(valor: string | null | undefined): ModoLectorQr | null`.
- `resolverModoLectorQr({ farmacia, equipo }): ModoLectorQr`, the rule above.

`modules/parametros/domain/parametros-registry.ts` imports the modes from there, the same way it already imports
constants from `costos-proveedor`, `entregas`, `preparaciones` and `stock` domains.

## Farmacia level: `fsj.parametro`

- Key `lector_qr_receta`, `tipo = 'TEXTO'` (the enum already has it), value `CAMARA` | `LECTOR`.
- **Migration** `0114_parametro_lector_qr_receta`: `INSERT ... SELECT FROM fsj.tenant ... ON CONFLICT DO NOTHING`
  with `CAMARA`, same shape as section 3 of 0107. Needed because `fsj_app` only has `UPDATE (valor, descripcion,
  actualizado_en)` on `fsj.parametro`: the app cannot create the row. No schema change, no new grant.
- **Rollback** `prisma/rollbacks/0114_parametro_lector_qr_receta.down.sql`: `DELETE FROM fsj.parametro WHERE clave =
  'lector_qr_receta'`. Plus `docs/rollbacks/lector-qr-configurable.md` (code first, then the `.down.sql`; with the
  code reverted nothing reads the row).
- `scripts/create-tenant.ts` seeds the row for new tenants (next to `alicuota_iva_porcentaje`).

### Registry: an "opción" parameter

Today every entry is `tipo: "NUMERO"` and `validar` returns a `Decimal`.

- `ParametroDefinicion.tipo` becomes `"NUMERO" | "OPCION"`; an `OPCION` entry has `opciones: readonly { valor,
  label }[]`.
- `ValidacionParametro` returns the normalized value as a **string** (`{ ok: true; valor: string }`). The numeric
  validators return `valor.toString()`, which is exactly what `editar-parametro.ts` stores today
  (`validacion.valor.toString()`), so stored numbers do not change. `validar` has a single caller
  (`editar-parametro.ts`); the unit tests only check `.ok`.
- The `OPCION` validator accepts only a listed `valor` (exact match), error "Elegí una de las opciones.".
- `listParametros` also returns `tipo` and `opciones`; `ParametroForm` renders a `<select name="valor">` for
  `OPCION` (labels from `opciones`) and the current input otherwise. Same form, same `editarParametroAction`, same
  `config.editar` gate, same audit (`parametro` / `MODIFICAR` with old and new value). No new use case.
- The list fallback (`row?.valor ?? valorPorDefecto`) already covers a tenant without the row.

### Reading it in `/recetas/nuevo`

- `modules/recetas/infrastructure`: `getModoLectorQrFarmacia(tx, tenantId)`: `findUnique` on
  `(tenantId, "lector_qr_receta")`, `parseModoLectorQr(row?.valor) ?? MODO_LECTOR_QR_POR_DEFECTO`. Same discipline as
  `stock/infrastructure/partida-repository.ts#getDiasAlertaVencimiento`. `recetas` must not import `parametros`'
  infrastructure (module boundary), so it reads the row itself.
- `modules/recetas/application/get-modo-lector-qr.ts`: `defineQuery` with `permiso: "recetas.crear"` (the page
  already requires it). It needs no `config.ver`: whoever loads recetas must know the mode.
- `app/(app)/recetas/nuevo/page.tsx` passes `modoLectorFarmacia` and `session.tenantId` to `NuevaReceta`, which
  passes them to `ImportarRecetaQr`.

## Equipo level: the browser

- `localStorage` key `fsj.lector-qr.<tenantId>`, value `FARMACIA` | `CAMARA` | `LECTOR`. Keyed by tenant so one
  browser used by two farmacias does not mix them. Precedent: `modules/operadores/ui/operador-provider.tsx` (last
  operador chosen).
- Every read and write is wrapped in `try/catch` (private mode, blocked storage, quota): on failure the panel uses
  the farmacia mode and the selector still changes the mode for the current page.
- Read through `useSyncExternalStore` with server snapshot `null` (unknown on the server), subscribed to the
  `storage` event so another tab's change applies too. This mirrors how the panel already reads camera support
  (`soporte` is `null` on the server and during hydration, and the camera button only appears once mounted).
- Choosing "Según la farmacia" removes the key.
- Not audited: it is a per-device display preference, it touches no data.

### Hydration

The camera button already renders only after mount, so no button flickers. The panel subtitle and placeholder render
with the farmacia mode on the server; if the equipo overrides it they change once mounted. Accepted: it is one line
of text, and reading the browser preference on the server would need a cookie for no real gain.

## Panel (`modules/recetas/ui/importar-receta-qr.tsx`)

- `modoEfectivo = resolverModoLectorQr({ farmacia: modoLectorFarmacia, equipo })`.
- `LECTOR`: the camera button, its unavailability notice (`avisoCamaraId`) and the scanner are not rendered. If
  the mode switches to `LECTOR` while the camera is open, the scanner is unmounted, which already stops every track
  ("Apagado de la cámara").
- Copy by mode:
  - `CAMARA` (today): "Usá el lector, pegá el link o escaneá con la cámara." / placeholder "Escaneá el QR o pegá el
    link".
  - `LECTOR`: "Escaneá el QR con el lector o pegá el link." / placeholder "Escaneá el QR con el lector o pegá el
    link".
- Selector "En este equipo": a small native `<select>` under the form, label visible, options
  "Según la farmacia (Cámara | Lector USB)", "Cámara", "Lector USB". Outside the `<form>` (it must not submit) and
  after the input in tab order, so the input keeps the initial focus and a USB scan always lands in the input.
  Changing it does not move the focus.
- Everything else (focus rules, double Enter guard, live region, paste-to-read, `requestSubmit`) is untouched.

## Unchanged on purpose

- `Permissions-Policy` stays `camera=(self)` on `/recetas/nuevo` in both modes: an equipo can override a `LECTOR`
  farmacia, and the server does not know the equipo value.
- `leerRecetaQrAction`, the hash extraction, the RCTA adapter and the preview.

## Tests

Unit (vitest, node, no DOM, same limits the spec already states for P55–P57):

- `resolverModoLectorQr` and `parseModoLectorQr`: every combination, unknown values, `null`.
- Registry: `lector_qr_receta` accepts `CAMARA` / `LECTOR`, rejects anything else (including lowercase and blanks),
  default valid; the numeric entries still normalize as before.
- The storage helper: read/write/remove, and a `localStorage` that throws.

Manual: the panel in both modes, the equipo selector, the Parámetros select, and the Gadnic CODBAR10 end to end
(scan, Enter suffix) on a real PC.
