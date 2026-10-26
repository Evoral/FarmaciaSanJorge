# Parte 4 — Entradas no confiables y salidas generadas

Commit base del revisor: `00afed2` (anterior a los fixes de la parte 3; el logo [WIP] quedó commiteado en `ff9433a`
sin cambios en lo auditado aquí).

## Revisión del auditor del plan

### Veredicto sobre el informe

Creíble y bien acotado: lo que declara conforme (parsers con límite de tamaño y firma antes de leer, QR sin SSRF,
CSP con nonce, errores sin stack) coincide con el código revisado por muestreo. Ningún hallazgo bloquea el deploy.
Infla dos ítems: P4-01 no es una debilidad real y P4-05 no es un hallazgo (ya está cubierto por un test).

Verificado en el código:
- `shared/pdf/logo.ts` lee `public/logo-etiqueta.png` fijo: ningún PDF dibuja una imagen subida por el usuario.
- No hay exportaciones CSV (sin `text/csv` ni `.csv` en `app/`, `modules/`, `shared/`).
- Todas las rutas de `app/api/**` con datos de pacientes llevan `Cache-Control: private, no-store`; solo los jobs
  (`plazos-archivo`, `retiros-vencidos`) no, y devuelven JSON sin datos personales.
- `tests/unit/next-config-headers.test.ts` y `tests/unit/xlsx-report.test.ts` existen.

### Verificación por hallazgo

| ID | Original | Revisado | Veredicto | Evidencia de la revisión |
|---|---|---|---|---|
| P4-01 | WARNING | — | FALSO POSITIVO | `Content-Disposition: inline` es el comportamiento por defecto. Con `Content-Type` derivado de los magic bytes en el servidor (`logo.ts:46`, nunca el MIME del cliente), `nosniff` y SVG rechazado, no hay interpretación alternativa posible. |
| P4-02 | WARNING | SUGGESTION | CONFIRMADO | `resumenFiltro` (libro, contralor y valorizado PDF) interpola los query params crudos, y `texto` no tiene `max()` en `filtros.ts:35`. Solo deforma la cabecera del PDF que pide el mismo usuario autenticado: sin impacto sobre terceros. |
| P4-03 | SUGGESTION | SUGGESTION | CONFIRMADO, RIESGO BAJO | exceljs guarda strings como texto (`t="s"`): Excel no los evalúa al abrir. Solo se volvería fórmula si el usuario edita la celda. No hay CSV, que es donde este ataque es real. |
| P4-04 | SUGGESTION | SUGGESTION | CONFIRMADO | Rango de fechas libre, acotado por `MAX_EXPORT_ROWS = 5000` con aviso de truncado. |
| P4-05 | SUGGESTION | — | NO ES HALLAZGO | El propio informe reconoce que `next-config-headers.test.ts` ya lo cubre. |

### Clasificación para producción

**Antes del deploy**
- Nada.

**En el tiempo**
- ~~P4-02~~ **CORREGIDO**: `textoDeFiltro` (`shared/format/texto-filtro.ts`) en los tres `resumenFiltro` de PDF (sin caracteres de control, 60 caracteres máx.) y `texto` con `max(200)`.
- ~~P4-03~~ **CORREGIDO**: `textoSeguro` en `toCellValue` prefija con `'` el texto que empieza con `=`, `+`, `-`, `@`, tab o CR.
- P4-04: opcional; el tope de filas ya protege.

### Observación fuera del alcance de seguridad

- Las etiquetas y la hoja de envíos usan siempre `public/logo-etiqueta.png` (San Jorge), no el logo subido por cada
  farmacia (`openspec/specs/logo-farmacia/spec.md`). En un sistema multi-tenant, otra farmacia imprimiría el logo de San Jorge.
  **CORREGIDO** (decisión del usuario): etiqueta y hoja de envíos usan el logo del tenant y los XLSX su nombre
  (`logo-farmacia.md` R6, R7). Sin logo, San Jorge tiene que subirlo para que sus etiquetas lo sigan mostrando.

### Para la parte 5

- Verificaciones de producción que propone el informe (egress de las funciones hacia Supabase y
  `decrypter.verumrp.com.ar`, 413 por tamaño en Vercel, headers por `curl -I` incluida HSTS): incorporarlas al
  checklist de deploy.

---

## Informe original del revisor (resumido)

### B. Resumen
- Uploads y parsers (PDF de receta y factura, XLS/XLSX, logo): `instanceof File`, tamaño antes de `arrayBuffer()`, firma real; lector BIFF8 propio con detección de ciclos.
- QR/RCTA: solo hash `[0-9A-F]{64}`, endpoint constante, `redirect: "error"`, timeout 8 s, 64 KiB máx.: sin SSRF.
- XLSX con exceljs: strings como texto; recomendación preventiva de escape.
- CSP con nonce por request, `frame-ancestors 'none'`, `nosniff`, `X-Frame-Options: DENY`, cámara solo en `/recetas/nuevo`.
- Route Handlers devuelven `toSafeError` sin stack.
- Conteo: 0 BLOCKER, 0 CRITICAL, 2 WARNING, 3 SUGGESTION. `npm test` 3593/3593, typecheck y lint OK, `npm audit --omit=dev` 0.

### C. Hallazgos (originales)
| ID | Sev. | Ubicación | Resumen | Acción propuesta |
|---|---|---|---|---|
| P4-01 | WARNING | `app/api/farmacia/logo/route.ts:41-50` | Falta `Content-Disposition: inline`. | Agregarlo. |
| P4-02 | WARNING | `app/api/libro/export/pdf/route.ts:27` | `texto` crudo en la cabecera del PDF. | Acotar longitud y quitar saltos de línea. |
| P4-03 | SUGGESTION | `shared/xlsx/xlsx-report.ts:146-163` | Strings con prefijo de fórmula sin escapar. | Prefijo `'`. |
| P4-04 | SUGGESTION | `modules/libro/domain/filtros.ts:29-37` | Exportaciones sin rango máximo de fechas. | Refinamiento zod opcional. |
| P4-05 | SUGGESTION | `proxy.ts:45-47` | `/api/**` sin CSP depende de `nosniff` en `next.config.ts`. | Mantener el test. |

### E. Pruebas propuestas
PP4-01 logo SVG/renombrado (unitario, a explicitar), PP4-02 inyección XLSX (cubierta por `xlsx-report.test.ts`),
PP4-03 QR con host ajeno (cubierta, P15–P17), PP4-04 XLS cíclico/sobredimensionado (cubierta).

### F. Solo verificables en producción
Egress filtering de las funciones; 413 por tamaño en Vercel; `curl -I` de `/recetas/nuevo`, `/recetas` y una
exportación (Permissions-Policy, `Cache-Control`, HSTS).
