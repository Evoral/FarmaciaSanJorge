/**
 * The farmacia's logo for printed documents: the tenant's OWN uploaded logo (`fsj.tenant.logo`,
 * docs/specs/logo-farmacia.md R6), never a fixed file -- in a multi-tenant app a fixed logo would print one
 * farmacia's brand on another's documents. Used by the etiqueta (`modules/preparaciones/infrastructure/etiqueta-pdf.ts`)
 * and the hoja de envíos (`modules/entregas/infrastructure/envios-pdf.ts`).
 *
 * PDFKit draws PNG and JPEG only: a WebP logo, an unreadable one or none returns null and the caller draws its
 * document without it.
 */

export interface LogoPdf {
  imagen: Buffer;
  /** Width / height, read from the image's own header. */
  proporcion: number;
}

function dimensionesPng(b: Uint8Array): [number, number] | null {
  if (b.length < 24) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
}

function dimensionesJpeg(b: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marcador = b[i + 1]!;
    // SOF0-SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not.
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      return [(b[i + 7]! << 8) | b[i + 8]!, (b[i + 5]! << 8) | b[i + 6]!];
    }
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return null;
}

export function logoParaPdf(logo: { bytes: Uint8Array; tipo: string } | null): LogoPdf | null {
  if (!logo) return null;
  const dimensiones = logo.tipo === "image/png" ? dimensionesPng(logo.bytes) : logo.tipo === "image/jpeg" ? dimensionesJpeg(logo.bytes) : null;
  if (!dimensiones || dimensiones[0] <= 0 || dimensiones[1] <= 0) return null;
  return { imagen: Buffer.from(logo.bytes), proporcion: dimensiones[0] / dimensiones[1] };
}
