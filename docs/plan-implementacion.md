# PLAN DE IMPLEMENTACIÓN — Farmacia San José (Laboratorio Magistral)

> Fuentes analizadas: `Farm SJ-Ejecución.txt` (invariantes + historias), `FarmaciaSJ.drawio` (49 clases/enums, 44 relaciones, 6 notas), proyecto `M:\Projects\farmacia-san-jose` (Next.js 16.3.5 recién creado, App Router, sin `src/`, alias `@/*`, Tailwind 4, TS strict, sin BD/ORM/tests).
> Convención de marcas: **[CONFIRMADO]** = sale de la documentación. **[PROPUESTA TÉCNICA]** = decisión técnica mía, revisable. **DECISIÓN PENDIENTE (DP-xx)** = decisión de negocio faltante (sección 21). Nada marcado como DP se implementa hasta resolverse; los puntos afectados lo indican.

---

## Context

La farmacia necesita un sistema de laboratorio magistral que reemplace el registro manual: recetas → ficha técnica → preparación con descuento de stock por partida → asiento en libro recetario (y contralor para controladas) → cierre diario firmado por el Director Técnico y adherido a un libro rubricado → entrega → archivo y destrucción reglamentaria de recetas físicas. El núcleo es **legal e inmutable**: los registros deben ser demostrablemente íntegros, trazables a una persona real y garantizados por la base de datos, no solo por la aplicación. **Decisión del usuario: se MANTIENE el multi-tenant** (INV-T01..T03 aplican, aunque la doc original decía quitarlo). La doc pide escribir **SQL con triggers/constraints antes que las specs** del núcleo legal. **El modelo de Libro rubricado queda SUJETO A VALIDACIÓN con la Asociación de Farmacias** (no se toma como definitivo) y **se elimina FojaInutilizada** del alcance. Este plan define qué construir, en qué orden, y cuándo cada punto está terminado.

---

## 1. Resumen del sistema

Aplicación web **multi-tenant** (cada tenant = una farmacia con su laboratorio, datos aislados) para gestionar el ciclo completo de preparados magistrales:

1. Catálogos: unidades de medida, drogas, proveedores, médicos, pacientes, reglas de precio.
2. Stock por **Partida** (lote de compra), movido exclusivamente por **MovimientoStock** inmutables.
3. **Receta** con uno o más **ItemReceta**, cada uno con su fórmula (**ComponenteItemReceta**).
4. **FichaTecnica** versionada con **LineaPesaje** congeladas, y **Cotizacion** histórica.
5. **Preparacion** cuya confirmación es atómica: egresos de stock + **AsientoRecetario** + **AsientoContralor** + estado de receta.
6. **CierreDiario** firmado por el DT, con hash de lote, vinculado a folios de un **LibroRubricado**.
7. **Entrega**, regularización de receta física, **LoteArchivoRecetas** y destrucción autorizada.
8. Usuarios sin autorregistro, roles/permisos, designaciones de DT, **RegistroAuditoria** inmutable.

## 2. Objetivos

- O1. Trazabilidad legal completa: todo asiento, movimiento y firma atribuible a un usuario real y verificable por hash.
- O2. Stock exacto por partida, con costo real y lote trazable, sin escrituras directas de saldo.
- O3. Garantías en BD para invariantes legales (triggers, constraints, privilegios del rol de aplicación).
- O4. Operación diaria fluida: la falta de firma o de receta física no bloquea la preparación.
- O5. Evidencia ante inspección: libro recetario, contralor, cumplimiento de firma, destrucción autorizada.

## 3. Alcance

Módulos de la sección 9. Multi-tenant con aislamiento garantizado en BD (INV-T01..T03). Firma `ELECTRONICA_SIMPLE` (re-autenticación). Impresión en PDF de ficha técnica, etiqueta, cierre diario. Digitalización histórica de asientos.

## 4. Fuera de alcance (salvo que se decida lo contrario)

- Datos compartidos entre tenants (no hay reportes cruzados ni transferencias entre farmacias; INV-T02/T03).
- Foja inutilizada (`FojaInutilizada`) **[DECISIÓN DEL USUARIO: se quita]**.
- Autorregistro público y "forgot password" autoservicio **[CONFIRMADO INV-U01, INV-U08]**.
- Facturación, cobro, AFIP, obras sociales/validación de credencial (DP-30).
- Órdenes de compra a proveedores (el ingreso es por Partida directamente).
- Firma `DIGITAL_CERTIFICADA` con certificado y sello de tiempo RFC 3161 (DP-19) — el enum se crea, la implementación no.
- Envío de emails/SMS (no hay requisito; ver DP-05).
- App móvil nativa.

---

## 5. Glosario

> Terminología única. Se usa EXACTAMENTE así en tablas, código, UI y specs. Identificadores de dominio en español (el dominio es legal y local); infraestructura en inglés. Tablas en `snake_case` singular (`asiento_recetario`), tipos TS en `PascalCase` (`AsientoRecetario`).

- **Tenant** → farmacia operadora; unidad de aislamiento de datos. Contiene los datos institucionales (razón social, nombre de fantasía, CUIT, matrícula de farmacia, domicilio) usados en impresos. Toda entidad de negocio pertenece a exactamente un Tenant.
- **Operador de plataforma** → quien da de alta Tenants y su primer Administrador (fuera de cualquier tenant; ver DP-37).
- **Usuario** → persona con cuenta nominal en el sistema. Nunca se elimina.
- **Rol** → agrupación de permisos (`ADMINISTRADOR`, `DIRECTOR_TECNICO`, `FARMACEUTICO`, `ATENCION_PUBLICO`, `SOLO_CONSULTA`).
- **Permiso** → capacidad atómica `modulo.accion` (ej. `stock.ajuste.registrar`).
- **Credencial de activación** → código de un solo uso, con vencimiento, que solo habilita a establecer la contraseña propia.
- **Usuario técnico** → usuario nominado `SISTEMA` que figura como autor de procesos automáticos. No puede iniciar sesión.
- **Designación DT** (`DesignacionDirectorTecnico`) → período en que un Usuario ejerce como Director Técnico (titular o suplente) con su matrícula.
- **Director Técnico (DT)** → Usuario con rol `DIRECTOR_TECNICO` y Designación DT vigente a una fecha dada.
- **Unidad de medida** (`UnidadMedida`) → unidad del catálogo con `tipoMagnitud` y `factorABase`.
- **Unidad base** → la única unidad de un `tipoMagnitud` con `factorABase = 1`.
- **Droga** → materia prima (principio activo o excipiente). No tiene stock propio.
- **Droga controlada** → Droga con `esControlada = true` y `tipoControl ∈ {PSICOTROPICO, ESTUPEFACIENTE}`.
- **Proveedor** → quien vende una Partida.
- **Partida** → lote de compra de una Droga: costo, lote, vencimiento, cantidad inicial y disponible. Único lugar del stock.
- **Partida abierta** → Partida con `fechaApertura` no nula (ya se usó en una preparación).
- **Partida vencida** → Partida con `fechaVencimiento < fecha actual`.
- **Movimiento de stock** (`MovimientoStock`) → hecho inmutable que altera el saldo de una Partida: `INGRESO_COMPRA`, `EGRESO_PREPARACION`, `AJUSTE`.
- **Ajuste** → Movimiento de stock tipo `AJUSTE`, con motivo y autorización del DT. Incluye la **merma**.
- **Merma** → Ajuste por pérdida fuera de preparación (rotura, derrame, vencimiento).
- **Médico** → profesional prescriptor. (En el diagrama: `Medico` y el FK `profesionalId`; se unifica como `medicoId`.)
- **Paciente** → destinatario del preparado.
- **Receta** → prescripción recibida; contiene uno o más Ítems.
- **Ítem de receta** (`ItemReceta`) → un preparado pedido: forma farmacéutica, cantidad de unidades, cantidad total.
- **Componente** (`ComponenteItemReceta`) → droga + cantidad dentro de la fórmula de un Ítem.
- **Fórmula** → el conjunto ordenado de Componentes de un Ítem. **No es una entidad propia** en el diagrama (ver DP-08).
- **c.s.p.** (cantidad suficiente para) → Componente con `esCantidadSuficiente = true`, completa hasta el total.
- **Ficha técnica** (`FichaTecnica`) → instrucción de elaboración versionada de un Ítem, con sus Líneas de pesaje congeladas.
- **Línea de pesaje** (`LineaPesaje`) → cantidad exacta a pesar de una Droga en una Ficha técnica.
- **Cotización** (`Cotizacion`) → cálculo de precio de un Ítem en un instante; histórica.
- **Regla de precio** (`ReglaPrecio`) → parámetros de margen aplicables a una Cotización.
- **Preparación** (`Preparacion`) → elaboración física de una Ficha técnica: `INICIADA`, `CONFIRMADA`, `DESCARTADA`.
- **Confirmación** → operación atómica que cierra una Preparación y genera egresos + asientos.
- **Reparto** → asignación, calculada por el sistema, de una Línea de pesaje entre Partidas.
- **Etiqueta** → rótulo impreso del preparado.
- **Entrega** → dispensa de la Receta al paciente (o su envío).
- **Receta física** → soporte papel de la receta. `recetaFisicaRecibida` indica su recepción.
- **Regularización** → recepción tardía de la receta física de una Receta ya asentada.
- **Libro recetario** → registro legal digital compuesto por Asientos recetario.
- **Asiento recetario** (`AsientoRecetario`) → renglón legal inmutable con número correlativo.
- **Detalle de asiento** (`DetalleAsiento`) → renglón de fórmula congelado como texto dentro del asiento.
- **Asiento contralor** (`AsientoContralor`) → renglón del libro de psicotrópicos o estupefacientes.
- **Anulación** (`AnulacionAsiento`) → corrección de un asiento por anulación con motivo; nunca edición.
- **Jornada** → día calendario en zona horaria `America/Argentina/Mendoza`.
- **Cierre diario** (`CierreDiario`) → agrupación firmada de todos los asientos vigentes de una jornada.
- **Firma** → acto del DT que crea el Cierre diario. **Firma fuera de término** → firma posterior al plazo de la jornada.
- **Libro rubricado** (`LibroRubricado`) → libro físico habilitado por la autoridad, con fojas numeradas.
- **Foja / folio** → página numerada del libro rubricado. (Modelo sujeto a validación con la Asociación de Farmacias.)
- **Lote de archivo** (`LoteArchivoRecetas`) → conjunto de recetas físicas archivadas de un período.
- **Destrucción** → eliminación física autorizada de un Lote de archivo.
- **Registro de auditoría** (`RegistroAuditoria`) → constancia inmutable de una operación relevante.
- **Baja lógica** → `fechaBaja` no nula; la entidad deja de ofrecerse en carga pero resuelve en históricos.
- **Parámetro** → valor configurable por Tenant (plazos, umbrales).

---

## 6. Actores y roles

| Actor | Rol | Descripción |
|---|---|---|
| Administrador | `ADMINISTRADOR` (`esAdministrador = true`) | Gestiona usuarios, roles, designaciones DT, parámetros, unidades de medida, reglas de precio. |
| Director Técnico | `DIRECTOR_TECNICO` + Designación DT vigente | Firma cierres, autoriza ajustes y anulaciones, gestiona libros rubricados (tentativo, DP-38), archivo y destrucción. |
| Farmacéutico | `FARMACEUTICO` | Recetas, fichas, preparaciones, stock, drogas, partidas. |
| Atención al público | `ATENCION_PUBLICO` | Alta de recetas, pacientes, médicos, cotización, entrega. |
| Solo consulta | `SOLO_CONSULTA` | Lectura de listados y reportes (inspector, auditor interno). |
| Usuario técnico | `SISTEMA` (no es rol asignable; uno por tenant) | Autor de procesos automáticos (alertas, vencimientos). Sin login. |
| Operador de plataforma | fuera de tenant (DP-37) | Alta/baja de Tenants y de su primer ADM. No accede a datos de negocio. |

Todo Usuario pertenece a un único Tenant (diagrama: `Tenant 1 — 0..* Usuario "opera"`); sus roles y permisos operan solo dentro de ese Tenant.

Un Usuario puede tener varios roles (UsuarioRol 1..*) **[CONFIRMADO]**. Permisos efectivos = unión de permisos de sus roles. `DIRECTOR_TECNICO` sin Designación DT vigente **no** puede firmar ni autorizar (INV-U04/U05).

## 7. Matriz de permisos

> Rol ADM=ADMINISTRADOR, DT, FAR=FARMACEUTICO, ATP=ATENCION_PUBLICO, SC=SOLO_CONSULTA. "Cond." = condiciones adicionales. Toda acción requiere además **sesión activa de Usuario en estado ACTIVO**. Asignación inicial de permisos a roles = seed **[PROPUESTA TÉCNICA]**, editable por ADM solo si se resuelve DP-03.

| Módulo | Acción (permiso) | Roles | Cond. adicionales |
|---|---|---|---|
| Auth | `auth.login`, `auth.logout`, `auth.password.cambiar` | todos | Estado ACTIVO (login); PENDIENTE solo puede activar |
| Auth | `auth.activar` | titular de credencial | Credencial válida, no usada, no vencida |
| Usuarios | `usuarios.listar/ver` | ADM | — |
| Usuarios | `usuarios.crear` | ADM | ≥1 rol; queda PENDIENTE_ACTIVACION |
| Usuarios | `usuarios.editar` (datos personales) | ADM | No cambia email si hay DP-06 |
| Usuarios | `usuarios.roles.modificar` | ADM | Nunca 0 roles; no quitarse ADM a sí mismo si es el último ADM activo |
| Usuarios | `usuarios.suspender/reactivar/baja` | ADM | Motivo obligatorio; no el último ADM activo; no a sí mismo |
| Usuarios | `usuarios.credencial.restablecer` | ADM | No sobre sí mismo (**PROPUESTA**); motivo |
| Usuarios | `usuarios.auditoria.ver` | ADM, DT(lectura) | — |
| Designación DT | `dt.designar`, `dt.cesar` | ADM | Usuario con rol DT; matrícula; DP-11 |
| Roles/Permisos | `roles.ver` | ADM | — ; edición según DP-03 |
| Farmacia/Parámetros | `config.ver/editar` | ADM (editar), todos (ver datos institucionales) | Auditado |
| Unidades | `unidades.crear/baja/editar` | ADM | INV-M02/M03/M04 |
| Drogas | `drogas.crear/editar/baja/reactivar` | FAR, DT, ADM | INV-F03/F05 |
| Proveedores | `proveedores.*` | FAR, DT, ADM | — |
| Médicos | `medicos.*` | ATP, FAR, DT | — |
| Pacientes | `pacientes.*` | ATP, FAR, DT | Datos sensibles; DP-24 |
| Reglas de precio | `precios.reglas.editar` | ADM, DT (**DP-09**) | Auditado |
| Stock | `stock.ver` | todos | — |
| Stock | `stock.partida.ingresar` | FAR, DT | Genera INGRESO_COMPRA |
| Stock | `stock.partida.costo.corregir` | DT, ADM (**DP-13**) | Motivo; auditado |
| Stock | `stock.ajuste.registrar` | FAR, DT | Requiere autorización DT (INV-U05) |
| Stock | `stock.ajuste.autorizar` | DT vigente | Designación DT vigente hoy |
| Recetas | `recetas.crear/editar` | ATP, FAR, DT | Editar solo en PENDIENTE_PREPARACION sin fichas con preparación |
| Recetas | `recetas.anular` | FAR, DT | Motivo; efectos según DP-16 |
| Recetas | `recetas.fisica.registrar` | ATP, FAR, DT | — |
| Ficha técnica | `fichas.generar/imprimir` | FAR, DT | Sin efecto sobre stock/libro |
| Cotización | `cotizaciones.calcular/ver` | ATP, FAR, DT | Sin efecto sobre stock/libro |
| Preparación | `preparaciones.iniciar/descartar` | FAR, DT | — |
| Preparación | `preparaciones.confirmar` | FAR, DT | Re-autenticación (INV-X02); stock suficiente; jornada no firmada |
| Etiquetas | `etiquetas.generar/imprimir` | FAR, DT | Preparación CONFIRMADA |
| Libro recetario | `libro.ver`, `libro.exportar` | FAR, DT, SC | — |
| Libro recetario | `libro.anulacion.solicitar` | FAR, DT | Jornada no firmada (INV-C03) |
| Libro recetario | `libro.anulacion.autorizar` | DT vigente | — |
| Libro recetario | `libro.historico.digitalizar` | DT (**DP-17**) | origen DIGITALIZACION_HISTORICA |
| Cierre diario | `cierres.ver`, `cierres.reporte` | DT, FAR, SC | — |
| Cierre diario | `cierres.firmar` | DT vigente a `cierre.fecha` | Re-autenticación; orden cronológico |
| Cierre diario | `cierres.imprimir` | DT, FAR | — |
| Cierre diario | `cierres.folio.corregir` | DT | Motivo opcional; sin solapamiento |
| Libros rubricados | `libros.crear/cerrar` | DT | Sujeto a validación (DP-38) |
| Plataforma | `tenants.crear/editar/baja` | Operador de plataforma | Fuera de tenant (DP-37) |
| Entregas | `entregas.registrar`, `entregas.firma.confirmar` | ATP, FAR, DT | recetaFisicaRecibida = true |
| Regularización | `regularizacion.ver` | ATP, FAR, DT | — |
| Archivo | `archivo.lotes.*`, `archivo.destruccion.*` | DT | INV-D02 |
| Reportes | `reportes.*` | DT, FAR, SC (ADM: usuarios/auditoría) | — |
| Auditoría | `auditoria.ver` | ADM, DT | Solo lectura; nunca editable |

