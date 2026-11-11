# Rollback: plataforma (superadmin and the `/plataforma` panel)

The change (`openspec/specs/plataforma/spec.md`, archived change `plataforma-superadmin`) adds a platform operator, the
**superadmin**, who lives outside every tenant, and the `/plataforma` panel where it lists pharmacies, creates them,
suspends or reactivates them, edits their contacto and keeps their cuenta corriente.

It has **three schema changes**, reverted newest first, each as reverted code + a new forward migration built from its
`prisma/rollbacks/<migration>.down.sql`:

| Migration | Adds | Down file |
|---|---|---|
| `20261109120000_0124_superadmin_identidad` | `fsj.superadmin`, `fsj.superadmin_sesion`, `fsj.plataforma_auditoria`, email unique across usuario/superadmin, login and session functions | `prisma/rollbacks/0124_superadmin_identidad.down.sql` |
| `20261109130000_0125_tenant_estado_y_alta` | `fsj.tenant.estado` + `contacto_*`, `fsj.crear_tenant_interno`, alta / estado / contacto / list / detail functions; drops permisos `tenants.*` | `prisma/rollbacks/0125_tenant_estado_y_alta.down.sql` |
| `20261109140000_0126_cuenta_corriente` | `fsj.plataforma_cargo`, `fsj.plataforma_pago`, their functions, saldo | `prisma/rollbacks/0126_cuenta_corriente.down.sql` |

You can stop after any step: 0126 alone (no cuenta corriente), 0126 + 0125 (no estado, no panel alta), or all three.

## What the down migrations lose

- **0126:** every cargo and pago. Export them first:
  `COPY (SELECT * FROM fsj.plataforma_cargo) TO STDOUT WITH CSV HEADER;` and the same for `fsj.plataforma_pago`.
- **0125:** every pharmacy's estado and contacto. **A SUSPENDIDO pharmacy becomes usable again at once**: write down
  which ones are suspended (`SELECT id, razon_social FROM fsj.tenant WHERE estado = 'SUSPENDIDO'`) before. Pharmacies
  created from the panel stay (they are ordinary tenants).
- **0124:** every superadmin, platform session and platform audit row. Export `fsj.plataforma_auditoria` first if the
  history matters.

## Order

1. Deploy the reverted code of the stages being rolled back **first**:
   - 0126: `modules/plataforma` cuenta corriente (`application/cuenta-corriente.ts`, `ui/movimiento-forms.tsx`, the
     actions and the detail page section) -- or the whole panel if you go further.
   - 0125: `scripts/create-tenant.ts` back to its own inserts (git history before stage 2), `modules/auth` without
     `tenant.estado` (`validate-session.ts`, `session-repository.ts`, `usuario-repository.ts#tenantPuedeIniciarSesion`,
     `login.ts`), `modules/auth/domain/permisos.ts` with `tenants.crear/editar/baja` again, `prisma/schema.prisma`
     without `Tenant.estado` / `contacto*` / `EstadoTenant` (+ `npm run db:generate`).
   - 0124: `modules/auth` without the superadmin branch (`login.ts`, `require-superadmin.ts`,
     `superadmin-repository.ts`, `session-plataforma.ts`, the platform cookie in `cookie-policy.ts` / `cookie-store.ts`),
     `app/(auth)/login/actions.ts`, `proxy.ts`, `shared/auth/plataforma.ts`, `scripts/superadmin.ts`, the whole
     `modules/plataforma` and `app/(plataforma)`.
2. For each migration, newest first: copy its `.down.sql` into a NEW migration folder (next free number, a timestamp
   later than every existing one) and apply it forward (`docs/deploy.md`). Never edit or delete an applied migration.
3. `npm run typecheck`, `npm run lint`, `npm test`.

Between steps 1 and 2 nothing breaks: the reverted code simply stops calling the platform functions. Rolling back
0125's code without its migration leaves suspended pharmacies able to log in (the code no longer checks `estado`).

## Edited files outside the new ones (revert)

- `AGENTS.md`: the `fsj.plataforma_*` exception to the `p_tenant_id` rule and the seeds line.
- `eslint.config.mjs`: `modules/plataforma/application/define-plataforma.ts` in the transaction-rule ignores.
- `shared/usecase.ts`: `parseInput` back to non-exported.
- `shared/errors/mensajes-invariantes.ts`: the `INV-PLAT-*` messages.
- `shared/labels/field-labels.ts`: the alta labels (`zonaHoraria`, `contacto*`, `admin*`).
- `tests/db/catalogo-guardas.test.ts`: `fsj.superadmin` out of `REFERENCIAS_SIN_INDICE`.
- `tests/unit/*`: the platform tests and the mocks added to the login / session tests.
- `modules/README.md`, `docs/architecture.md`, `shared/auth/README.md`, `docs/plan-implementacion.md` (DP-37, 3.12).
