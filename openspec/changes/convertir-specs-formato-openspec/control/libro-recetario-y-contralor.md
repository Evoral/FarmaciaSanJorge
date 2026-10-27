# Control table: libro-recetario-y-contralor

Original: `git show HEAD:openspec/specs/libro-recetario-y-contralor/spec.md`.

Rewritten from scratch after two failed attempts that paraphrased and dropped rules. Method: each paragraph, bullet
and table row of the original became one or more requirements in its own wording, with only SHALL/MUST inserted;
paragraphs over 500 characters were split and the subject repeated instead of "esto" / "esa función". The title drops
its "SPEC — " prefix. Spanish kept throughout. IDs (INV-*, D*, DP-*) move to the requirement header. Markers:
"(deducción)" = **[DEDUCCIÓN]**, "(conflicto)" = **[CONFLICTO]**, "(resuelto)" = **[RESUELTO]**.

| Original | Converted to | Note |
|---|---|---|
| Blockquote: Fuente, DEDUCCIÓN/PENDIENTE legend | `## Fuente` | Verbatim. |
| Blockquote: "Fuente de verdad… manda este documento" | `## Purpose` | Verbatim, plus one sentence naming the capability. |
| Blockquote: pago de la receta | "Pago fuera de esta máquina de estados" | — |
| §1 Principio + Motivos típicos | "Principio — lo asentado no se deshace" | — |
| §1 table (jornada abierta / firmada) | "Corrección en jornada abierta", "Corrección en jornada firmada" | Table rows as prose, one requirement per column. |
| §1 INV-L09, L02, L18, L19, L20 | One requirement each | — |
| §1 two [DEDUCCIÓN] | "Rectificativo como AsientoRecetario", "Asiento sin efecto por rectificativo" | — |
| §1 [PENDIENTE] segrega | `## Notas y puntos pendientes` | Verbatim. |
| §1 [RESUELTO] D3 | "D3 — Rectificativo por error de dato", "D3 — Corrección de un dato mal cargado" | — |
| D1 | "D1 — Autorización del rectificativo", "INV-L21 — …", "D1 — Comando rectificarAsiento" | — |
| D2 | "D2 — Registro y corrección por ítem", "D2 — Ítems de la receta", "D2 — Estado sin efecto…", "D2 — Anulación de la receta…", "D2 — Receta entregada y estado derivado" | Decision header (revisado, reemplazado por D8) kept in the first one. |
| D4 | "D4 — Hash V3", "INV-L22", "INV-L23", "D4 — verificar_cadena por versión" | — |
| D7, first sentence (original rule, later reverted) | `## Registro histórico` › "D7, decisión original" | Verbatim quote; it no longer holds. |
| D7, reverts 2026-09-29 and 2026-10-21, "únicamente en reanclarLibro" | "D7 — Co-firma del DT sin re-auth del solicitante" | See conflict 1. |
| D8 header | "D8 — Un asiento por receta" | — |
| D8 Cuándo se escribe | "D8 — Cuándo se escribe", "D8 — Camino heredado preparaciones.confirmar" | — |
| D8 Contenido | "D8 — Contenido del asiento", "D8 — Detalle del asiento por receta" | — |
| D8 Modelo | "D8 — Modelo asiento_preparacion", "D8 — Filas de asiento_preparacion", "D8 — Asientos SISTEMA nuevos y existentes" | — |
| D8 Invariantes | "INV-L07", "INV-L24", "INV-L25", "INV-P04" | — |
| D8 Hash V4, Corrección, Transición, Lectura | "D8 — Hash V4", "D8 — Corrección…", "D8 — Receta en RETIRO_VENCIDO", "D8 — Transición", "D8 — Lectura" | — |
| §2 removal paragraph | "DP-17 — Asientos históricos eliminados" | Decision record with date and migration. |
| §2 rest (registro de la decisión original, DEDUCCIÓN, D5) | `## Registro histórico` › "Asientos históricos (DP-17)" | Verbatim: the original itself marks it as record only. |
| §3 DP-31 | "DP-31 — Contador transaccional" | — |
| §3 Numeración inicial and its 7 sub-bullets | "Numeración inicial — …" ×2, "Numeración — …" ×9, "INV-L26 — …" ×2 | "lo avisa" → "avisar el límite conocido"; "con esto" → "con la numeración del libro"; "Ambas funciones" named. |
| §3 DP-32 | "DP-32 — Hash calculado por la base" | — |
| §3 "Aplica igual al libro recetario y a cada libro contralor" | "DP-31 y DP-32 — Cada libro con su secuencia y su cadena" | — |
| §3 Un asiento por receta | "D8 — Reemplaza a los asientos consecutivos" | — |
| §3 Impresión | "Impresión — …" ×6 | — |
| §3 Anulados en la hoja | "Anulados en la hoja", "Anulados — …" ×2 | — |
| §3 Lote en la hoja | "Lote en la hoja", "Lote — solo visualización" | See conflict 3. |
| §3 Orden de impresión | "Orden de impresión", "… — rechazo y botones", "… — exportación de /libro" | — |
| §3 Fórmula, Excipiente (incl. INV-P08), Libro por día | "Fórmula de la prescripción", "Fórmula — …", "Excipiente utilizado", "Excipiente — queda fijo", "INV-P08 — …", "Libro por día" | — |
| §3 Aviso y reanclaje | "Aviso de quiebre de la cadena", "Aviso — resultado en memoria", "Reanclaje — …" ×3 | The "Pendiente (no implementado)" sentence goes to `## Notas y puntos pendientes`, verbatim. |
| §3 Receta Nº, Jornada en el listado | "Receta Nº en el listado", "Receta Nº — solo visualización", "Jornada en el listado", "Columna Estado del listado" | — |
| §4 Configuración por farmacia | "Configuración del contralor por farmacia" | — |
| §4 AsientoContralor table | `## Modelo AsientoContralor` (verbatim) + "AsientoContralor — campos condicionales" | Normative cells (null solo en APERTURA, solo en EGRESO por preparación, solo en INGRESO) also in the requirement. |
| §4 Enum, Relaciones, saldoAnterior | "AsientoContralor — movimientos y relaciones" | — |
| §4 Comportamiento | "Contralor desactivado", "Contralor activado", "Activación del contralor" | "todo lo anterior" spelled out. |
| §4 INV-L08, L11–L17, INV-L01/L03/C02 | One requirement each | — |
| §4 four [DEDUCCIÓN] | Four "(deducción)" requirements | — |
| §4 two [CONFLICTO] | "Conflicto INV-L12 y DP-21b — AJUSTE", "Conflicto DP-38 — LibroRubricado mínimo" | The assumption is the SHALL; the conflict text is kept. |
| §4 [RESUELTO 2026-10-23] | "Droga controlada dada de alta después de la activación" | — |
| §4 two [PENDIENTE] | `## Notas y puntos pendientes` | Verbatim. |
| §5 INV-C21, DP-18b (+2 sub-bullets), DP-18, DP-18c, DP-18d, DP-19, DP-21 | "INV-C21", "DP-18b — …" ×2, "DP-18 — …" ×2, "DP-18c — …" ×3, "DP-18d — …" ×2, "DP-19", "DP-21 — …" ×4 | DP-18 "esa función" named. |