Diferenciación explícita (implementada en capas distintas):
- **Acceso al módulo/pantalla**: `proxy.ts` (solo sesión) + guardas en layouts server-side por permiso.
- **Ejecución de acción**: `authorize(permiso)` en cada Server Action / route handler — **fuente de verdad**.
- **Condición de negocio**: en el servicio de aplicación (ej. DT vigente a la fecha).
- **Garantía final**: BD (triggers/constraints/privilegios).

---

## 8. Arquitectura propuesta [PROPUESTA TÉCNICA]

**Monolito modular** en Next.js 16 (App Router), arquitectura *screaming* + hexagonal liviana.

```
app/                         # solo routing/UI (RSC + Server Actions delgadas)
  (auth)/login, activar/
  (app)/<modulo>/...         # layout con guardas de permiso
  api/<modulo>/...           # route handlers (PDF, exportaciones)
modules/<modulo>/
  domain/                    # tipos, reglas puras, máquinas de estado (sin I/O)
  application/               # casos de uso: authorize → validar → tx → auditar
  infrastructure/            # repositorios Prisma, SQL ($queryRaw tipado)
  ui/                        # componentes del módulo (container/presentational)
shared/
  db/ (cliente, tx helper, schema drizzle), auth/ (session, authorize),
  audit/, errors/, validation/ (zod), money-decimal/, time/ (jornada TZ), pdf/
db/migrations/               # SQL versionado: tablas, triggers, grants, seeds
tests/{unit,integration,db,e2e}
```

Stack:
- **PostgreSQL administrado por Supabase** [DECISIÓN DEL USUARIO] (triggers, `SELECT ... FOR UPDATE`, índices parciales, `EXCLUDE`, roles con privilegios por tabla, `numeric`). Nunca Postgres local.
  - Tablas de la app en un **schema propio `fsj`**, NO en `public`, y ese schema **no se expone** en la Data API de Supabase (PostgREST); `anon`/`authenticated` sin privilegios sobre `fsj`. No se usa Supabase Auth ni supabase-js desde el cliente.
  - `DIRECT_URL` = conexión directa como `postgres` (dueño) → solo migraciones. `DATABASE_URL` = Pooler (Supavisor, modo transacción) autenticado como rol **`fsj_app`** → runtime. El tenant se fija con `set_config('app.tenant_id', $1, true)` dentro de cada transacción (compatible con pooler en modo transacción).
- **Prisma** [DECISIÓN DEL USUARIO] para modelo y queries tipadas; `prisma migrate` contra Supabase. Triggers, RLS, grants, exclusiones y constraint triggers se escriben como **SQL a mano dentro de las migraciones** (`prisma migrate dev --create-only` + editar `migration.sql`), porque Prisma no los modela. Operaciones con locks/contadores usan `$queryRaw` dentro de `$transaction` interactiva.
- Dos roles de BD: `fsj_owner` (migraciones, dueño) y `fsj_app` (runtime, sin UPDATE/DELETE en tablas legales — INV-X01).
- **Auth propia** con sesiones opacas en BD (token aleatorio, hash SHA-256 en tabla, cookie `httpOnly; Secure; SameSite=Lax`), contraseñas **argon2id** (`@node-rs/argon2`). Motivo: el ciclo PENDIENTE_ACTIVACION / credencial de un uso / "el admin nunca conoce la contraseña" no encaja limpio en librerías genéricas.
- **Zod** para validación de entrada en el borde del servidor. **decimal.js** para toda aritmética de cantidades/costos (nunca `number` float).
- **Vitest** (unit + integración contra un **proyecto Supabase dedicado a tests**, `TEST_DATABASE_URL`/`TEST_DIRECT_URL`; nunca el de desarrollo), **Playwright** (E2E).
- PDF: `@react-pdf/renderer` o `pdfmake` (determinístico: cantidad de páginas calculable → folios, DP-21).
- Logging estructurado `pino`; request-id por operación.
- Next 16: `proxy.ts` (no `middleware.ts`), APIs de request **async** (`await cookies()`, `await params`), Turbopack por defecto, `cacheComponents` **desactivado** para datos legales (todo dinámico, sin caché de datos de negocio). Leer `node_modules/next/dist/docs/` antes de cada fase de UI (AGENTS.md).

Patrón de caso de uso (obligatorio en todo comando):
```
action(input) → requireSession() → authorize(permiso) → zod.parse
  → db.transaction(tx => { reglas de negocio; escrituras; audit.record(tx, ...) })
  → mapear errores de dominio/BD a ErrorSeguro
```
La auditoría se escribe **dentro de la misma transacción** que la operación.

**Multi-tenant [DECISIÓN DEL USUARIO: se mantiene]** — diseño **[PROPUESTA TÉCNICA]**:
- Tabla `tenant` (campos del diagrama). **Todas** las tablas de negocio llevan `tenant_id uuid NOT NULL`, incluidas las hijas que en el diagrama no lo tienen (Partida, ItemReceta, MovimientoStock, AsientoContralor, etc.). Motivo: INV-T02 solo se garantiza en BD con **FK compuestas** `(tenant_id, x_id) → padre(tenant_id, id)`, que exigen la columna en la hija. Cada tabla con `UNIQUE (tenant_id, id)`.
- **INV-T01 [BD]**: Row Level Security (RLS) en todas las tablas de negocio con política `tenant_id = current_setting('app.tenant_id')::uuid`; `fsj_app` **sin** `BYPASSRLS`; `withTransaction` hace `SET LOCAL app.tenant_id` con el tenant **de la sesión** (nunca del input). Sin tenant seteado ⇒ la consulta no devuelve filas y el INSERT falla.
- **INV-T02 [BD]**: FK compuestas en toda relación entre entidades de negocio.
- **INV-T03 [BD]**: trigger genérico `BEFORE UPDATE` que rechaza cambios de `tenant_id`; `fsj_app` sin UPDATE sobre la columna.
- Catálogos **globales** (sin tenant, solo lectura para `fsj_app`): `rol`, `permiso`, `rol_permiso`. `unidad_medida`: DP-39 (global vs por tenant).
- Unicidades "por tenant": `numero_correlativo`, `email` (DP-40), `dni`, códigos, `fecha` de cierre, etc. → `UNIQUE (tenant_id, ...)`.
- Contadores correlativos y cadenas de hash **por tenant** (INV-L04, INV-L06).
- Parámetros y zona horaria de jornada **por tenant** (default `America/Argentina/Mendoza`).
- Procesos automáticos (jobs) iteran tenants y setean `app.tenant_id` por tenant, con el usuario técnico SISTEMA de ese tenant.

---

## 9. Módulos

Orden de presentación = orden de dependencias. Cada módulo lista invariantes primero.

### M00. Plataforma (transversal)

- **Objetivo**: infraestructura común: tenancy, BD, transacciones, errores, validación, tiempo/jornada, decimales, logging, configuración por ambiente.
- **Responsabilidades**: cliente BD y helper de transacción que **setea `app.tenant_id` desde la sesión**; mapeo de errores de Postgres (códigos de trigger `P0001` con `MESSAGE` codificado `INV-XXX`) a errores de dominio; función `jornadaDe(timestamp, tenant)` en la TZ del tenant; `now()` siempre del servidor/BD; alta/baja de Tenants (operador de plataforma). **No** contiene reglas de negocio.
- **Dependencias**: ninguna.
- **Entidades**: `tenant` (`id`, `razon_social`, `nombre_fantasia`, `cuit UNIQUE`, `domicilio`, `matricula_farmacia`, `zona_horaria`, `fecha_baja`, `creado_en`), `parametro` (`tenant_id`, `clave`, `valor`; PK `(tenant_id, clave)`).
- **Invariantes**:
  - INV-T01 Toda entidad de negocio pertenece a exactamente un tenant; ninguna consulta retorna filas de más de un tenant. [BD] `tenant_id NOT NULL` + RLS.
  - INV-T02 Ninguna relación cruza tenants. [BD] FK compuestas `(tenant_id, …)`.
  - INV-T03 `tenant_id` nunca cambia. [BD] trigger + sin grant de UPDATE sobre la columna.
  - INV-PL-001 Un tenant con `fecha_baja` no admite login ni operaciones de sus usuarios; sus datos se conservan. [APP] **[PROPUESTA]**
  - INV-PL-002 Las fechas de negocio (fechaAsiento, jornada, fechaFirma, registradoEn) las fija el servidor/BD, nunca el cliente. [BD + APP] (`DEFAULT now()` y triggers que sobreescriben).
  - INV-PL-003 Cantidades y montos son `numeric` en BD y `Decimal` en aplicación. [BD + APP]
- **Parámetros iniciales** (tabla `parametro` clave/valor tipado, auditados): `plazo_regularizacion_receta_dias` (DP-15), `umbral_folios_alerta` (DP-22), `plazo_archivo_comun_anios`=2, `plazo_archivo_controladas_anios`=3 (DP-26), `vencimiento_credencial_horas`=72, `plazo_firma_jornada` (DP-18), `dias_alerta_vencimiento_partida` (DP-14), `session_idle_minutes`, `session_absolute_hours` (DP-20).
- **API/UI**: `/admin/farmacia` (datos del propio tenant), `/admin/parametros` (ADM); `/plataforma/tenants` (operador, DP-37).
- **Auditoría**: edición de datos del tenant y parámetros (valor anterior/nuevo); alta/baja de tenant.
- **Errores**: errores de BD nunca se exponen crudos; se mapean a mensaje seguro + código + request-id.
- **Tests**: jornada en bordes (23:59/00:00 Mendoza, cambios de UTC), mapeo de errores, parámetros tipados; **aislamiento**: con dos tenants sembrados, cada consulta de cada repositorio como tenant A nunca devuelve filas de B; INSERT con FK hacia fila de otro tenant falla; UPDATE de `tenant_id` falla; transacción sin `app.tenant_id` no ve filas.
- **NO HACER**: no tomar `tenant_id` del input del cliente, de la URL ni de headers (solo de la sesión); no filtrar tenant "a mano" en cada query como única defensa (RLS es la garantía, el filtro explícito es complemento); no dar `BYPASSRLS` a `fsj_app`; no crear índices únicos sin `tenant_id`; no compartir contadores ni cadenas de hash entre tenants; no usar `Date` del cliente para fechas legales; no usar `number` para cantidades; no usar `cacheComponents`/`use cache` sobre datos de negocio; no crear `middleware.ts` (Next 16 usa `proxy.ts`); no leer `process.env` fuera de un módulo `env` validado con zod.
- **DoD**: `env` validado al arrancar (falla si falta variable); `prisma migrate deploy` corre contra Supabase con `DIRECT_URL` (dueño); la app corre con `fsj_app` (sin BYPASSRLS); tests de jornada, decimales y **aislamiento entre tenants** verdes; test automático que verifica que toda tabla de negocio tiene `tenant_id NOT NULL`, RLS habilitado y trigger INV-T03.

### M01. Auditoría

- **Objetivo**: constancia inmutable de operaciones relevantes (INV-A01..A03).
- **Responsabilidades**: `audit.record(tx, {...})`; consulta filtrada. **No** registra lecturas, listados, fichas técnicas, cotizaciones, impresión de etiquetas, navegación [CONFIRMADO INV-A01].
- **Dependencias**: M00. (Usuarios referencia; la tabla se crea antes, FK a `usuario`.)
- **Entidad** `registro_auditoria`: `id uuid PK`, `usuario_id uuid NOT NULL FK`, `entidad text NOT NULL`, `entidad_id uuid NOT NULL`, `accion tipo_accion NOT NULL`, `valor_anterior jsonb`, `valor_nuevo jsonb`, `motivo text`, `autorizado_por_id uuid FK NULL`, `contexto jsonb` (request-id, user-agent), `ip inet`, `ocurrido_en timestamptz NOT NULL DEFAULT now()`. **[PROPUESTA]** agregar `motivo`, `autorizado_por_id`, `contexto` (no están en el diagrama; el pedido los exige). Índices: `(entidad, entidad_id, ocurrido_en)`, `(usuario_id, ocurrido_en)`, `(accion, ocurrido_en)`.
- **Enum `tipo_accion`** (no definido en diagrama — **[PROPUESTA]**): `CREAR, MODIFICAR, BAJA, REACTIVAR, ANULAR, AUTORIZAR, FIRMAR, CONFIRMAR, DESCARTAR, CAMBIAR_ESTADO, ASIGNAR_ROL, QUITAR_ROL, SUSPENDER, RESTABLECER_CREDENCIAL, ACTIVAR_CUENTA, LOGIN_FALLIDO_BLOQUEO, CORREGIR_FOLIO, INUTILIZAR_FOJAS, DESTRUIR, IMPRIMIR_CIERRE`.
- **Invariantes**:
  - INV-A01 Toda operación con relevancia legal/económica/configuración genera registro (tabla de la doc). [APP]
  - INV-A02 Inmutable, sin purga. [BD] trigger `BEFORE UPDATE OR DELETE → RAISE`; `fsj_app` sin UPDATE/DELETE/TRUNCATE.
  - INV-A03 `usuario_id NOT NULL`; procesos automáticos usan el Usuario técnico `SISTEMA`. [BD]
