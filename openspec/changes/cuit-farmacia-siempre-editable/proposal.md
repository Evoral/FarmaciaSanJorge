# Propuesta — CUIT de la farmacia siempre editable

> **Estado:** propuesta aprobada por el usuario, pendiente de implementar.
> **Spec afectada:** `openspec/specs/cuit-farmacia/spec.md` (delta en `specs/cuit-farmacia/spec.md`).

## Por qué

Hoy el ADM puede cambiar el CUIT desde Administración › Configuración › Farmacia solo hasta que se firma el primer
cierre diario (R2, `INV-PL-005`, trigger de la migración 0105). Después el campo desaparece y el CUIT queda fijo,
sin ningún camino desde la app para corregirlo o cambiarlo.

Una farmacia que ya opera necesita poder cambiar su CUIT (por ejemplo, un cambio de titularidad) sin pasar por un
arreglo a mano en la base.

## Decisión del usuario (2026-11-03)

1. **El CUIT se puede editar siempre**, haya o no cierres diarios firmados, con el mismo permiso `config.editar` y
   desde el mismo formulario.
2. **Con un cartel de advertencia** junto al campo, siempre visible, con este texto:
   "El CUIT identifica legalmente a la farmacia. Si lo cambiás, el CUIT nuevo aparece en todos los documentos,
   incluso en los cierres, hojas del libro recetario y fichas ya firmados cuando se vuelvan a ver o imprimir. El
   CUIT anterior queda registrado en la auditoría."
3. **Nada más.** Se descartó guardar un historial de titulares (CUIT y razón social con fecha de vigencia) para que
   los documentos ya firmados conserven el CUIT anterior: el usuario pidió explícitamente solo hacerlo editable.
   El riesgo (los documentos firmados se reimprimen con el CUIT nuevo) queda aceptado y explicado en el cartel.

## Alcance

- Sacar el bloqueo de la app (`editarDatosTenant`) y de la base (trigger `fsj.tenant_cuit_antes_primer_cierre`).
- El campo CUIT se muestra siempre en el formulario; deja de aparecer en "Datos no editables".
- Cartel de advertencia fijo junto al campo.
- Siguen iguales: permiso `config.editar` (R1), auditoría solo cuando cambia (R4), CUIT único entre farmacias (R5).

## Fuera de alcance

- Historial de titulares / copia del CUIT en cada cierre, hoja del libro o ficha.
- Confirmación extra al guardar (diálogo, reautenticación con contraseña).
- Cambios en la razón social u otros datos: ya son editables sin restricción.

## Impacto

- **Base de datos:** migración nueva que borra el trigger y su función (se mantiene `GRANT UPDATE (cuit)` de la
  0105), su `.down.sql` que los recrea, y la sección correspondiente en `docs/rollbacks/cuit-farmacia.md`.
- **Módulos:** `farmacia` (use case, query, repositorio, formulario), página de Configuración › Farmacia,
  `shared/errors/mensajes-invariantes.ts` (`INV-PL-005` se queda: la migración 0105 ya aplicada lo sigue nombrando).
- **Documentos legales:** el PDF del cierre, la hoja del libro recetario y la ficha de elaboración leen el CUIT
  del tenant en el momento: después de un cambio muestran el CUIT nuevo, también los ya firmados.
