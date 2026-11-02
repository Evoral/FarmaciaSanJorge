# Propuesta — Lector de QR configurable por farmacia y por equipo

> **Estado:** propuesta aprobada por el usuario, pendiente de implementar.
> **Spec afectada:** `openspec/specs/importacion-receta-qr/spec.md` (delta en `specs/importacion-receta-qr/spec.md`).

## Por qué

Empiezan a llegar lectores físicos de códigos (el primero: Gadnic CODBAR10, lector de mesa 1D/2D por USB). Hoy el
panel "Con el QR o el link de la receta" de `/recetas/nuevo` ya acepta un lector USB que emula teclado (escribe el
código y presiona Enter en el campo), pero siempre ofrece además el botón "Escanear con la cámara", pensado para
celulares y tablets. En un mostrador con lector, ese botón sobra y el texto del panel no habla del lector.

No sabemos qué hardware tendrá cada farmacia, y dentro de una misma farmacia puede variar por equipo (PC con lector
en el mostrador, tablet con cámara en el laboratorio). Por eso se configura en dos niveles.

## Decisión del usuario (2026-11-02)

1. **No se elimina la cámara.** Se agrega un **modo del lector** con dos valores: **Cámara** (por defecto, el
   comportamiento de hoy) y **Lector USB**.
2. **Nivel farmacia:** el Administrador lo elige en Administración → Configuración → Parámetros
   ("Lector de QR de recetas"). Es el valor con el que arrancan todos los equipos.
3. **Nivel equipo:** cualquier usuario que carga recetas puede elegir, en el propio panel QR, el modo de **ese
   equipo**: "Según la farmacia", "Cámara" o "Lector USB". Se guarda en el navegador y, si existe, manda sobre el de
   la farmacia.
4. Se descartó configurarlo **solo desde un superadmin** (operador de plataforma): esa consola no existe (DP-37
   sigue abierta, las farmacias se crean con `scripts/create-tenant.ts`) y cada cambio de hardware pasaría por
   nosotros. Se descartó **solo por farmacia** porque el hardware es de cada equipo. Se descartó **registrar
   equipos en la base** porque la app web no identifica equipos y sería mucho para una preferencia de pantalla.
5. **Fuera del primer alcance:** detectar solo si el equipo tiene cámara y ocultar el botón. El comportamiento de
   los navegadores antes de dar el permiso de cámara no está verificado; el selector por equipo cubre el caso.

## Alcance

- Parámetro de farmacia `lector_qr_receta` (`CAMARA` | `LECTOR`), con valor por defecto `CAMARA`, editable con
  `config.editar` desde la pantalla de Parámetros como un selector (hoy esa pantalla solo maneja números).
- Selector "En este equipo" en el panel QR, guardado en el navegador por farmacia.
- En modo **Lector USB** el panel no muestra el botón de cámara ni el aviso de HTTPS, y su texto habla del lector.
- En los dos modos siguen iguales: el campo (que acepta el lector USB y el link pegado), las validaciones, la
  consulta a RCTA, las reglas de foco y la política de permisos de la cámara.

## Fuera de alcance

- Consola de superadmin / operador de plataforma (DP-37).
- Registro de equipos en la base o configuración del modo por usuario.
- Detección automática de cámara.
- Otros usos del lector (por ejemplo, escanear códigos de barras de partidas en stock): hoy el sistema no lee
  códigos fuera del panel QR de recetas.
- Configuración del propio lector (sufijo Enter, prefijos, distribución de teclado): sigue documentada en la sección
  "Panel y lector USB" de la spec, sin cambios de código.

## Impacto

- **Base de datos:** una migración de datos (fila del parámetro para cada farmacia existente), su `.down.sql` y
  `docs/rollbacks/lector-qr-configurable.md`. Sin cambios de esquema.
- **Módulos:** `parametros` (tipo de parámetro "opción"), `recetas` (lectura del modo y panel QR),
  `scripts/create-tenant.ts`.
- **Seguridad:** el modo solo decide qué se muestra; no habilita ni bloquea nada en el servidor. La cámara sigue
  limitada por `Permissions-Policy` a `/recetas/nuevo`.
