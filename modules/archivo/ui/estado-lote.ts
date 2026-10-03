/**
 * Presentation of a lote de archivo's estado: the badge tone. Steps that ask for action (plazo cumplido, destrucción
 * in progress) read as warnings; archived and destroyed lotes are settled. Pure.
 */
import type { BadgeTone } from "@/shared/ui/status-badge";
import type { EstadoLoteArchivoValue } from "@/modules/archivo/domain/lote-archivo";

const TONO: Record<EstadoLoteArchivoValue, BadgeTone> = {
  EN_ARCHIVO: "neutral",
  PLAZO_CUMPLIDO: "warn",
  DESTRUCCION_SOLICITADA: "warn",
  DESTRUCCION_AUTORIZADA: "warn",
  DESTRUIDO: "neutral",
};

export function tonoEstadoLote(estado: EstadoLoteArchivoValue): BadgeTone {
  return TONO[estado];
}
