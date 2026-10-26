/**
 * Trust boundary for the farmacia's uploaded logo (openspec/specs/logo-farmacia/spec.md). Same order as the PDF imports
 * (shared/pdf/validar-archivo-pdf.ts): `instanceof File`, empty, too big (BEFORE reading it), then the file signature.
 * The media type is DETECTED from the signature, never taken from `file.type` or the extension (client-controlled),
 * and it is what the logo is later served as. SVG is not accepted: it can carry script.
 */
import { ValidationError } from "@/shared/errors";

/** 512 KiB; also a CHECK on fsj.tenant.logo (migration 0098). A navbar logo needs far less. */
export const MAX_LOGO_BYTES = 512 * 1024;

export const TIPOS_LOGO = ["image/png", "image/jpeg", "image/webp"] as const;
export type TipoLogo = (typeof TIPOS_LOGO)[number];

/** For the file input's `accept`: only a hint, the signature check is what counts. */
export const ACCEPT_LOGO = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

export const MENSAJES_LOGO = {
  noEsArchivo: "Elegí la imagen del logo.",
  vacio: "El archivo está vacío.",
  demasiadoGrande: `La imagen supera el máximo de ${MAX_LOGO_BYTES / 1024} KB.`,
  formatoInvalido: "El logo debe ser una imagen PNG, JPG o WebP.",
} as const;

function empiezaCon(bytes: Uint8Array, firma: readonly number[], desde = 0): boolean {
  return bytes.length >= desde + firma.length && firma.every((b, i) => bytes[desde + i] === b);
}

/** The media type the bytes actually are, or `null` when they are none of `TIPOS_LOGO`. */
export function detectarTipoLogo(bytes: Uint8Array): TipoLogo | null {
  if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // "RIFF" <size> "WEBP"
  if (empiezaCon(bytes, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Returns the bytes and their detected type. Throws `ValidationError` (shown verbatim, marking the `logo` field) on the first failure. */
export async function validarArchivoLogo(archivo: unknown): Promise<{ bytes: Uint8Array<ArrayBuffer>; tipo: TipoLogo }> {
  const error = (message: string) => new ValidationError(message, { fields: ["logo"] });
  if (!(archivo instanceof File)) throw error(MENSAJES_LOGO.noEsArchivo);
  if (archivo.size === 0) throw error(MENSAJES_LOGO.vacio);
  if (archivo.size > MAX_LOGO_BYTES) throw error(MENSAJES_LOGO.demasiadoGrande);

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const tipo = detectarTipoLogo(bytes);
  if (!tipo) throw error(MENSAJES_LOGO.formatoInvalido);
  return { bytes, tipo };
}
