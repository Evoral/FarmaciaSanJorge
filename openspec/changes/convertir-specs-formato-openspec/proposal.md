# Convert the specs to the OpenSpec format

## Why

The specs moved 1:1 from `docs/specs/` (commit 729ec2a) but are still free-form:
rules, dated decisions, implementation status and code notes are mixed, and
`openspec validate` rejects all 34. Requirements with scenarios make each rule
checkable and let CI catch a malformed spec.

User decision (2026-10-25): convert in tandas, from low to high risk, starting
with a pilot on `cuit-farmacia`; each tanda is reviewed before the next starts.

## What Changes

- Every `openspec/specs/<feature>/spec.md` is rewritten to `## Purpose` +
  `## Requirements` (`### Requirement:` with SHALL/MUST, `#### Scenario:` with
  WHEN/THEN). The format is fixed in `design.md`.
- No business rule changes. A rule that looks wrong is reported, not fixed here.
- At the end, `openspec validate --specs --strict` joins CI.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None at requirement level: the 34 specs keep their rules; only the format changes
(hence `skip_specs: true`).

## Impact

- `openspec/specs/**`, `.github/workflows/ci.yml` (last tanda), `package.json`
  (pinned `@fission-ai/openspec` devDependency, last tanda).
- Code keeps citing rule IDs (`R7`, `V3`...): the IDs are preserved.

## Out of scope

- Changing any rule, or the code it governs.
- `docs/rollbacks/` and the applied migrations under `prisma/migrations/`.
