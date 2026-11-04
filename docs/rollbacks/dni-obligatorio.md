# Rollback: DNI obligatorio y normalizado

The feature makes DNI mandatory for new pacientes (both official alta `/clientes` and quick-create in the receta flow), prevents clearing an existing DNI on edición, requires DNI when importing a receta that creates a new paciente without DNI in the document, and normalizes all typed DNIs (pacientes and usuarios) to digits only (7 or 8 digits).

The feature has **NO schema change**: it is a code-only revert (no `.down.sql` migration). Migration 0116 (`uq_paciente_dni` uniqueness index, see [`docs/rollbacks/paciente-dni-unico.md`](file:///docs/rollbacks/paciente-dni-unico.md)) and migration 0029 (`paciente_dni_formato_check`) remain in place and are unaffected.

## What the revert loses

- New pacientes can once again be created without a DNI.
- Editing an existing paciente allows clearing their DNI.
- Receta imports creating a new paciente without DNI in the document no longer prompt for a DNI upon confirmation.
- DNI input for usuarios is no longer validated for 7–8 digits or stripped of dots/formatting at the application layer. Existing stored DNIs in the database are not altered.

## Order

1. Revert the code hunks listed below.
2. `npm run typecheck`, `npm run lint`, `npm test`.

## New files (delete on rollback)

- `shared/validation/dni.ts`
- `openspec/specs/dni-obligatorio/spec.md`
- `docs/rollbacks/dni-obligatorio.md` (this file, optional)

## Edited files (revert the DNI hunks)

- `modules/pacientes/**`:
  - `modules/pacientes/domain/paciente.ts`: remove `dniObligatorio`; revert `dniOpcional` back to not normalizing digits via `shared/validation/dni.ts`.
  - `modules/pacientes/application/crear-paciente.ts`: remove `altaPacienteInput`; revert `crearPacienteConConsentimientoInput` back to extending `crearPacienteInput`; revert duplicate DNI `ValidationError` field marker.
  - `modules/pacientes/application/crear-paciente-desde-receta.ts`: revert `input: altaPacienteInput` back to `input: crearPacienteInput`.
  - `modules/pacientes/application/editar-paciente.ts`: remove the check that prevents clearing an existing DNI (`actual.dni && !input.dni`).
  - `modules/pacientes/ui/paciente-form.tsx`: revert `required` attribute on DNI input for alta mode, help text, and placeholder.
- `modules/recetas/**`:
  - `modules/recetas/application/importar-receta.ts`: in `resolverPaciente`, remove the mandatory DNI check on new paciente alta (`!datos.dni`) and the duplicate DNI error (`Ya existe un paciente con ese DNI: volvé a leer la receta para usarlo.`).
  - `modules/recetas/ui/paciente-picker.tsx`: revert `required` attribute on the quick-create DNI input.
  - `modules/recetas/ui/receta-form.tsx`: remove `pacienteNuevo.dni` state, its mapping to `datos.dni`, and the conditional DNI input field (`borrador.paciente.dni ? null : ...`).
    **Important:** the container query layout conversions (`@container`, `@sm:grid-cols-2`, `@lg:grid-cols-2`, `@3xl:grid-cols-2`, `@5xl:grid-cols-[...]`) introduced in the same commit are responsive layout fixes and **must stay**.
- `modules/usuarios/**`:
  - `modules/usuarios/application/crear-usuario.ts`: remove `normalizarDni` and `dniValido` validation on usuario DNI.
  - `modules/usuarios/application/editar-usuario.ts`: remove `normalizarDni` and `dniValido` validation on usuario DNI.
- Specs:
  - `openspec/specs/importacion-receta-qr/spec.md`: revert the scenario addition for mandatory DNI on new paciente import in "Datos del paciente".
  - `openspec/specs/importacion-receta-pdf/spec.md`: revert the mandatory DNI addition on new paciente alta in "Match de paciente" and the match table row.

## Related rollbacks

- [`docs/rollbacks/paciente-dni-unico.md`](file:///docs/rollbacks/paciente-dni-unico.md): migration 0116 (`uq_paciente_dni` index). Unaffected by this rollback.
