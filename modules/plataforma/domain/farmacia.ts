/**
 * Pharmacy (tenant) as the platform sees it (openspec/changes/plataforma-superadmin, P8-P12). Pure: no I/O. The
 * platform only ever sees fsj.tenant's own columns, never a tenant-scoped table (D11).
 */
export type EstadoFarmacia = "ACTIVO" | "SUSPENDIDO";

export const ESTADO_FARMACIA_LABEL: Readonly<Record<EstadoFarmacia, string>> = { ACTIVO: "Activa", SUSPENDIDO: "Suspendida" };

export const PAGINA_FARMACIAS = 25;
export const RAZON_SOCIAL_MAX = 200;
export const CONTACTO_NOMBRE_MAX = 120;
export const TELEFONO_MAX = 40;
export const MOTIVO_MAX = 500;

export interface FarmaciaListada {
  id: string;
  razonSocial: string;
  nombreFantasia: string | null;
  cuit: string;
  estado: EstadoFarmacia;
  dadaDeBaja: boolean;
  /** Decimal as a string ("0.00"); positive = the pharmacy owes. */
  saldo: string;
}

export interface FarmaciaDetalle {
  id: string;
  razonSocial: string;
  nombreFantasia: string | null;
  cuit: string;
  domicilio: string | null;
  matriculaFarmacia: string | null;
  telefonoFijo: string | null;
  telefonoCelular: string | null;
  zonaHoraria: string;
  estado: EstadoFarmacia;
  fechaBaja: Date | null;
  creadoEn: Date;
  contactoNombre: string | null;
  contactoEmail: string | null;
  contactoTelefono: string | null;
}

export interface EventoPlataforma {
  id: string;
  ocurridoEn: Date;
  accion: string;
  superadmin: string;
  motivo: string | null;
}

export const ACCION_PLATAFORMA_LABEL: Readonly<Record<string, string>> = {
  TENANT_CREAR: "Alta de la farmacia",
  TENANT_SUSPENDER: "Suspensión",
  TENANT_REACTIVAR: "Reactivación",
  TENANT_CONTACTO_EDITAR: "Cambio de contacto",
  CARGO_REGISTRAR: "Cargo registrado",
  CARGO_ANULAR: "Cargo anulado",
  PAGO_REGISTRAR: "Pago registrado",
  PAGO_ANULAR: "Pago anulado",
};

// ---------------------------------------------------------------------------
// Cuenta corriente (P13-P16). Money travels as decimal strings, never JS numbers.
// ---------------------------------------------------------------------------
export const MEDIOS_PAGO = ["TRANSFERENCIA", "EFECTIVO", "MERCADO_PAGO", "OTRO"] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number];
export const MEDIO_PAGO_LABEL: Readonly<Record<MedioPago, string>> = {
  TRANSFERENCIA: "Transferencia",
  EFECTIVO: "Efectivo",
  MERCADO_PAGO: "Mercado Pago",
  OTRO: "Otro",
};
export const CONCEPTO_MAX = 200;
export const NOTA_MAX = 500;
/** Timezone in which "today" is judged for a pago's fecha (the DB uses the same one). */
export const ZONA_PLATAFORMA = "America/Argentina/Buenos_Aires";

export interface MovimientoCuenta {
  tipo: "CARGO" | "PAGO";
  id: string;
  /** ISO date: the período's first day for a cargo, the fecha for a pago. */
  fecha: string;
  /** Concepto of a cargo, nota of a pago. */
  descripcion: string | null;
  medio: MedioPago | null;
  monto: string;
  creadoEn: Date;
  creadoPor: string;
  anulacion: { en: Date; por: string; motivo: string } | null;
}

/** CUIT/CUIL digits only ("30-12345678-9" -> "30123456789"). */
export function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}
