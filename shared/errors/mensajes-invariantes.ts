/**
 * Global Spanish translation table for every `INV-XXX` code the database
 * raises (`RAISE EXCEPTION 'INV-XXX: ...' USING ERRCODE = 'P0001'` in
 * prisma/migrations/**), reached through `mapDbError` ->
 * `InvariantViolationError.invariantCode`.
 *
 * Layering (most specific wins):
 *   1. A module's own table (`modules/<m>/domain/mensajes-invariantes.ts`),
 *      applied inside that module's application layer, where the exact
 *      operation is known (e.g. "no se pudo anular el asiento").
 *   2. This table, applied centrally by `userMessageFor`
 *      (shared/errors/user-message.ts) for every other flow, and used by
 *      the module tables as their second-level fallback.
 *   3. `MENSAJE_INVARIANTE_GENERICO`, for a code missing here.
 *
 * Messages are written for the end user: what rule applies / what to do,
 * never the internal code, table or column names. The raw DB text is still
 * logged server-side (shared/errors/log-error.ts).
 *
 * tests/unit/mensajes-invariantes-global.test.ts scans the migrations and
 * fails if a raised code is missing here -- add the message together with
 * any new `RAISE EXCEPTION 'INV-...'`.
 */
export const MENSAJES_INVARIANTES: Readonly<Record<string, string>> = {
  // Archivo de recetas / destrucción (M15)
  "INV-ARC-005": "El lote de archivo no puede pasar a ese estado desde su estado actual.",
  "INV-ARC-006":
    "La receta no puede archivarse: debe estar entregada o anulada, y una vez asignada a un lote no puede cambiar de lote.",
  "INV-ARC-007": "La receta usa una droga controlada y no puede asignarse a un lote que no incluye controladas.",
  "INV-D05": "Los datos del lote de archivo no se pueden modificar, y un lote ya destruido no admite ningún cambio.",

  // Autenticación
  "INV-AU-002": "La credencial de activación ya fue usada, fue revocada o está vencida. Pedile al administrador una nueva.",

  // Cierre diario (M13)
  "INV-C01": "Esa jornada ya fue firmada.",
  "INV-C03": "La jornada ya fue firmada por el Director Técnico: no se pueden registrar más movimientos ni asientos en ella.",
  "INV-C04": "Un cierre diario firmado no se puede modificar.",
  "INV-C18": "La firma quedaría fuera de término: indicá el motivo de la demora.",
  "INV-C19": "No se puede firmar fuera de orden: hay una jornada anterior con asientos sin firmar, o una jornada posterior ya firmada.",
  "INV-C21": "Solo se puede firmar una jornada anterior a hoy: el cierre diario se hace al día siguiente.",

  // Catálogos
  "INV-DRG-001": "No se puede cambiar la unidad base ni la clasificación de control de una droga que ya tiene partidas cargadas.",
  "INV-DRG-002": "Ese nombre ya está en uso: es el nombre o uno de los otros nombres de una droga vigente.",
  "INV-DRG-003": "Ese otro nombre ya fue quitado de la droga. Si hace falta, agregalo de nuevo.",
  "INV-M01": "No se puede convertir entre esas unidades de medida: no existen o miden magnitudes distintas (por ejemplo, masa y volumen).",
  "INV-M04": "La unidad de medida ya fue usada: no se puede cambiar su factor de conversión ni su magnitud.",

  // Directores técnicos
  "INV-DT-001": "El usuario elegido no tiene el rol de Director Técnico.",
  "INV-DT-003":
    "Los datos de una designación de Director Técnico no se pueden modificar: solo se puede registrar su cese (fecha y motivo), y una vez registrado es definitivo.",
  "INV-DT-004": "Esa fecha de cese dejaría una jornada ya firmada sin Director Técnico vigente. Elegí una fecha de cese posterior.",
  "INV-DT-005": "El usuario elegido no está activo: no puede ser designado Director Técnico.",

  // Entregas (M14)
  "INV-ENT-001": "Una entrega registrada no se puede modificar, salvo confirmar el retorno, que no se puede revertir.",
  "INV-ENT-002": "La receta no puede marcarse como entregada sin una entrega registrada (retiro presencial, o envío con el retorno confirmado).",
  // INV-ENT-003's trigger was dropped by migration 0051 (receta física attribute removed); kept because the scan covers 0040/0041.
  "INV-ENT-003": "La receta fue enviada y está esperando retorno: confirmá el retorno en lugar de registrar solo la recepción física.",
  "INV-ENT-004": "Una entrega solo se elimina anulándola, para que quede su registro en el historial de entregas anuladas.",
  "INV-ENT-005": "Un envío necesita un repartidor asignado, y el repartidor de un envío registrado se puede cambiar pero no quitar.",

  // Preparaciones / etiquetas / fichas técnicas
  "INV-ETQ-001": "La etiqueta solo se puede generar para una preparación confirmada.",
  "INV-P01": "La preparación no tiene una ficha técnica válida, o se intentó cambiar su ficha técnica.",
  "INV-P04": "No se pudo vincular la preparación con su asiento en el libro recetario.",
  "INV-P05": "La preparación ya fue confirmada o descartada: no admite ese cambio.",
  "INV-P07": "La fecha y el tipo de vencimiento del preparado se fijan al confirmar la preparación y no se pueden modificar después.",
  "INV-P08": "El excipiente utilizado solo se puede cambiar antes de imprimir las etiquetas: después queda registrado en el libro recetario.",
  "INV-R03": "La ficha técnica debe tener al menos una línea de pesaje.",

  // Registros inmutables / multi-farmacia
  "INV-IMMUTABLE": "Ese registro forma parte del historial y no se puede modificar ni eliminar.",
  "INV-T03": "Un registro no se puede pasar a otra farmacia.",
  "INV-PL-004": "Solo se pueden modificar los datos de la farmacia de la sesión actual.",
  "INV-PL-005": "El CUIT de la farmacia ya no se puede cambiar: hay cierres diarios firmados que lo llevan.",

  // Libro recetario / contralor (M12)
  "INV-L01": "Los asientos del libro no se pueden modificar: solo se pueden anular o rectificar, según corresponda.",
  "INV-L02": "La jornada del asiento ya está firmada: no se puede anular, corresponde un asiento rectificativo.",
  "INV-L03": "No hay un libro recetario abierto disponible. Contactá al administrador.",
  "INV-L07": "Cada receta se registra en el libro recetario con un único asiento que reúne todos sus ítems. Contactá al administrador.",
  "INV-L08":
    "No se pudo registrar el movimiento en el libro contralor: verificá que la droga sea controlada y que haya un libro contralor abierto. Contactá al Director Técnico si el problema persiste.",
  "INV-L09": "El asiento no existe o ya no está vigente: no se puede anular.",
  "INV-L14": "El saldo del libro contralor de esta droga quedaría negativo.",
  "INV-L15":
    "El asiento de apertura del libro contralor debe ser el primero de la droga, y la droga todavía no lo tiene o ya tiene otros movimientos. Contactá al Director Técnico.",
  "INV-L16": "Para el ingreso por compra de una droga controlada es obligatorio el número de vale de adquisición.",
  "INV-L17": "La fecha de activación del libro contralor ya fue establecida y no se puede cambiar.",
  "INV-L18":
    "El asiento original no admite un rectificativo: debe ser un asiento generado por el sistema, de una jornada ya firmada, y el rectificativo debe tener una fecha posterior.",
  "INV-L21": "El asiento rectificativo no tiene una autorización de rectificación válida.",
  "INV-L22": "No se pudo registrar el asiento del libro recetario porque su detalle está incompleto. Contactá al administrador.",
  "INV-L23": "El detalle o las preparaciones de un asiento ya registrado no se pueden modificar.",
  "INV-L25": "El asiento del libro recetario debe incluir las preparaciones confirmadas de los ítems de su receta. Contactá al administrador.",
  "INV-L26": "La numeración del libro ya quedó fija con el primer cierre firmado: no se puede cambiar.",
  "INV-LIB-001": "Los datos ya cargados de un libro rubricado no se pueden modificar.",

  // Precios
  "INV-PR-001": "Una regla de precio no se puede editar: cerrala e ingresá una nueva versión.",
  "INV-PR-002":
    "Los tramos de margen no son válidos: debe haber al menos uno, cada tope debe ser mayor que el anterior y solo el último tramo puede quedar sin tope.",
  "INV-CP-001": "Un costo de proveedor no se puede editar: registrá uno nuevo y el anterior queda en el historial.",
  "INV-CP-002": "Ese costo de proveedor ya fue reemplazado o dado de baja y no se puede volver a modificar.",

  // Recetas
  "INV-R01": "La receta debe tener al menos un ítem.",
  // INV-R07's trigger/CHECK were dropped by migration 0051; kept because the scan covers 0016.
  "INV-R07": "No se puede registrar el retiro presencial sin haber recibido la receta física.",
  "INV-R08": "La receta no admite ese cambio de estado desde su estado actual.",
  // INV-R07's trigger/CHECK were dropped by migration 0051; kept because the scan covers 0016.
  "INV-R11": "La receta ya no se puede editar: solo se editan recetas pendientes de preparación y sin preparaciones iniciadas.",
  "INV-R12":
    "Esta receta ya tiene preparaciones registradas en el libro recetario. Para anularla, dejá sin efecto esos asientos desde el Libro recetario (requiere autorización del Director Técnico). La receta se anulará automáticamente.",
  "INV-R13": "El pago de una receta anulada no se puede modificar.",
  "INV-R14": "Una receta entregada tiene que quedar pagada.",

  // Stock (M07)
  "INV-S01": "El stock disponible de una partida solo cambia registrando un movimiento de stock.",
  "INV-S10": "La partida está vencida: no se puede descontar stock de una partida vencida. Si es una droga, requiere acción del Director Técnico (reanálisis o marcarla como vencida).",
  "INV-S21": "La fecha de vencimiento es obligatoria para una droga; solo los excipientes y materiales pueden no vencer.",
  "INV-S22": "No se pudo registrar el reanálisis: solo el Director Técnico vigente puede hacerlo, en una partida de droga con saldo y con una fecha posterior a la actual.",
  "INV-S23": "El vencimiento original de una partida no se modifica; el vencimiento vigente solo cambia registrando un reanálisis.",
  "INV-S24": "El relevamiento inicial ya está cerrado: no se pueden cargar más existencias iniciales. Ingresá el stock como una compra.",
  "INV-S26": "El relevamiento inicial ya está cerrado y no se puede reabrir; solo el Director Técnico vigente puede cerrarlo.",
  "INV-S12": "La cantidad descontada no coincide con lo que exige la línea de pesaje. Revisá las cantidades y volvé a intentarlo.",
  "INV-S16": "La fecha de apertura de la partida solo se registra con un movimiento de stock.",
  "INV-S17": "La fecha de apertura de la partida ya fue registrada y no se puede cambiar.",
  "INV-STK-002": "No se pudo registrar el ingreso de la partida: la cantidad ingresada no coincide con su cantidad inicial. Volvé a intentarlo.",

  // Roles (migration 0054, DP-03)
  "INV-ROL-001": "El código de un rol no se puede cambiar.",
  "INV-ROL-002": "El rol Administrador y el rol interno del sistema no se pueden modificar ni eliminar.",
  "INV-ROL-003": "El rol Director Técnico no se puede eliminar.",
  "INV-ROL-004": "El rol está asignado a uno o más usuarios: quitáselo antes de eliminarlo.",
  "INV-ROL-005": "El rol interno del sistema no se puede asignar a un usuario.",

  // Cuentas de sector (migration 0077)
  "INV-SEC-001": "Una cuenta de sector no puede tener el rol Administrador ni el de Director Técnico.",
  "INV-SEC-002": "Un usuario no puede pasar a ser cuenta de sector ni dejar de serlo: se define al crearlo.",

  // Usuarios
  "INV-U02": "El usuario debe tener al menos un rol.",
  "INV-U04": "No hay una designación de Director Técnico vigente para esa fecha.",
  "INV-U05": "El Director Técnico que autoriza no está vigente hoy.",
  "INV-U07": "El usuario que realiza o autoriza la operación no está activo.",
  "INV-USR-006": "El usuario no admite ese cambio de estado (un usuario dado de baja no se puede reactivar).",
};

export const MENSAJE_INVARIANTE_GENERICO =
  "No se pudo completar la operación: se violó una regla del sistema. Contactá al administrador si el problema persiste.";

/** The global Spanish message for `codigo`, or `undefined` when the table has none (lets module tables chain their own generic fallback). */
export function mensajeGlobalParaInvariante(codigo: string): string | undefined {
  return Object.hasOwn(MENSAJES_INVARIANTES, codigo) ? MENSAJES_INVARIANTES[codigo] : undefined;
}

/** The Spanish message for `codigo` (e.g. `"INV-S10"`), falling back to `MENSAJE_INVARIANTE_GENERICO`. Never returns the code itself. */
export function mensajeParaInvariante(codigo: string): string {
  return mensajeGlobalParaInvariante(codigo) ?? MENSAJE_INVARIANTE_GENERICO;
}
