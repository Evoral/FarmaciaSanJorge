# Tasks

Each tanda: convert → `openspec validate` → control table → independent review
→ user approval → one commit. A tanda does not start before the previous one is
approved.

## 0. Pilot (2 KB)

- [x] 0.1 Convert `cuit-farmacia`
- [x] 0.2 Validate, control table, review, user approval of the format

## 1. Configuración y utilidades (8 KB)

- [ ] 1.1 `numeros-ingresados`
- [ ] 1.2 `exportaciones-excel`
- [ ] 1.3 `logo-farmacia`
- [ ] 1.4 `alta-receta-idempotente`

## 2. Catálogos e historiales (61 KB)

- [ ] 2.1 `historial-partidas`
- [ ] 2.2 `historial-droga`
- [ ] 2.3 `trayectoria-paciente` (header says "implementation in progress": check against code)
- [ ] 2.4 `trayectoria-proveedor`
- [ ] 2.5 `pacientes-recurrentes`
- [ ] 2.6 `sinonimos-droga`

## 3. Precios (37 KB)

- [ ] 3.1 `reglas-precio`
- [ ] 3.2 `presupuesto-receta`
- [ ] 3.3 `costos-proveedor`

## 4. Stock (48 KB)

- [ ] 4.1 `existencia-inicial`
- [ ] 4.2 `reanalisis-partida`
- [ ] 4.3 `reserva-stock-preparacion` (most cited spec: 68 references)

## 5. Laboratorio (41 KB)

- [ ] 5.1 `ficha-tecnica` (its test cases become scenarios)
- [ ] 5.2 `pesada-real`
- [ ] 5.3 `excipiente-preparacion`
- [ ] 5.4 `vencimiento-preparado`
- [ ] 5.5 `etiqueta-preparado`
- [ ] 5.6 `hoja-etiquetas`

## 6. Recetas (55 KB)

- [ ] 6.1 `domicilios`
- [ ] 6.2 `pago-receta`
- [ ] 6.3 `importacion-receta-pdf`
- [ ] 6.4 `importacion-receta-qr`

## 7. Entregas (51 KB)

- [ ] 7.1 `anular-entrega`
- [ ] 7.2 `retiro-vencido`
- [ ] 7.3 `envios-repartidores`

## 8. Seguridad y accesos (44 KB) — review by a different agent is mandatory

- [ ] 8.1 `roles-personalizables`
- [ ] 8.2 `cuentas-de-sector`
- [ ] 8.3 `contrasena-temporal`

## 9. Libro recetario (36 KB) — alone, maximum care

- [ ] 9.1 `libro-recetario-y-contralor`

## 10. Closing

- [ ] 10.1 Pin `@fission-ai/openspec` as devDependency (a release at least two weeks old)
- [ ] 10.2 Add `openspec validate --specs --strict` to `.github/workflows/ci.yml`
- [ ] 10.3 Update "Status of the migration" in `openspec/README.md`
- [ ] 10.4 Archive this change