- **Historias**: Como ADM/DT quiero consultar la auditoría filtrando por entidad, usuario, acción y fechas, para reconstruir quién hizo qué. *Criterios*: filtros combinables, paginación por cursor, diff anterior/nuevo legible, sin acciones de edición, exportable CSV (DP-27 si hay límite).
- **UI**: `/auditoria` (listado + detalle), pestaña "Historial" reutilizable en cada entidad.
- **Tests**: UPDATE/DELETE sobre la tabla falla con `fsj_app` y con `fsj_owner` (trigger); cada caso de uso auditable produce exactamente un registro con los campos correctos (test por caso de uso, en su módulo); rollback de la operación ⇒ no queda registro.
- **NO HACER**: no auditar fuera de la transacción de la operación; no tomar `usuario_id` del input del cliente; no guardar contraseñas, hashes ni credenciales en `valor_*`; no ofrecer purga ni edición.
- **DoD**: tabla + trigger + grants; `audit.record` tipado por entidad/acción; pantalla de consulta; test de inmutabilidad; test de atomicidad.

### M02. Autenticación y sesiones

- **Objetivo**: acceso nominal y no delegable.
- **Responsabilidades**: login, logout, activación con credencial de un uso, cambio de contraseña, sesiones, expiración, re-autenticación (step-up) para operaciones críticas, bloqueo por intentos. **No** alta de usuarios (M03).
- **Dependencias**: M00, M01, M03 (tabla usuario).
- **Entidades** (no están en el diagrama — **[PROPUESTA]**):
  - `credencial_activacion`: `id`, `usuario_id FK`, `token_hash text UNIQUE`, `emitida_por_id FK`, `emitida_en`, `vence_en`, `usada_en NULL`, `revocada_en NULL`, `motivo_emision (ALTA|RESTABLECIMIENTO)`. Índice único parcial: una sola credencial no usada/no revocada por usuario.
  - `sesion`: `id`, `usuario_id`, `token_hash UNIQUE`, `creada_en`, `ultimo_uso_en`, `expira_en`, `revocada_en`, `ip`, `user_agent`, `reautenticada_en NULL`.
  - `usuario.password_hash` (NULL mientras PENDIENTE_ACTIVACION), `intentos_fallidos`, `bloqueado_hasta`.
- **Invariantes**:
  - INV-U07 Cuenta nueva ⇒ `PENDIENTE_ACTIVACION`; la credencial solo permite establecer contraseña; PENDIENTE no opera ni figura como responsable. [BD + APP] — BD: trigger en tablas con `*_por_id` verifica que el usuario referenciado esté `ACTIVO` (**PROPUESTA** vía función `assert_usuario_activo(id)`).
  - INV-U08 Restablecimiento ⇒ vuelve a PENDIENTE_ACTIVACION, revoca sesiones y credenciales previas, emite credencial de 72 h. [BD + APP]
  - INV-AU-001 La contraseña definitiva solo la define el titular; nunca se almacena en claro ni la ve el ADM. [APP]
  - INV-AU-002 Una credencial se usa a lo sumo una vez y no después de `vence_en`. [BD + APP] (`UPDATE ... SET usada_en = now() WHERE usada_en IS NULL AND vence_en > now() RETURNING` — atómico).
  - INV-X02 Confirmar preparación y firmar cierre requieren sesión propia activa + re-autenticación reciente (contraseña reingresada en ese acto) **[PROPUESTA de implementación de INV-X02; confirmar DP-20]**.
- **Historias**:
  1. Como usuario ACTIVO quiero iniciar sesión con email y contraseña para operar. *Criterios*: mensaje genérico ante error (no revela si el email existe); bloqueo temporal tras N intentos (DP-20); SUSPENDIDO/BAJA/PENDIENTE no ingresan; se actualiza `ultimoAcceso`.
  2. Como titular con credencial quiero establecer mi contraseña para activar mi cuenta. *Criterios*: pantalla `/activar` pide email + código + nueva contraseña ×2; política de contraseña (DP-20); credencial vencida/usada ⇒ error claro "pedí al administrador una nueva"; al activar: estado ACTIVO, credencial `usada_en`, auditoría `ACTIVAR_CUENTA` con el propio usuario como autor, redirección a login.
  3. Como usuario quiero cambiar mi contraseña (pidiendo la actual) para mantener mi cuenta segura. *Criterios*: revoca las demás sesiones.
  4. Como usuario quiero cerrar sesión. *Criterios*: sesión revocada en BD, cookie eliminada.
  5. "Olvidé mi contraseña" en login ⇒ texto informativo "Contactá al administrador" (sin flujo autoservicio) [CONFIRMADO por INV-U08].
- **API**: Server Actions `login`, `logout`, `activarCuenta`, `cambiarPassword`, `reautenticar`. `proxy.ts`: redirige a `/login` si no hay cookie de sesión (chequeo optimista); la validación real ocurre en `requireSession()` server-side.
- **Seguridad**: argon2id; comparación en tiempo constante de tokens; rate limit por IP+email en login/activación; CSRF: Server Actions de Next validan Origin — verificar en docs de Next 16 y agregar chequeo de `Origin` en route handlers mutantes; cookies `Secure` en prod; rotación de token de sesión al login; expiración por inactividad y absoluta.
- **Errores**: credencial inválida, vencida, usada, revocada; usuario no ACTIVO; bloqueo; sesión expirada a mitad de un formulario (se conserva el borrador en el cliente, se pide re-login).
- **Concurrencia**: doble envío de activación ⇒ el `UPDATE ... WHERE usada_en IS NULL` garantiza un solo éxito.
- **Tests**: unit de política de contraseña; integración de cada error; authorization: PENDIENTE no puede ejecutar ninguna Server Action de negocio (test paramétrico sobre el registro de acciones); concurrencia de activación; E2E alta→activación→login.
- **NO HACER**: no implementar Register público; no enviar ni mostrar la contraseña definitiva al ADM; no permitir que el ADM fije contraseñas; no usar JWT sin revocación para sesiones; no confiar en `proxy.ts` como autorización; no compartir sesión entre usuarios en un mismo equipo (logout explícito + timeout); no loguear tokens ni contraseñas.
- **DoD**: login/logout/activación/cambio/reauth funcionando; sesiones revocables; bloqueo; auditoría de activación y restablecimiento; tests de autorización y concurrencia verdes; E2E del ciclo de vida.

### M03. Usuarios, roles y permisos

- **Objetivo**: administración nominal de cuentas y autorizaciones.
- **Responsabilidades**: alta administrativa, edición, estados, roles, restablecimiento de credencial, consulta, catálogo de roles/permisos, función `authorize`. **No** designaciones DT (M04).
- **Dependencias**: M00, M01, M02.
- **Entidades**:
  - `usuario`: `tenant_id`, `id`, `email citext` (UNIQUE `(tenant_id, email)` o global — DP-40), `nombre`, `apellido`, `dni` (UNIQUE `(tenant_id, dni)`), `estado estado_usuario`, `creado_por_id FK NOT NULL` (excepto el seed inicial: ver DP-04), `creado_en`, `ultimo_acceso`, `numero_matricula NULL`, `fecha_baja NULL`, `motivo_baja NULL`, `password_hash NULL`, `es_tecnico bool`.
  - `rol` (seed fijo: 5 códigos), `permiso` (seed), `rol_permiso`, `usuario_rol` (`id`, `usuario_id`, `rol_id`, `asignado_por_id`, `asignado_en`; UNIQUE(usuario_id, rol_id)).
  - `usuario_estado_historial` **[PROPUESTA]**: cambios de estado con motivo (además de auditoría, para consulta rápida).
- **Máquina de estados** (`estado_usuario` = diagrama `BAJA, ACTIVO, SUSPENDIDO` + `PENDIENTE_ACTIVACION` requerido por INV-U07 — ver DP-01):
  ```
  [alta] → PENDIENTE_ACTIVACION ──(titular establece contraseña)──→ ACTIVO
  ACTIVO ──(ADM suspende, motivo)──→ SUSPENDIDO ──(ADM reactiva, motivo)──→ ACTIVO
  ACTIVO|SUSPENDIDO ──(ADM restablece credencial)──→ PENDIENTE_ACTIVACION
  ACTIVO|SUSPENDIDO|PENDIENTE ──(ADM baja, motivo)──→ BAJA
  BAJA ──(reactivación con motivo: DP-02)──→ PENDIENTE_ACTIVACION
  ```
  Inválidas: PENDIENTE→ACTIVO por acción del ADM; cualquier → PENDIENTE sin credencial nueva; BAJA→ACTIVO directo.
- **Invariantes**:
  - INV-U01 Sin autorregistro; `creado_por_id` obligatorio y con rol ADMINISTRADOR. [APP + BD(NOT NULL)]
  - INV-U02 Todo usuario tiene ≥1 rol. [BD] Trigger `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` sobre `usuario` y `usuario_rol` que valida al commit.
  - INV-U03 Nunca se elimina. [BD] trigger BEFORE DELETE → RAISE; sin grant DELETE.
  - INV-USR-004 Siempre existe al menos un Usuario ACTIVO con rol ADMINISTRADOR. [APP] **[PROPUESTA]**
  - INV-USR-005 Un ADM no puede suspender, dar de baja ni restablecer su propia cuenta. [APP] **[PROPUESTA]**
  - INV-USR-006 Transición de estado solo por máquina definida. [BD] trigger de transiciones válidas.
- **Historias** (todas ADM):
  1. Listar usuarios con búsqueda (nombre, apellido, email, DNI), filtros (estado, rol) y paginación.
  2. Crear usuario (datos + ≥1 rol) ⇒ PENDIENTE_ACTIVACION + credencial de un uso mostrada **una sola vez** en pantalla con cartel "vence en 72 h" (DP-05 sobre canal de entrega). *Criterios*: email/DNI únicos; la credencial no vuelve a mostrarse; auditoría `CREAR` + `ASIGNAR_ROL`.
  3. Editar datos personales. *Criterios*: auditoría con diff; email único.
  4. Modificar roles. *Criterios*: nunca 0 roles; quitar DIRECTOR_TECNICO con Designación vigente exige cesar la designación primero; auditoría por cada rol.
  5. Suspender / reactivar / dar de baja con motivo. *Criterios*: revoca sesiones y credenciales; auditado.
  6. Restablecer credencial. *Criterios*: pasa a PENDIENTE, revoca sesiones, emite credencial 72 h con cartel; auditoría `RESTABLECER_CREDENCIAL` con ADM, afectado y timestamp [CONFIRMADO INV-U08].
  7. Ver detalle con estado, roles, último acceso, historial.
  8. Ver catálogo de roles y sus permisos (lectura; edición según DP-03).
- **API**: `usuarios.listar/obtener/crear/editar/cambiarRoles/suspender/reactivar/darDeBaja/restablecerCredencial`. `authorize(sesion, permiso)` y `can()` para ocultar UI.
- **UI**: `/admin/usuarios`, `/admin/usuarios/nuevo`, `/admin/usuarios/[id]`, `/admin/roles`.
- **Auditoría**: alta, edición, cambio de rol, suspensión, reactivación, baja, restablecimiento [CONFIRMADO].
- **Errores**: email duplicado; intento de dejar sin roles; último ADM; auto-baja; concurrencia de edición (`updated_at` como versión optimista ⇒ "el registro cambió, recargá").
- **Concurrencia**: dos ADM restableciendo a la vez ⇒ índice único parcial de credencial activa + lock de fila `usuario FOR UPDATE`.
- **Tests**: máquina de estados (todas las transiciones válidas/inválidas); INV-U02 en BD (intentar borrar último `usuario_rol` en tx ⇒ falla al commit); INV-U03; autorización matriz completa (cada acción × cada rol = permitido/denegado); último ADM.
- **NO HACER**: no quitar roles para retirar acceso (se desactiva) [CONFIRMADO]; no eliminar usuarios; no exponer `password_hash` en ningún DTO; no decidir permisos por rol en el frontend (siempre `authorize` en servidor); no permitir que el cliente envíe `creado_por_id`/`asignado_por_id`.
- **DoD**: CRUD administrativo completo con estados; matriz de autorización testeada; auditoría por operación; UI con búsqueda/filtros/paginación; E2E alta→activación→suspensión→restablecimiento.

### M04. Designación de Director Técnico

- **Objetivo**: determinar quién es DT vigente a una fecha (INV-U04/U05).
- **Entidad** `designacion_director_tecnico`: `id`, `usuario_id FK`, `caracter (TITULAR|SUPLENTE)`, `matricula text NOT NULL`, `expediente_designacion`, `vigente_desde date NOT NULL`, `vigente_hasta date NULL`, `motivo_cese NULL`, `registrado_por_id FK NOT NULL`, `registrado_en`. Check `vigente_hasta IS NULL OR vigente_hasta >= vigente_desde`.
- **Invariantes**:
  - INV-DT-001 El usuario designado tiene rol DIRECTOR_TECNICO. [BD + APP]
  - INV-DT-002 No hay dos designaciones TITULAR con períodos solapados. [BD] `EXCLUDE USING gist (daterange(vigente_desde, vigente_hasta, '[]') WITH &&) WHERE caracter='TITULAR'` (DP-11 para suplentes).
  - INV-DT-003 Una designación se cesa fijando `vigente_hasta` + `motivo_cese`; no se borra; `vigente_desde` y `matricula` no se modifican. [BD]
  - INV-U04 Firmar un cierre requiere designación vigente **a `cierre.fecha`**. [BD + APP]
- **Historias**: ADM designa DT (titular/suplente) con matrícula y expediente; ADM registra cese con motivo; todos ven quién es DT vigente hoy. *Criterios*: auditoría de alta y cese [CONFIRMADO]; no solapamiento de titulares.
- **Relación con "MatriculaProfesional"** de INV-U04: se modela con la matrícula de la designación (DP-10).
- **Tests**: vigencia en bordes de fecha; solapamiento; firma de fecha pasada con DT vigente entonces y no hoy (debe permitirse según INV-U04).
- **NO HACER**: no evaluar vigencia contra la fecha actual cuando la regla dice `cierre.fecha`; no borrar designaciones; no inferir DT solo por el rol.
- **DoD**: tabla + exclusión; `esDTVigente(usuarioId, fecha)` usado por M08/M10/M11; UI `/admin/directores-tecnicos`; tests.

### M05. Catálogos: Unidades de medida

- **Entidad** `unidad_medida`: `id`, `codigo UNIQUE`, `nombre`, `simbolo`, `tipo_magnitud`, `factor_a_base numeric(20,10) > 0`, `es_base bool`, `fecha_baja NULL`, `motivo_baja`, `usada bool DEFAULT false` (marca de uso, mantenida por trigger desde tablas que la referencian — para INV-M04).
- **Enum `tipo_magnitud`** (no definido en diagrama; DP-07): propuesta `MASA, VOLUMEN, UNIDADES, ACTIVIDAD (UI), PROPORCION (%)`; `CANTIDAD_SUFICIENTE` **no es unidad** sino flag del componente (ya existe `esCantidadSuficiente`).
- **Seed** (de la lista del diagrama): MICROGRAMO, MILIGRAMO, GRAMO (base MASA), KILOGRAMO, MICROLITRO, MILILITRO (base VOLUMEN), LITRO, UNIDAD_INTERNACIONAL, GOTA, UNIDAD, PORCENTAJE. GOTA ↔ mL requiere definición (DP-07).
- **Invariantes**: INV-M01 [BD + APP] (función SQL `convertir(valor, origen, destino)` que falla si magnitudes difieren), INV-M02 [BD] (índice único parcial `(tipo_magnitud) WHERE es_base` + check `NOT es_base OR factor_a_base = 1`), INV-M03 [BD] (FK `ON DELETE RESTRICT` + sin grant DELETE), INV-M04 [BD] (trigger: si `usada` ⇒ `factor_a_base` y `tipo_magnitud` inmutables; solo ADM edita), INV-G01 baja con `fecha_baja`.
- **Historias** [CONFIRMADO]: ADM da de alta unidad con magnitud y factor; ADM da de baja unidad en desuso sin afectar históricos. + reactivar con motivo (INV-G01).
- **NO HACER**: no convertir peso↔volumen por factor; no editar factor de una unidad usada (baja + nueva); no borrar.
- **DoD**: CRUD ADM, conversión testeada con todos los pares, UI `/admin/unidades`.

