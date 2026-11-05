# Impresión de tickets térmicos de 80 mm

## Purpose

Document the geometry and layout rules for tickets printed on the laboratory's 80 mm thermal receipt printer (POS80), implemented in `shared/pdf/ticket.ts`. This geometry is shared by every ticket in the system: the ficha técnica (`modules/elaboracion/infrastructure/ficha-pdf.ts`) and the cotización ticket (`modules/recetas/infrastructure/ticket-cotizacion-pdf.ts`, `openspec/specs/presupuesto-receta/spec.md`). It also specifies the printed content and delivery endpoint of the ficha técnica.

## Requirements

### Requirement: Width of the 80 mm thermal printer (POS80)

Thermal tickets for the POS80 printer SHALL use an 80 mm page with a 5 mm left margin (`MARGEN_IZQUIERDO`) and content
ending 64 mm from the left edge (a 16 mm right margin, so `ANCHO_CONTENIDO` is 59 mm wide): the printer clipped
anything past ~66 mm. Shared by the ficha técnica and the cotización (`openspec/specs/presupuesto-receta/spec.md`).

#### Scenario: Right-aligned amount stays printable

- **WHEN** a ticket is rendered with `renderTicketPdf` (`shared/pdf/ticket.ts`)
- **THEN** the page is 80 mm wide and every text, including right-aligned amounts, ends 64 mm from the left edge

### Requirement: Height and color of a thermal ticket

A receipt roll has no page height: the ticket SHALL be one page exactly as tall as its content (laid out once on a
very tall page to measure it, then rendered at the measured height). It SHALL print in black only, with no greys.

#### Scenario: Ticket as tall as its content

- **WHEN** a ticket of any length is rendered with `renderTicketPdf`
- **THEN** it is a single page whose height matches its content, in black only

### Requirement: Printed content and delivery of the ficha técnica

The ficha técnica ticket SHALL print: the preparación's name (only if the ítem has one); the paciente; the médico and their matrícula; the líneas de pesaje as droga / cantidad (including "Enrase manual", prescripción details, and "= N mg" equivalencia); the insumos with their detalle; and a footer "Receta Nº N · Ficha técnica". Delivery via `GET /api/fichas-tecnicas/[id]/pdf` MUST require the `fichas.imprimir` permission and use an opaque id with no patient data in the URL or the filename.

#### Scenario: Ficha técnica ticket content and delivery

- **GIVEN** an authorized user with `fichas.imprimir`
- **WHEN** fetching `GET /api/fichas-tecnicas/[id]/pdf` (`app/api/fichas-tecnicas/[id]/pdf/route.ts`, `modules/elaboracion/application/imprimir-ficha-tecnica-pdf.ts`, `modules/elaboracion/infrastructure/ficha-pdf.ts`)
- **THEN** the PDF contains the preparación name (if loaded), paciente, médico with matrícula, líneas de pesaje, insumos with detalle, and the footer "Receta Nº N · Ficha técnica"
- **AND** the URL and filename carry only the opaque ficha id and version without exposing patient data
