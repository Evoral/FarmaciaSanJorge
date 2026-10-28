/**
 * T2-04 regression tests: `crearProductoDesdeFacturaAction` on a cuenta de sector.
 *
 * Audit finding T2-04 (P2-04):
 * - `crearProductoDesdeFacturaAction` on a cuenta de sector without an operador
 *   credential returns `{ status: "operador-required" }` and does NOT execute `crearDroga`.
 * - With an operador credential, `conOperador` passes the credential to the pipeline
 *   and completes the creation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import type { Permiso } from "@/modules/auth/domain/permisos";
import type { VerificacionDeOperador } from "@/shared/auth/operador";
import { CAMPO_OPERADOR_PIN } from "@/shared/auth/operador-campos";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const insertDrogaMock = vi.fn();
const auditRecordMock = vi.fn<(tx: unknown, input: unknown) => Promise<undefined>>(async () => undefined);

vi.mock("@/shared/audit", () => ({
  record: (tx: unknown, input: unknown) => auditRecordMock(tx, input),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const FAKE_TX = {
  __fakeTx: true,
  unidadMedida: {
    findUnique: vi.fn(async () => ({ id: "33333333-3333-4333-a333-333333333333", nombre: "gramo", simbolo: "g", fechaBaja: null })),
  },
};
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX),
}));

vi.mock("@/modules/stock/application/contralor", () => ({
  requiereAperturaContralorEnTx: vi.fn(async () => false),
}));

let mockSession: AuthenticatedSession;
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => mockSession),
  requireRecentReauth: vi.fn(),
}));

const verificarOperadorMock = vi.fn(async (...args: unknown[]): Promise<VerificacionDeOperador> => {
  void args;
  return { ok: false, message: "sin configurar" };
});
vi.mock("@/shared/auth/operador", () => ({
  verificarOperadorEnTx: (...args: unknown[]) => verificarOperadorMock(...args),
}));

vi.mock("@/modules/drogas/infrastructure/droga-repository", () => ({
  insertDroga: (...args: unknown[]) => insertDrogaMock(...args),
  existeNombreVigente: vi.fn(async () => null),
  getDrogaByName: vi.fn(async () => null),
  findUnidadById: vi.fn(async () => ({ id: "33333333-3333-4333-a333-333333333333", simbolo: "g" })),
}));

const SECTOR_ID = "11111111-1111-4111-a111-111111111111";
const EMPLEADO_ID = "22222222-2222-4222-a222-222222222222";
const UNIDAD_ID = "33333333-3333-4333-a333-333333333333";

function sesionDeSector(permisos: Permiso[] = ["drogas.crear"], conPin: Permiso[] = ["drogas.crear"]): AuthenticatedSession {
  return {
    sesionId: "ses-sector",
    tenantId: "00000000-0000-4000-a000-000000000001",
    usuario: { id: SECTOR_ID, email: "sector@fsj.test", nombre: "Sector", apellido: "Laboratorio" },
    permisos: new Set<Permiso>(permisos),
    reautenticadaEn: null,
    sector: {
      permisosConPin: new Set<Permiso>(conPin),
    },
  };
}

describe("T2-04: crearProductoDesdeFacturaAction in sector accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = sesionDeSector();
  });

  it("without operator credential: returns operador-required and does NOT execute crearDroga", async () => {
    const { crearProductoDesdeFacturaAction } = await import("@/modules/stock/ui/actions");

    const formData = new FormData();
    formData.set("nombre", "Ibuprofeno");
    formData.set("unidadBaseId", UNIDAD_ID);
    formData.set("clase", "DROGA");

    const result = await crearProductoDesdeFacturaAction(formData);

    expect(result).toEqual({ status: "operador-required" });
    expect(insertDrogaMock).not.toHaveBeenCalled();
  });

  it("with operator credential: runs verification and executes crearDroga on success", async () => {
    const { crearProductoDesdeFacturaAction } = await import("@/modules/stock/ui/actions");

    verificarOperadorMock.mockResolvedValueOnce({
      ok: true,
      operador: {
        id: EMPLEADO_ID,
        email: "emp@fsj.test",
        nombre: "Juan",
        apellido: "Pérez",
        permisos: new Set(["drogas.crear"]),
      },
      metodo: "PIN",
    });

    insertDrogaMock.mockResolvedValueOnce({ id: "droga-new-id" });

    const formData = new FormData();
    formData.set("nombre", "Ibuprofeno");
    formData.set("unidadBaseId", UNIDAD_ID);
    formData.set("clase", "DROGA");
    formData.set(CAMPO_OPERADOR_PIN, "1234");

    const result = await crearProductoDesdeFacturaAction(formData);

    expect(result).toEqual({ status: "success", id: "droga-new-id" });
    expect(insertDrogaMock).toHaveBeenCalledTimes(1);
  });
});
