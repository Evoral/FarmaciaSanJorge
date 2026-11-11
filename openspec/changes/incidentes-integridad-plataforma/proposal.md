# Proposal — Incidentes de integridad del libro visibles en la plataforma

> **Status:** proposal, pending user review. Open product questions are recorded as assumptions (A1–A6).
> **Specs affected:** `openspec/specs/libro-recetario-y-contralor/spec.md`, `openspec/specs/plataforma/spec.md`.

## Intent

A broken libro recetario hash chain is a legal-integrity event, but today only the pharmacy sees it (red banner in
`app/(app)/layout.tsx`, from `modules/libro/application/resumen-integridad.ts`). Nothing is persisted, so the
superadmin never learns of it and there is no history of when it started or ended. Goal: every detected quiebre
becomes a persisted incident the superadmin can see in `/plataforma`.

## User decision (2026-11-11)

Detection stays on the pharmacy side: incidents are recorded when the existing verification runs for a pharmacy
session. The platform does NOT scan tenants.

## Current gap

| Today | After |
|---|---|
| Result lives only in a per-process Map (5 min TTL) | Incident row per libro and quiebre, with first/last detection |
| Superadmin sees nothing | Indicator in the list, section in the detail |
| Only pino to stdout, nothing logged on a quiebre | One structured `error` line when an incident opens |

## Scope

- New tenant table `fsj.libro_incidente_integridad` (migration 0128): `libro_id`, `primer_quiebre_numero`,
  `detectado_en`, `ultima_deteccion_en`, `detecciones`, `resuelto_en`. Partial unique index on open incidents
  `(tenant_id, libro_id) WHERE resuelto_en IS NULL`; RLS ENABLE + FORCE + policy; index `(tenant_id, libro_id)`.
- Fail-soft `defineCommand` (`libro.integridad.registrarIncidentes`), called only on a cache miss of
  `resumenIntegridad`. Per open libro: same number upserts (`detecciones + 1`); a different number closes the open
  incident and opens a new one; OK closes it. Any failure is logged and swallowed: banner and page unchanged.
- `fsj.plataforma_incidentes_integridad(p_token_hash, ...)` SECURITY DEFINER, starts with `fsj.plataforma_actor`,
  returns only libro tipo, número, dates, count, state. No asiento or patient data.
- `/plataforma`: badge for pharmacies with an open incident. `/plataforma/farmacias/[id]`: open + resolved list.

## Out of scope

- Platform-wide scan, scheduled verification, email/alert sinks.
- Superadmin seguimiento/notes or manual close (a platform write; would extend the `plataforma_auditoria` CHECK, P7).
- Classifying the quiebre (hueco reanclable vs fila alterada).
- Any change to banner text, cache, reanclaje or `fsj.verificar_cadena`.

## Approach

- Queries stay read-only: the write is a separate command, mirroring the best-effort pattern of
  `authorizeAuditado` (`shared/usecase.ts`) and `ON CONFLICT` upserts (`formula-repository.ts:104`).
- Attribution: `audit: { skip: true, reason }` and no actor column. The navigating user did not cause the quiebre;
  the incident row is itself the record. Tradeoff: we lose "who was browsing", which has no product value.
- The verifier remains the source of truth; an incident row never decides integrity.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `libro-recetario-y-contralor`: add incident registration and auto-close on verification.
- `plataforma`: P8 gains the indicator; P9's "MUST NOT read any tenant-scoped table" gets one exception (incidents
  through the SECURITY DEFINER function); new requirement for the incidents section.

## Affected areas

| Area | Impact |
|---|---|
| `prisma/migrations/0128_*`, `prisma/rollbacks/0128_*.down.sql` | New |
| `modules/libro/{application,infrastructure}` | New command + repository |
| `app/(app)/layout.tsx` | Calls the command on cache miss |
| `modules/plataforma/*`, `app/plataforma/**` | New query, badge, section |
| `tests/db/catalogo-guardas.test.ts` | Must pass unchanged |
| `docs/rollbacks/incidentes-integridad-plataforma.md` | New |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Write fails and breaks the layout | Low | try/catch, log `warn`, banner computed first |
| Silent tenants never report (no `libro.ver` navigation) | Med | Accepted (A3); shown as a limitation |
| Concurrent instances double-insert | Low | Partial unique index + `ON CONFLICT` |
| Relaxing P9 widens platform reads | Low | Function returns fixed, non-clinical columns |

## Rollback

Run the `.down.sql` (drops function, table, policy); revert the command call in the layout and the plataforma UI.
Banner keeps working: it never depended on the table. Steps in `docs/rollbacks/incidentes-integridad-plataforma.md`.

## Assumptions (open for confirmation)

- A1 First slice is view-only for the superadmin.
- A2 Incidents auto-close when verification returns OK; no manual close.
- A3 A tenant where nobody with `libro.ver` navigates produces no incident.
- A4 Banner text and behavior do not change.
- A5 A libro closed while broken keeps its incident open (it is no longer verified).
- A6 Suspended pharmacies (no sessions) produce no new detections.

## Proposal question round

1. Should the superadmin be able to annotate or acknowledge an incident in a later slice?
2. Is a libro closed while broken acceptable as "open forever" (A5), or should closing it resolve the incident?
3. Does the pharmacy need to know the platform was notified (banner wording stays as spec'd today)?

## Success criteria

- [ ] A quiebre seen by a pharmacy user appears in `/plataforma` within one cache cycle.
- [ ] After a successful reanclaje, the incident shows as resolved with `resuelto_en`.
- [ ] Banner, cache behavior and page load are unchanged when the write fails.
- [ ] No asiento or patient data reaches the platform function or the log line.
