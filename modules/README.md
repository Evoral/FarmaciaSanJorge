# modules/

One directory per business module (`M00`-`M16` in the plan), each following
the same internal layering:

```
modules/<modulo>/
  domain/           pure types, rules, state machines -- no I/O, no Prisma, no Next
  application/       use cases: requireSession -> authorize -> zod -> transaction -> audit
  infrastructure/    Prisma repositories, typed $queryRaw
  ui/                container/presentational components for this module
```

Enforced by ESLint (`eslint.config.mjs`):

- `modules/*/domain/**` cannot import `@prisma/client`, `shared/db`, `next`,
  or another module's `infrastructure/**`.
- `app/**` cannot import any `modules/*/infrastructure/**` directly --
  route/UI code only talks to a module through its `application/` use cases.

See `docs/architecture.md` for the full rationale. No modules are
implemented yet: FASE 0 is infrastructure only.
