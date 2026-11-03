/**
 * Unit tests for Server Actions:
 * `elaborarLoteAction` (modules/stock/ui/actions.ts), `crearDrogaAction` and `editarDrogaAction` (modules/drogas/ui/actions.ts)
 * with use cases mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { elaborarLoteMock, crearDrogaMock, editarDrogaMock, revalidatePathMock } = vi.hoisted(() => ({
  elaborarLoteMock: vi.fn(),
  crearDrogaMock: vi.fn(),
  editarDrogaMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/shared/auth/operador-context", () => ({
  conOperador: vi.fn(async (_formData: FormData, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/modules/stock/application/elaborar-lote", () => ({
  elaborarLote: elaborarLoteMock,
}));

vi.mock("@/modules/drogas/application/crear-droga", () => ({
  crearDroga: crearDrogaMock,
}));

vi.mock("@/modules/drogas/application/editar-droga", () => ({
  editarDroga: editarDrogaMock,
}));

const { elaborarLoteAction } = await import("@/modules/stock/ui/actions");
const { crearDrogaAction, editarDrogaAction } = await import("@/modules/drogas/ui/actions");

const P1_UUID = "11111111-1111-4111-8111-111111111111";
const P2_UUID = "22222222-2222-4222-8222-222222222222";
const P3_UUID = "33333333-3333-4333-8333-333333333333";
const DROGA_PRODUCIDA_ID = "44444444-4444-4444-8444-444444444444";
const DROGA_ID = "55555555-5555-4555-8555-555555555555";
const UNIDAD_ID = "66666666-6666-4666-8666-666666666666";

const C1_UUID = "77777777-7777-4777-8777-777777777777";
const C2_UUID = "88888888-8888-4888-8888-888888888888";
const C3_UUID = "99999999-9999-4999-8999-999999999999";

describe("Server Actions -- lotes-elaborados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    elaborarLoteMock.mockResolvedValue({ partidaId: "nueva-partida-1" });
    crearDrogaMock.mockResolvedValue({ id: DROGA_ID, nombre: "Nueva Droga", unidadBaseId: UNIDAD_ID, sinonimos: [] });
    editarDrogaMock.mockResolvedValue({ id: DROGA_ID, nombre: "Droga Editada", unidadBaseId: UNIDAD_ID, sinonimos: [] });
  });

  describe("elaborarLoteAction", () => {
    it("cantidad_<uuid> fields become consumos, blanks are skipped", async () => {
      const formData = new FormData();
      formData.set("tipo", "DILUCION");
      formData.set("drogaProducidaId", DROGA_PRODUCIDA_ID);
      formData.set("cantidadProducida", "100");

      // Valid consumption
      formData.set(`cantidad_${P1_UUID}`, "1");
      // Blank value -> skipped
      formData.set(`cantidad_${P2_UUID}`, "   ");
      // Another valid consumption
      formData.set(`cantidad_${P3_UUID}`, "99");
      // Non-UUID field -> ignored
      formData.set("cantidad_not-a-uuid", "50");

      const res = await elaborarLoteAction({ status: "idle" }, formData);

      expect(res.status).toBe("success");
      expect(res).toEqual({
        status: "success",
        message: "Lote elaborado: la partida ya está en el stock.",
        partidaId: "nueva-partida-1",
      });
      expect(res).not.toHaveProperty("redirigirA");
      expect(elaborarLoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tipo: "DILUCION",
          drogaProducidaId: DROGA_PRODUCIDA_ID,
          cantidadProducida: "100",
          consumos: [
            { partidaId: P1_UUID, cantidad: "1" },
            { partidaId: P3_UUID, cantidad: "99" },
          ],
        }),
      );
    });
  });

  describe("drogas Server Actions formula fields (crearDrogaAction / editarDrogaAction)", () => {
    it("no formulaEnviada means undefined", async () => {
      const formData = new FormData();
      formData.set("id", DROGA_ID);
      formData.set("nombre", "Droga Editada");
      formData.set("stockMinimo", "0");
      // formulaEnviada is NOT set

      await editarDrogaAction({ status: "idle" }, formData);

      expect(editarDrogaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: DROGA_ID,
          formula: undefined,
        }),
      );
    });

    it("no tieneFormula means null", async () => {
      const formData = new FormData();
      formData.set("id", DROGA_ID);
      formData.set("nombre", "Droga Editada");
      formData.set("stockMinimo", "0");
      formData.set("formulaEnviada", "true");
      // tieneFormula is NOT set

      await editarDrogaAction({ status: "idle" }, formData);

      expect(editarDrogaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: DROGA_ID,
          formula: null,
        }),
      );
    });

    it("componente_<uuid> keeps form order", async () => {
      const formData = new FormData();
      formData.set("id", DROGA_ID);
      formData.set("nombre", "Droga Editada");
      formData.set("stockMinimo", "0");
      formData.set("formulaEnviada", "true");
      formData.set("tieneFormula", "on");
      formData.set("cantidadReferencia", "100");

      // Components appended in order: C3, then C1, then C2
      formData.append(`componente_${C3_UUID}`, "30");
      formData.append(`componente_${C1_UUID}`, "10");
      formData.append(`componente_${C2_UUID}`, "20");

      await editarDrogaAction({ status: "idle" }, formData);

      expect(editarDrogaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: DROGA_ID,
          formula: {
            cantidadReferencia: "100",
            componentes: [
              { drogaId: C3_UUID, cantidad: "30" },
              { drogaId: C1_UUID, cantidad: "10" },
              { drogaId: C2_UUID, cantidad: "20" },
            ],
          },
        }),
      );
    });

    it("crearDrogaAction defaults missing formula to null when formulaEnviada is omitted or unchecked", async () => {
      const formData = new FormData();
      formData.set("nombre", "Nueva Droga");
      formData.set("unidadBaseId", UNIDAD_ID);
      formData.set("stockMinimo", "0");

      await crearDrogaAction({ status: "idle" }, formData);

      expect(crearDrogaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: "Nueva Droga",
          formula: null,
        }),
      );
    });
  });
});
