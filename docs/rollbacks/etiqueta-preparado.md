# Rollback: Etiqueta del preparado (logo, phones, dosis, paciente)

Spec: `openspec/specs/etiqueta-preparado/spec.md`. The feature has a **schema change**
(migration `prisma/migrations/20261019120000_0089_tenant_telefonos`), so it is
reverted as code + a new forward migration built from
`prisma/rollbacks/0089_tenant_telefonos.down.sql`.

## What the down migration loses

- The farmacia's `telefono_fijo` / `telefono_celular`. Etiquetas already
  generated keep the phones in their `etiqueta.contenido` text, but the old
  parser does not know those lines: their reprints fall back to a rebuild from
  live data (old layout).

## Order

1. Deploy the reverted code **first**: it does not read the phone columns, which are nullable.
2. Copy `prisma/rollbacks/0089_tenant_telefonos.down.sql` into a NEW migration and apply it.
