# Impresión de tickets térmicos de 80 mm

## Purpose

Document the geometry and layout rules for tickets printed on the laboratory's 80 mm thermal receipt printer (POS80), implemented in `shared/pdf/ticket.ts`. This geometry is shared by every ticket in the system: the ficha técnica (`modules/elaboracion/infrastructure/ficha-pdf.ts`) and the cotización ticket (`modules/recetas/infrastructure/ticket-cotizacion-pdf.ts`, `openspec/specs/presupuesto-receta/spec.md`). It also specifies the printed content and delivery endpoint of the ficha técnica.

## Requirements

### Requirement: Geometry of the 80 mm thermal printer (POS80)

Thermal tickets for the POS80 printer SHALL use an 80 mm width with a 5 mm left margin (`MARGEN_IZQUIERDO`). Content SHALL end at 64 mm from the left edge (`ANCHO_CONTENIDO`) because the printer clipped anything past ~66 mm. Page height MUST equal content height, measured on a tall layout pass before rendering. Content SHALL render in solid black only without greys. This geometry is shared by the ficha técnica and cotización (`openspec/specs/presupuesto-receta/spec.md`).

#### Scenario: POS80 ticket geometry

- **WHEN** a ticket is rendered with `renderTicketPdf` (`shared/pdf/ticket.ts`)
- **THEN** it uses an 80 mm page width, 5 mm left margin, 64 mm content width limit, single-page dynamic height matching the measured content, and pure black stroke/fill

### Requirement: Printed content and delivery of the ficha técnica

The ficha técnica ticket SHALL print: the preparación's name (only if the ítem has one); the paciente; the médico and their matrícula; the líneas de pesaje as droga / cantidad (including "Enrase manual", prescripción details, and "= N mg" equivalencia); the insumos with their detalle; and a footer "Receta Nº N · Ficha técnica". Delivery via `GET /api/fichas-tecnicas/[id]/pdf` MUST require the `fichas.imprimir` permission and use an opaque id with no patient data in the URL or the filename.

#### Scenario: Ficha técnica ticket content and delivery

- **GIVEN** an authorized user with `fichas.imprimir`
- **WHEN** fetching `GET /api/fichas-tecnicas/[id]/pdf` (`app/api/fichas-tecnicas/[id]/pdf/route.ts`, `modules/elaboracion/application/imprimir-ficha-tecnica-pdf.ts`, `modules/elaboracion/infrastructure/ficha-pdf.ts`)
- **THEN** the PDF contains the preparación name (if loaded), paciente, médico with matrícula, líneas de pesaje, insumos with detalle, and the footer "Receta Nº N · Ficha técnica"
- **AND** the URL and filename carry only the opaque ficha id and version without exposing patient data