### M06. Catálogos: Drogas, Proveedores, Médicos, Pacientes

**Droga** `droga`: `id`, `nombre UNIQUE (ci, entre vigentes)`, `unidad_base_id FK unidad_medida`, `densidad numeric NULL` (**PROPUESTA** para INV-M01, DP-06b), `es_controlada bool`, `tipo_control (NINGUNO|PSICOTROPICO|ESTUPEFACIENTE)`, `stock_minimo numeric >= 0`, `fecha_baja`, `motivo_baja`. Check: `es_controlada = (tipo_control <> 'NINGUNO')`. `factorConversion` del diagrama queda en DP-06.
- INV-F03 Droga con partidas/movimientos no se elimina [BD] (sin DELETE + RESTRICT).
- INV-F05 Cambios en Droga no alteran fichas/cotizaciones/asientos [APP] (esos guardan valores congelados).
- INV-DRG-001 `unidad_base_id` y `tipo_control` no cambian si la droga tiene partidas **[PROPUESTA]** (DP-12): cambiar `es_controlada` afecta contralor.
- `stockDisponible()` = SUM(partidas no vencidas); vista `v_stock_droga`.
- Historias: FAR/DT alta, edición, baja, reactivación con motivo; listado con stock disponible, filtro controladas, bajo mínimo.

**Proveedor** `proveedor`: `id`, `razon_social`, `cuit UNIQUE` (validación dígito verificador), `fecha_baja`. CRUD + baja lógica.

**Médico** `medico`: `id`, `nombre`, `apellido`, `matricula` (UNIQUE entre vigentes, DP-23 si hay jurisdicción), `especialidad`, `telefono`, `direccion_registrada`, `fecha_baja`. CRUD + baja lógica. Búsqueda por matrícula/apellido.

**Paciente** `paciente`: `id`, `cuil varchar(11) NULL UNIQUE`, `dni varchar(8)`, `nombre`, `apellido`, `telefono`, `email`, `fecha_nacimiento date`, `nro_credencial`, `sexo`, + `fecha_baja` **[PROPUESTA; no está en diagrama]**. Datos de salud ⇒ acceso restringido y sin exposición en logs (DP-24).

- **Auditoría**: Droga alta/modificación/baja [CONFIRMADO]; Proveedor/Médico/Paciente **[PROPUESTA]** alta/modificación/baja.
- **NO HACER**: no agregar campo `stock` a Droga (INV-S01); no borrar ninguna de estas entidades si tiene referencias; no crear "Prescriptor" y "Médico" como entidades distintas; no poner el proveedor en la Droga (va en la Partida) [CONFIRMADO nota "Multiproveedor"].
- **DoD**: CRUD + baja/reactivación con motivo, búsqueda, filtros, paginación, validaciones (CUIT/CUIL/DNI), autorización, auditoría, tests de restricción de borrado.

### M07. Stock y Partidas

- **Objetivo**: stock exacto y trazable por partida.
- **Dependencias**: M00, M01, M03, M04, M05, M06.
- **Entidades**:
  - `partida`: `id`, `droga_id FK`, `proveedor_id FK`, `lote text`, `costo_unitario numeric >= 0` (por unidad base de la droga — **PROPUESTA**), `cantidad_inicial numeric > 0`, `cantidad_disponible numeric`, `fecha_ingreso timestamptz DEFAULT now()`, `fecha_vencimiento date NOT NULL`, `fecha_apertura timestamptz NULL`, `motivo_apertura_adicional text NULL`. UNIQUE(droga_id, proveedor_id, lote) **[PROPUESTA]**.
  - `movimiento_stock`: `id`, `partida_id FK NOT NULL`, `tipo`, `cantidad numeric > 0`, `preparacion_id NULL`, `linea_pesaje_id NULL` (**PROPUESTA** para INV-S12), `motivo_ajuste NULL`, `observacion`, `registrado_por_id NOT NULL`, `autorizado_por_id NOT NULL` (INV-U06), `registrado_en DEFAULT now()`, `desvio_propuesta bool`, `jornada date` (generada).
  - Enum `tipo_movimiento`: INGRESO_COMPRA, EGRESO_PREPARACION, AJUSTE. Enum `motivo_ajuste`: ROTURA, DERRAME, VENCIMIENTO, PREPARACION_DESCARTADA, DIFERENCIA_ARQUEO.
- **Invariantes** (todas de la doc): INV-S01..S21. Implementación BD:
  - S01/S04: `cantidad_disponible` solo la escribe el trigger `AFTER INSERT ON movimiento_stock` (función `SECURITY DEFINER`); trigger `BEFORE UPDATE ON partida` rechaza cambios de `cantidad_disponible` salvo bandera de sesión seteada por esa función (`SET LOCAL fsj.mov = 'on'`); `fsj_app` sin UPDATE sobre esa columna (GRANT por columna).
  - S02 `CHECK (cantidad_disponible >= 0)`; S03 `CHECK (cantidad_disponible <= cantidad_inicial)`.
  - Alta de partida: INSERT con `cantidad_disponible = 0` + INGRESO_COMPRA por `cantidad_inicial` en la misma tx; constraint trigger diferido valida que toda partida tenga exactamente un INGRESO_COMPRA igual a `cantidad_inicial` **[PROPUESTA]**.
  - S05 FK `partida_id NOT NULL`. S06 trigger UPDATE/DELETE → RAISE + sin grants. S07 `CHECK (cantidad > 0)`.
  - S08 `CHECK (tipo <> 'AJUSTE' OR (motivo_ajuste IS NOT NULL AND autorizado_por_id IS NOT NULL))` + trigger: autorizador con DT vigente hoy (INV-U05).
  - S09 `CHECK (tipo <> 'EGRESO_PREPARACION' OR preparacion_id IS NOT NULL)`.
  - S10 [APP] + **refuerzo BD propuesto** en trigger (`fecha_vencimiento >= jornada`).
  - S11 `SELECT ... FOR UPDATE` de las partidas en orden determinístico (por `id`) para evitar deadlocks.
  - S12/S13/S19/S20 validados por constraint trigger diferido: SUM(egresos de una línea) = `linea_pesaje.cantidad_a_pesar` (convertida a unidad base) y todas las partidas salvo la última quedan en 0.
  - S14/S15/S18 [APP] propuesta de partidas (función pura en `domain/`), desvío registrado con `desvio_propuesta = true` + auditoría; segunda apertura exige motivo.
  - S16/S17 trigger: primer EGRESO_PREPARACION setea `fecha_apertura = now()` si es NULL; `fecha_apertura` nunca vuelve a NULL ni cambia.
  - S21 [APP]: si saldo registrado ≠ existente, primero AJUSTE (flujo separado); el egreso nunca absorbe diferencias.
  - INV-C03: trigger rechaza movimientos cuya `jornada` tenga CierreDiario (siempre es hoy ⇒ solo afecta si hoy ya fue firmado — DP-18b).
  - INV-STK-001 El signo de AJUSTE: **DP-21b** (el diagrama no permite ajustes positivos; S03 impide superar el inicial).
- **Historias**:
  1. FAR/DT ingresa partida (droga, proveedor, lote, vencimiento, cantidad, unidad de compra convertida a base, costo). *Criterios*: genera INGRESO_COMPRA atómico; vencimiento futuro; auditado.
  2. **Merma** [CONFIRMADO historia 2]: AJUSTE con motivo obligatorio, `preparacion_id` NULL, autorización DT + observación libre, inmutable, cantidad ≤ saldo.
  3. Diferencia de arqueo: AJUSTE `DIFERENCIA_ARQUEO` con autorización DT.
  4. DT/ADM corrige costo de partida con motivo (auditado; no altera cotizaciones históricas).
  5. Consultar stock por droga (suma de no vencidas), por partida, kardex de movimientos con filtros y paginación.
  6. Alertas: bajo `stock_minimo`, partidas por vencer (DP-14), vencidas con saldo (sugerir ajuste VENCIMIENTO).
- **Flujo de autorización DT** (DP-08b, crítico): propuesta **[PROPUESTA]** — *co-firma en el mismo acto*: el operador carga el ajuste y el DT ingresa sus credenciales en el mismo formulario (step-up del DT), se valida DT vigente; alternativa: bandeja de solicitudes pendientes que el DT aprueba (requiere entidad `SolicitudAjuste`). Si el operador es el DT, `registrado_por_id = autorizado_por_id` (INV-U06).
- **Concurrencia**: dos ajustes simultáneos sobre la misma partida ⇒ `FOR UPDATE` + CHECK ≥ 0.
- **Tests**: todos los INV-S con SQL directo como `fsj_app` (esperando rechazo); concurrencia (2 conexiones confirmando/ajustando en paralelo); propiedad: saldo = inicial − Σegresos − Σajustes siempre.
- **NO HACER**: no escribir `cantidad_disponible` desde la app; no editar/borrar movimientos; no referenciar Droga en movimientos; no usar cantidades negativas; no "reabrir" partidas; no aumentar el inicial (partida nueva); no aceptar el `autorizado_por_id` enviado por el cliente sin re-autenticación del DT; no calcular stock en la app sumando en memoria cuando existe la vista.
- **DoD**: DDL + triggers + grants; ingreso, ajuste, corrección de costo, consultas, alertas; tests de BD de cada invariante; test de concurrencia; auditoría; UI `/stock`, `/stock/partidas/[id]`, `/stock/ajustes/nuevo`.

### M08. Precios (Reglas de precio)

- **Entidad** `regla_precio` (referenciada en `Cotizacion.reglaPrecioId`, **no definida en el diagrama** — DP-09): propuesta mínima `id`, `nombre`, `forma_farmaceutica NULL`, `margen numeric`, `honorario_fijo numeric`, `vigente_desde`, `vigente_hasta`, `creado_por_id`. Versionada: una modificación crea una versión nueva (las cotizaciones apuntan a la versión usada).
- Invariante INV-PR-001 Una regla usada por una cotización no se modifica (nueva versión). [BD]
- Auditoría: toda modificación [CONFIRMADO].
- **Bloqueado por DP-09** para la fórmula exacta de precio.

### M09. Recetas

- **Dependencias**: M03, M05, M06.
- **Entidades**:
  - `receta`: `id`, `numero_interno` (generado por BD, contador — **PROPUESTA**, formato DP-25), `paciente_id`, `medico_id`, `fecha_creada DEFAULT now()`, `fecha_prescripcion date`, `fecha_valida_desde date`, `fecha_ingreso`, `origen (PRESENCIAL|DIGITAL_PDF|DIGITAL_FOTO)`, `estado`, `archivo_adjunto_url NULL` (obligatorio si origen DIGITAL_*), `receta_fisica_recibida bool DEFAULT false`, `receta_fisica_recibida_en NULL`, `receta_fisica_recibida_por_id NULL`, `registrada_por_id`, `lote_archivo_id NULL`, `motivo_anulacion NULL`.
  - `item_receta`: `id`, `receta_id`, `descripcion`, `forma_farmaceutica`, `cantidad_unidades int > 0`, `unidad_medida_id`, `cantidad_total numeric > 0`, `unidad_total_id`, `observaciones`.
  - `componente_item_receta`: `id`, `item_receta_id`, `droga_id`, `cantidad numeric NULL` (NULL si c.s.p.), `unidad_medida_id NULL`, `es_principio_activo`, `es_cantidad_suficiente`, `orden`. Checks: c.s.p. ⇔ cantidad NULL; a lo sumo un c.s.p. por ítem (índice único parcial) **[PROPUESTA]**; UNIQUE(item_receta_id, orden).
  - `receta_estado_historial` **[PROPUESTA]**.
- **Máquina de estados** (valores del diagrama; transiciones **[PROPUESTA]**, DP-16):
  ```
  PENDIENTE_PREPARACION → EN_PREPARACION   (se inicia la 1ª preparación)
  EN_PREPARACION → PREPARADA               (todos los ítems con preparación CONFIRMADA; en la tx de confirmar, INV-P03.4)
  PREPARADA → LISTA_PARA_RETIRAR           (etiqueta impresa / acción manual — DP-16)
  LISTA_PARA_RETIRAR → ENTREGADA           (retiro presencial; requiere receta_fisica_recibida — INV-R07)
  LISTA_PARA_RETIRAR → ENVIADA_PEND_FIRMA  (envío; firma de recepción pendiente)
  ENVIADA_PEND_FIRMA → ENTREGADA           (firma recibida + receta_fisica_recibida)
  {PENDIENTE_PREPARACION, EN_PREPARACION} → ANULADA  (sin preparaciones confirmadas)
  {PREPARADA, LISTA_PARA_RETIRAR, ENVIADA_PEND_FIRMA} → ANULADA  (DP-16: exige AnulacionAsiento + AJUSTE?)
  ```
  Sin retrocesos (INV-R08). Descarte de una preparación INICIADA con otras aún pendientes ⇒ la receta permanece EN_PREPARACION (no es retroceso). ENTREGADA y ANULADA son terminales.
- **Invariantes**: INV-R01 [BD constraint trigger diferido: ≥1 ítem], INV-ITM-001 ≥1 componente por ítem [BD], INV-R07 [BD check + APP], INV-R08 [APP + trigger de transiciones], INV-R09 [BD + APP], INV-R10 [APP].
- **Historias**:
  1. ATP/FAR carga receta (paciente, médico — alta rápida si no existe —, fechas, origen, adjunto, ítems con fórmula). *Criterios*: validación fecha_prescripcion ≤ hoy; adjunto obligatorio para digitales (PDF/JPG/PNG, tamaño máx., escaneo de tipo MIME real); auditoría alta.
  2. Editar receta mientras esté PENDIENTE_PREPARACION y sin fichas con preparación.
  3. Registrar recepción de receta física (fecha y usuario) — también a posteriori (regularización).
  4. Anular receta con motivo (según estado).
  5. Listado con filtros (estado, paciente, médico, fechas, pendientes de receta física) y búsqueda por número.
- **Almacenamiento de adjuntos**: DP-29 (disco local cifrado vs S3). Descarga solo vía route handler con `authorize`; nunca URL pública.
- **NO HACER**: no permitir retroceder estados; no entregar sin receta física; no bloquear la preparación por falta de receta física; no guardar el adjunto en `public/`; no confiar en la extensión del archivo.
- **DoD**: DDL, estados con trigger, CRUD, adjuntos seguros, listados, auditoría (alta, cambio de estado, anulación [CONFIRMADO]), tests de transición completos.

### M10. Ficha técnica y Cotización

- **Entidades**:
  - `ficha_tecnica`: `id`, `item_receta_id`, `version int`, `generada_en`, `generada_por_id`. UNIQUE(item_receta_id, version). (Diagrama dice 1—1; se corrige a 1..* por INV-R05.)
  - `linea_pesaje`: `id`, `ficha_tecnica_id`, `droga_id`, `cantidad_a_pesar numeric > 0`, `unidad_medida_id`, `orden`, `droga_nombre_snapshot` **[PROPUESTA, INV-F05]**.
  - `cotizacion`: `id`, `item_receta_id`, `costo_insumos`, `margen_aplicado`, `precio_final`, `regla_precio_id`, `calculada_en`, `calculada_por_id`, `detalle jsonb` (costo por línea y partida usada para costear — **PROPUESTA**).
