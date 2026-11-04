/**
 * Unit tests for confirmarReservasRecetaAction (modules/preparaciones/ui/actions.ts):
 * - form field incluirExcipientes "1" -> true
 * - form field incluirExcipientes "0" -> false
 * - form field incluirExcipientes missing -> undefined
 * passed to confirmarReservasReceta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { confirmarReservasReceta } from "@/modules/preparaciones/application/confirmar-reservas-receta";

const confirmarReservasRecetaMock = vi.fn<typeof confirmarReservasReceta>();
const revalidatePathMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/shared/auth/operador-context", () => ({
  conOperador: vi.fn(async (_formData: FormData, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/modules/preparaciones/application/confirmar-reservas-receta", () => ({
  confirmarReservasReceta: (...args: Parameters<typeof confirmarReservasReceta>) => confirmarReservasRecetaMock(...args),
}));

const { confirmarReservasRecetaAction } = await import(
  "@/modules/preparaciones/ui/actions"
);

const RECETA_ID = "22222222-2222-4222-8222-222222222222";
const PREP_1 = "33333333-3333-4333-8333-333333333333";

describe("confirmarReservasRecetaAction: parsing of incluirExcipientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmarReservasRecetaMock.mockResolvedValue({
      asientoId: "asiento-1",
      numeroCorrelativo: "101",
      etiquetas: [{ preparacionId: PREP_1, etiquetaId: "et-1" }],
    });
  });

  it('form field incluirExcipientes="1" passes true to confirmarReservasReceta', async () => {
    const formData = new FormData();
    formData.set("recetaId", RECETA_ID);
    formData.set("incluirExcipientes", "1");
    formData.set(`tipoVencimiento_${PREP_1}`, "ESTANDAR");

    const result = await confirmarReservasRecetaAction({ status: "idle" }, formData);

    expect(result.status).toBe("success");
    expect(confirmarReservasRecetaMock).toHaveBeenCalledTimes(1);
    expect(confirmarReservasRecetaMock).toHaveBeenCalledWith(
      RECETA_ID,
      { [PREP_1]: "ESTANDAR" },
      true
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/preparaciones");
    expect(revalidatePathMock).toHaveBeenCalledWith("/recetas");
  });

  it('form field incluirExcipientes="0" passes false to confirmarReservasReceta', async () => {
    const formData = new FormData();
    formData.set("recetaId", RECETA_ID);
    formData.set("incluirExcipientes", "0");

    const result = await confirmarReservasRecetaAction({ status: "idle" }, formData);

    expect(result.status).toBe("success");
    expect(confirmarReservasRecetaMock).toHaveBeenCalledTimes(1);
    expect(confirmarReservasRecetaMock).toHaveBeenCalledWith(
      RECETA_ID,
      {},
      false
    );
  });

  it("missing incluirExcipientes passes undefined to confirmarReservasReceta", async () => {
    const formData = new FormData();
    formData.set("recetaId", RECETA_ID);

    const result = await confirmarReservasRecetaAction({ status: "idle" }, formData);

    expect(result.status).toBe("success");
    expect(confirmarReservasRecetaMock).toHaveBeenCalledTimes(1);
    expect(confirmarReservasRecetaMock).toHaveBeenCalledWith(
      RECETA_ID,
      {},
      undefined
    );
  });
});
