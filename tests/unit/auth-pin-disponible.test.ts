/**
 * Unit tests for unique PIN per farmacia (commit d09d3e1):
 * - `modules/auth/application/pin-disponible.ts`:
 *   `assertPinDisponible` rejects with MENSAJE_PIN_NO_DISPONIBLE ("Ese PIN no se puede usar. Elegí otro.")
 *   on field "pin", and never names another usuario.
 * - `modules/auth/infrastructure/usuario-repository.ts`:
 *   `loadPinHashesDeOtros` takes a per-tenant advisory lock and excludes the usuario itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/shared/errors";
import { assertPinDisponible, MENSAJE_PIN_NO_DISPONIBLE } from "@/modules/auth/application/pin-disponible";
import { loadPinHashesDeOtros } from "@/modules/auth/infrastructure/usuario-repository";

const verifyPasswordMock = vi.fn();
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));

const loadPinHashesDeOtrosMock = vi.fn();
vi.mock("@/modules/auth/infrastructure/usuario-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/auth/infrastructure/usuario-repository")>();
  return {
    ...actual,
    loadPinHashesDeOtros: (...args: unknown[]) => loadPinHashesDeOtrosMock(...args),
  };
});

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USUARIO_ID = "22222222-2222-4222-a222-222222222222";
const PIN = "4821";

beforeEach(() => {
  verifyPasswordMock.mockReset();
  loadPinHashesDeOtrosMock.mockReset();
});

describe("assertPinDisponible (pin-disponible.ts)", () => {
  it("rejects when any other usuario's PIN hash matches the candidate PIN", async () => {
    loadPinHashesDeOtrosMock.mockResolvedValue(["hash-user-b", "hash-user-c"]);
    verifyPasswordMock.mockImplementation(async (hash: string) => hash === "hash-user-c");

    const error = await assertPinDisponible({} as any, TENANT_ID, USUARIO_ID, PIN).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    const valError = error as ValidationError;
    expect(valError.message).toBe(MENSAJE_PIN_NO_DISPONIBLE);
    expect(valError.fields).toEqual(["pin"]);

    // The message must never name another usuario or leak identity
    expect(valError.message).not.toMatch(/usuario|nombre|email|pertenece a/i);
    expect(loadPinHashesDeOtrosMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, USUARIO_ID);
  });

  it("resolves without throwing when no other usuario's hash matches", async () => {
    loadPinHashesDeOtrosMock.mockResolvedValue(["hash-user-b", "hash-user-c"]);
    verifyPasswordMock.mockResolvedValue(false);

    await expect(assertPinDisponible({} as any, TENANT_ID, USUARIO_ID, PIN)).resolves.toBeUndefined();
  });

  it("resolves immediately when there are no other usuarios with a configured PIN", async () => {
    loadPinHashesDeOtrosMock.mockResolvedValue([]);

    await expect(assertPinDisponible({} as any, TENANT_ID, USUARIO_ID, PIN)).resolves.toBeUndefined();
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });
});

describe("loadPinHashesDeOtros (usuario-repository)", () => {
  it("takes a per-tenant advisory lock and excludes the calling usuario", async () => {
    const executedRaw: string[] = [];
    const findManyMock = vi.fn().mockResolvedValue([
      { pinHash: "hash-other-1" },
      { pinHash: "hash-other-2" },
      { pinHash: null },
    ]);

    const fakeTx = {
      $executeRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => {
        executedRaw.push(strings.join(""));
        return Promise.resolve(1);
      }),
      usuario: {
        findMany: findManyMock,
      },
    } as any;

    const { loadPinHashesDeOtros: realLoadPinHashesDeOtros } = await vi.importActual<
      typeof import("@/modules/auth/infrastructure/usuario-repository")
    >("@/modules/auth/infrastructure/usuario-repository");

    const result = await realLoadPinHashesDeOtros(fakeTx, TENANT_ID, USUARIO_ID);

    // Advisory lock acquired
    expect(executedRaw[0]).toContain("pg_advisory_xact_lock");
    expect(executedRaw[0]).toContain("fsj.pin:");

    // Query excludes the current usuario and excludes null pinHash
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        id: { not: USUARIO_ID },
        pinHash: { not: null },
      },
      select: { pinHash: true },
    });

    // Returns non-null hashes
    expect(result).toEqual(["hash-other-1", "hash-other-2"]);
  });
});