- **Invariantes**: INV-R02 [APP] (casos de uso sin escrituras en stock/libro; test lo verifica), INV-R03 [BD diferido], INV-R04 [BD: check >0 + trigger inmutable], INV-R05 [BD: trigger rechaza UPDATE/DELETE de ficha y líneas si existe preparación; en la práctica, fichas y líneas inmutables siempre **PROPUESTA**], INV-R06 [APP: vigente = max(calculada_en)].
- **Cálculo de la ficha**: **BLOQUEADO por DP-06c** — falta la regla de cálculo (cantidad total × concentración, % p/p, c.s.p. = total − Σ resto, exceso de pesada/merma técnica, conversiones de unidad y densidad). Se implementa como función pura `calcularLineasPesaje(item, drogas, unidades)` con tests de tabla una vez definida.
- **Costeo de cotización**: **DP-09** (¿costo de qué partida? propuesta: la que proponga el reparto INV-S14, sin reservar).
- **Historias**: FAR genera/regenera ficha (nueva versión) e imprime PDF; ATP/FAR cotiza un ítem y ve historial.
- **NO HACER**: no descontar stock, asentar ni consumir correlativo al generar ficha/cotización; no recalcular líneas leyendo el maestro; no borrar cotizaciones previas; no auditar fichas/cotizaciones (INV-A01).
- **DoD**: generación versionada, PDF de ficha, cotización histórica, tests de cálculo (tras DP-06c), test de "sin efectos".

### M11. Preparación (núcleo transaccional)

- **Dependencias**: M07, M09, M10, M12 (tablas del libro).
- **Entidades**: `preparacion` (`id`, `ficha_tecnica_id`, `preparada_por_id`, `iniciada_en`, `iniciada_por_id`, `confirmada_en`, `estado`, `motivo_descarte`, `descartada_por_id`), `etiqueta` (`id`, `preparacion_id UNIQUE`, `contenido`, `generada_en`, `impresa`, `impresa_en`, `impresa_por_id`), `reparto_propuesto` transitorio (no persiste; el desvío se registra en el movimiento).
- **Máquina de estados**: `INICIADA → CONFIRMADA` (terminal), `INICIADA → DESCARTADA` (terminal). CONFIRMADA → nada (INV-P05); descarte posterior físico = AJUSTE `PREPARACION_DESCARTADA` sobre las partidas consumidas (DP-16b: ¿también anula el asiento?).
- **Invariantes**: INV-P01 [BD FK NOT NULL], INV-P02 [BD índice único parcial `(ficha_tecnica_id) WHERE estado <> 'DESCARTADA'`] + **INV-PRP-003 [PROPUESTA]** a lo sumo una preparación CONFIRMADA por ítem de receta, INV-P03 [BD + APP], INV-P04 [BD constraint trigger diferido bidireccional], INV-P05 [BD trigger], INV-P06 [APP: de la sesión].
- **Flujo principal de confirmación** (`confirmarPreparacion(preparacionId, repartoSeleccionado)`):
  1. requireSession + re-autenticación (INV-X02) + `authorize('preparaciones.confirmar')`.
  2. `BEGIN` (READ COMMITTED + locks explícitos).
  3. Lock `preparacion FOR UPDATE`; verificar INICIADA; verificar jornada actual sin CierreDiario.
  4. Por cada LineaPesaje (orden): partidas elegidas `FOR UPDATE` (orden por id); verificar no vencidas (S10); calcular reparto (S13/S19/S20) en unidad base; si alguna no alcanza ⇒ error "stock insuficiente" (sin absorber diferencias, S21).
  5. INSERT MovimientoStock EGRESO_PREPARACION por consumo (trigger descuenta, marca apertura).
  6. Tomar número del **contador sin huecos** (ver M12) y hash previo; INSERT AsientoRecetario + DetalleAsiento (texto congelado).
  7. Por cada droga controlada consumida: INSERT AsientoContralor con `saldo_posterior` (Σ disponible de la droga post-movimiento).
  8. UPDATE preparación → CONFIRMADA (`preparada_por_id` = sesión, `confirmada_en = now()`); actualizar estado de Receta.
  9. Auditoría (preparación confirmada, movimientos, asiento, contralor).
  10. `COMMIT` (constraint triggers diferidos validan P04, S12, R-coherencia).
- **Flujos alternativos**: el farmacéutico cambia partidas propuestas (desvío registrado); abre una segunda partida con motivo (S18); falta stock ⇒ debe ingresar partida o ajustar antes; jornada ya firmada (DP-18b) ⇒ rechazo.
- **Errores**: cualquier fallo ⇒ ROLLBACK total; el número correlativo **no** se consume (contador en tabla, no SEQUENCE).
- **Cancelación**: usuario abandona antes de confirmar ⇒ preparación queda INICIADA; puede descartarse con motivo.
- **Concurrencia**: dos terminales confirmando la misma preparación ⇒ lock de fila + chequeo de estado ⇒ una falla con "ya confirmada"; dos preparaciones distintas sobre la misma partida ⇒ serializadas por `FOR UPDATE`; timeouts de lock (`lock_timeout`) con reintento controlado.
- **Etiqueta**: generar/imprimir tras CONFIRMADA; contenido según DP-28; impresión no auditada [CONFIRMADO].
- **Tests**: integración de la transacción completa; inyección de fallo en cada paso (1..8) ⇒ nada persiste; concurrencia con 2 conexiones reales; reparto (unit, tabla de casos: una partida exacta, varias, abierta + siguiente, vencida excluida, insuficiente); INV-P04 intentando crear asiento sin preparación por SQL.
- **NO HACER**: no dividir la confirmación en varias requests/transacciones; no dejar que el usuario edite cantidades del reparto; no tomar `preparada_por_id` del formulario; no usar `SEQUENCE` para el correlativo; no confirmar con sesión de otro usuario; no permitir descontar de partida vencida.
- **DoD**: flujo completo con UI `/preparaciones/[id]` (propuesta de partidas, desvío, confirmación con re-auth), etiqueta PDF, tests de atomicidad/concurrencia verdes, auditoría.

### M12. Registro legal — Libro recetario y Contralor

- **Entidades**:
  - `asiento_recetario`: `tenant_id`, `id`, `numero_correlativo bigint NOT NULL` (UNIQUE `(tenant_id, numero_correlativo)` — INV-L04 "único por tenant"), `fecha_asiento date NOT NULL` (= jornada de inserción, fijada por trigger), `item_receta_id`, `preparacion_id NULL`, `medico_id`, `cantidad_unidades`, `origen_carga (SISTEMA|DIGITALIZACION_HISTORICA)`, `cierre_diario_id NULL`, `estado (VIGENTE|ANULADO)`, `hash_integridad text NOT NULL`, `hash_anterior text NOT NULL`, `registrado_por_id`, `registrado_en`, + snapshot textual: `paciente_texto`, `medico_texto` (nombre, matrícula), `formula_texto` (INV-L05) **[PROPUESTA columnas snapshot]**.
  - `detalle_asiento`: `id`, `asiento_recetario_id`, `descripcion`, `cantidad`, `unidad_texto`, `es_cantidad_suficiente` (duplicado del diagrama eliminado), `orden`. Inmutable. (Los métodos `anular/estaFirmado` del diagrama pertenecen al asiento, no al detalle.)
  - `asiento_contralor`: `id`, `asiento_recetario_id`, `tipo_libro (PSICOTROPICO|ESTUPEFACIENTE)`, `numero_correlativo` (UNIQUE `(tenant_id, tipo_libro, numero_correlativo)`), `droga_id`, `droga_texto`, `cantidad_utilizada`, `saldo_posterior`, `hash_integridad`, `hash_anterior`.
  - `anulacion_asiento`: `id`, `asiento_id UNIQUE` (0..1), `motivo NOT NULL`, `anulado_por_id`, `autorizado_por_id NOT NULL`, `anulado_en`.
  - `contador_correlativo` (PK `(tenant_id, clave)`, `ultimo_valor bigint`, `ultimo_hash text`; una fila por tenant y clave, creada al dar de alta el tenant): claves `RECETARIO`, `CONTRALOR_PSICOTROPICO`, `CONTRALOR_ESTUPEFACIENTE`. **[PROPUESTA — resuelve la contradicción INV-L03 vs INV-L04]**: una `SEQUENCE` de Postgres deja huecos ante rollback (viola "sin saltos"); un contador en fila bloqueada `FOR UPDATE` dentro de la misma tx es generado por la BD, transaccional y sin huecos, y además serializa la cadena de hash. Se asigna por **trigger BEFORE INSERT** (la app nunca envía el número). Ver DP-31 para confirmación.
- **Invariantes**: INV-L01 [BD triggers + grants], INV-L02 [BD trigger por columna: solo `cierre_diario_id` NULL→valor y `estado` VIGENTE→ANULADO], INV-L03/L04 [BD contador + UNIQUE + check de continuidad `numero = ultimo+1`], INV-L05 [APP snapshots], INV-L06 [APP; **PROPUESTA** calcular en trigger con `pgcrypto` para que no dependa de la app — DP-32], INV-L07 [BD check `(origen_carga='SISTEMA') = (preparacion_id IS NOT NULL)`], INV-L08 [BD+APP], INV-L09 [BD: anular = INSERT anulacion + trigger que pasa estado a ANULADO], INV-C03 sobre asientos [BD].
- **Hash**: `SHA-256(canonical_json(campos del asiento + detalles) || hash_anterior)`; génesis = hash de constante documentada. Serialización canónica versionada (`version_formato`).
- **Historias**:
  1. FAR/DT/SC consulta el libro por rango de fechas/números, ve asientos anulados con su anulación, exporta PDF/CSV.
  2. FAR solicita anulación con motivo; DT autoriza (co-firma, igual que ajustes) — solo si la jornada del asiento no está firmada (INV-C03; DP-16c para asientos de jornadas firmadas).
  3. DT verifica integridad de la cadena (recalcula hashes y reporta primer quiebre).
  4. DT digitaliza asientos históricos (origen DIGITALIZACION_HISTORICA, sin stock) — **DP-17** (numeración, fecha, cierre).
  5. Consulta libro contralor por tipo y droga con saldos.
- **Auditoría**: creación y anulación [CONFIRMADO].
- **NO HACER**: no calcular correlativos con MAX+1 ni en la app; no usar SEQUENCE; no exponer endpoints de update/delete sobre asientos; no editar un asiento para corregirlo; no resolver datos del médico/fórmula por FK al mostrar el asiento (usar snapshot); no reasignar números anulados.
- **DoD**: DDL + triggers + grants; tests SQL de cada invariante como `fsj_app` y como `fsj_owner`; verificación de cadena; consulta/exportación; anulación con co-firma DT.

### M13. Cierre diario y Firma

> **Decisión del usuario**: el modelo de **Libro rubricado** (folios, fojas) debe consultarse con la **Asociación de Farmacias** y **no se toma como 100% cierto**. Por eso M13 se parte en dos: **M13a Cierre diario y firma** (firme, se implementa) y **M13b Libro rubricado y folios** (**SUJETO A VALIDACIÓN — DP-38**, se implementa solo después). **FojaInutilizada se QUITA** (INV-C16 e historia 6 fuera de alcance).
> **[PROPUESTA TÉCNICA]** Desacoplar: `cierre_diario` **no** lleva `libro_id`/`folio_*`. La vinculación a folios vive en una tabla aparte (`asignacion_folio`) que M13b agrega después. Así, si la Asociación cambia el modelo, el núcleo de firma no se toca ni se migra.

#### M13a. Cierre diario y firma (se implementa)

- **Entidad** `cierre_diario`: `tenant_id`, `id`, `fecha date` (UNIQUE `(tenant_id, fecha)`), `director_tecnico_id`, `designacion_id` **[PROPUESTA]**, `matricula_dt text`, `cantidad_asientos`, `hash_lote`, `sello_tiempo timestamptz`, `mecanismo_firma`, `version_formato`, `fecha_impresion NULL`, `impreso_por_id NULL`, `fecha_firma timestamptz DEFAULT now()`, `fuera_de_termino bool`, `motivo_demora motivo_demora NULL` (enum, DP-18c), `motivo_demora_detalle text`.
- **Invariantes**: INV-C01 [BD UNIQUE (tenant_id, fecha)], INV-C02 [BD+APP: en la tx de firma, UPDATE de todos los asientos VIGENTE de la fecha y check final de que no queda ninguno sin vincular], INV-C03 [BD triggers en asiento/anulación/movimiento], INV-C04 [BD sin DELETE; UPDATE solo de columnas de impresión], INV-C05 [APP; hash de asientos ordenados por número], INV-C06/C07 [APP], INV-C17 [BD+APP: la ausencia de firma no bloquea], INV-C18 [BD check `fuera_de_termino` calculado por trigger y `NOT fuera_de_termino OR motivo_demora IS NOT NULL`], INV-C19 [BD trigger: no existe fecha anterior con asientos sin cierre — DP-18d para jornadas sin asientos], INV-C20 [BD trigger fuerza `fecha_firma = now()`], INV-U04 [BD+APP].
- **Flujo de firma** (`firmarCierre(fecha, motivoDemora?)`):
  1. Sesión + re-autenticación del DT + DT vigente a `fecha`.
  2. `BEGIN`; lock de serialización de cierres del tenant (`pg_advisory_xact_lock(hash(tenant_id))`); verificar orden cronológico (C19) y que `fecha < hoy` o política DP-18.
  3. Seleccionar asientos VIGENTE de la fecha ordenados por número; calcular `hash_lote`.
  4. INSERT cierre (trigger calcula `fuera_de_termino`, `fecha_firma`), UPDATE asientos (`cierre_diario_id`).
  5. Auditoría (FIRMAR, incl. tardía). `COMMIT`.
  6. Generar PDF del comprobante; registrar `fecha_impresion`/`impreso_por_id` al imprimir.
- **Historias** [CONFIRMADO 7, 8, 9]: alerta destacada de jornadas sin firmar con antigüedad; firma fuera de término con motivo; reporte de cumplimiento (fecha, fecha de firma, demora, motivo).
- **Libros contralor**: ¿se firman/imprimen también? **DP-33**.
- **NO HACER**: no permitir fecha de firma enviada por el cliente; no firmar fechas salteadas; no revertir ni borrar cierres; no bloquear la operación diaria por firmas pendientes; no acoplar la firma al modelo de libro/folios.
- **DoD**: DDL + triggers; firma con re-auth; PDF del comprobante; alertas; reporte de cumplimiento; tests de concurrencia (dos firmas simultáneas de la misma fecha / fechas consecutivas).

#### M13b. Libro rubricado y folios (SUJETO A VALIDACIÓN — DP-38; no se implementa hasta confirmarlo)

Modelo **tentativo** según el diagrama y la doc, a revisar con la Asociación de Farmacias:
- `libro_rubricado`: `tenant_id`, `id`, `tipo (RECETARIO|PSICOTROPICO|ESTUPEFACIENTE)`, `numero_libro` (UNIQUE `(tenant_id, tipo, numero_libro)`), `cantidad_fojas > 0`, `folio_actual int DEFAULT 0`, `fecha_rubrica`, `expediente_rubrica`, `fecha_cierre NULL`, `registrado_por_id`.
- `asignacion_folio` **[PROPUESTA]**: `tenant_id`, `cierre_diario_id UNIQUE`, `libro_id`, `folio_desde`, `folio_hasta`; `EXCLUDE USING gist (libro_id WITH =, int4range(folio_desde, folio_hasta, '[]') WITH &&)`.
- `correccion_folio` **[PROPUESTA]**: anterior/nuevo, motivo opcional, usuario, fecha.
- Invariantes tentativas: INV-C08, C09, C10, C11, C12, C13, C14, C15. **INV-C16 QUITADA** (sin fojas inutilizadas).
- Historias tentativas: DT registra libro nuevo y cierra el agotado; alerta de folios por debajo del umbral; corregir folio con motivo, sin solapamiento, auditado con anterior/nuevo.
- Preguntas para la Asociación: ver DP-38.
- **NO HACER**: no implementar nada de M13b antes de validar; no crear `foja_inutilizada`; no editar `folio_actual` a mano; no dejar que la corrección de folio toque hash, asientos o firma.

