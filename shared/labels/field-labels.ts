/**
 * THE single dictionary of human (Spanish) field labels, shared by two
 * consumers so a field is named the same way everywhere:
 *
 *   - validation errors: `parseInput` in shared/usecase.ts turns a zod
 *     issue path into a label via `formatIssuePath`, since the resulting
 *     `ValidationError` message is shown verbatim in the UI (otherwise the
 *     user would see raw keys like `numeroMatricula: ...`);
 *   - the audit diff table: modules/auditoria/domain/presentacion.ts's
 *     `etiquetaCampo` labels each changed key of `valor_anterior` /
 *     `valor_nuevo` via `fieldLabel`.
 *
 * Labels are worded to read on their own (an error alert or an audit row
 * has no form around it), so where a form's text leans on its layout the
 * entry here is the more explicit wording ("Motivo del ajuste", not just
 * "Motivo").
 *
 * Why ONE global dictionary keyed by field name, instead of a label map per
 * schema/module: the same key names repeat across modules with the same
 * meaning (`nombre`, `motivo`, `observaciones`, `vigenteDesde`,
 * `pacienteId`, ...), so a per-schema map would duplicate most entries
 * dozens of times and drift apart. Id fields (`drogaId`, `usuarioId`) map
 * to the entity name, since in the UI they are a picker of that entity.
 *
 * Completeness is enforced, not hoped for:
 * tests/unit/usecase-registry-all-modules.test.ts walks the input schema of
 * EVERY registered use case and fails if any object key has no entry here.
 * Audit-only keys (never a use-case input) are not covered by that guard;
 * they sit in their own section at the end. Lookup still never throws on an unmapped key (a schema built
 * outside the registry, a key added between test runs): it falls back to
 * humanizing the key ("fechaVencimiento" -> "Fecha vencimiento",
 * "laboratorioId" -> "Laboratorio"),
 * which is readable if not perfectly worded.
 */

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  // Identity, contact and registration data.
  apellido: "Apellido",
  cuil: "CUIL",
  cuit: "CUIT",
  direccionRegistrada: "Dirección registrada",
  dni: "DNI",
  domicilio: "Domicilio",
  email: "Email",
  especialidad: "Especialidad",
  fechaNacimiento: "Fecha de nacimiento",
  matricula: "Matrícula",
  matriculaJurisdiccion: "Jurisdicción de la matrícula",
  matriculaFarmacia: "Matrícula de la farmacia",
  nombre: "Nombre",
  nombreFantasia: "Nombre de fantasía",
  nroCredencial: "Nº de credencial (obra social)",
  numeroMatricula: "Matrícula",
  razonSocial: "Razón social",
  sexo: "Sexo",
  telefono: "Teléfono",
  aceptaRecordatoriosWhatsapp: "Acepta recordatorios por WhatsApp",

  // Credentials and step-up.
  actual: "Contraseña actual",
  codigo: "Código",
  nueva: "Nueva contraseña",
  nuevaRepeat: "Repetir nueva contraseña",
  password: "Contraseña",
  passwordActual: "Contraseña actual",
  pin: "PIN",
  pinRepeat: "Repetir PIN",
  roles: "Roles",
  rolCodigo: "Rol",
  rolId: "Rol",
  permisos: "Permisos",

  // References to other entities (pickers or hidden ids in the UI).
  asientoId: "Asiento",
  asientoOriginalId: "Asiento original",
  autorizadoPorId: "Autorizado por",
  designacionId: "Designación",
  drogaId: "Droga",
  drogaIds: "Drogas",
  dtUsuarioId: "Director Técnico",
  etiquetaId: "Etiqueta",
  fichaTecnicaId: "Ficha técnica",
  id: "Identificador",
  itemRecetaId: "Ítem de la receta",
  lineaPesajeId: "Línea de pesaje",
  medicoId: "Médico",
  pacienteId: "Paciente",
  partidaId: "Partida",
  partidaIds: "Partidas",
  preparacionId: "Preparación",
  proveedorId: "Proveedor",
  recetaId: "Receta",
  unidadBaseId: "Unidad base",
  unidadCompraId: "Unidad de compra",
  unidadId: "Unidad",
  unidadMedidaId: "Unidad",
  unidadTotalId: "Unidad del total",
  usuarioId: "Usuario",

  // Catalog data (drogas, unidades, proveedores, parámetros, precios).
  clave: "Parámetro",
  esBase: "Unidad base",
  esControlada: "Controlada",
  factorABase: "Factor de conversión",
  costoHasta: "Costo hasta",
  margen: "Margen (%)",
  precioMinimo: "Precio mínimo",
  simbolo: "Símbolo",
  stockMinimo: "Stock mínimo",
  tipoControl: "Tipo de control",
  tipoMagnitud: "Magnitud",
  tramos: "Tramos de margen",
  valor: "Valor",

  // Recetas, ítems and componentes.
  aliasTexto: "Texto en la receta",
  archivo: "Archivo PDF",
  datos: "Datos",
  emisor: "Emisor de la receta digital",
  equivalencias: "Equivalencias de drogas",
  existenteId: "Coincidencia existente",
  fechaValidaDesde: "Válida desde",
  fuente: "Fuente de la importación",
  nroRecetaEmisor: "Nº de receta del emisor",
  urlVerificacion: "Link de verificación",
  cantidadTotal: "Cantidad total",
  cantidadUnidades: "Cantidad de unidades",
  componentes: "Componentes",
  descripcion: "Descripción",
  diagnosticoCodigo: "Código de diagnóstico (CIE-10)",
  diagnosticoDescripcion: "Diagnóstico",
  duracionTratamientoDias: "Duración del tratamiento (días)",
  esPrincipioActivo: "Principio activo",
  fechaPrescripcion: "Fecha de prescripción",
  formaFarmaceutica: "Forma farmacéutica",
  fraccionDosisPorUnidad: "Fracción de dosis por unidad",
  items: "Ítems",
  itemsVersion: "Versión de los ítems",
  medicoTexto: "Médico (si figura)",
  modoExpresion: "Modo de expresión",
  numeroInterno: "Nº de receta",
  origen: "Origen",
  pacienteTexto: "Paciente (si figura)",
  posologia: "Posología",
  version: "Versión",
  soloSiDesactualizada: "Solo si la ficha está desactualizada",

  // Stock, preparaciones, entregas.
  cantidad: "Cantidad",
  cantidadCompra: "Cantidad comprada",
  cantidadManual: "Cantidad real registrada",
  costoUnitario: "Costo unitario",
  costoUnitarioNuevo: "Costo unitario nuevo",
  fechaVencimiento: "Fecha de vencimiento",
  formulaTexto: "Fórmula",
  lineas: "Líneas",
  lote: "Lote",
  modalidad: "Modalidad",
  numeroValeAdquisicion: "Nº de vale de adquisición",
  ubicacion: "Ubicación",

  // Libro, cierres, archivo, directores técnicos.
  caracter: "Carácter",
  expedienteAutorizacion: "Expediente de autorización",
  expedienteDesignacion: "Expediente de designación",
  fecha: "Fecha",
  fechaAsiento: "Fecha del asiento",
  fechaAutorizacion: "Fecha de autorización",
  fechaDestruccion: "Fecha de destrucción",
  numeroAsientoFisico: "Nº de asiento en el libro físico",
  tipoLibro: "Libro",
  vigenteDesde: "Vigente desde",
  vigenteHasta: "Vigente hasta",

  // Motivos and free text.
  motivo: "Motivo",
  motivoAjuste: "Motivo del ajuste",
  motivoAperturaAdicional: "Motivo de apertura adicional",
  motivoCese: "Motivo del cese",
  motivoDemora: "Motivo de la demora",
  motivoDemoraDetalle: "Detalle de la demora",
  observacion: "Observación",
  observaciones: "Observaciones",

  // List filters, pagination and report exports.
  accion: "Acción",
  bajoMinimo: "Bajo mínimo",
  cantidadFilas: "Cantidad de filas",
  conPartidasPorVencer: "Con partidas por vencer",
  conPartidasVencidas: "Con partidas vencidas con saldo",
  cursor: "Página",
  desde: "Desde",
  entidad: "Entidad",
  entidadId: "ID de entidad",
  estado: "Estado",
  fechaDesde: "Desde",
  fechaHasta: "Hasta",
  filtroResumen: "Filtros aplicados",
  formato: "Formato",
  hasta: "Hasta",
  incluirVencidas: "Incluir vencidas",
  ingresoDesde: "Ingreso desde",
  ingresoHasta: "Ingreso hasta",
  numeroDesde: "Nº desde",
  numeroHasta: "Nº hasta",
  orden: "Ordenar por",
  page: "Página",
  pageSize: "Tamaño de página",
  periodo: "Período",
  periodoDesde: "Período desde",
  periodoHasta: "Período hasta",
  search: "Búsqueda",
  sinEtiquetaImpresa: "Sin etiqueta impresa",
  soloBajoMinimo: "Solo bajo mínimo",
  soloConSaldo: "Solo con saldo",
  soloControladas: "Solo controladas",
  soloSinStock: "Solo sin stock",
  soloVencidas: "Solo vencidas",
  soloVigentes: "Solo vigentes",
  texto: "Paciente / médico",
  tipo: "Tipo",
  truncated: "Resultado recortado",
  unidad: "Mostrar costo por",
  ventana: "Ventana",

  // Keys that only appear in audit diffs (valorAnterior/valorNuevo), not in
  // any use-case input: readable siblings of reference ids written next to
  // the id at audit time, plus derived/summary values.
  asiento: "Asiento",
  casoDeUso: "Operación",
  permiso: "Permiso requerido",
  asientoOriginal: "Asiento original",
  asientoRecetario: "Asiento del libro recetario",
  droga: "Droga",
  fichaTecnica: "Ficha técnica",
  itemsResumen: "Ítems",
  medico: "Médico",
  paciente: "Paciente",
  partida: "Partida",
  preparacion: "Preparación",
  proveedor: "Proveedor",
  unidadBase: "Unidad base",
  unidadCompra: "Unidad de compra",
  unidadIngresada: "Unidad ingresada",
  usuario: "Usuario",
  asientoRecetarioId: "Asiento del libro recetario",
  cantidadAsientos: "Cantidad de asientos",
  cantidadIngresada: "Cantidad ingresada",
  cantidadInicialBase: "Cantidad inicial",
  cantidadRecetas: "Cantidad de recetas",
  estadoReceta: "Estado de la receta",
  fechaBaja: "Fecha de baja",
  firmaRecibida: "Firma recibida",
  fueraDeTermino: "Fuera de término",
  incluyeControladas: "Incluye controladas",
  motivoBaja: "Motivo de baja",
  numero: "Número",
  numeroCorrelativo: "Nº de asiento",
  primeraImpresion: "Primera impresión",
  rol: "Rol",
  tomadaEn: "Tomada el",
  tomadaPor: "Tomada por",
};