Every paragraph, bullet and table row of the original is accounted for above. Rules dropped: none. Rules changed:
none. 128 requirements, 130 scenarios, 18 derived.

## Coverage check

`cover.py` (scratchpad; word 3-grams of each original sentence against requirement text and plain sections,
scenarios excluded): 28 of 424 original sentences under 0.85. Each was read: all are SHALL reorders ("solo es
posible" → "SHALL ser posible solo"), an ID moved to the header, or a pronoun replaced by its referent ("esa
función", "esta regla", "lo avisa", "todo lo anterior", "Ambas funciones"). None drops content.

## Derived scenarios

| Scenario | Reasoning |
|---|---|
| INV-L21 "Rectificativo sin autorización" | "validado … con un constraint trigger DEFERRABLE" read as "the deferred trigger rejects it". |
| INV-L22 "Asiento SISTEMA sin detalle", INV-L23 "Detalle tardío" | "exige" / "no puede insertarse" read as a rejection. |
| INV-L07 "Asiento SISTEMA mixto", INV-L25 "Preparación de otra receta" | The invariant read as a rejection of a row that breaks it. |
| INV-L15 "Segunda apertura", INV-L16 "Ingreso sin vale", "Partida sin vale" | "exactamente uno" / "exige" read as a rejection. |
| INV-L14 "Egreso mayor al saldo" | Computed: 2 − 3 < 0, so "nunca es negativo" rejects it. |
| INV-L12 "Egreso", conflicto AJUSTE "Ajuste contralor" | Computed examples of the formula (10 − 3 = 7; AJUSTE assumed to subtract: 10 − 2 = 8). |
| INV-L13 "Dos movimientos simultáneos" | "bajo bloqueo para que no lean el mismo saldo" read as "the second starts from the first's saldoPosterior". |
| DP-31 "Transacción revertida" | The reason against SEQUENCE read as "a rolled-back number is not lost". |
| "Renumerar un libro en uso" | Computed: 1–5 shifted by the difference to 101–105. |
| "Etiqueta impresa antes de renumerar" | Example value ("Receta 3"). |
| DP-18 "Firma dos días después" | Computed: jornada_actual = fecha + 2 > fecha + 1 + 0. |
| DP-18c "Motivo libre preexistente" | Example value ("se cortó la luz"). |
| INV-L01/L03/C02 "Asiento contralor del día" | INV-C02 applied to AsientoContralor: the vigente asiento is linked to its cierre. |

## Conflicts (kept as written)

1. D7 says re-auth is kept "únicamente en `reanclarLibro`", but §3 Numeración (same original) and the code also
   require it for `libro.numeracion.configurar` (`modules/libro/application/configurar-numeracion-libro.ts:36`;
   `reanclar-libro.ts:27`). Both texts kept.
2. INV-L12 says AJUSTE "según su sentido"; the [CONFLICTO] note assumes it always subtracts, and the database does
   so (`prisma/migrations/20260921090300_0014_libro_recetario_contralor/migration.sql` ~760, ~896:
   `ELSE saldo_anterior - cantidad`). Both texts kept.
3. DP-21 (2026-09-24) lists `hash_lote`, motivo de demora and the contralor asientos on the comprobante; "Impresión"
   (2026-10-16/17) says the hoja del día carries none of them. Both kept; the later one describes today's PDF.
4. "Impresión" says the `/libro` PDF export "usa el mismo formato"; "Lote en la hoja" says it does not yet carry the
   Lote column nor the legalizado header and footer. Both kept.