### M14. Entrega y Regularización

- **Entidad** `entrega`: `id`, `receta_id UNIQUE`, `modalidad` (enum no definido: **DP-34**, propuesta `RETIRO_PRESENCIAL, ENVIO`), `entregada_por_id`, `entregada_en`, `firma_recibida bool`, `firma_recibida_en`, `fecha_archivo_receta date`.
- **Invariantes**: INV-R07 [BD trigger: no ENTREGADA sin `receta_fisica_recibida`], INV-R09, INV-R10 [APP listado + alerta por parámetro].
- **Historias**: ATP registra retiro presencial (verifica receta física); registra envío ⇒ ENVIADA_PEND_FIRMA; confirma firma recibida ⇒ ENTREGADA; ve listado de regularización (recetas con asiento y sin receta física, antigüedad, alerta por plazo).
- **DoD**: flujo de entrega con transiciones de estado, auditoría de cambio de estado, listado de regularización con alertas.

### M15. Archivo de recetas y Destrucción

- **Entidad** `lote_archivo_recetas`: campos del diagrama (con `tenant_id`) + `registrado_por_id`, `registrado_en`. Estado `EN_ARCHIVO → PLAZO_CUMPLIDO → DESTRUCCION_SOLICITADA → DESTRUCCION_AUTORIZADA → DESTRUIDO`. `receta.lote_archivo_id` (N:1).
- **Invariantes**: INV-D01 [APP: solo recetas físicas; los asientos no se tocan], INV-D02 [BD check `estado <> 'DESTRUIDO' OR (expediente_autorizacion IS NOT NULL AND fecha_autorizacion IS NOT NULL)`], INV-D03 [APP; plazos por parámetro, DP-26], INV-D04 [APP], INV-D05 [BD trigger: DESTRUIDO inmutable], INV-ARC-006 una receta pertenece a un solo lote; solo recetas con receta física recibida y ENTREGADA/ANULADA pueden archivarse **[PROPUESTA]**.
- **Historias** 3, 4, 5 [CONFIRMADO]: conformar lote (período, numeración, ubicación, controladas); alerta de plazo cumplido (proceso diario con usuario técnico SISTEMA pasa a PLAZO_CUMPLIDO); registrar solicitud, autorización (expediente) y destrucción.
- **Proceso automático**: job diario (cron del host o route handler con secreto) — **PROPUESTA**; auditado como SISTEMA.
- **DoD**: CRUD de lotes, máquina de estados con trigger, alertas, auditoría (conformación y destrucción [CONFIRMADO]), tests de INV-D02/D05.

### M16. Reportes y Alertas (Tablero)

- Tablero por rol: jornadas sin firmar (DT), folios por debajo del umbral (DT), recetas pendientes de regularización, partidas por vencer/vencidas con saldo, drogas bajo mínimo, lotes con plazo cumplido.
- Reportes: stock valorizado por partida (costo real), kardex, libro recetario, libros contralor, cumplimiento de firma, auditoría, recetas por estado.
- Solo lectura; paginados; exportación CSV/PDF; permisos por reporte. No auditados salvo exportación del libro (DP-27).
- **DoD**: cada reporte con filtros, permisos, test de consulta y de autorización.

---

## 10. Modelo de datos (resumen)

Todas las tablas: PK `uuid` (`gen_random_uuid()`), `timestamptz` en UTC, jornada derivada en la TZ del tenant. **Toda tabla de negocio: `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)`, FK compuestas, RLS habilitado, trigger INV-T03.** Globales sin tenant: `tenant`, `rol`, `permiso`, `rol_permiso` (y `unidad_medida` según DP-39). `ON DELETE RESTRICT` en todas las FK de negocio.

| Grupo | Tablas | Inmutable (trigger + sin grant) |
|---|---|---|
| Plataforma | tenant, parametro | — (tenant: sin DELETE) |
| Acceso | usuario, rol, permiso, rol_permiso, usuario_rol, credencial_activacion, sesion, usuario_estado_historial, designacion_director_tecnico | usuario (no DELETE) |
| Catálogos | unidad_medida, droga, proveedor, medico, paciente, regla_precio | (no DELETE) |
| Stock | partida, movimiento_stock | movimiento_stock (total) |
| Recetas | receta, item_receta, componente_item_receta, receta_estado_historial, entrega | — |
| Elaboración | ficha_tecnica, linea_pesaje, cotizacion, preparacion, etiqueta | ficha_tecnica, linea_pesaje, cotizacion |
| Legal | contador_correlativo, asiento_recetario, detalle_asiento, asiento_contralor, anulacion_asiento | todas (excepción INV-L02) |
| Cierre | cierre_diario | total salvo columnas de impresión |
| Libros (TENTATIVO, DP-38) | libro_rubricado, asignacion_folio, correccion_folio | asignacion_folio (salvo corrección auditada), correccion_folio |
| Archivo | lote_archivo_recetas | cuando DESTRUIDO |
| Auditoría | registro_auditoria | total |

**Reglas en BD**: todas las marcadas [BD] arriba (checks, uniques, parciales, exclusiones, triggers de inmutabilidad y transición, constraint triggers diferidos, grants por columna, contador sin huecos, fechas del servidor).
**Reglas en APP**: propuesta de partidas, cálculos de ficha/cotización, snapshots, hash (salvo DP-32), alertas, re-autenticación, orquestación transaccional, autorización por permiso.
**Enums a definir** (no están en el diagrama): `tipo_magnitud`, `tipo_accion`, `modalidad_entrega`, `motivo_demora`.

## 11. Flujos principales

1. **Alta de usuario**: ADM crea → PENDIENTE + credencial 72 h (mostrada una vez) → titular activa → ACTIVO.
2. **Ingreso de partida**: FAR carga → partida + INGRESO_COMPRA (una tx) → stock visible.
3. **Receta → entrega**: alta receta → ficha técnica (v1) → cotización → iniciar preparación → confirmar (tx atómica M11) → etiqueta → LISTA_PARA_RETIRAR → entrega (con receta física) → ENTREGADA.
4. **Cierre diario**: jornada termina → alerta al DT → firma con re-auth → folios asignados → PDF impreso → adherido al libro.
5. **Archivo**: lote conformado → plazo cumplido (job) → solicitud → autorización → destrucción.

## 12. Flujos excepcionales

- Stock insuficiente al confirmar ⇒ rollback; ajuste o ingreso previo.
- Diferencia física detectada ⇒ AJUSTE DIFERENCIA_ARQUEO antes de preparar (S21).
- Preparación fallida físicamente antes de confirmar ⇒ DESCARTADA con motivo (sin stock afectado).
- Preparación confirmada y luego descartada físicamente ⇒ AJUSTE PREPARACION_DESCARTADA (DP-16b sobre el asiento).
- Error en asiento ⇒ anulación con motivo + autorización DT, en jornada no firmada.
- Firma tardía ⇒ `fuera_de_termino` + motivo.
- (Tentativo, DP-38) Folio mal registrado ⇒ corrección auditada; libro agotado ⇒ alerta por umbral, nuevo libro.
- Intento de acceder a datos de otro tenant (URL manipulada con id ajeno) ⇒ RLS no devuelve la fila ⇒ 404 (no 403, para no revelar existencia).
- Receta digital sin físico ⇒ se prepara y asienta; no se entrega; listado de regularización.
- Usuario pierde contraseña ⇒ restablecimiento por ADM.
- DT sin designación vigente ⇒ no firma ni autoriza; el sistema indica el motivo.
- Sesión expira durante confirmación ⇒ la tx no inicia; re-login; la preparación sigue INICIADA.

## 13. Seguridad

- Autenticación: argon2id, sesiones opacas revocables, rotación, expiración por inactividad/absoluta, bloqueo por intentos, rate limit (login, activación, reauth).
- Autorización: `authorize` en **cada** Server Action / route handler (test automático que recorre el registro de acciones y verifica que todas llaman a `authorize`), guardas de layout para pantallas, BD como última barrera.
- Entrada: zod en el servidor para todo input; nunca confiar en validación de cliente.
- SQL injection: solo queries parametrizadas (Prisma / `$queryRaw` con template tag; prohibido `$queryRawUnsafe` con input); prohibido concatenar.
- XSS: React escapa por defecto; prohibido `dangerouslySetInnerHTML`; PDFs generados server-side; CSP estricta en `next.config.ts` headers.
- CSRF: Server Actions (verificar protección de Origin en docs de Next 16) + chequeo de `Origin` en route handlers mutantes + `SameSite=Lax`.
- Archivos: validación de MIME real, tamaño máximo, almacenamiento fuera de `public/`, descarga autorizada.
- Secretos: `.env` por ambiente validado con zod; nunca en el repo; credenciales de `fsj_owner` solo en CI/migraciones.
- Datos sensibles (pacientes, recetas): no se loguean; acceso por permiso; backups cifrados (DP-24).
- Errores seguros: mensaje genérico + código + request-id; stack solo en logs del servidor.
- Headers: HSTS, X-Content-Type-Options, frame-ancestors none, Referrer-Policy.
- Privilegios BD: `fsj_app` sin DDL, sin UPDATE/DELETE en tablas legales, grants por columna donde aplique.

## 14. Auditoría

Tabla de la doc (INV-A01) [CONFIRMADO] + propuestas: Proveedor/Médico/Paciente (alta/modificación/baja), Parámetros/Farmacia, activación de cuenta, bloqueo por intentos, desvío de propuesta de partidas, verificación de cadena de hash con resultado, exportación del libro (DP-27). Campos: usuario, fecha, entidad, id, acción, anterior, nuevo, motivo, autorizado_por, IP, contexto. Inmutable y sin purga. **No se audita**: consultas, listados, fichas técnicas, cotizaciones, impresión de etiquetas, navegación [CONFIRMADO].

## 15. Integraciones

Ninguna obligatoria. Potenciales (fuera de alcance salvo decisión): email/SMS para credenciales (DP-05), almacenamiento S3 (DP-29), TSA RFC 3161 y firma digital certificada (DP-19), impresora de etiquetas (DP-28), validación de matrícula/credenciales de obras sociales (DP-30).

---

## 16. Plan de implementación por fases

> Cada PUNTO = una unidad implementable, testeable y revisable (idealmente un PR ≤ 400 líneas; si no, chained PRs). Formato: `F.P` — descripción → subtareas → DoD específico. El DoD global (§18) aplica además a todos.

### FASE 0 — Fundaciones
- **0.1 Tooling**: agregar deps (drizzle-orm, drizzle-kit, pg/postgres, zod, decimal.js, @node-rs/argon2, pino, vitest, @testcontainers/postgresql, playwright); scripts `db:migrate`, `db:seed`, `test`, `test:db`, `test:e2e`, `typecheck`. DoD: `npm run typecheck && npm run lint && npm test` verdes en CI.
- **0.2 Estructura de carpetas** `modules/`, `shared/`, `db/migrations/`, `tests/` + README de arquitectura. DoD: regla ESLint que impide que `modules/A/domain` importe infraestructura, y que `app/` importe `infrastructure/` directo.
- **0.3 Entorno**: Prisma + Supabase, `env.ts` con zod (`DATABASE_URL`, `DIRECT_URL`, `FSJ_APP_DB_PASSWORD`, `TEST_*`), `.env.example`. DoD: la app no arranca con env inválido.
- **0.4 Roles de BD**: migración `0000_roles.sql` (`fsj_owner`, `fsj_app`, extensiones `pgcrypto`, `citext`, `btree_gist`). DoD: test conecta como `fsj_app` y no puede crear tablas.
- **0.5 Infra transversal**: cliente BD, `withTransaction`, mapeo de errores de BD (`INV-XXX` en MESSAGE), `ErrorSeguro`, logger con request-id, `jornadaDe()`, utilidades Decimal. DoD: tests unitarios.
- **0.6 Harness de tests de BD**: proyecto Supabase de tests (guardas: nunca apuntar al de desarrollo) + `prisma migrate reset` + helper `asApp(sql)` / `asOwner(sql)` + helper `expectInvariantViolation('INV-S04')`. DoD: un test de ejemplo verde.
- **0.7 CI** (GitHub Actions): typecheck, lint, unit, db, build. DoD: pipeline verde.

### FASE 1 — Esquema y garantías de BD (SQL primero, como pide la doc)
> Cada punto: migración SQL + tests de BD que prueban cada invariante [BD] con SQL crudo como `fsj_app`. Sin UI.
- **1.1** Tenant, parámetros, enums globales, **infraestructura multi-tenant**: función/trigger genérico INV-T03, plantilla de política RLS, helper de migración `make_tenant_table(nombre)` que aplica `tenant_id NOT NULL` + `UNIQUE(tenant_id,id)` + RLS + trigger; test de aislamiento con dos tenants.
- **1.2** Usuarios/roles/permisos/usuario_rol + INV-U02 (diferido), U03, transiciones de estado, seeds de roles/permisos, usuario técnico SISTEMA por tenant, primer ADM por tenant (DP-04/DP-37).
- **1.3** Registro de auditoría + inmutabilidad (INV-A02, A03).
- **1.4** Credenciales y sesiones.
- **1.5** Designación DT + exclusión de titulares + función `es_dt_vigente(usuario, fecha)`.
- **1.6** Unidades de medida (M02, M03, M04) + función `convertir`.
- **1.7** Drogas, proveedores, médicos, pacientes (F03, restricciones de borrado).
- **1.8** Partidas + movimientos (S01–S09, S16, S17, alta de partida con INGRESO diferido, grants por columna).
- **1.9** Recetas, ítems, componentes (R01, estados + trigger de transiciones, R07).
- **1.10** Fichas, líneas, cotizaciones, reglas de precio (R03, R04, R05, inmutabilidad).
- **1.11** Preparación, etiqueta (P01, P02, P05) — P04 se completa en 1.12.
- **1.12** Contador correlativo, asientos, detalle, contralor, anulación (L01–L04, L07, L09, P04 diferido bidireccional, S12/S13/S19/S20 diferido).
- **1.13** Cierre diario (C01–C04, C17–C20 [BD]). Libro rubricado/folios **NO** (DP-38). Sin foja inutilizada.
- **1.14** Entrega, lote de archivo (D02, D05).
- **1.15** Grants finales de `fsj_app` + test que enumera todas las tablas legales y verifica ausencia de UPDATE/DELETE (INV-X01).
- DoD de fase: test automático recorre `information_schema` y verifica en cada tabla de negocio `tenant_id NOT NULL`, RLS habilitado + forzado, trigger INV-T03 y FK compuestas; `npm run test:db` cubre **cada** invariante [BD] con al menos un caso que debe fallar y uno que debe pasar; matriz INV→test en §19 actualizada.

### FASE 2 — Autenticación y acceso
- **2.1** Sesiones (crear, validar, revocar, expirar) con `tenant_id` del usuario guardado en la sesión, `requireSession()` que devuelve `{usuario, tenantId}` y setea `app.tenant_id` en la transacción, `proxy.ts` optimista. Resolución de tenant en el login según DP-40. Tenant dado de baja ⇒ login rechazado.
- **2.2** Login/logout + bloqueo + rate limit + UI `/login`.
- **2.3** Activación con credencial + UI `/activar`.
- **2.4** Cambio de contraseña + UI `/cuenta`.
- **2.5** Re-autenticación (step-up) reutilizable (`requireRecentReauth(minutos)` + componente modal).
- **2.6** `authorize(permiso)`, `can()`, guardas de layout, test "toda acción llama a authorize".
- **2.7** `audit.record` integrado al helper de caso de uso.
- DoD: E2E login/logout/activación; PENDIENTE/SUSPENDIDO/BAJA rechazados; tests de autorización.

