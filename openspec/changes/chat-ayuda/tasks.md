# Tasks — chat-ayuda

Order matters: each block builds on the previous one. Design: `design.md`.

## 0. Decisions before starting

- [x] 0.1 `ayuda.consultar` is assignable, not base (User decision 2026-10-28).
- [x] 0.2a Verify pricing and data terms.
- [ ] 0.2b User creates the key on a dedicated billed Cloud project with a daily request quota and budget alerts.
- [x] 0.3 Retention of `fsj.consulta_ayuda`: no expiry until the platform owner decides (User decision 2026-10-28).

## 1. Schema and permission (one migration)

- [x] 1.1 Add `"ayuda.consultar": "consulta"` to `PERMISO_CATALOGO` (`modules/auth/domain/permisos.ts`).
- [x] 1.2 Migration `prisma/migrations/20261028120000_0109_chat_ayuda/migration.sql`: the permiso in `fsj.permiso` (no role rows); `fsj.consulta_ayuda` with CHECK on `resultado`, index, RLS policy, `SELECT`/`INSERT` and `UPDATE (util)` grants to `fsj_app`, no `DELETE`.
- [x] 1.3 `prisma/schema.prisma` model + `npm run db:generate`.
- [x] 1.4 `prisma/rollbacks/0109_chat_ayuda.down.sql` and `docs/rollbacks/chat-ayuda.md`.
- [x] 1.5 Check that `tests/db/auth-permisos.test.ts` and the unit tests enumerating the catalog still match.

## 2. Configuration

- [ ] 2.1 `GEMINI_API_KEY` and `GEMINI_MODEL` (optional, default `gemini-2.5-flash`) in `shared/env.ts` (blank → undefined), `.env.example` and `docs/deploy.md`.

## 3. Domain (pure)

- [ ] 3.1 `guia.ts`: `EntradaGuia` type.
- [ ] 3.2 `filtrar-guia.ts`: all-required semantics.
- [ ] 3.3 `armar-contexto.ts`: fixed rules + index sorted by id + focus details + history + question; history/question limits.
- [ ] 3.4 `resolver-respuesta.ts`: model output → answer + entry from the guide; `null` → CA4b card.
- [ ] 3.5 `consulta-ayuda.ts`: resultado values.

## 4. Guide content

- [ ] 4.1 Draft `guia-entradas.ts` from `openspec/specs/*` and `app/(app)/` routes (daily-use flows first).
- [ ] 4.2 User reviews tone and steps.

## 5. Infrastructure

- [ ] 5.1 `npm install --save-exact @google/genai@2.10.0`; `gemini.server.ts` uses the SDK, `server-only`, model from env, thinking level `low`, timeout, per-request enum schema, zod re-parse, typed error.
- [ ] 5.2 `consulta-ayuda-repository.ts`: insert and own-row rating update.

## 6. Application and web

- [ ] 6.1 Use cases listed in `design.md` §Module layout (commands skip audit with reason).
- [ ] 6.2 Human labels for the new input fields in `shared/labels/field-labels.ts` (registry completeness test).
- [ ] 6.3 `app/(app)/ayuda-actions.ts`: one turn = consult → register (also on error); rating action.
- [ ] 6.4 Chat UI: history and focus in state, pending state, keep the typed question on error, plain-text answers, "Ir a" with `next/link`, CA4b card, "¿Te sirvió?".
- [ ] 6.5 Mount the chat in `app/(app)/app-shell.tsx` only when `can(session, "ayuda.consultar")` and the key is configured.

## 7. Tests (unit)

- [ ] 7.1 `filtrarGuia`: all-required semantics; no permisos → empty guide.
- [ ] 7.2 Guide integrity: unique ids, routes exist as static pages, specs exist, index budget.
- [ ] 7.3 `armarContexto`: stable prefix per permission set; non-permitted entries absent (titles included); focus details only for a permitted focus.
- [ ] 7.4 Turn flow with a mocked Gemini client: foreign focus ignored; second call only on `necesitaDetalle`; ≤2 calls; provider failure → CA11 and row saved as `error`; unknown id rejected.
- [ ] 7.5 Rating only touches the caller's own row.

## 8. Docs and closing

- [ ] 8.1 `modules/README.md`: add the `ayuda` row.
- [ ] 8.2 AGENTS.md: "a change to a user flow updates its guide entry (`modules/ayuda/domain/guia-entradas.ts`) in the same commit."
- [ ] 8.3 Archive: move the delta to `openspec/specs/chat-ayuda/spec.md` (add `## Purpose`) and the change to `changes/archive/`.

Not verified by this plan: real answer quality with human phrasing — try it with the user on a staging key before
enabling it for every farmacia. Reviewing the log in-app waits for the platform admin panel (separate change).
