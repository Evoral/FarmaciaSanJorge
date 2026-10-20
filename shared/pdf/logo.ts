/**
 * The farmacia's logo for printed documents: `public/logo-etiqueta.png` (icon + "san jorge" wordmark, 283 × 95 px),
 * read once per server process. A missing file returns null and the caller draws its document without the logo.
 * Used by the etiqueta (`modules/preparaciones/infrastructure/etiqueta-pdf.ts`) and the hoja de envíos
 * (`modules/entregas/infrastructure/envios-pdf.ts`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let logoCache: Buffer | null | undefined;

export function logoFarmacia(): Buffer | null {
  if (logoCache === undefined) {
    try {
      logoCache = readFileSync(path.join(process.cwd(), "public", "logo-etiqueta.png"));
    } catch {
      logoCache = null;
    }
  }
  return logoCache;
}

/** Width / height of `public/logo-etiqueta.png`. */
export const LOGO_FARMACIA_PROPORCION = 283 / 95;