/** "fechaVencimiento" -> "Fecha vencimiento"; "laboratorioId" -> "Laboratorio"; "campo_nuevo" -> "Campo nuevo". Fallback only -- see the module doc comment. */
function humanizeKey(key: string): string {
  const words = key
    .replace(/(.)Id$/, "$1")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Label for a single field key: its `FIELD_LABELS` entry, or the humanized fallback. */
export function fieldLabel(key: string): string {
  // Own-property check: a plain `FIELD_LABELS[key]` would resolve
  // inherited keys such as "constructor" to an Object.prototype function.
  return Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key]! : humanizeKey(key);
}

function formatSegment(segment: PropertyKey): string {
  if (typeof segment === "number") return `n.º ${segment + 1}`;
  if (typeof segment === "symbol") return segment.description ?? "";
  return fieldLabel(segment);
}

/**
 * A zod issue path as a human label: each key mapped through
 * `FIELD_LABELS` (humanized fallback), each array index shown 1-based
 * (`n.º 2`), segments joined with " › " -- e.g. `["items", 1, "drogaId"]`
 * -> "Ítems › n.º 2 › Droga". Returns `null` for an empty path (an issue
 * about the input as a whole), so the caller can omit the prefix.
 */
export function formatIssuePath(path: readonly PropertyKey[]): string | null {
  if (path.length === 0) return null;
  return path.map(formatSegment).join(" › ");
}