### FASE 3 — Administración
- **3.1** Usuarios: listado/búsqueda/filtros/paginación.
- **3.2** Alta con credencial (cartel 72 h).
- **3.3** Edición datos personales.
- **3.4** Roles (asignar/quitar con reglas).
- **3.5** Suspender/reactivar/baja.
- **3.6** Restablecer credencial.
- **3.7** Detalle + historial de auditoría por usuario.
- **3.8** Catálogo de roles/permisos (lectura; edición si DP-03).
- **3.9** Designaciones DT (alta, cese, vigente hoy).
- **3.10** Datos del tenant (farmacia) y parámetros.
- **3.12** Consola de operador de plataforma: alta/baja de tenant + primer ADM con credencial (tras DP-37).
- **3.11** Visor de auditoría global.
- DoD: matriz de autorización de admin 100% testeada; E2E ciclo de vida de usuario.

### FASE 4 — Catálogos
- **4.1** Unidades de medida (ADM). **4.2** Drogas. **4.3** Proveedores. **4.4** Médicos. **4.5** Pacientes. **4.6** Reglas de precio (tras DP-09).
- Cada uno: listado+búsqueda+filtros+paginación, alta, edición, baja/reactivación con motivo, validaciones, auditoría, tests de autorización.

### FASE 5 — Stock
- **5.1** Ingreso de partida. **5.2** Consulta de stock por droga y partida + kardex. **5.3** Co-firma DT reutilizable (tras DP-08b). **5.4** Ajustes/mermas. **5.5** Corrección de costo. **5.6** Función pura de propuesta y reparto (S13–S20) con tests de tabla. **5.7** Alertas de stock/vencimiento. **5.8** Test de concurrencia de stock.

### FASE 6 — Recetas
- **6.1** Alta de receta con ítems y fórmula (+ alta rápida paciente/médico). **6.2** Adjuntos seguros (tras DP-29). **6.3** Edición en PENDIENTE. **6.4** Recepción de receta física. **6.5** Anulación (tras DP-16). **6.6** Listados/filtros.

### FASE 7 — Ficha técnica y cotización
- **7.1** Motor de cálculo de líneas (tras DP-06c). **7.2** Generación versionada. **7.3** PDF de ficha. **7.4** Cotización + historial (tras DP-09). **7.5** Test "sin efectos" (INV-R02).

### FASE 8 — Preparación
- **8.1** Iniciar/descartar. **8.2** UI de propuesta de partidas con desvío y motivo. **8.3** Transacción de confirmación completa (M11). **8.4** Tests de fallo por paso y concurrencia. **8.5** Etiqueta (tras DP-28).

### FASE 9 — Libro recetario
- **9.1** Consulta y exportación. **9.2** Anulación con co-firma DT. **9.3** Verificación de cadena de hash. **9.4** Libros contralor (consulta). **9.5** Digitalización histórica (tras DP-17).

### FASE 10 — Cierre diario
- **10.1** Firma (en término y fuera de término) con re-auth. **10.2** PDF del comprobante de cierre. **10.3** Alerta de jornadas pendientes. **10.4** Reporte de cumplimiento de firma. **10.5** Concurrencia de firma.
- **10.B (DIFERIDO, tras DP-38)** Libros rubricados, asignación de folios, alerta de umbral, corrección de folio — se replanifica con la respuesta de la Asociación de Farmacias.

### FASE 11 — Entrega y regularización
- **11.1** Retiro presencial. **11.2** Envío y confirmación de firma (tras DP-34). **11.3** Listado de regularización + alerta.
- **Nota (D2 revisado, FASE 9):** `item_receta` no tiene columna de estado propia -- la entrega debe excluir los ítems cuyo asiento SISTEMA esté "sin efecto" (ANULADO o con rectificativo), calculado igual que `todosLosItemsSinEfecto` en `modules/libro/infrastructure/receta-coupling-repository.ts`.

### FASE 12 — Archivo y destrucción
- **12.1** Lotes de archivo. **12.2** Job diario de plazos (usuario SISTEMA). **12.3** Trámite de destrucción.

### FASE 13 — Reportes y tablero
- **13.1** Tablero por rol. **13.2** Stock valorizado, kardex. **13.3** Libro recetario/contralor imprimible. **13.4** Exportaciones.

### FASE 14 — Hardening y despliegue
- **14.1** Headers de seguridad/CSP. **14.2** Rate limiting global. **14.3** Backups cifrados + prueba de restauración (DP-35). **14.4** Observabilidad (logs estructurados, healthcheck `/api/health` con chequeo de BD). **14.5** Despliegue (DP-35) con migraciones como `fsj_owner`. **14.6** Revisión de seguridad completa + E2E de regresión del flujo principal.

## 17. Dependencias entre puntos

```
0.* → 1.1 → 1.2 → 1.3 → 1.4 → 1.5
1.2 → 1.6 → 1.7 → 1.8 ─┐
1.7 → 1.9 → 1.10 → 1.11 → 1.12 → 1.13 → 1.14 → 1.15
1.8 ───────────────────┘ (1.12 depende de 1.8 para S12)
1.15 → 2.* → 3.* → 4.1 → 4.2..4.5 → 5.* → 6.* → 7.* → 8.* → 9.* → 10.* → 11.* → 12.* → 13.* → 14.*
4.6 depende de DP-09; 7.1 de DP-06c; 5.3 de DP-08b; 9.5 de DP-17; 10.B de DP-38 (+DP-21, DP-22); 3.12 de DP-37
```
Paralelizables (con worktrees aislados): 4.3/4.4/4.5; 11.* y 12.1 una vez terminada la FASE 10; 13.* por reporte.

## 18. Definition of Done global

Un punto está TERMINADO solo si:
1. Migración SQL aplicada desde cero y sobre la versión anterior sin errores.
2. Invariantes [BD] del punto con test que prueba el rechazo como `fsj_app`.
3. Casos de uso con `authorize` + zod + transacción + auditoría (cuando corresponde).
4. Tests: unit (reglas puras), integración (BD real), autorización (cada rol permitido/denegado), edge cases, concurrencia si hay riesgo.
5. UI con estados de carga, vacío y error; listados con búsqueda/filtros/paginación; acciones ocultas si no hay permiso (sin reemplazar la verificación del servidor).
6. Errores mapeados a mensajes seguros; ningún stack/SQL expuesto.
7. `typecheck`, `lint`, `build`, todos los tests verdes en CI.
8. Matriz de cobertura (§19) actualizada; sin DP abierta que afecte el punto.
9. Revisión fresca (sub-agente) del diff antes del merge.

## 19. Matriz de cobertura de requisitos

| Requisito | Módulo | Punto | Test | Estado |
|---|---|---|---|---|
| INV-T01 (aislamiento, RLS) | M00 | 1.1, cada tabla | db: consulta como tenant A no ve B | Planificado |
| INV-T02 (sin relaciones cruzadas) | M00 | 1.1, cada tabla | db: FK a fila de otro tenant falla | Planificado |
| INV-T03 (tenant_id inmutable) | M00 | 1.1 | db: UPDATE tenant_id falla | Planificado |
| INV-U01 | M03 | 1.2, 3.2 | authz alta solo ADM | Planificado |
| INV-U02 | M03 | 1.2, 3.4 | db: quitar último rol falla al commit | Planificado |
| INV-U03 | M03 | 1.2 | db: DELETE usuario falla | Planificado |
| INV-U04 | M04, M13 | 1.5, 1.13, 10.3 | db+int: firma sin DT vigente a fecha | Planificado |
| INV-U05 | M07, M12 | 1.8, 5.3, 9.2 | db+int: ajuste/anulación sin DT | Planificado |
| INV-U06 | M07, M12 | 1.8, 1.12 | db: NOT NULL | Planificado |
| INV-U07 | M02, M03 | 1.2, 1.4, 2.3, 3.2 | int: PENDIENTE no opera | Planificado |
| INV-U08 | M02, M03 | 3.6 | int: reset→PENDIENTE, 72 h, auditado | Planificado |
| INV-F03, F05 | M06 | 1.7, 4.2 | db: DELETE droga; int: snapshot | Planificado |
| INV-G01 | M05, M06 | 1.6, 1.7, 4.* | int: baja no ofrecida, histórico resuelve | Planificado |
| INV-M01–M04 | M05 | 1.6, 4.1 | db + unit conversión | Planificado |
| INV-S01–S09 | M07 | 1.8 | db por invariante | Planificado |
| INV-S10 | M07, M11 | 1.8, 8.3 | int: partida vencida | Planificado |
| INV-S11 | M07, M11 | 5.8, 8.4 | concurrencia 2 conexiones | Planificado |
| INV-S12, S13, S19, S20 | M07, M11 | 1.12, 5.6, 8.3 | db diferido + unit reparto | Planificado |
| INV-S14, S15, S18 | M07, M11 | 5.6, 8.2 | unit + int desvío auditado | Planificado |
| INV-S16, S17 | M07 | 1.8 | db | Planificado |
| INV-S21 | M07, M11 | 5.4, 8.3 | int: insuficiente ⇒ rollback | Planificado |
| INV-R01–R06 | M09, M10 | 1.9, 1.10, 7.* | db + int "sin efectos" | Bloqueado parcial (DP-06c, DP-09) |
| INV-R07–R10 | M09, M14 | 1.9, 6.4, 11.* | db + int | Implementado (FASE 11, 2026-09-24) |
| INV-D01–D05, INV-ARC-005/006/007 | M15 | 1.14, 12.* | db + int | Implementado (FASE 12, 2026-09-24, plazos DP-26 PARCIAL) |
| INV-P01–P06 | M11 | 1.11, 1.12, 8.* | db + fallo por paso | Planificado |
| INV-L01–L09 | M12 | 1.12, 9.* | db por invariante + cadena | Planificado (DP-31, DP-32) |
| INV-L18–L20 (rectificativo, jornada firmada) | M12 | 1.12, 9.2 | db por invariante | Implementado (D1, 2026-09-23) |
| INV-L21 (rectificacion_asiento 1↔1) | M12 | 1.12, 9.2 | db: falta rectificacion al commit; rectificacion contra asiento no-RECTIFICATIVO | Implementado (D1, migración 0033) |
| INV-L22 (SISTEMA ⇒ ≥1 detalle al insertar) | M12 | 1.12, 9.1 | db: asiento SISTEMA sin detalle previo falla | Implementado (D4, migración 0034) |
| INV-L23 (detalle congelado tras el asiento) | M12 | 1.12, 9.1 | db: INSERT detalle tardío falla | Implementado (D4, migración 0034) |
| INV-C01–C07, C17–C20 | M13a | 1.13, 10.1–10.5 | db + concurrencia | Implementado (FASE 10, 2026-09-24) |
| INV-C08–C15 | M13b | 10.B | — | SUJETO A VALIDACIÓN (DP-38) |
| INV-C16 (fojas inutilizadas) | — | — | — | QUITADO por decisión del usuario |
| INV-A01–A03 | M01 | 1.3, 2.7, cada caso de uso | db + int por caso | Planificado |
| INV-X01 | M00 | 1.15 | db: enumeración de grants | Planificado |
| INV-X02 | M02 | 2.5, 8.3, 10.3 | int: sin reauth rechaza | Planificado (DP-20) |
| HU1 Unidades alta/baja | M05 | 4.1 | e2e | Planificado |
| HU2 Merma | M07 | 5.4 | int + e2e | Bloqueado parcial (DP-08b) |
| HU3 Lote de archivo | M15 | 12.1 | int | Planificado |
| HU4 Alerta plazo | M15 | 12.2 | int job | Planificado |
| HU5 Destrucción | M15 | 12.3 | int | Planificado |
| HU6 Inutilizar fojas | — | — | — | QUITADO por decisión del usuario |
| HU7 Alerta cierres | M13a | 10.3 | int | Implementado (FASE 10, 2026-09-24) |
| HU8 Firma fuera de término | M13a | 10.1 | db + int | Implementado (FASE 10, 2026-09-24, DP-18c) |
| HU9 Reporte cumplimiento | M13a | 10.4 | int | Implementado (FASE 10, 2026-09-24) |

Cobertura de entidades (responsable / CRUD / permisos / auditoría / UI / tests): todas las tablas de §10 tienen módulo dueño en §9 y punto en §16. Entidades sin UI propia (a propósito): `contador_correlativo`, `sesion`, `rol_permiso` (según DP-03), `detalle_asiento` (se ve dentro del asiento).

## 20. Checklist anti-omisiones

**Autenticación**: [x] Login 2.2 · [x] Logout 2.2 · [x] Alta (administrativa, sin registro público) 3.2 · [x] Activación 2.3 · [x] Forgot Password → N/A autoservicio; restablecimiento por ADM 3.6 · [x] Reset 3.6+2.3 · [x] Cambio de contraseña 2.4 · [x] Sesiones 2.1 · [x] Estados 1.2.
**Usuarios**: [x] Alta · [x] Listado · [x] Búsqueda · [x] Edición · [x] Activación · [x] Desactivación (suspender/baja) · [x] Roles · [x] Permisos (lectura; edición DP-03) · [x] Recuperación de acceso · [x] Auditoría.
**Administración**: [x] Panel `/admin` · [x] Configuración (farmacia) · [x] Catálogos (unidades, reglas de precio) · [x] Parámetros · [x] Usuarios · [x] Roles · [~] Permisos (DP-03) · [x] Operaciones especiales (designación DT, reset, alta de tenant) · [~] Libros rubricados (DP-38) · [—] Fojas inutilizadas (quitado).
**Multi-tenant**: [x] Tenant en todas las tablas de negocio · [x] RLS · [x] FK compuestas · [x] tenant_id inmutable · [x] Tenant desde la sesión · [x] Unicidades por tenant · [x] Contadores/hash por tenant · [x] Jobs por tenant · [x] Tests de aislamiento.
**Negocio** (por módulo M05–M15): crear/consultar/modificar/baja/estados/validaciones/permisos/auditoría/historial/excepciones/errores/concurrencia cubiertos en cada ficha de módulo; integraciones N/A salvo DP.
**Plataforma**: [x] Configuración · [x] Variables de entorno · [x] Seguridad · [x] Logging · [x] Auditoría · [x] Manejo de errores · [x] Migraciones · [x] Seeders (roles, permisos, unidades, SISTEMA, primer ADM) · [x] Tests · [x] Documentación (README arquitectura + runbook) · [~] Deploy (DP-35) · [x] Observabilidad (14.4).

## 21. Decisiones pendientes

> Formato: qué falta · por qué importa · qué afecta · opciones (la primera es mi recomendación técnica, **no** requisito).

