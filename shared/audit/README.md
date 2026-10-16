# shared/audit

`audit.record(tx, ...)` (M01, FASE 2 point 2.7): writes one immutable row
to `fsj.registro_auditoria` inside the caller's transaction. See
`index.ts` for the full contract.

In practice this is called from `shared/usecase.ts#defineCommand`'s
`audit` option, not directly -- that is what guarantees `usuario_id`/
`tenant_id` always come from the authenticated session and the write
always lands in the same transaction as the operation it audits.

On a cuenta de sector (a session shared by the empleados of a work area,
`docs/specs/cuentas-de-sector.md`) `usuario_id` is the EMPLEADO the pipeline
verified by PIN in that request, never the shared account, and the row's
`contexto` gains `terminal` (the shared account and its sesion) and
`verificacion` (the method).
