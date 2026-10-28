/**
 * Global Help Guide Entries (CA2, design.md "Guide data model", "Initial content").
 *
 * The guide is global across all tenants, versioned with the code.
 * Every field is strictly checked against the UI source code and static routes.
 * A change to any user flow must update its corresponding entry in the same commit.
 */
import type { GuiaAyuda } from "./guia";

export const GUIA_AYUDA: GuiaAyuda = [
  {
    id: "archivo.lotes",
    titulo: "Archivo de recetas",
    permisos: ["archivo.lotes.gestionar"],
    ruta: "/archivo",
    pasos: "Entrá a Archivo de recetas en el menú para ver los lotes archivados y consultar recetas en guarda legal.",
    detalles: [
      {
        tema: "Filtros de archivo",
        texto: "Podés filtrar los lotes por estado o por rango de fechas de prescripción según el período legal.",
      },
      {
        tema: "Conformar lote",
        texto: "Tocá Conformar lote para seleccionar el período y la ubicación física de las recetas a archivar.",
      },
    ],
  },
  {
    id: "auditoria.consultar",
    titulo: "Auditoría",
    permisos: ["auditoria.ver"],
    ruta: "/auditoria",
    pasos: "Entrá a Auditoría en el menú para revisar el registro de acciones, cambios de estado y operaciones realizadas.",
    detalles: [
      {
        tema: "Filtros de auditoría",
        texto: "Podés filtrar los registros por usuario, entidad afectada, tipo de acción realizada o rango de fechas.",
      },
    ],
  },
  {
    id: "cierres.firmar",
    titulo: "Firmar cierre diario",
    permisos: ["cierres.ver", "cierres.firmar"],
    ruta: "/cierres",
    pasos: "Entrá a Gestión DT en el menú, revisá los asientos en Pendientes de firma y tocá Firmar cierre.",
    detalles: [
      {
        tema: "Demora en la firma",
        texto: "Si la firma se realiza fuera de término, el formulario te pide indicar el motivo de la demora.",
      },
      {
        tema: "Contraseña de usuario",
        texto: "Para firmar la jornada se solicita la contraseña de tu usuario personal como confirmación de seguridad.",
      },
    ],
    spec: "libro-recetario-y-contralor",
  },
  {
    id: "cierres.historial",
    titulo: "Historial de cierres",
    permisos: ["cierres.ver"],
    ruta: "/cierres/historial",
    pasos: "Entrá a Gestión DT en el menú y abrí la pestaña Historial de cierres para consultar las jornadas firmadas.",
    detalles: [
      {
        tema: "Filtro por fechas",
        texto: "Podés buscar cierres firmados indicando un rango de fechas en Desde y Hasta.",
      },
    ],
    spec: "libro-recetario-y-contralor",
  },
  {
    id: "cierres.vencimientos",
    titulo: "Vencimientos de drogas",
    permisos: ["cierres.ver", "stock.ver"],
    ruta: "/cierres/vencimientos",
    pasos: "Entrá a Gestión DT en el menú y abrí la pestaña Vencimientos para revisar las drogas vencidas o por vencer.",
    detalles: [
      {
        tema: "Control de vencimientos",
        texto: "Muestra las partidas de drogas con saldo que ya vencieron o están próximas a vencer para coordinar con el DT.",
      },
    ],
    spec: "reanalisis-partida",
  },
  {
    id: "clientes.gestionar",
    titulo: "Clientes",
    permisos: ["pacientes.gestionar"],
    ruta: "/clientes",
    pasos: "Entrá a Clientes en el menú para buscar pacientes, consultar sus recetas o tocar Nuevo cliente para crearlo.",
    detalles: [
      {
        tema: "Búsqueda de clientes",
        texto: "Escribí el apellido, nombre o número de documento en el buscador para localizar al cliente.",
      },
      {
        tema: "Historial del cliente",
        texto: "Al abrir un cliente podés consultar la pestaña Historial para ver el recorrido de todas sus recetas.",
      },
    ],
    spec: "pacientes-recurrentes",
  },
  {
    id: "configuracion.farmacia-editar",
    titulo: "Editar datos de farmacia",
    permisos: ["config.ver", "config.editar"],
    ruta: "/admin/configuracion/farmacia",
    pasos: "Entrá a Configuración en el menú, elegí Farmacia y modificá los datos editables o el logo institucional.",
    detalles: [
      {
        tema: "Logo de la farmacia",
        texto: "Podés subir la imagen del logo institucional para que aparezca en la barra lateral y en los reportes.",
      },
    ],
    spec: "logo-farmacia",
  },
  {
    id: "configuracion.farmacia-ver",
    titulo: "Datos de la farmacia",
    permisos: ["config.ver"],
    ruta: "/admin/configuracion/farmacia",
    pasos: "Entrá a Configuración en el menú y elegí Farmacia para consultar los datos institucionales registrados.",
    detalles: [
      {
        tema: "Información institucional",
        texto: "Muestra la razón social, CUIT, dirección y datos oficiales configurados para la farmacia.",
      },
    ],
    spec: "logo-farmacia",
  },
  {
    id: "configuracion.pin",
    titulo: "PIN por acción",
    permisos: ["config.ver", "config.editar"],
    ruta: "/admin/configuracion/pin",
    pasos: "Entrá a Configuración en el menú, elegí PIN por acción y seleccioná qué acciones requieren PIN en sectores.",
    detalles: [
      {
        tema: "Cuentas de sector",
        texto: "En una cuenta de sector, las acciones activadas exigen que el empleado ingrese su PIN personal.",
      },
    ],
    spec: "cuentas-de-sector",
  },
  {
    id: "configuracion.precios",
    titulo: "Reglas de precio",
    permisos: ["precios.reglas.editar"],
    ruta: "/admin/configuracion/precios",
    pasos: "Entrá a Configuración en el menú, elegí Reglas de precio y definí el precio mínimo y los márgenes por tramo.",
    detalles: [
      {
        tema: "Cálculo del precio",
        texto: "El precio sugerido de la preparación toma el mayor valor entre el precio mínimo y el costo más el margen.",
      },
    ],
    spec: "reglas-precio",
  },
  {
    id: "costos.consultar",
    titulo: "Costos de proveedores",
    permisos: ["stock.valorizado.ver"],
    ruta: "/costos-proveedor",
    pasos: "Entrá a Costos de proveedores en el menú para consultar los precios de referencia vigentes por droga.",
    detalles: [
      {
        tema: "Precios de referencia",
        texto: "Estos precios se utilizan para cotizar recetas y no alteran el costo real de las partidas en stock.",
      },
    ],
    spec: "costos-proveedor",
  },
  {
    id: "costos.importar",
    titulo: "Importar lista de precios",
    permisos: ["stock.valorizado.ver", "costos.proveedor.gestionar"],
    ruta: "/costos-proveedor/importar",
    pasos: "Entrá a Costos de proveedores en el menú, abrí la pestaña Importar lista, cargá el archivo y confirmá.",
    detalles: [
      {
        tema: "Formato de planilla",
        texto: "Podés subir listas de precios en formato Excel (.xls o .xlsx) y revisar la vista previa antes de guardar.",
      },
    ],
    spec: "costos-proveedor",
  },
  {
    id: "cuenta.perfil",
    titulo: "Mi cuenta",
    permisos: ["auth.password.cambiar"],
    ruta: "/cuenta",
    pasos: "Tocá tu nombre abajo en la barra lateral para abrir Mi cuenta y modificar tu contraseña o PIN de operador.",
    detalles: [
      {
        tema: "PIN personal",
        texto: "El PIN de cuatro dígitos se utiliza para autorizar operaciones sensibles en puestos con sesión compartida.",
      },
    ],
    spec: "cuentas-de-sector",
  },
  {
    id: "drogas.consultar",
    titulo: "Drogas",
    permisos: ["drogas.editar"],
    ruta: "/catalogos/drogas",
    pasos: "Entrá a Catálogos en el menú y elegí Drogas para consultar las materias primas, su stock y controlados.",
    detalles: [
      {
        tema: "Drogas controladas",
        texto: "El listado indica si la droga corresponde a psicotrópicos o estupefacientes bajo control oficial.",
      },
    ],
    spec: "sinonimos-droga",
  },
  {
    id: "drogas.crear",
    titulo: "Nueva droga",
    permisos: ["drogas.editar", "drogas.crear"],
    ruta: "/catalogos/drogas",
    pasos: "Entrá a Catálogos en el menú, elegí Drogas y tocá Nueva droga para registrar una materia prima.",
    detalles: [
      {
        tema: "PIN de operador",
        texto: "En una cuenta de sector, puede pedir tu PIN según la configuración de la farmacia.",
      },
      {
        tema: "Datos requeridos",
        texto: "Se define el nombre, clase de producto, unidad base y tipo de control legal de la droga.",
      },
    ],
    spec: "sinonimos-droga",
  },
  {
    id: "entregas.registrar",
    titulo: "Entregas",
    permisos: ["entregas.registrar"],
    ruta: "/entregas",
    pasos: "Entrá a Entregas en el menú, buscá la receta preparada y tocá Entregar para registrar el retiro o el envío.",
    detalles: [
      {
        tema: "PIN de operador",
        texto: "En una cuenta de sector, puede pedir tu PIN según la configuración de la farmacia.",
      },
      {
        tema: "Cobro previo",
        texto: "Para entregar en mostrador la receta debe estar pagada; en envíos puede salir impaga y cobrarse al retorno.",
      },
    ],
    spec: "envios-repartidores",
  },
  {
    id: "etiquetas.imprimir",
    titulo: "Imprimir etiquetas",
    permisos: ["preparaciones.iniciar", "etiquetas.imprimir"],
    ruta: "/preparaciones",
    pasos: "Entrá a Preparaciones en el menú, abrí la pestaña Confirmadas, localizá la preparación y tocá Imprimir.",
    detalles: [
      {
        tema: "Posición en la hoja",
        texto: "En el diálogo de impresión podés elegir el tamaño de etiqueta y la celda de la hoja donde querés imprimir.",
      },
    ],
    spec: "hoja-etiquetas",
  },
  {
    id: "libro.contralor",
    titulo: "Libros contralor",
    permisos: ["libro.ver"],
    ruta: "/libro/contralor",
    pasos: "Entrá a Libro Recetario en el menú, abrí la pestaña Libros contralor y consultá psicotrópicos y estupefacientes.",
    detalles: [
      {
        tema: "Filtros de controlados",
        texto: "Podés filtrar los movimientos por droga, tipo de libro y rango de fechas de los asientos.",
      },
    ],
    spec: "libro-recetario-y-contralor",
  },
  {
    id: "libro.recetario",
    titulo: "Libro Recetario",
    permisos: ["libro.ver"],
    ruta: "/libro",
    pasos: "Entrá a Libro Recetario en el menú para ver los asientos correlativos de preparaciones y buscar por fecha.",
    detalles: [
      {
        tema: "Búsqueda de asientos",
        texto: "Podés buscar asientos por número correlativo, rango de fechas o datos del paciente o médico.",
      },
    ],
    spec: "libro-recetario-y-contralor",
  },
  {
    id: "medicos.gestionar",
    titulo: "Médicos",
    permisos: ["medicos.gestionar"],
    ruta: "/catalogos/medicos",
    pasos: "Entrá a Catálogos en el menú, elegí Médicos y buscá por nombre o matrícula, o tocá Nuevo médico para darlo de alta.",
    detalles: [
      {
        tema: "Datos del prescriptor",
        texto: "Se registra el nombre, matrícula profesional provincial o nacional y datos de contacto del médico.",
      },
    ],
  },
  {
    id: "partidas.consultar",
    titulo: "Partidas",
    permisos: ["stock.ver"],
    ruta: "/partidas",
    pasos: "Entrá a Partidas en el menú para revisar los lotes ingresados, consultar saldos y verificar vencimientos.",
    detalles: [
      {
        tema: "Búsqueda de lotes",
        texto: "Podés buscar por código de lote, filtrar por droga, droguería de origen o filtrar partidas con saldo.",
      },
    ],
    spec: "historial-partidas",
  },
  {
    id: "partidas.ingresar",
    titulo: "Nuevo ingreso de partida",
    permisos: ["stock.ver", "stock.partida.ingresar"],
    ruta: "/partidas/ingresar",
    pasos: "Entrá a Partidas en el menú, tocá Nuevo ingreso y completá los datos de la factura y los lotes del proveedor.",
    detalles: [
      {
        tema: "PIN de operador",
        texto: "En una cuenta de sector, puede pedir tu PIN según la configuración de la farmacia.",
      },
      {
        tema: "Importar factura PDF",
        texto: "Podés subir el archivo PDF de la factura del proveedor para autocompletar la carga de los lotes recibidos.",
      },
    ],
    spec: "historial-partidas",
  },
  {
    id: "preparaciones.tomar",
    titulo: "Preparaciones",
    permisos: ["preparaciones.iniciar"],
    ruta: "/preparaciones",
    pasos: "Entrá a Preparaciones en el menú, buscá la receta en la pestaña Pendientes y tocá Tomar receta para iniciarla.",
    detalles: [
      {
        tema: "PIN de operador",
        texto: "En una cuenta de sector, puede pedir tu PIN según la configuración de la farmacia.",
      },
      {
        tema: "Pesaje y confirmación",
        texto: "Al tomar la receta se abre el espacio de trabajo para registrar el pesaje de drogas y confirmar la fórmula.",
      },
    ],
    spec: "reserva-stock-preparacion",
  },
  {
    id: "proveedores.gestionar",
    titulo: "Proveedores",
    permisos: ["proveedores.gestionar"],
    ruta: "/proveedores",
    pasos: "Entrá a Proveedores en el menú para consultar droguerías registradas o tocar Nuevo proveedor para dar de alta uno.",
    detalles: [
      {
        tema: "Identificación tributaria",
        texto: "Al registrar un proveedor se ingresa su número de CUIT y los datos de contacto del distribuidor.",
      },
    ],
    spec: "trayectoria-proveedor",
  },
  {
    id: "recetas.anular",
    titulo: "Anular receta",
    permisos: ["recetas.crear", "recetas.anular"],
    ruta: "/recetas",
    pasos: "Entrá a Recetas en el menú, abrí la receta correspondiente y en el panel Anulación tocá Anular receta.",
    detalles: [
      {
        tema: "PIN obligatorio",
        texto: "En una cuenta de sector, siempre te va a pedir tu PIN de empleado.",
      },
      {
        tema: "Motivo de anulación",
        texto: "Es obligatorio indicar el motivo por el cual se deja sin efecto la receta antes de confirmar la baja.",
      },
    ],
    spec: "libro-recetario-y-contralor",
  },
  {
    id: "recetas.buscar",
    titulo: "Recetas",
    permisos: ["recetas.crear"],
    ruta: "/recetas",
    pasos: "Entrá a Recetas en el menú para ver el listado, filtrar por estado de preparación o buscar por Nº interno.",
    detalles: [
      {
        tema: "Filtros por estado",
        texto: "Podés hacer clic en cada estado del resumen para ver únicamente las recetas en esa etapa.",
      },
    ],
    spec: "alta-receta-idempotente",
  },
  {
    id: "recetas.cargar",
    titulo: "Nueva receta",
    permisos: ["recetas.crear"],
    ruta: "/recetas/nuevo",
    pasos: "Entrá a Recetas en el menú, tocá Nueva receta y completá los datos del paciente, médico y la fórmula magistral.",
    detalles: [
      {
        tema: "PIN de operador",
        texto: "En una cuenta de sector, puede pedir tu PIN según la configuración de la farmacia.",
      },
      {
        tema: "Importar receta digital",
        texto: "En Nueva receta podés tocar Seleccionar PDF para cargar directamente la receta electrónica del paciente.",
      },
    ],
    spec: "alta-receta-idempotente",
  },
  {
    id: "repartidores.gestionar",
    titulo: "Repartidores",
    permisos: ["repartidores.gestionar"],
    ruta: "/catalogos/repartidores",
    pasos: "Entrá a Catálogos en el menú, elegí Repartidores y tocá Nuevo repartidor para registrar personal de envíos.",
    detalles: [
      {
        tema: "Asignación en entregas",
        texto: "Los repartidores activos son los que se pueden seleccionar al registrar una entrega a domicilio.",
      },
    ],
    spec: "envios-repartidores",
  },
  {
    id: "reportes.consultar",
    titulo: "Reportes",
    permisos: ["reportes.ver"],
    ruta: "/reportes",
    pasos: "Entrá a Reportes en el menú para acceder a las consultas de recetas por estado, movimientos y exportaciones.",
    detalles: [
      {
        tema: "Reporte de recetas",
        texto: "Podés consultar totales por estado y descargar el listado de recetas según su fecha de ingreso.",
      },
    ],
  },
  {
    id: "reportes.kardex",
    titulo: "Kardex de movimientos",
    permisos: ["stock.ver"],
    ruta: "/reportes/kardex",
    pasos: "Entrá a Reportes en el menú y elegí Kardex de movimientos para consultar ingresos, egresos y ajustes de drogas.",
    detalles: [
      {
        tema: "Filtros de movimientos",
        texto: "Podés seleccionar una droga específica y acotar por tipo de movimiento o rango de fechas.",
      },
    ],
  },
  {
    id: "reportes.valorizado",
    titulo: "Stock valorizado",
    permisos: ["stock.valorizado.ver"],
    ruta: "/reportes/stock-valorizado",
    pasos: "Entrá a Reportes en el menú y elegí Stock valorizado para ver el valor monetario del inventario por partida.",
    detalles: [
      {
        tema: "Excluir vencidas",
        texto: "Podés activar el filtro para no contabilizar las partidas que ya superaron su fecha de vencimiento.",
      },
    ],
  },
  {
    id: "roles.gestionar",
    titulo: "Nuevo rol",
    permisos: ["roles.ver", "roles.gestionar"],
    ruta: "/admin/accesos/roles",
    pasos: "Entrá a Usuarios y accesos en el menú, abrí la pestaña Roles y tocá Nuevo rol para crear un rol personalizado.",
    detalles: [
      {
        tema: "Asignación de permisos",
        texto: "Podés elegir qué permisos de consulta, gestión u operativos otorgar al nuevo rol.",
      },
      {
        tema: "Protección de roles",
        texto: "Los roles del sistema protegen permisos críticos y no permiten eliminar roles base.",
      },
    ],
    spec: "roles-personalizables",
  },
  {
    id: "roles.ver",
    titulo: "Roles",
    permisos: ["roles.ver"],
    ruta: "/admin/accesos/roles",
    pasos: "Entrá a Usuarios y accesos en el menú y abrí la pestaña Roles para consultar los roles y sus permisos.",
    detalles: [
      {
        tema: "Roles asignados",
        texto: "Muestra cuántos usuarios personales y cuentas de sector tienen asignado cada rol.",
      },
    ],
    spec: "roles-personalizables",
  },
  {
    id: "stock.ajustes-consultar",
    titulo: "Ajustes de stock",
    permisos: ["stock.ver"],
    ruta: "/stock/ajustes",
    pasos: "Entrá a Ajuste de Stock en el menú para revisar el historial de mermas y ajustes de saldo registrados.",
    detalles: [
      {
        tema: "Filtros de ajustes",
        texto: "Podés buscar por nombre de droga o número de lote, y filtrar por el motivo declarado en el ajuste.",
      },
    ],
  },
  {
    id: "stock.ajustes-registrar",
    titulo: "Registrar ajuste de stock",
    permisos: ["stock.ver", "stock.ajuste.registrar"],
    ruta: "/stock/ajustes/nuevo",
    pasos: "Entrá a Ajuste de Stock en el menú, tocá Registrar ajuste, elegí la droga y partida, y completá el motivo.",
    detalles: [
      {
        tema: "PIN de operador",
        texto: "En una cuenta de sector, puede pedir tu PIN según la configuración de la farmacia.",
      },
      {
        tema: "Co-firma del DT",
        texto: "El ajuste descuenta stock disponible de la partida y queda asentado con la intervención del Director Técnico.",
      },
    ],
  },
  {
    id: "stock.consultar",
    titulo: "Stock",
    permisos: ["stock.ver"],
    ruta: "/stock",
    pasos: "Entrá a Stock en el menú para ver las existencias actuales por droga, alertas de faltantes y vencimientos.",
    detalles: [
      {
        tema: "Alertas de stock",
        texto: "Podés filtrar drogas que estén Bajo mínimo, Sin stock o con partidas vencidas o por vencer.",
      },
    ],
  },
  {
    id: "unidades.consultar",
    titulo: "Unidades de medida",
    permisos: ["unidades.editar"],
    ruta: "/catalogos/unidades",
    pasos: "Entrá a Catálogos en el menú y elegí Unidades de medida para consultar las unidades vigentes y sus símbolos.",
    detalles: [
      {
        tema: "Magnitudes",
        texto: "Las unidades se agrupan por peso, volumen o unidades enteras con sus factores de conversión.",
      },
    ],
  },
  {
    id: "usuarios.crear",
    titulo: "Nuevo usuario",
    permisos: ["usuarios.listar", "usuarios.crear"],
    ruta: "/admin/accesos/usuarios/nuevo",
    pasos: "Entrá a Usuarios y accesos en el menú, tocá Nuevo usuario, completá los datos del empleado y tocá Crear usuario.",
    detalles: [
      {
        tema: "Cuentas de sector",
        texto: "Al crear una cuenta compartida para un puesto físico, marcá la opción Cuenta de sector.",
      },
    ],
    spec: "cuentas-de-sector",
  },
  {
    id: "usuarios.listar",
    titulo: "Usuarios",
    permisos: ["usuarios.listar"],
    ruta: "/admin/accesos/usuarios",
    pasos: "Entrá a Usuarios y accesos en el menú para ver los usuarios dados de alta, su estado y roles asignados.",
    detalles: [
      {
        tema: "Filtros de usuarios",
        texto: "Podés buscar por nombre, filtrar por estado activo o suspendido, o filtrar por rol asignado.",
      },
    ],
  },
] as const;
