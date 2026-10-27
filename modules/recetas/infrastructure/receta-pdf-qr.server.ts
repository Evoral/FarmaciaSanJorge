/**
 * QR codes printed as images inside a receta PDF (openspec/specs/importacion-receta-pdf/spec.md, "Lectura por MisRx"):
 * a MisRx PDF is one page-sized image with no text layer, so its QR is the only way in. Each embedded image is decoded
 * with jsQR. Never throws: an unreadable document or image just yields no codes, and the caller reports "no link".
 * The bytes and the decoded texts are never logged.
 */
import "server-only";
import jsQR from "jsqr";

/** Images above this many pixels are skipped: a page-sized render is far below it, and jsQR's cost grows with the area. */
const MAX_PIXELES_IMAGEN = 16_000_000;

/** pdf.js gives 1 (gray), 3 (RGB) or 4 (RGBA) channels; jsQR wants RGBA. */
function aRgba(datos: Uint8ClampedArray, pixeles: number, canales: number): Uint8ClampedArray {
  if (canales === 4) return datos;
  const rgba = new Uint8ClampedArray(pixeles * 4);
  for (let i = 0; i < pixeles; i++) {
    const origen = i * canales;
    rgba[i * 4] = datos[origen]!;
    rgba[i * 4 + 1] = datos[origen + (canales > 1 ? 1 : 0)]!;
    rgba[i * 4 + 2] = datos[origen + (canales > 2 ? 2 : 0)]!;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export async function leerQrsDePdf(bytes: Uint8Array, maxPaginas: number): Promise<string[]> {
  const { getDocumentProxy, extractImages } = await import("unpdf");
  const codigos: string[] = [];
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
    for (let numero = 1; numero <= Math.min(pdf.numPages, maxPaginas); numero++) {
      for (const imagen of await extractImages(pdf, numero)) {
        const pixeles = imagen.width * imagen.height;
        if (pixeles === 0 || pixeles > MAX_PIXELES_IMAGEN) continue;
        const qr = jsQR(aRgba(imagen.data, pixeles, imagen.channels), imagen.width, imagen.height, { inversionAttempts: "attemptBoth" });
        if (qr?.data) codigos.push(qr.data);
      }
    }
  } catch {
    // An image or page pdf.js cannot decode: keep whatever was read.
  } finally {
    await pdf?.loadingTask.destroy();
  }
  return codigos;
}
