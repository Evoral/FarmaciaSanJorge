import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/recetas/cotizacion/pdf/route";
import { AuthorizationError, DomainError } from "@/shared/errors";

const imprimirCotizacionPdfMock = vi.fn();
vi.mock("@/modules/recetas/application/imprimir-cotizacion-pdf", () => ({
  imprimirCotizacionPdf: (...args: unknown[]) => imprimirCotizacionPdfMock(...args),
}));

function crearRequest(body: FormData): Request {
  return new Request("https://localhost/api/recetas/cotizacion/pdf", {
    method: "POST",
    body,
  });
}

describe("POST /api/recetas/cotizacion/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("itemsJson that is not valid JSON -> 400, text/plain, 'No se pudo leer la receta para la cotización.'", async () => {
    const formData = new FormData();
    formData.set("itemsJson", "invalid-json{{");

    const response = await POST(crearRequest(formData));

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("No se pudo leer la receta para la cotización.");
    expect(imprimirCotizacionPdfMock).not.toHaveBeenCalled();
  });

  it("DomainError -> 422 with its message as plain text", async () => {
    imprimirCotizacionPdfMock.mockRejectedValue(new DomainError("Hay ítems sin precio."));

    const formData = new FormData();
    formData.set("itemsJson", JSON.stringify([{ formaFarmaceutica: "CREMA" }]));

    const response = await POST(crearRequest(formData));

    expect(response.status).toBe(422);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("Hay ítems sin precio.");
  });

  it("AuthorizationError -> 403 with safe plain text", async () => {
    imprimirCotizacionPdfMock.mockRejectedValue(new AuthorizationError("Sin permiso cotizaciones.calcular"));

    const formData = new FormData();
    formData.set("itemsJson", JSON.stringify([{ formaFarmaceutica: "CREMA" }]));

    const response = await POST(crearRequest(formData));

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("No tenés permiso para realizar esta acción.");
  });

  it("unexpected Error -> 500 with the generic safe message (not the raw error text)", async () => {
    imprimirCotizacionPdfMock.mockRejectedValue(new Error("critical secret database crash 12345"));

    const formData = new FormData();
    formData.set("itemsJson", JSON.stringify([{ formaFarmaceutica: "CREMA" }]));

    const response = await POST(crearRequest(formData));

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    const text = await response.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("database crash");
    expect(text).toBe("Ocurrió un error inesperado. Volvé a intentarlo.");
  });

  it("success -> 200, application/pdf, Content-Disposition: inline; filename=\"cotizacion.pdf\", Cache-Control: private, no-store, Content-Length equal to byte length", async () => {
    const fakePdf = Buffer.from("%PDF-1.4 sample cotizacion ticket content");
    imprimirCotizacionPdfMock.mockResolvedValue(fakePdf);

    const formData = new FormData();
    formData.set("itemsJson", JSON.stringify([{ formaFarmaceutica: "CREMA" }]));

    const response = await POST(crearRequest(formData));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="cotizacion.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Length")).toBe(String(fakePdf.byteLength));

    const body = await response.arrayBuffer();
    expect(Buffer.from(body)).toEqual(fakePdf);
  });

  it("the paciente and médico form fields reach the use case", async () => {
    const fakePdf = Buffer.from("%PDF-1.4 test");
    imprimirCotizacionPdfMock.mockResolvedValue(fakePdf);

    const formData = new FormData();
    const items = [{ formaFarmaceutica: "CREMA", descripcion: "Crema Base" }];
    formData.set("itemsJson", JSON.stringify(items));
    formData.set("paciente", "Juan Pérez");
    formData.set("medico", "Dra. Gomez");

    await POST(crearRequest(formData));

    expect(imprimirCotizacionPdfMock).toHaveBeenCalledTimes(1);
    expect(imprimirCotizacionPdfMock).toHaveBeenCalledWith({
      items,
      paciente: "Juan Pérez",
      medico: "Dra. Gomez",
    });
  });
});
