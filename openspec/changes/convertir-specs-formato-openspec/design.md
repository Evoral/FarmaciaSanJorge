# Design: spec format

Fixed by the pilot (`cuit-farmacia`); every later tanda follows it.

## Shape of a converted spec

```markdown
# <Feature title>

## Purpose
What the capability is for and why it exists (50+ characters). The dated user
decision that created it goes here.

## Requirements

### Requirement: R1 — <short name>
One behavior, stated with SHALL or MUST (CLI rule), under 500 characters.
The reason, when the original gives one, stays in the text.

#### Scenario: <short name>
- **GIVEN** <state> (optional)
- **WHEN** <action>
- **THEN** <outcome>
- **AND** <more outcome> (optional)

## Enforcement     (optional, non-normative)
## Code            (optional, non-normative)
```

## Rules for the conversion

1. **Rule IDs survive**: an original `R5` becomes `### Requirement: R5 — ...`.
   Rules without an ID get none (no new numbering that code does not cite).
2. **No new behavior**: a scenario only restates what the original says. A
   scenario that is a direct reading of the rule (e.g. "without the permiso the
   edit is refused" from "with the permiso X") is marked *derived* in the
   control table so the reviewer checks it.
3. **Non-normative content is kept**, not deleted: enforcement notes, accepted
   races, code maps and implementation notes go in sections after
   `## Requirements`, which the CLI ignores. Reference material a requirement
   cites (e.g. the list of exports) also goes there, named in the requirement.
4. **Language**: every spec keeps its original language; nothing is translated.
   User decision (2026-10-25). A Spanish spec stays in Spanish and its requirement
   text carries the literal SHALL or MUST keyword the CLI requires
   ("La receta SHALL quedar Pagada...").
5. **Control table** per spec: original rule → requirement → scenarios, with
   every original sentence accounted for. It lives in
   `control/<feature>.md` inside this change and is archived with it.

## Tooling

`@fission-ai/openspec` 1.14.1 (2026-10-05). 1.15.0 was one day old when the
pilot ran; pin whichever is at least two weeks old when CI adopts it.