- **DP-01 RESUELTA**: se agrega `PENDIENTE_ACTIVACION` a `EstadoUsuario` (valores: PENDIENTE_ACTIVACION, ACTIVO, SUSPENDIDO, BAJA).
- **DP-02** ¿Una BAJA de usuario es reversible? INV-G01 sugiere reactivación con motivo. · M03. · (a) BAJA→PENDIENTE con motivo; (b) BAJA terminal.
- **DP-03** ¿El ADM puede editar la asignación permiso↔rol, o es fija por seed? · M03, 3.8. · (a) fija (recomendado: más seguro y auditable); (b) editable y auditada.
- **DP-04 RESUELTA** (sí, como se propuso): creación del **primer ADM de cada tenant** (INV-U01 exige `creadoPorId`): · 1.2, 3.12. · Lo crea el operador de plataforma (DP-37) con `creado_por_id = SISTEMA` del tenant y credencial de activación de un uso; en desarrollo, vía CLI de seed.
- **DP-05** Canal de entrega de la credencial de activación: · M03. · (a) solo pantalla, se entrega en persona (recomendado, sin integración); (b) email.
- **DP-06** `Droga.factorConversion`: ¿qué convierte, si la unidad base ya tiene `factorABase`? · M06. · (a) eliminar; (b) redefinir como densidad.
- **DP-06b** Conversión peso↔volumen (INV-M01 menciona densidad): ¿se admite con `droga.densidad`? · M05, M10.
- **DP-06c RESUELTA** → `docs/specs/ficha-tecnica.md` (reglas R1–R9, validaciones V1–V9, casos T1–T8). Cambia el modelo: `ModoExpresion` reemplaza `esCantidadSuficiente`; `ItemReceta.fraccionDosisPorUnidad`; líneas con enrase manual; INV-R04 e INV-S12 revisados.
- **DP-07** Valores de `TipoMagnitud` y tratamiento de GOTA, UI, PORCENTAJE, CANTIDAD_SUFICIENTE (este último, ¿unidad o solo flag?). · M05.
- **DP-08** "Fórmula" aparece en el glosario de la doc e INV-F05/auditoría, pero no hay entidad. ¿Existe catálogo de fórmulas magistrales reutilizables (plantillas) o la fórmula vive solo en el ítem? · M06/M09. INV-F01/F02/F04 no están en la doc (numeración salta): ¿fueron eliminadas?
- **DP-08b** **Mecanismo de autorización del DT** para ajustes y anulaciones: (a) co-firma en el mismo acto con credenciales del DT (recomendado, simple); (b) bandeja de aprobación asíncrona (entidad nueva). · M07, M12, M13.
- **DP-09** `ReglaPrecio`: estructura y fórmula de precio (margen, honorarios, envase, por forma farmacéutica) y qué costo de partida se usa. Quién la edita. · BLOQUEA 4.6, 7.4.
- **DP-10** "MatriculaProfesional vigente" (INV-U04): ¿basta la matrícula de la designación DT o hay entidad aparte con vencimiento de matrícula? · M04.
- **DP-11** ¿Puede haber más de un DT vigente simultáneo (titular + suplentes)? ¿Un suplente firma solo en ausencia del titular? · M04, M13.
- **DP-12** ¿Puede cambiar `esControlada`/`tipoControl`/unidad base de una droga con partidas? · M06.
- **DP-13** Quién corrige costo de partida y si afecta algo más que reportes. · M07.
- **DP-14** Días de anticipación para alertar vencimiento de partidas. · M07.
- **DP-15 RESUELTA** (2026-09-24): parámetro por tenant `plazo_regularizacion_dias` (entero ≥ 0, default 7; migración 0040 + `scripts/create-tenant.ts` + `modules/parametros/domain/parametros-registry.ts`) -- una receta se marca "vencida" en `/regularizacion` cuando la antigüedad de su asiento más antiguo supera ese plazo.
- **DP-16 RESUELTA** → `docs/specs/libro-recetario-y-contralor.md` §1. Se puede dejar sin efecto, nunca deshacer: el egreso de stock se mantiene, el preparado se descarta, con controlada se segrega.
- **DP-16b** Preparación confirmada y luego descartada: ¿se anula también el asiento o solo se ajusta el stock? · M11/M12.
- **DP-16c RESUELTA**: jornada firmada ⇒ el asiento original NO se toca; se hace un **asiento rectificativo nuevo** en la jornada en curso. Jornada abierta ⇒ el original pasa a ANULADO. Ver spec §1.
- **DP-17 RESUELTA**: los asientos históricos son solo control, con el formato y la numeración del libro físico, en una tabla aparte. No entran en correlativo, hash ni cierres. Ver spec §2.
- **DP-18 RESUELTA (2026-09-24, FASE 10 punto 10.1)**: "en término" = firmar dentro de `plazo_firma_dias` días corridos desde la fecha de la jornada -- nuevo parámetro por tenant (`fsj.parametro`, clave `plazo_firma_dias`, entero ≥ 0, default 0 -- 0 reproduce la regla anterior de "solo la misma jornada"), editable por ADM en `/admin/parametros`. Migración 0038: `CREATE OR REPLACE fsj.cierre_diario_calcular_fuera_de_termino` lee el parámetro (COALESCE a 0 si falta). Ver spec §5.
- **DP-18b RESUELTA**: el DT puede firmar la jornada en curso (cierra el negocio y firma el día completo). Desde la firma, INV-C03 rechaza todo registro con fecha de hoy. La UI de firma debe advertirlo y mostrar las preparaciones INICIADAS. Firmar una fecha futura se rechaza (INV-C21).
- **DP-18c RESUELTA (2026-09-24, FASE 10 punto 10.1)**: enum `fsj.motivo_demora` = `AUSENCIA_DT`, `FALLA_SISTEMA`, `FARMACIA_CERRADA`, `OTRO` (migración 0039; `OTRO` exige `motivo_demora_detalle` no vacío, CHECK en BD). Datos preexistentes que no matcheaban una etiqueta real pasan a `OTRO`, preservando el texto original en `motivo_demora_detalle` cuando estaba vacío.
- **DP-18d RESUELTA (2026-09-24, FASE 10 punto 10.1)**: una jornada sin ningún asiento (recetario ni contralor) NO requiere firma y no aparece en el listado/alerta de pendientes; firmarla igual (en cero) sigue siendo posible, solo que nunca se exige. Ver spec §5.
- **DP-19 RESUELTA (2026-09-24)**: no se implementa `DIGITAL_CERTIFICADA` ni sello de tiempo de tercero (TSA) en este alcance. `mecanismo_firma` queda en `CREDENCIALES_DT` y `sello_tiempo`/`fecha_firma` son la hora del servidor (`now()`, INV-C20). El enum/columna quedan preparados para una futura integración TSA sin migrar de nuevo.
- **DP-20** Política de sesión y contraseñas: timeout inactividad/absoluto, intentos antes de bloqueo, complejidad, ventana de re-autenticación (propuesta: 30 min / 12 h / 5 intentos / 12 caracteres / reauth en el acto). Re-autenticación con PIN de 6 dígitos (clave rápida) además de contraseña; nunca válido para login ni co-firma DT. · M02.
- **DP-21 RESUELTA (2026-09-24, FASE 10 punto 10.2)**: comprobante en hoja A4 (`shared/pdf/pdf-document.ts`, `modules/cierres/infrastructure/cierre-pdf.ts`), no ligado al cálculo de folios (M13b sigue diferido, DP-38). Contenido: datos de la farmacia, fecha de la jornada, DT (nombre + matrícula), listado de asientos recetario (Nº, paciente, médico, fórmula, estado visual) y de contralor (Nº, libro, droga, movimiento, cantidad, saldo) de esa jornada, `cantidad_asientos`, `hash_lote`, `sello_tiempo`/`fecha_firma`, fuera de término + motivo, y un área en blanco para "Firma y sello del Director Técnico". Ruta `app/api/cierres/[id]/pdf`, permiso `cierres.imprimir`; la primera impresión fija `fecha_impresion`/`impreso_por_id`; toda impresión se audita (`TipoAccion.IMPRIMIR_CIERRE`).
- **DP-21b RESUELTA**: **NO existen ajustes positivos**. Todo `AJUSTE` descuenta saldo. Un sobrante se registra como partida nueva. [BD] check: los movimientos siempre restan salvo `INGRESO_COMPRA`.
- **DP-22** Umbral de folios para alerta. · M13.
- **DP-23** Unicidad de matrícula de médico (¿provincial/nacional? ¿matrícula + jurisdicción?). · M06.
- **DP-24** Política de datos de pacientes (Ley 25.326): retención, baja lógica, quién ve qué. · M06.
- **DP-25** Formato de `numeroInterno` de receta. · M09.
- **DP-26 PARCIAL (2026-09-24, FASE 12)**: plazos parametrizables por tenant (`plazo_archivo_comun_anios`=2, `plazo_archivo_controladas_anios`=3 por defecto, migración 0042) a confirmar con la normativa de Mendoza; el sistema conserva lo digital para siempre -- "destrucción" es únicamente de las recetas en PAPEL (`lote_archivo_recetas.estado` llegando a `DESTRUIDO`), nunca de `receta`/`asiento`/adjuntos. · M15.
- **DP-27** RESUELTA (2026-09-23, D6): se auditan las exportaciones (CSV/PDF) del libro recetario -- `TipoAccion.EXPORTAR` (migración 0036), `modules/libro/application/exportar-libro.ts`. · M01.
- **DP-28** Contenido obligatorio de la etiqueta e impresora usada. · M11.
- **DP-29** Almacenamiento de adjuntos de recetas digitales (disco local vs objeto S3), tamaño máximo y retención. · M09.
- **DP-30** Obras sociales/credencial del paciente: ¿solo dato o hay validación/facturación? · Alcance.
- **DP-31 CONFIRMADA**: correlativo con contador transaccional (FOR UPDATE), no SEQUENCE.
- **DP-32 CONFIRMADA**: hash calculado en la base (trigger + pgcrypto), encadenado por libro.
- **DP-33 RESUELTA** → spec §4: contralor activable por tenant (`fechaActivacionContralor`), registra APERTURA/INGRESO/EGRESO/AJUSTE con saldos, INV-L08 e INV-L11 a INV-L17.
- **DP-34 RESUELTA** (2026-09-24): `ModalidadEntrega` = `RETIRO_PRESENCIAL`/`ENVIO` (ya seedeadas por migración 0016). "Firma recibida" = la constancia firmada por el paciente que el repartidor trae de vuelta JUNTO con la receta física original; `entregas.firma.confirmar` (`modules/entregas/application/confirmar-firma-recibida.ts`) registra ambas cosas y pasa la receta a ENTREGADA en una sola transacción atómica. Mientras la receta está ENVIADA_PEND_FIRMA, el 6.4 aislado (`registrarRecepcionFisica`) se rechaza (app-level, más INV-ENT-003 [BD] de refuerzo); INV-ENT-002 [BD] exige una fila `entrega` antes de permitir ENTREGADA (migración 0040).
- **DP-35** Hosting/despliegue (servidor local en la farmacia vs nube), backups y disponibilidad sin internet. · FASE 14.
- **DP-37** **Operador de plataforma**: ¿quién da de alta tenants y su primer ADM? ¿Existe una consola de plataforma o se hace por CLI/soporte? ¿El operador puede ver algo de un tenant (no, recomendado)? · M00, 3.12.
- **DP-38** **Libro rubricado** (consultar con la Asociación de Farmacias): ¿el comprobante del cierre se imprime y adhiere al libro o se asienta a mano? ¿Cuántos asientos por foja? ¿Los libros de contralor tienen su propio libro rubricado? ¿Qué se hace con fojas dañadas, ya que no se registran fojas inutilizadas? ¿Hace falta registrar folios en el sistema? · BLOQUEA M13b / 10.B.
- **DP-39 RESUELTA**: `unidad_medida` es **catálogo GLOBAL** (sin `tenant_id`, sin RLS, compartido por todos los tenants). Consecuencia a tener presente: un alta o baja hecha por un ADM impacta a todos los tenants; INV-M04 (factor inmutable si la unidad fue usada) pasa a evaluarse sobre el uso en CUALQUIER tenant.
- **DP-40 RESUELTA**: email **único global**; el login es solo email + contraseña, sin elegir tenant. El tenant se deduce del usuario y se fija en la sesión.
- **DP-41 RESUELTA**: un Usuario pertenece a **un solo tenant**. Quien trabaje en dos farmacias necesita otra cuenta y, por DP-40 (email único global), **otro email**.

## 22. Riesgos técnicos

- R-T1 Huecos de correlativo si se usa `SEQUENCE` (mitigado con contador en fila, DP-31) — a costa de serializar confirmaciones (aceptable: volumen de un laboratorio).
- R-T2 Deadlocks al bloquear varias partidas: orden determinístico de locks + `lock_timeout` + reintento.
- R-T3 Constraint triggers diferidos complejos: difíciles de depurar; cada uno con test dedicado y mensaje `INV-XXX`.
- R-T4 Precisión numérica: definir escala `numeric` por magnitud (p.ej. 4 decimales en g) y redondeo de balanza (DP-06c).
- R-T5 Next.js 16 difiere del conocimiento previo (proxy, APIs async, caché): leer docs locales antes de cada fase de UI.
- R-T6 PDF determinístico para folios: si el render cambia, los folios calculados no coinciden con el impreso; versionar el formato (`versionFormato`).
- R-T7 Hash en app vs BD: si la app calcula, un bug de serialización rompe la cadena; test de verificación de cadena en CI.
- R-T8 Zona horaria: jornada Mendoza vs UTC del servidor; todas las fechas legales derivadas en BD con `AT TIME ZONE`.

## 23. Riesgos funcionales

- R-F1 Regla de cálculo de ficha sin definir (DP-06c): bloquea el corazón del sistema.
- R-F2 Corrección de asientos en jornadas firmadas (DP-16c) sin definir: riesgo legal.
- R-F3 Autorización DT presencial obligatoria podría frenar la operación si el DT no está (DP-08b, DP-11).
- R-F4 Firmas atrasadas acumuladas + orden cronológico estricto pueden trabar al DT (mitigado con alertas).
- R-F5 Plazos legales de Mendoza sin confirmar (DP-26).
- R-F6 El modelo de libro rubricado puede cambiar tras la consulta a la Asociación (DP-38); mitigado desacoplando folios del cierre.
- R-F7 Libros contralor incompletos si no registran ingresos (DP-33) — posible incumplimiento.

## 24. Preguntas que deben resolverse antes de implementar

**Antes de FASE 1 (bloquean el esquema):** DP-01, DP-04, DP-16, DP-16c, DP-17, DP-21b, DP-31, DP-32, DP-33, DP-39, DP-40, DP-41.
**Antes de FASE 2–3:** DP-02, DP-03, DP-05, DP-20.
**Antes de FASE 4–5:** DP-06, DP-06b, DP-07, DP-08, DP-08b, DP-09, DP-10, DP-11, DP-12, DP-23, DP-24.
**Antes de FASE 7–8:** DP-06c, DP-16b, DP-28.
**Antes de FASE 10–15:** DP-22, DP-29, DP-35 (DP-18/18b/18c/18d/19/21 resueltas, FASE 10, 2026-09-24; DP-15/DP-34 resueltas, FASE 11, 2026-09-24; DP-26 PARCIAL, FASE 12, 2026-09-24).

La FASE 0 y los puntos 1.1–1.8 pueden empezar apenas se confirmen DP-01, DP-04, DP-21b, DP-39, DP-40, DP-41. M13b (libro rubricado) espera a DP-38.

---

## Verificación (cómo probar el plan una vez implementado)

- `npm run db:bootstrap && npm run db:migrate && npm run db:seed` (contra Supabase)
- `npm run test:db` — cada invariante [BD] rechazada como `fsj_app`.
- `npm test` — unit + integración + autorización (matriz completa).
- `npm run test:e2e` — Playwright: alta usuario → activación → ingreso partida → receta → ficha → confirmación → etiqueta → cierre firmado → entrega; y el flujo de restablecimiento de credencial.
- Test de concurrencia: dos confirmaciones simultáneas sobre la misma partida y dos firmas simultáneas de la misma fecha.
- Script de verificación de cadena de hash sobre la BD de prueba.
