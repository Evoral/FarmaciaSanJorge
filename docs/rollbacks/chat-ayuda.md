# Rollback: Chat de ayuda (migración 0109)

Spec: `openspec/specs/chat-ayuda/spec.md`. The feature has a **schema change**
(migration `prisma/migrations/20261028120000_0109_chat_ayuda`), so it is
reverted as code + a new forward migration built from
`prisma/rollbacks/0109_chat_ayuda.down.sql`.

## What the down migration loses

- The log of questions and answers asked to the help chat (`fsj.consulta_ayuda`).
- The permission `ayuda.consultar` and any custom role assignments of it in `fsj.rol_permiso`.
- Nothing else: no business data (recetas, stock, patients) is affected.

## Order

1. Deploy the reverted code **first**: without the code, no client calls the chat Server Actions, no queries check `ayuda.consultar`, and the UI does not render the chat bubble in `app-shell.tsx`.
2. Copy `prisma/rollbacks/0109_chat_ayuda.down.sql` into a NEW forward migration and apply it manually.

## Code

Revert the commits of the feature. They touch:
- `modules/ayuda/**` (domain, application, infrastructure, ui)
- `app/(app)/ayuda-actions.ts`
- `app/(app)/app-shell.tsx` (chat mount)
- `modules/auth/domain/permisos.ts` (`ayuda.consultar`)
- `modules/usuarios/domain/roles.ts` (`GRUPO_PERMISO_LABELS.ayuda`)
- `modules/usuarios/domain/ayuda-permisos.ts` (`AYUDA_PERMISO["ayuda.consultar"]`)
- `prisma/schema.prisma` (`ConsultaAyuda`)
- `shared/env.ts` (`GEMINI_API_KEY`, `GEMINI_MODEL`)
- `docs/rollbacks/chat-ayuda.md`, `prisma/migrations/20261028120000_0109_chat_ayuda/`, `prisma/rollbacks/0109_chat_ayuda.down.sql`

## After the rollback

The help chat button no longer appears in the app shell, the API key is not required, and the database retains no traces of past help interactions.
