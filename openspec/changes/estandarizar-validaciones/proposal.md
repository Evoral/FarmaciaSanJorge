# Propuesta — Estandarizar validaciones de entrada

> **Estado:** propuesta aprobada por el usuario, pendiente de specs, diseño y tareas.
> **Specs afectadas:** dos specs nuevas, `openspec/specs/fechas-entrada/spec.md` y
> `openspec/specs/importacion-factura-compra/spec.md` (deltas en `specs/`). `importacion-receta-pdf` no cambia de
> regla.

## Por qué

Una revisión de pendientes viejos (2026-11-04) confirmó cuatro desvíos del estándar de la app. Ninguno rompe hoy,
pero todos dependen de que alguien se acuerde de una convención que el código no hace cumplir:

1. **Postgres limpio.** La migración 0000 instala extensiones `WITH SCHEMA extensions` sin crear ese esquema, y la
   0108 ejecuta `ALTER ROLE authenticator` sin verificar que el rol exista. Los dos existen solo en Supabase: en
   cualquier otro Postgres, `prisma migrate deploy` falla. No está documentado.
2. **Importación de receta PDF.** El formulario arma el JSON de confirmación sin tipo
   (`payloadImportacion()`, `modules/recetas/ui/receta-form.tsx`) y la action lo vuelve a leer con `JSON.parse`.
   El typecheck no lo compara con `ImportarRecetaWireInput`. Solo funciona porque cada campo opcional pasa por
   `opcional()`: el esquema del médico rechaza `null`, así que un campo nuevo que se olvide del helper hace fallar
   la importación en producción, no en CI.
3. **Fechas `AAAA-MM-DD`.** El validador `isoDate` está definido unas diez veces y solo uno (impresión de envíos)
   rechaza fechas que no existen en el calendario. En los listados, `?desde=2026-02-30` pasa la validación y llega
   a Postgres, que tira error al convertirla a `date`.
4. **Campos de texto opcionales.** Crear y editar médico definen el mismo helper dos veces; `numeroMatricula` de
   usuarios acepta `""` y solo no guarda una cadena vacía porque las dos actions la limpian antes.

Además, la **factura manual** (Stock › Ingresar factura sin PDF, `ImportarFacturaForm` con `manual`) no deja
cargar **Despacho de importación** ni **País de origen** en sus lotes: los arma con `despacho: null` fijo, aunque el
use case (`importarFacturaCompra`) y las columnas de la partida (migración 0062) ya los aceptan, y la factura leída
del PDF sí los guarda. Va contra la regla "lo que ofrece un alta lo ofrece la otra".

> Corrección (2026-11-05): la primera versión hablaba del "ingreso manual de partida". No tiene pantalla:
> `ingresarPartidaCommand` no tiene ningún llamador en `app/` ni en `ui/`. El ingreso manual real es la factura
> manual.

## Decisión del usuario (2026-11-04)

1. **Entran los cuatro arreglos:** documentar Postgres limpio, tipar el payload del PDF, un `isoDate` único y un
   helper único de texto opcional para médico y usuario.
2. **La factura manual ofrece Despacho de importación y País de origen** por lote, opcionales, igual que guarda
   la factura leída del PDF.
3. **Una fecha inválida en el filtro de un listado se ignora:** el listado se muestra sin ese filtro de fecha y sin
   mensaje de error.
4. **Postgres limpio se resuelve solo con documentación** en `docs/deploy.md`: las migraciones ya aplicadas no se
   editan (Prisma detecta el cambio de checksum en las bases existentes).

## Alcance

- `docs/deploy.md`: pasos previos a `migrate deploy` en un Postgres que no sea Supabase (crear el esquema
  `extensions` y el rol `authenticator NOLOGIN`).
- `payloadImportacion()` tipado como `ImportarRecetaWireInput`; un `null` en un campo que no lo acepta pasa a ser
  error de typecheck. Sin cambio de comportamiento.
- Un solo `isoDate` compartido que valida formato **y** existencia en el calendario, usado por todos los use cases
  que hoy definen el suyo.
  - **Listados** (auditoría, entregas pendientes, preparaciones, recetas en curso, recetas pendientes): una fecha
    de filtro inválida se descarta y el listado se muestra sin ese filtro.
  - **Formularios** (vencimiento de partida, vigencia de director técnico, fechas de receta): una fecha inválida
    sigue marcando el campo con su error, como hoy.
- Un solo helper de texto opcional que convierte `""`, `null` y `undefined` en `null`, usado por crear/editar médico
  y por `numeroMatricula` en crear/editar usuario.
- Factura manual: campos opcionales Despacho de importación y País de origen en cada lote, con la validación que ya
  tiene la línea de factura (texto, máximo 200 caracteres, vacío = sin dato). Se guardan en las columnas existentes
  `partida.despacho_importacion` / `pais_origen`. Solo cambia el formulario: el use case ya los recibe.

## Fuera de alcance

- Editar migraciones ya aplicadas o agregar una migración de portabilidad (la 0108 corre antes que cualquier
  migración nueva en una base limpia, así que no serviría).
- El orden de bloqueos de `confirmar-preparacion.ts`: la revisión confirmó que no hay deadlock (preparación →
  receta → partidas en los dos caminos).
- Despacho y país en la existencia inicial y en la edición de una partida ya ingresada (las columnas son de solo
  inserción).
- Editar el despacho o el país que se leyó de un PDF: se siguen mostrando como texto bajo el lote.
- `ingresarPartidaCommand` sin pantalla: si se borra o se le da una, va en otro cambio.
- Cambiar el comportamiento de la importación PDF o el texto de sus errores.

## Impacto

- **Base de datos:** ninguno. Sin migración, sin `.down.sql`.
- **Módulos:** `recetas` (formulario de receta), `stock` (dominio de partida, formulario de factura),
  `medicos`, `usuarios`, `auditoria`, `entregas`, `preparaciones`, `directores-tecnicos`; `shared/` recibe el
  `isoDate` y el helper de texto opcional.
- **Docs:** `docs/deploy.md`.
- **Riesgo:** bajo. Lo más delicado es que los listados dejen de fallar con una fecha mala: hay que cubrir con
  tests que el filtro se descarta y no rompe el resto de los filtros.
