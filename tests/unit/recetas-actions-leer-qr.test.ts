/**
 * `leerRecetaQrAction` (importacion-receta-qr spec, R6): the Server Action
 * behind the "QR o link" input. The text travels in the form field `codigo`
 * (the use case's input name); the action hands it over untouched, returns the
 * preview in its own POST response and turns every failure into a user
 * message. Use cases mocked; all values are fictitious.
 *
 * NOT covered here: P55-P57 (Enter submits once, an empty field does not query,
 * the PDF panel is unchanged and the QR input is focused on load). They are UI
 * behavior and vitest runs in node without a DOM, so they are verified by hand
 * (docs/specs/importacion-receta-qr.md).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthorizationError, DomainError, ValidationError } from "@/shared/errors";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const leerRecetaQrMock = vi.fn(async (codigo: unknown) => {
  void codigo;
  return { fuente: "QR" };
});
vi.mock("@/modules/recetas/application/leer-receta-qr", () => ({ leerRecetaQr: (codigo: unknown) => leerRecetaQrMock(codigo) }));

// actions.ts imports every use case of the module; none of the others is exercised here.
const sinUso = vi.hoisted(() => () => ({}));
vi.mock("@/modules/recetas/application/crear-receta", sinUso);
vi.mock("@/modules/recetas/application/leer-receta-pdf", sinUso);
vi.mock("@/modules/recetas/application/importar-receta", sinUso);
vi.mock("@/modules/recetas/application/presupuestar-receta", sinUso);
vi.mock("@/modules/recetas/application/generar-fichas-y-cotizaciones", sinUso);
vi.mock("@/modules/recetas/application/editar-receta", sinUso);
vi.mock("@/modules/recetas/application/anular-receta", sinUso);
vi.mock("@/modules/recetas/application/list-drogas-para-receta", sinUso);
vi.mock("@/modules/pacientes/application/list-pacientes", sinUso);
vi.mock("@/modules/pacientes/application/crear-paciente-desde-receta", sinUso);
vi.mock("@/modules/medicos/application/list-medicos", sinUso);
vi.mock("@/modules/medicos/application/crear-medico-desde-receta", sinUso);

const { leerRecetaQrAction } = await import("@/modules/recetas/ui/actions");
const { IDLE_LEER_RECETA_STATE, IDLE_LEER_PDF_STATE } = await import("@/modules/recetas/ui/action-state");

const CODIGO = "https://verumrp.com.ar/prescripcion/" + "a1b2c3d4e5f60718".repeat(4);

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  leerRecetaQrMock.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("leerRecetaQrAction", () => {
  it("passes the `codigo` field to the use case untouched and returns the preview", async () => {
    const estado = await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: CODIGO }));
    expect(leerRecetaQrMock).toHaveBeenCalledTimes(1);
    expect(leerRecetaQrMock).toHaveBeenCalledWith(CODIGO);
    expect(estado).toEqual({ status: "success", vistaPrevia: { fuente: "QR" } });
  });

  it("reads only `codigo`: any other field name reaches the use case as missing", async () => {
    await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ qr: CODIGO }));
    expect(leerRecetaQrMock).toHaveBeenCalledWith(null);
  });

  it("a validation error and a domain error come back as their own user message", async () => {
    leerRecetaQrMock.mockRejectedValueOnce(new ValidationError("QR no válido o receta no encontrada", { fields: ["codigo"] }));
    expect(await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: "" }))).toMatchObject({ status: "error", message: "QR no válido o receta no encontrada" });
    leerRecetaQrMock.mockRejectedValueOnce(new DomainError("No se pudo consultar RCTA, importá el PDF"));
    expect(await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: CODIGO }))).toEqual({ status: "error", message: "No se pudo consultar RCTA, importá el PDF" });
  });

  it("flags `campo: 'codigo'` ONLY when the error targets the typed code (an input problem), so the input is marked invalid for those and not for outages", async () => {
    leerRecetaQrMock.mockRejectedValueOnce(new ValidationError("QR no válido o receta no encontrada", { fields: ["codigo"] }));
    expect(await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: "x" }))).toStrictEqual({ status: "error", message: "QR no válido o receta no encontrada", campo: "codigo" });
    // An outage (DomainError), a permission error and a validation error on another field carry no `campo`.
    leerRecetaQrMock.mockRejectedValueOnce(new DomainError("No se pudo consultar RCTA, importá el PDF"));
    expect(await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: CODIGO }))).toStrictEqual({ status: "error", message: "No se pudo consultar RCTA, importá el PDF" });
    leerRecetaQrMock.mockRejectedValueOnce(new ValidationError("Dato inválido", { fields: ["otro"] }));
    expect(await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: CODIGO }))).toStrictEqual({ status: "error", message: "Dato inválido" });
    leerRecetaQrMock.mockRejectedValueOnce(new AuthorizationError());
    expect(await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: CODIGO }))).not.toHaveProperty("campo");
    leerRecetaQrMock.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: CODIGO }))).toStrictEqual({ status: "error", message: "No se pudo leer el QR." });
  });

  it("an unexpected error gets the generic fallback, never the raw error text", async () => {
    leerRecetaQrMock.mockRejectedValueOnce(new Error("socket hang up https://decrypter.example/?hashedRecipe=abc"));
    const estado = await leerRecetaQrAction(IDLE_LEER_RECETA_STATE, form({ codigo: CODIGO }));
    expect(estado).toEqual({ status: "error", message: "No se pudo leer el QR." });
  });

  it("keeps the PDF names as aliases of the generalized state", () => {
    expect(IDLE_LEER_PDF_STATE).toBe(IDLE_LEER_RECETA_STATE);
    expect(IDLE_LEER_RECETA_STATE).toEqual({ status: "idle" });
  });
});
