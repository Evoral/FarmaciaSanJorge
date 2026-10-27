# Domicilios del cliente, de la receta y de entrega

## Purpose

Keeps apart the domicilio written on the receta and the one the envío goes to, for the cliente and for each receta.

User decision (2026-10-23). There are two domicilios: the one written on the receta and the one the envío goes to.
When only one is loaded, it is used for both. Migration 0099.

## Requirements

### Requirement: One domicilio loaded is used for both

There SHALL be two domicilios: the one written on the receta and the one the envío goes to. When only one is loaded, it is used for both.

#### Scenario: Receta with only its domicilio

- **GIVEN** a receta with a domicilio de la receta and an empty domicilio de entrega
- **WHEN** an envío of that receta is registered
- **THEN** the envío goes to the domicilio de la receta

### Requirement: Domicilio del cliente

`paciente.domicilio` SHALL be written by the cliente's ficha (`/clientes/[id]`) and, **automáticamente**, by an imported receta (QR / PDF) that brings a domicilio (D3).

#### Scenario: Editing the ficha

- **WHEN** a user edits the domicilio in the cliente's ficha (`/clientes/[id]`)
- **THEN** `paciente.domicilio` changes

### Requirement: Domicilio de entrega del cliente

`paciente.domicilio_entrega` SHALL be written **only** by the cliente's ficha. Empty means the same domicilio as `paciente.domicilio`.

#### Scenario: Cliente without domicilio de entrega

- **GIVEN** a cliente with a `paciente.domicilio` and an empty `paciente.domicilio_entrega`
- **WHEN** its domicilio de entrega is used
- **THEN** it is the same `paciente.domicilio`

#### Scenario: A receta never writes it

- **WHEN** a receta is saved or imported for the cliente
- **THEN** `paciente.domicilio_entrega` does not change

### Requirement: Domicilio de la receta

`receta.domicilio_paciente` (0070) SHALL be written by the receta form; a QR / PDF preloads it. It is stored per receta: it is the one at the date of the prescription (see `openspec/specs/importacion-receta-pdf/spec.md`).

#### Scenario: Cliente moves after the receta

- **GIVEN** a receta saved with the domicilio the cliente had at the prescription date
- **WHEN** the cliente's `paciente.domicilio` changes later
- **THEN** the receta keeps its own `receta.domicilio_paciente`

### Requirement: Domicilio de entrega de la receta

`receta.domicilio_entrega` (0099) SHALL be written by the receta form and by the envío modal when the receta has none (E4). Empty means the domicilio de la receta.

#### Scenario: Receta form

- **WHEN** a user fills the domicilio de entrega in the receta form and saves
- **THEN** it is stored in `receta.domicilio_entrega`

### Requirement: D1 — Domicilios del cliente al elegirlo

Al elegir un cliente existente en la carga manual o la edición, la receta SHALL mostrar sus dos domicilios (`domiciliosPacienteParaRecetaAction`). Un domicilio que el cliente no tiene deja lo que ya estaba escrito.

#### Scenario: Cliente con los dos domicilios

- **GIVEN** un cliente existente con domicilio y domicilio de entrega
- **WHEN** se lo elige en la carga manual de una receta
- **THEN** la receta muestra sus dos domicilios

#### Scenario: Cliente sin domicilio de entrega

- **GIVEN** una receta en edición con un domicilio de entrega ya escrito
- **AND** un cliente existente sin domicilio de entrega
- **WHEN** se elige ese cliente
- **THEN** el domicilio de entrega de la receta queda como estaba escrito

### Requirement: D2 — Domicilios en una importación

En una importación, el domicilio de la receta SHALL salir del documento; si el documento no trae, se precarga el del cliente existente. El domicilio de entrega se precarga desde el cliente existente.

#### Scenario: Documento con domicilio

- **GIVEN** un documento importado que trae domicilio, de un cliente existente
- **WHEN** se lee la importación
- **THEN** el domicilio de la receta es el del documento
- **AND** el domicilio de entrega se precarga desde el cliente existente

#### Scenario: Documento sin domicilio

- **GIVEN** un documento importado sin domicilio, de un cliente existente con domicilio
- **WHEN** se lee la importación
- **THEN** el domicilio de la receta se precarga con el del cliente existente

### Requirement: D3 — Solo el domicilio del documento sin cambios actualiza al cliente

