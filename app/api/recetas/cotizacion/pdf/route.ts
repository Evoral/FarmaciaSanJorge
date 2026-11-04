/**
 * `POST /api/recetas/cotizacion/pdf` (openspec/specs/presupuesto-receta, "Ticket de cotización"): the 80 mm ticket
 * with the price of the receta being loaded, for a client who only asks for it. A POST, not a GET: the draft and the
 * paciente's name travel in the body, never in the URL. The "Precio" box submits it to a new tab, which shows the PDF
 * to print. Authorization and the price live in `imprimirCotizacionPdf` (a `defineQuery`, `cotizaciones.calcular`);
 * nothing is saved.
 */
import { NextResponse } from "next/server";
import { imprimirCotizacionPdf, type ImprimirCotizacionWireInput } from "@/modules/recetas/application/imprimir-cotizacion-pdf";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  DOMAIN_ERROR: 422,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  INVARIANT_VIOLATION: 409,
  STEP_UP_REQUIRED: 401,
  PASOS_PENDIENTES: 403,
  INTERNAL_ERROR: 500,
};

function texto(formData: FormData, campo: string): string | null {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : null;
}

/** The tab shows the reason as plain text: the user opened it to print, not to read JSON. */
function errorComoTexto(mensaje: string, status: number): Response {
  return new NextResponse(mensaje, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();

  let items: unknown;
  let formData: FormData;
  try {
    formData = await request.formData();
    items = JSON.parse(texto(formData, "itemsJson") ?? "");
  } catch {
    return errorComoTexto("No se pudo leer la receta para la cotización.", 400);
  }

  let pdf: Buffer;
  try {
    pdf = await imprimirCotizacionPdf({
      // Validated by the use case (zod), like every Server Action input.
      items: items as ImprimirCotizacionWireInput["items"],
      paciente: texto(formData, "paciente"),
      medico: texto(formData, "medico"),
    });
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    return errorComoTexto(toSafeError(e, requestId).message, status);
  }

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="cotizacion.pdf"',
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
