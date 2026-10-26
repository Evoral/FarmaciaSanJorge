# Domicilios del cliente, de la receta y de entrega

User decision (2026-10-23). There are two domicilios: the one written on the receta and the one the envío goes to.
When only one is loaded, it is used for both. Migration 0099.

## Where each one lives

| Dato | Columna | Quién lo escribe |
|---|---|---|
| Domicilio del cliente | `paciente.domicilio` | Su ficha (`/clientes/[id]`), y **automáticamente** una receta importada (QR / PDF) que trae domicilio. |
| Domicilio de entrega del cliente | `paciente.domicilio_entrega` | **Solo** su ficha. Vacío = el mismo domicilio. |
| Domicilio de la receta | `receta.domicilio_paciente` (0070) | El formulario de la receta; el QR / PDF lo precarga. Se guarda por receta: es el de la fecha de la prescripción (ver `openspec/specs/importacion-receta-pdf/spec.md`). |
| Domicilio de entrega de la receta | `receta.domicilio_entrega` (0099) | El formulario de la receta, y el modal de envío cuando la receta no tiene ninguno (E4). Vacío = el domicilio de la receta. |

## Rules

- **D1** Al elegir un cliente existente en la carga manual o la edición, la receta muestra sus dos domicilios
  (`domiciliosPacienteParaRecetaAction`). Un domicilio que el cliente no tiene deja lo que ya estaba escrito.
- **D2** En una importación, el domicilio de la receta sale del documento; si el documento no trae, se precarga el del
  cliente existente. El domicilio de entrega se precarga desde el cliente existente.
- **D3** Solo el domicilio que **trajo el documento, sin cambios**, actualiza `paciente.domicilio` al confirmar la
  importación (`domicilioDelDocumento`). Uno escrito o corregido a mano queda solo en la receta. En el alta de un cliente
  desde la importación se guarda con ese mismo criterio. Se audita como `MODIFICAR` del paciente.
- **D4** Escribir domicilios en la receta (carga manual, edición) nunca cambia al cliente.
- **D5** El envío va a `domicilioDeEnvio(domicilio_paciente, domicilio_entrega)` (`modules/entregas/domain/entrega.ts`):
  el de entrega o, si está vacío, el de la receta. Lo usan el modal de envío, el envío pendiente y la hoja del repartidor.
- **D6** Si la receta no tiene ninguno, el modal de envío pide "Domicilio de entrega" y lo guarda en
  `receta.domicilio_entrega` (antes escribía `domicilio_paciente`, que ahora no se toca nunca desde una entrega).

Free text, optional, trimmed, `''` = `NULL`, máx. 300. Not part of the libro recetario asiento or its hash.

## Code

- `prisma/migrations/20261023090000_0099_domicilios_cliente_y_entrega/`
- `modules/pacientes/`: `domain/paciente.ts` (`domicilioOpcional`), `application/{crear,editar}-paciente.ts`,
  `infrastructure/paciente-repository.ts`, `ui/{paciente-form.tsx,actions.ts}`; `app/(app)/clientes/[id]/page.tsx`.
- `modules/recetas/`: `application/{crear,editar,importar}-receta.ts`, `application/leer-receta-pdf.ts`,
  `infrastructure/{receta,importacion}-repository.ts` (`actualizarDomicilioPaciente`), `domain/importacion-receta.ts`,
  `ui/{receta-form.tsx,receta-form-inicial.ts,actions.ts}`; `app/(app)/recetas/[id]/page.tsx`.
- `modules/entregas/`: `domain/entrega.ts` (`domicilioDeEnvio`), `application/{registrar-entrega,get-entrega-estado}.ts`,
  `infrastructure/entrega-repository.ts`, `ui/*` (`domicilioEnvio`).

Rollback: `docs/rollbacks/domicilios.md`.