Solo el domicilio que **trajo el documento, sin cambios**, SHALL actualizar `paciente.domicilio` al confirmar la importación (`domicilioDelDocumento`). Uno escrito o corregido a mano queda solo en la receta. En el alta de un cliente desde la importación se guarda con ese mismo criterio. Se audita como `MODIFICAR` del paciente.

#### Scenario: Confirmar sin cambios

- **GIVEN** una importación cuyo documento trae domicilio, de un cliente existente
- **WHEN** se confirma sin cambiar ese domicilio
- **THEN** `paciente.domicilio` pasa a ser el del documento
- **AND** se audita como `MODIFICAR` del paciente

#### Scenario: Domicilio corregido a mano

- **GIVEN** una importación cuyo domicilio el usuario corrigió a mano
- **WHEN** se confirma
- **THEN** el domicilio queda solo en la receta y `paciente.domicilio` no cambia

#### Scenario: Alta de cliente desde la importación

- **GIVEN** una importación con un cliente nuevo y un domicilio escrito a mano (el documento no traía)
- **WHEN** se confirma
- **THEN** el cliente se da de alta sin ese domicilio en `paciente.domicilio`

### Requirement: D4 — La receta nunca cambia al cliente

Escribir domicilios en la receta (carga manual, edición) SHALL NOT cambiar nunca al cliente.

#### Scenario: Edición de la receta

- **WHEN** se cambian los domicilios de una receta en la edición
- **THEN** los domicilios del cliente no cambian

### Requirement: D5 — Domicilio de envío

El envío SHALL ir a `domicilioDeEnvio(domicilio_paciente, domicilio_entrega)` (`modules/entregas/domain/entrega.ts`): el de entrega o, si está vacío, el de la receta. Lo usan el modal de envío, el envío pendiente y la hoja del repartidor.

#### Scenario: Receta con domicilio de entrega

- **GIVEN** una receta con domicilio de la receta y domicilio de entrega
- **WHEN** se muestra en el modal de envío, el envío pendiente o la hoja del repartidor
- **THEN** el domicilio de envío es el de entrega

#### Scenario: Receta sin domicilio de entrega

- **GIVEN** una receta con domicilio de la receta y sin domicilio de entrega
- **WHEN** se muestra en el modal de envío, el envío pendiente o la hoja del repartidor
- **THEN** el domicilio de envío es el de la receta

### Requirement: D6 — Receta sin ningún domicilio

Si la receta no tiene ninguno, el modal de envío SHALL pedir "Domicilio de entrega" y guardarlo en `receta.domicilio_entrega` (antes escribía `domicilio_paciente`, que ahora no se toca nunca desde una entrega).

#### Scenario: Envío de una receta sin domicilios

- **GIVEN** una receta sin domicilio de la receta ni domicilio de entrega
- **WHEN** se registra un envío y se escribe el "Domicilio de entrega" en el modal
- **THEN** se guarda en `receta.domicilio_entrega`
- **AND** `receta.domicilio_paciente` no se toca

### Requirement: Formato de los domicilios

Every domicilio SHALL be free text, optional, trimmed, `''` = `NULL`, máx. 300. Not part of the libro recetario asiento or its hash.

#### Scenario: Blank domicilio

- **WHEN** a domicilio is saved with only spaces
- **THEN** it is stored as `NULL`

#### Scenario: Libro recetario

- **WHEN** a receta with domicilios gets its libro recetario asiento
- **THEN** neither domicilio is part of the asiento or its hash

## Where each one lives

| Dato | Columna | Quién lo escribe |
|---|---|---|
| Domicilio del cliente | `paciente.domicilio` | Su ficha (`/clientes/[id]`), y **automáticamente** una receta importada (QR / PDF) que trae domicilio. |
| Domicilio de entrega del cliente | `paciente.domicilio_entrega` | **Solo** su ficha. Vacío = el mismo domicilio. |
| Domicilio de la receta | `receta.domicilio_paciente` (0070) | El formulario de la receta; el QR / PDF lo precarga. Se guarda por receta: es el de la fecha de la prescripción (ver `openspec/specs/importacion-receta-pdf/spec.md`). |
| Domicilio de entrega de la receta | `receta.domicilio_entrega` (0099) | El formulario de la receta, y el modal de envío cuando la receta no tiene ninguno (E4). Vacío = el domicilio de la receta. |

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
