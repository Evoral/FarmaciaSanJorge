# Control table: numeros-ingresados

Original: `git show 22ee3f1:openspec/specs/numeros-ingresados/spec.md`.

| Original | Converted to | Scenarios | Note |
|---|---|---|---|
| Status line (implemented 2026-10-19, no schema change, code file) | `## Status` | — | Verbatim. |
| Goal (es-AR numbers, silent 1000x error, one rule, never guess) | `## Purpose` | — | Verbatim. |
| N1 `1,5` / `,5` → 1,5 / 0,5 | N1 | "Comma decimals" (direct) | — |
| N2 `1.234,5` → 1234,5 | N2 | "Thousands and decimals" (direct) | — |
| N3 `0.015`, `12.5`, `1.25`, `0.500` → decimal point | N3 | "Not three digits after the dot", "Leading zero" (direct) | Scenario values are the table's own examples. |
| N4 `1.500`, `12.000`, `1.234.567` refused, message offers both; DT/owner decision 2026-10-19 | N4 | "Ambiguous thousands" (direct) | — |
| N5 `1 500` → 1500 | N5 | "Space as separator" (direct) | — |
| N6 `1e3`, `abc`, `1,2,3` refused with message | N6 | "Malformed number" (direct) | — |
| N7 prefills use a comma, untouched edit never trips N4 | N7 | "Edit form saved untouched" (direct; the last AND is **derived**: "never trips N4" read as "not refused by N4") | — |
| Where (server edge, live previews, prefills) + "Not affected" | `## Where` | — | Verbatim. |

Every sentence of the original is accounted for. Rules dropped: none. Rules changed: none.

`openspec validate numeros-ingresados --type spec --strict`: valid (CLI 1.14.1).

## Review (2026-10-25)

Independent review (separate agent): APPROVE. Code confirms N3 (`0.500`), N4 (`1.500`)
and the derived N7 step.

Pre-existing gap, kept as written: N4 says the message "offers both" readings; the code offers both
only for `1.500`-like input. `1.234.567` gets "escribí 1234567" and `12.000` gets "12" without the
comma reading. The scenario asserts only `1.500`, which is correct.
