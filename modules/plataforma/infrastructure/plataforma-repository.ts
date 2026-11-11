/**
 * Platform reads and writes (migrations 0124-0126). fsj_app has no privilege on the platform tables and RLS hides
 * every tenant row outside a tenant transaction, so EVERYTHING here is a call to a SECURITY DEFINER fsj.plataforma_*
 * function that receives the session token hash and re-validates it (spec P6).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EstadoFarmacia, EventoPlataforma, FarmaciaDetalle, FarmaciaListada, MedioPago, MovimientoCuenta } from "../domain/farmacia";

export interface Meta {
  ip: string | null;
  requestId: string | null;
}

export async function listarFarmacias(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  filtro: { busqueda: string | null; limit: number; offset: number },
): Promise<{ items: FarmaciaListada[]; total: number }> {
  const rows = await tx.$queryRaw<
    { id: string; razon_social: string; nombre_fantasia: string | null; cuit: string; estado: EstadoFarmacia; fecha_baja: Date | null; saldo: string; total: bigint }[]
  >`SELECT id, razon_social, nombre_fantasia, cuit, estado::text AS estado, fecha_baja, saldo::text AS saldo, total
    FROM fsj.plataforma_listar_tenants(${tokenHash}, ${filtro.busqueda}, ${filtro.limit}::int, ${filtro.offset}::int)`;
  return {
    total: rows.length > 0 ? Number(rows[0]!.total) : 0,
    items: rows.map((r) => ({
      id: r.id,
      razonSocial: r.razon_social,
      nombreFantasia: r.nombre_fantasia,
      cuit: r.cuit,
      estado: r.estado,
      dadaDeBaja: r.fecha_baja !== null,
      saldo: r.saldo,
    })),
  };
}

export async function verFarmacia(tx: Prisma.TransactionClient, tokenHash: string, tenantId: string): Promise<FarmaciaDetalle | null> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      razon_social: string;
      nombre_fantasia: string | null;
      cuit: string;
      domicilio: string | null;
      matricula_farmacia: string | null;
      telefono_fijo: string | null;
      telefono_celular: string | null;
      zona_horaria: string;
      estado: EstadoFarmacia;
      fecha_baja: Date | null;
      creado_en: Date;
      contacto_nombre: string | null;
      contacto_email: string | null;
      contacto_telefono: string | null;
    }[]
  >`SELECT id, razon_social, nombre_fantasia, cuit, domicilio, matricula_farmacia, telefono_fijo, telefono_celular, zona_horaria,
           estado::text AS estado, fecha_baja, creado_en, contacto_nombre, contacto_email, contacto_telefono
    FROM fsj.plataforma_ver_tenant(${tokenHash}, ${tenantId}::uuid)`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    razonSocial: r.razon_social,
    nombreFantasia: r.nombre_fantasia,
    cuit: r.cuit,
    domicilio: r.domicilio,
    matriculaFarmacia: r.matricula_farmacia,
    telefonoFijo: r.telefono_fijo,
    telefonoCelular: r.telefono_celular,
    zonaHoraria: r.zona_horaria,
    estado: r.estado,
    fechaBaja: r.fecha_baja,
    creadoEn: r.creado_en,
    contactoNombre: r.contacto_nombre,
    contactoEmail: r.contacto_email,
    contactoTelefono: r.contacto_telefono,
  };
}

export async function auditoriaFarmacia(tx: Prisma.TransactionClient, tokenHash: string, tenantId: string, limit: number): Promise<EventoPlataforma[]> {
  const rows = await tx.$queryRaw<{ id: string; ocurrido_en: Date; accion: string; superadmin_nombre: string; motivo: string | null }[]>`
    SELECT id, ocurrido_en, accion, superadmin_nombre, motivo FROM fsj.plataforma_auditoria_tenant(${tokenHash}, ${tenantId}::uuid, ${limit}::int)`;
  return rows.map((r) => ({ id: r.id, ocurridoEn: r.ocurrido_en, accion: r.accion, superadmin: r.superadmin_nombre, motivo: r.motivo }));
}

export async function conflictosDeAlta(tx: Prisma.TransactionClient, tokenHash: string, cuit: string, adminEmail: string): Promise<{ cuit: boolean; email: boolean }> {
  const rows = await tx.$queryRaw<{ cuit_en_uso: boolean; email_en_uso: boolean }[]>`
    SELECT cuit_en_uso, email_en_uso FROM fsj.plataforma_alta_conflictos(${tokenHash}, ${cuit}, ${adminEmail})`;
  return { cuit: rows[0]?.cuit_en_uso ?? false, email: rows[0]?.email_en_uso ?? false };
}

export interface AltaFarmaciaDb {
  razonSocial: string;
  cuit: string;
  nombreFantasia: string | null;
  domicilio: string | null;
  matriculaFarmacia: string | null;
  zonaHoraria: string;
  contactoNombre: string | null;
  contactoEmail: string | null;
  contactoTelefono: string | null;
  adminEmail: string;
  adminNombre: string;
  adminApellido: string;
  adminDni: string;
  adminPasswordHash: string;
  etiqueta: { nombre: string; anchoMm: number; altoMm: number };
  hoja: { anchoMm: number; altoMm: number; margenMm: number };
}

export async function crearFarmacia(tx: Prisma.TransactionClient, tokenHash: string, alta: AltaFarmaciaDb, meta: Meta): Promise<{ tenantId: string }> {
  const rows = await tx.$queryRaw<{ tenant_id: string }[]>`
    SELECT tenant_id FROM fsj.plataforma_crear_tenant(
      ${tokenHash}, ${alta.razonSocial}, ${alta.cuit}, ${alta.nombreFantasia}, ${alta.domicilio}, ${alta.matriculaFarmacia}, ${alta.zonaHoraria},
      ${alta.contactoNombre}, ${alta.contactoEmail}, ${alta.contactoTelefono},
      ${alta.adminEmail}, ${alta.adminNombre}, ${alta.adminApellido}, ${alta.adminDni}, ${alta.adminPasswordHash},
      ${alta.etiqueta.nombre}, ${alta.etiqueta.anchoMm}::numeric, ${alta.etiqueta.altoMm}::numeric,
      ${alta.hoja.anchoMm}::numeric, ${alta.hoja.altoMm}::numeric, ${alta.hoja.margenMm}::numeric,
      ${meta.ip}, ${meta.requestId})`;
  return { tenantId: rows[0]!.tenant_id };
}

export async function cambiarEstadoFarmacia(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  tenantId: string,
  estado: EstadoFarmacia,
  motivo: string | null,
  meta: Meta,
): Promise<void> {
  await tx.$executeRaw`SELECT fsj.plataforma_cambiar_estado_tenant(${tokenHash}, ${tenantId}::uuid, ${estado}::fsj.estado_tenant, ${motivo}, ${meta.ip}, ${meta.requestId})`;
}

export async function editarContactoFarmacia(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  tenantId: string,
  contacto: { nombre: string | null; email: string | null; telefono: string | null },
  meta: Meta,
): Promise<void> {
  await tx.$executeRaw`SELECT fsj.plataforma_editar_contacto_tenant(${tokenHash}, ${tenantId}::uuid, ${contacto.nombre}, ${contacto.email}, ${contacto.telefono}, ${meta.ip}, ${meta.requestId})`;
}

export async function cuentaCorriente(tx: Prisma.TransactionClient, tokenHash: string, tenantId: string): Promise<{ movimientos: MovimientoCuenta[]; saldo: string }> {
  const rows = await tx.$queryRaw<
    {
      tipo: "CARGO" | "PAGO";
      id: string;
      fecha: string;
      descripcion: string | null;
      medio: MedioPago | null;
      monto: string;
      creado_en: Date;
      creado_por: string;
      anulado_en: Date | null;
      anulado_por: string | null;
      motivo_anulacion: string | null;
      saldo: string;
    }[]
  >`SELECT tipo, id, fecha::text AS fecha, descripcion, medio, monto::text AS monto, creado_en, creado_por, anulado_en, anulado_por, motivo_anulacion,
           saldo::text AS saldo
    FROM fsj.plataforma_cuenta_corriente(${tokenHash}, ${tenantId}::uuid)`;
  return {
    // Every row carries the same saldo; no movements means 0 (P16).
    saldo: rows[0]?.saldo ?? "0.00",
    movimientos: rows.map((r) => ({
      tipo: r.tipo,
      id: r.id,
      fecha: r.fecha,
      descripcion: r.descripcion,
      medio: r.medio,
      monto: r.monto,
      creadoEn: r.creado_en,
      creadoPor: r.creado_por,
      anulacion: r.anulado_en ? { en: r.anulado_en, por: r.anulado_por ?? "", motivo: r.motivo_anulacion ?? "" } : null,
    })),
  };
}

/** `monto` is a decimal string with 2 decimals; `periodo` an ISO date (any day of the month). */
export async function registrarCargo(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  cargo: { tenantId: string; periodo: string; monto: string; concepto: string },
  meta: Meta,
): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT fsj.plataforma_registrar_cargo(${tokenHash}, ${cargo.tenantId}::uuid, ${cargo.periodo}::date, ${cargo.monto}::numeric, ${cargo.concepto}, ${meta.ip}, ${meta.requestId}) AS id`;
  return rows[0]!.id;
}

export async function registrarPago(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  pago: { tenantId: string; fecha: string; monto: string; medio: MedioPago; nota: string | null; envioId: string },
  meta: Meta,
): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT fsj.plataforma_registrar_pago(${tokenHash}, ${pago.tenantId}::uuid, ${pago.fecha}::date, ${pago.monto}::numeric,
      ${pago.medio}::fsj.medio_pago_plataforma, ${pago.nota}, ${pago.envioId}::uuid, ${meta.ip}, ${meta.requestId}) AS id`;
  return rows[0]!.id;
}

export async function anularMovimiento(tx: Prisma.TransactionClient, tokenHash: string, tipo: "CARGO" | "PAGO", id: string, motivo: string, meta: Meta): Promise<void> {
  await tx.$executeRaw`SELECT fsj.plataforma_anular_movimiento(${tokenHash}, ${tipo}, ${id}::uuid, ${motivo}, ${meta.ip}, ${meta.requestId})`;
}

/** Which field a unique violation raised by the alta belongs to (the race the pre-check cannot close), or `null`. */
export function campoDeConflictoDeAlta(error: unknown): "cuit" | "adminEmail" | "adminDni" | null {
  const textos: string[] = [];
  for (let actual: unknown = error, i = 0; actual && i < 5; actual = (actual as { cause?: unknown }).cause, i++) {
    if (actual instanceof Error) textos.push(actual.message);
  }
  const texto = textos.join(" ");
  if (texto.includes("tenant_cuit_key")) return "cuit";
  if (texto.includes("usuario_email_key") || texto.includes("superadmin_email_key")) return "adminEmail";
  if (texto.includes("usuario_tenant_dni_key")) return "adminDni";
  return null;
}
