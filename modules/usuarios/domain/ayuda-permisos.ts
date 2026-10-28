/**
 * Plain-language help for every role-assignable permiso, shown as a hover
 * hint in the role editor (`/admin/accesos/roles`). It EXTENDS the short
 * `fsj.permiso.descripcion` with what the permiso lets a usuario do in
 * practice. Typed over every assignable code, so a new permiso without help
 * text is a compile error.
 */
import type { Permiso, PERMISO_CATALOGO } from "@/modules/auth/domain/permisos";

type PermisoAsignable = { [K in Permiso]: (typeof PERMISO_CATALOGO)[K] extends "sistema" ? never : K }[Permiso];

const AYUDA_PERMISO: Readonly<Record<PermisoAsignable, string>> = {
  "auth.login": "Entrar al sistema con usuario y contraseña. Todos los roles lo incluyen.",
  "auth.logout": "Salir del sistema. Todos los roles lo incluyen.",
  "auth.password.cambiar": "Cambiar la propia contraseña. Todos los roles lo incluyen.",
  "usuarios.listar": "Ver la lista de usuarios de la farmacia.",
  "usuarios.ver": "Abrir la ficha de un usuario con sus datos y roles.",
  "usuarios.crear": "Dar de alta un usuario nuevo.",
  "usuarios.editar": "Modificar nombre, documento y otros datos personales de un usuario.",
  "usuarios.roles.modificar": "Darle o quitarle roles a un usuario, es decir, cambiar lo que puede hacer.",
  "usuarios.suspender": "Bloquear temporalmente el acceso de un usuario sin darlo de baja.",
  "usuarios.reactivar": "Devolverle el acceso a un usuario suspendido.",
  "usuarios.baja": "Dar de baja definitiva a un usuario. Su historial se conserva.",
  "usuarios.credencial.restablecer": "Asignar una contraseña temporal nueva (por ejemplo, si el usuario olvidó la contraseña) o borrar su PIN para que configure uno nuevo al ingresar.",
  "usuarios.auditoria.ver": "Ver el historial de cambios hechos sobre los usuarios: altas, bajas, cambios de roles.",
  "dt.designar": "Nombrar al Director Técnico de la farmacia.",
  "dt.cesar": "Terminar la designación del Director Técnico actual.",
  "roles.ver": "Ver los roles y qué permisos tiene cada uno.",
  "roles.gestionar": "Crear roles nuevos, cambiar sus permisos o eliminarlos.",
  "config.ver": "Ver los datos de la farmacia: razón social, dirección, matrícula, parámetros.",
  "config.editar": "Cambiar los datos de la farmacia y los parámetros generales del sistema.",
  "unidades.crear": "Agregar una unidad de medida nueva (g, ml, cápsulas...).",
  "unidades.editar": "Modificar una unidad de medida existente.",
  "unidades.baja": "Dejar de usar una unidad de medida.",
  "drogas.crear": "Agregar una droga o materia prima nueva al catálogo.",
  "drogas.editar": "Modificar los datos de una droga del catálogo.",
  "drogas.baja": "Dejar de usar una droga: ya no se ofrece en recetas nuevas.",
  "drogas.reactivar": "Volver a habilitar una droga dada de baja.",
  "proveedores.gestionar": "Dar de alta, modificar y dar de baja proveedores.",
  "medicos.gestionar": "Dar de alta, modificar y dar de baja médicos prescriptores.",
  "pacientes.gestionar": "Dar de alta, modificar y dar de baja clientes.",
  "precios.reglas.editar": "Cambiar cómo se calcula el precio de venta (márgenes, honorarios, redondeos).",
  "costos.proveedor.gestionar": "Cargar, importar y actualizar las listas de precios de los proveedores.",
  "repartidores.gestionar": "Dar de alta, modificar y dar de baja los repartidores de envíos.",
  "stock.ver": "Ver cuánto hay de cada droga y en qué partidas.",
  "stock.valorizado.ver": "Ver el stock con su costo en pesos.",
  "stock.partida.ingresar": "Registrar la entrada de mercadería nueva (una partida con lote y vencimiento).",
  "stock.partida.costo.corregir": "Corregir el costo cargado de una partida. No cambia la cantidad.",
  "stock.ajuste.registrar": "Cargar una corrección de cantidad de stock (rotura, faltante, sobrante).",
  "stock.ajuste.autorizar": "Aprobar o rechazar los ajustes de stock que cargó otra persona.",
  "recetas.crear": "Cargar una receta magistral nueva.",
  "recetas.editar": "Modificar una receta cargada que todavía no se preparó.",
  "recetas.anular": "Anular una receta para que no siga su curso.",
  "fichas.generar": "Generar la ficha técnica de una preparación.",
  "fichas.imprimir": "Imprimir fichas técnicas ya generadas.",
  "cotizaciones.calcular": "Calcular el presupuesto de una receta para el paciente.",
  "cotizaciones.ver": "Ver presupuestos ya calculados.",
  "preparaciones.iniciar": "Empezar a preparar una receta: reserva el stock que se va a usar.",
  "preparaciones.descartar": "Cancelar una preparación en curso y liberar el stock reservado.",
  "preparaciones.confirmar": "Dar por terminada una preparación: descuenta el stock y la asienta en el libro recetario.",
  "etiquetas.generar": "Crear la etiqueta del preparado (datos, vencimiento, indicaciones).",
  "etiquetas.imprimir": "Imprimir etiquetas ya generadas.",
  "libro.ver": "Consultar el libro recetario y el libro contralor.",
  "libro.exportar": "Descargar el libro recetario (por ejemplo, para una inspección).",
  "libro.anulacion.solicitar": "Pedir que se anule un asiento del libro cargado por error. Otra persona lo tiene que autorizar.",
  "libro.anulacion.autorizar": "Aprobar o rechazar los pedidos de anulación de asientos del libro.",
  "cierres.ver": "Ver los cierres diarios del libro.",
  "cierres.reporte": "Ver qué días se cerraron y cuáles quedaron pendientes.",
  "cierres.firmar": "Firmar el cierre del día del libro recetario.",
  "cierres.imprimir": "Imprimir el comprobante de un cierre.",
  "cierres.folio.corregir": "Corregir el número de folio de un cierre cuando no coincide con el libro en papel.",
  "libros.crear": "Registrar un libro rubricado nuevo (el libro foliado en papel).",
  "libros.cerrar": "Cerrar un libro rubricado cuando se completa o se reemplaza.",
  "entregas.registrar": "Registrar que el preparado se le entregó al paciente o a quien lo retira.",
  "archivo.lotes.gestionar": "Armar y administrar los lotes de recetas archivadas.",
  "archivo.destruccion.gestionar": "Gestionar la destrucción de recetas archivadas cuyo plazo de guarda venció.",
  "reportes.ver": "Ver reportes de la operación diaria (recetas, preparaciones, stock).",
  "reportes.usuarios": "Ver reportes de actividad de los usuarios.",
  "reportes.auditoria": "Ver reportes armados a partir del registro de auditoría.",
  "auditoria.ver": "Ver el registro de quién hizo qué y cuándo en el sistema.",
};

/** Help text for `codigo`, or `undefined` for a code without one (e.g. a `sistema` permiso). */
export function ayudaDePermiso(codigo: Permiso): string | undefined {
  return Object.hasOwn(AYUDA_PERMISO, codigo) ? AYUDA_PERMISO[codigo as PermisoAsignable] : undefined;
}
