# modules/

One directory per business module, each following the same internal layering:

```
modules/<modulo>/
  domain/           pure types, rules, state machines -- no I/O, no Prisma, no Next
  application/      use cases (defineCommand/defineQuery): requireSession -> authorize -> zod -> transaction -> audit
  infrastructure/   Prisma repositories, typed $queryRaw
  ui/               container/presentational components for this module
```

Enforced by ESLint (`eslint.config.mjs`):

- `modules/*/domain/**` cannot import `@prisma/client`, `shared/db`, `next`,
  or any module's `infrastructure/**`.
- `app/**` cannot import any `modules/*/infrastructure/**` directly --
  route/UI code only talks to a module through its `application/` use cases.
- Nothing opens a tenant transaction directly; use cases go through
  `shared/usecase.ts`. Exempt: `modules/auth/**` (runs before a session
  exists) and the plazos job in `modules/archivo/application/actualizar-plazos.ts`.

See `docs/architecture.md` for the full rationale.

## Module map

`M..` is the module's section in `docs/plan-implementacion.md` §9 (search it,
don't read it whole). Cross-cutting platform code (M00) lives in `shared/`.

| Module | Plan | Owns |
|---|---|---|
| `auditoria` | M01 | Audit log listing and queries (writing goes through `shared/audit`) |
| `auth` | M02 | Login, sessions, PIN, account activation |
| `usuarios` | M03 | Users, roles and permissions (`docs/specs/roles-personalizables.md`) |
| `directores-tecnicos` | M04 | Director Técnico designation and who is in charge today |
| `unidades` | M05 | Units of measure catalog |
| `drogas` | M06 | Drugs catalog and their synonyms (`sinonimos-droga`) |
| `proveedores` | M06 | Suppliers catalog, supplier history and cost comparison (`trayectoria-proveedor`, `comparador-costos`) |
| `medicos` | M06 | Prescribers catalog |
| `pacientes` | M06 | Patients, recurring patients and patient history (`pacientes-recurrentes`, `trayectoria-paciente`) |
| `stock` | M07 | Partidas, stock movements, supplier invoice import |
| `precios` | M08 | Price rules (margin tiers, minimum price) and per-ítem cotización (`reglas-precio`) |
| `recetas` | M09 | Recetas and their ítems, PDF/QR import, receta budget, paid/unpaid flag (`importacion-receta-*`, `presupuesto-receta`, `pago-receta`) |
| `elaboracion` | M10 | Ficha técnica: weighing lines, versions, PDF (`ficha-tecnica`) |
| `preparaciones` | M11 | Preparación lifecycle (confirm/discard) and labels |
| `etiqueta-tamanos` | M11 | Label size catalog used when printing labels |
| `libro` | M12 | Libro recetario and libros contralor, entries and exports (`libro-recetario-y-contralor`) |
| `cierres` | M13 | Daily close and signature |
| `entregas` | M14 | Delivery and regularization (can also mark the receta paid, `pago-receta`) |
| `archivo` | M15 | Receta archive, retention periods, destruction |
| `farmacia` | — | Tenant (pharmacy) data. No `domain/` layer |
| `parametros` | — | Tenant-configurable parameters |

The dashboard and reports (M16) have no module of their own: the cards live in
`shared/dashboard/cards.ts` and the reports read through each module's queries.
Specs referenced above are in `docs/specs/`.
