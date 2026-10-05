/**
 * Badge tone of an audited acción: destructive or denied in red, creations/approvals in green, corrections in amber,
 * everything else neutral. Display only (the acción's label is always printed too). Shared by `/auditoria` and the
 * usuario "Historial" tab.
 */
import type { TipoAccion } from "@/generated/prisma/enums";
import type { BadgeTone } from "@/shared/ui/status-badge";

const TONO_ACCION: Partial<Record<TipoAccion, BadgeTone>> = {
  CREAR: "success",
  REACTIVAR: "success",
  ACTIVAR_CUENTA: "success",
  CREAR_ROL: "success",
  CONFIRMAR: "success",
  FIRMAR: "success",
  AUTORIZAR: "success",
  BAJA: "danger",
  ANULAR: "danger",
  DESCARTAR: "danger",
  SUSPENDER: "danger",
  QUITAR_ROL: "danger",
  DESTRUIR: "danger",
  INUTILIZAR_FOJAS: "danger",
  ELIMINAR_ROL: "danger",
  ACCESO_DENEGADO: "danger",
  LOGIN_FALLIDO_BLOQUEO: "danger",
  CORREGIR_FOLIO: "warn",
  RESTABLECER_CREDENCIAL: "warn",
};

export function tonoAccion(accion: TipoAccion): BadgeTone {
  return TONO_ACCION[accion] ?? "neutral";
}
