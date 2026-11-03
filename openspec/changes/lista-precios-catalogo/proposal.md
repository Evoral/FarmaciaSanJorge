# Propuesta — Importar la lista "Listado de precios: Catálogo"

> **Estado:** aprobada por el usuario (2026-11-03), implementada; falta la prueba en el navegador y archivar.
> **Spec afectada:** `openspec/specs/costos-proveedor/spec.md` (delta en `specs/costos-proveedor/spec.md`).

## Por qué

La farmacia actualiza una vez por año los precios de referencia de todas sus drogas con la lista que manda el
proveedor. La lista de este año (`Lista de precios actualizada 27-10-2026.xls`) es otro reporte de Crystal, el
**"LISTADO DE PRECIOS: CATALOGO"**, con columnas `Codigo Producto | Descripción | UM | Mínimo | Precio | Tipo Iva`.
El importador de Costos de proveedores (R13–R23) se hizo para la **"Lista de medicamentos"**
(`DESCRIPCION | PRECIO | PRECIO mg | mg C/IVA | COSTO`) y con este archivo no sirve:

1. **No lee el precio.** El reporte deja cada valor una columna antes que su título ("Precio" en la columna R, los
   números en la Q). Las 681 filas que coinciden con una droga quedarían como "precio inválido", que bloquea la
   confirmación.
2. **Ignora la UM.** Hoy la unidad del precio se deduce de la droga (masa → kg, volumen → L, unidades → u, R6). Esta
   lista dice la unidad de cada fila. 113 drogas que el sistema mide en mg vienen cotizadas **por litro**: el
   importador las tomaría como precio por kg, un precio equivocado. Las cápsulas vienen **por millar** (`Mi`).
3. **Detecta las presentaciones por el texto** ("Bidon X 10", "X 0.250"). Esta lista trae el código del producto:
   la fila base es la `NNNNN/000` y las presentaciones son las demás, sin depender del texto.
4. **No usa el tipo de IVA.** Cada fila dice `G` (gravado) o `E` (exento) y hoy todo toma la alícuota por defecto.

Números sobre la base de testeo (2026-11-03): 3.413 filas, 943 base. 815 drogas coinciden (827 filas). 681 se
pueden importar y 146 no: 113 por litro con la droga en mg, 7 por unidad con la droga en mg, 24 filas de 12 drogas
que aparecen dos veces (códigos `0xxxx` y `9xxxx`) y 2 por otros motivos.

## Decisión del usuario (2026-11-03)

1. **Se hace desde Costos de proveedores › Importar lista**, sin un script ni una pantalla nueva: el importador
   reconoce este formato y la vista previa existente es la pantalla de actualización. Se va a usar todos los años.
2. Los precios de la lista son **la base de todas las drogas**, no solo las que se compran a ese proveedor: se
   cargan al proveedor elegido en la importación y la cotización usa el de fecha más reciente (R26), sin cambios.

## Alcance

- El parser reconoce los dos formatos por su encabezado; la "Lista de medicamentos" sigue igual.
- Formato Catálogo: precio de la columna "Precio" aunque esté corrido, fila base por código (`/000`), unidad de la
  columna UM (`Kg`, `G`, `L`, `UN`, `Mi`; `Mi` se divide por 1000), alícuota por "Tipo Iva" (`E` = 0 %).
- Estado nuevo **"Omitida (unidad)"**: la UM de la lista es de otra magnitud que la droga (lista por L, droga en
  mg). No se importa ni bloquea la confirmación, y el motivo se ve en la fila.
- La vista previa muestra la UM y el IVA de la lista en cada fila.
- Medir la confirmación con ~700 filas; si no entra cómoda en el tiempo de la transacción, escribir en lotes.

## Fuera de alcance

- Convertir precios por litro a masa con la densidad (R5 lo prohíbe: la densidad no está resuelta, DP-06b).
- Elegir solo una de las filas duplicadas (`0xxxx` / `9xxxx`): sigue la regla CP7, el usuario omite una.
- Proponer la fecha de la lista a partir de "Fecha Impresión" del archivo: se sigue eligiendo antes de leer (R13).
- Las drogas que no coinciden por nombre (marcador "Sicotrop L4", orden de palabras, más detalle...): se asocian
  como hoy, eligiendo la droga y "recordar equivalencia" (R19), que vale para los años siguientes.

## Impacto

- **Base de datos:** ninguno. `alicuota_iva` ya admite 0; las filas usan las unidades del catálogo.
- **Módulo `costos-proveedor`:** parser nuevo del formato Catálogo, detección del formato, fila leída con UM y tipo
  de IVA, vista previa y evaluación de filas (estado nuevo), comando de confirmación (alícuota por fila), formulario
  de la vista previa (columnas UM e IVA, chip del estado nuevo).
- **Tests:** parser, vista previa y confirmación del formato Catálogo.
