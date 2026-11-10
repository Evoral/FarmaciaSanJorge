/**
 * `GET /api/stock/existencia-inicial/plantilla/xlsx`
 * Downloadable Excel template for importing planilla de existencia inicial (R21).
 * Thin route delegating to `generarPlantillaExistenciaInicial` in modules/stock.
 */
import { NextResponse } from "next/server";
import { generarPlantillaExistenciaInicial } from "@/modules/stock/application/plantilla-existencia-inicial";
import { AppError, type AppErrorCode, toSafeError } from "@/shared/errors";
import { XLSX_CONTENT_TYPE } from "@/shared/xlsx/xlsx-report";

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

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();

  let bytes: Uint8Array;
  try {
    bytes = await generarPlantillaExistenciaInicial();
  } catch (e) {
    const appError = e instanceof AppError ? e : undefined;
    const status = appError ? STATUS_BY_CODE[appError.code] : 500;
    const safe = toSafeError(e, requestId);
    return NextResponse.json(safe, { status });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": 'attachment; filename="plantilla-existencia-inicial.xlsx"',
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
