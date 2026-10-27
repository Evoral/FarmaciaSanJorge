# OpenSpec

Business rules of the app, organized the OpenSpec way: what the system does
**today** lives apart from what we **want to change**.

```
openspec/
├── config.yaml                 project context + per-phase rules
├── specs/<feature>/spec.md     source of truth: current behavior, one folder per feature
└── changes/
    ├── <change>/               a change in progress
    │   ├── proposal.md         why, scope, user decision
    │   ├── specs/<feature>/spec.md   delta: ADDED / MODIFIED / REMOVED requirements
    │   ├── design.md           technical approach
    │   └── tasks.md            implementation checklist
    └── archive/YYYY-MM-DD-<change>/   finished changes, kept as history
```

## Workflow

1. **Propose**: create `changes/<change>/` with `proposal.md`. A proposal is not
   a source of truth until it is approved.
2. **Specify and design**: write the delta specs, `design.md` and `tasks.md`.
3. **Apply**: implement and tick off `tasks.md`.
4. **Archive**: merge the deltas into `specs/<feature>/spec.md` and move the
   change to `changes/archive/`.

A small fix that changes a rule can update `specs/<feature>/spec.md` directly in
the same commit, without a change folder.

## Status of the migration

All 34 specs are in the Requirement / Scenario format (change
`convertir-specs-formato-openspec`, archived). CI validates them with
`npm run specs:validate`. Spec/code conflicts found during the conversion are
recorded in the archived change's `control/` tables, pending a rule-update pass.
