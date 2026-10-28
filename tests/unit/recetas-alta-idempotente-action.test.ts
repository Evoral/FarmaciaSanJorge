/**
 * T3-09 regression tests: `crearRecetaAction` handling of RecetaYaRegistradaError.
 *
 * In `modules/recetas/ui/actions.ts#crearRecetaAction`, when `crearReceta` throws
 * `RecetaYaRegistradaError`, it treats it as success, generates fichas/cotizaciones
 * if needed (`soloSiDesactualizadas: true`), and redirects to the existing receta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const crearRecetaMock = vi.fn<(input: unknown) => Promise<unknown>>(async () => undefined);
const generarFichasMock = vi.fn<(id: string, opts?: unknown) => Promise<unknown[]>>(async () => []);

class MockRecetaYaRegistradaError extends Error {
  constructor(readonly receta: { id: string; numeroInterno: string }) {
    super(`La receta ya fue registrada (N° ${receta.numeroInterno}).`);
  }
}

vi.mock("@/modules/recetas/application/crear-receta", () => ({
  crearReceta: (input: unknown) => crearRecetaMock(input),
  RecetaYaRegistradaError: MockRecetaYaRegistradaError,
}));

vi.mock("@/modules/recetas/application/generar-fichas-y-cotizaciones", () => ({
  generarFichasYCotizaciones: (id: string, opts?: unknown) => generarFichasMock(id, opts),
}));

// Mock remaining use cases imported by actions.ts
const sinUso = vi.hoisted(() => () => ({}));
vi.mock("@/modules/recetas/application/leer-receta-pdf", sinUso);
vi.mock("@/modules/recetas/application/leer-receta-qr", sinUso);
vi.mock("@/modules/recetas/application/importar-receta", sinUso);
vi.mock("@/modules/recetas/application/presupuestar-receta", sinUso);
vi.mock("@/modules/recetas/application/editar-receta", sinUso);
vi.mock("@/modules/recetas/application/anular-receta", sinUso);
vi.mock("@/modules/recetas/application/marcar-pago-receta", sinUso);
vi.mock("@/modules/recetas/application/list-drogas-para-receta", sinUso);
vi.mock("@/modules/pacientes/application/list-pacientes", sinUso);
vi.mock("@/modules/pacientes/application/get-paciente", sinUso);
vi.mock("@/modules/pacientes/application/crear-paciente-desde-receta", sinUso);
vi.mock("@/modules/medicos/application/list-medicos", sinUso);
vi.mock("@/modules/medicos/application/crear-medico-desde-receta", sinUso);

describe("T3-09: crearRecetaAction handling of RecetaYaRegistradaError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats RecetaYaRegistradaError as success and redirects to existing receta", async () => {
    const { crearRecetaAction } = await import("@/modules/recetas/ui/actions");
    const { IDLE_STATE } = await import("@/modules/recetas/ui/action-state");

    const existingReceta = { id: "receta-existing-uuid-123", numeroInterno: "555" };
    crearRecetaMock.mockRejectedValueOnce(new MockRecetaYaRegistradaError(existingReceta));

    const formData = new FormData();
    formData.set("pacienteId", "22222222-2222-4222-a222-222222222222");
    formData.set("medicoId", "33333333-3333-4333-a333-333333333333");
    formData.set("fechaPrescripcion", "2026-10-23");
    formData.set("origen", "PRESENCIAL");
    formData.set("envioId", "66666666-6666-4666-a666-666666666666");
    formData.set("itemsJson", JSON.stringify([{ descripcion: "Item 1" }]));

    const result = await crearRecetaAction(IDLE_STATE, formData);

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.message).toBe("La receta ya estaba registrada.");
      expect(result.id).toBe(existingReceta.id);
      expect(result.numeroInterno).toBe(existingReceta.numeroInterno);
      expect(result.redirigirA).toBe(`/recetas?registrada=${existingReceta.id}`);
    }
    expect(generarFichasMock).toHaveBeenCalledWith(existingReceta.id, { soloSiDesactualizadas: true });
  });
});
