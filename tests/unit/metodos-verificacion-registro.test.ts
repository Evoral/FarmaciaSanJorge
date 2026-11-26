/**
 * Verification methods (openspec/changes/metodos-verificacion-operador): the server registry covers the whole
 * catalog, and the shared secret-code strategy (identification + uniqueness) works against any `FuenteDeCodigos`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { ValidationError } from "@/shared/errors";
import { METODOS, METODOS_VERIFICACION } from "@/modules/auth/domain/verificacion-identidad";
import { OPERADOR_ELEGIBLE } from "@/modules/auth/infrastructure/operador-elegible";

const verifyPasswordMock = vi.fn(async (hash: string, plain: string): Promise<boolean> => hash === `hash:${plain}`);
vi.mock("@/modules/auth/domain/password", () => ({
  verifyPassword: (hash: string, plain: string) => verifyPasswordMock(hash, plain),
}));

// Partial mock on purpose (as the other suites do): the PIN source must only read these when called, not at load.
vi.mock("@/modules/auth/infrastructure/usuario-repository", () => ({
  loadPinHashesDeOperadores: vi.fn(),
}));

const { REGISTRO } = await import("@/modules/auth/application/metodos-verificacion");
const { identificadorPorCodigo, assertCodigoDisponible } = await import("@/modules/auth/application/identificacion-por-codigo");

const TX = { __fakeTx: true } as unknown as Prisma.TransactionClient;
const TENANT = "11111111-1111-1111-1111-111111111111";

describe("registry", () => {
  it("has exactly one entry per catalog method, at runtime", () => {
    expect(Object.keys(REGISTRO).sort()).toEqual([...METODOS_VERIFICACION].sort());
    expect(Object.keys(METODOS).sort()).toEqual([...METODOS_VERIFICACION].sort());
    for (const metodo of METODOS_VERIFICACION) {
      expect(REGISTRO[metodo].identificador.metodo).toBe(metodo);
      expect(METODOS[metodo].metodo).toBe(metodo);
    }
  });

  it("ties every catalog method's proof keys to its zod proof schema", () => {
    for (const metodo of METODOS_VERIFICACION) {
      const prueba: Record<string, string> = { metodo };
      for (const clave of METODOS[metodo].claves) prueba[clave] = "1234";
      const parsed = REGISTRO[metodo].prueba.safeParse(prueba);
      expect(parsed.success, `proof of ${metodo} built from METODOS.claves`).toBe(true);
      if (parsed.success) expect(parsed.data).toEqual(prueba);
    }
  });

  it("keeps the PIN proof schema and rejection messages exactly as before", () => {
    const { prueba, rechazo } = REGISTRO.PIN;
    expect(prueba.safeParse({ metodo: "PIN", pin: "4829" }).success).toBe(true);
    expect(prueba.safeParse({ metodo: "PIN", pin: "" }).success).toBe(false);
    expect(prueba.safeParse({ metodo: "PIN", pin: "x".repeat(65) }).success).toBe(false);
    expect(prueba.safeParse({ metodo: "PIN" }).success).toBe(false);
    expect(rechazo.NO_RECONOCIDA).toBe("El PIN no corresponde a ningún empleado habilitado.");
    expect(rechazo.AMBIGUA).toBe("Ese PIN lo tiene más de un empleado. Cambialo desde «Mi cuenta» para poder identificarte.");
  });

  it("keeps the operador eligibility filter of the S7 rule", () => {
    expect(OPERADOR_ELEGIBLE).toEqual({ estado: "ACTIVO", esSector: false, esTecnico: false, debeCambiarPassword: false });
  });
});

describe("code strategy", () => {
  const candidatos = vi.fn();
  const hashesDeOtros = vi.fn();
  const fuente = { candidatos, hashesDeOtros };
  const identificador = identificadorPorCodigo("PIN", "pin", fuente);

  beforeEach(() => {
    candidatos.mockReset();
    hashesDeOtros.mockReset();
    verifyPasswordMock.mockClear();
  });

  it("identifies the one candidate whose hash matches", async () => {
    candidatos.mockResolvedValue([
      { usuarioId: "ana", hash: "hash:1111" },
      { usuarioId: "beto", hash: "hash:2222" },
    ]);
    await expect(identificador.identificar({ tx: TX, tenantId: TENANT }, { metodo: "PIN", pin: "2222" })).resolves.toEqual({ ok: true, usuarioId: "beto" });
    expect(candidatos).toHaveBeenCalledWith(TX, TENANT);
  });

  it("reports NO_RECONOCIDA when nobody matches, including with no candidates", async () => {
    candidatos.mockResolvedValue([{ usuarioId: "ana", hash: "hash:1111" }]);
    await expect(identificador.identificar({ tx: TX, tenantId: TENANT }, { metodo: "PIN", pin: "9999" })).resolves.toEqual({ ok: false, motivo: "NO_RECONOCIDA" });
    candidatos.mockResolvedValue([]);
    await expect(identificador.identificar({ tx: TX, tenantId: TENANT }, { metodo: "PIN", pin: "9999" })).resolves.toEqual({ ok: false, motivo: "NO_RECONOCIDA" });
  });

  it("reports AMBIGUA when two candidates match, checking every hash (no early exit)", async () => {
    candidatos.mockResolvedValue([
      { usuarioId: "ana", hash: "hash:1111" },
      { usuarioId: "beto", hash: "hash:1111" },
      { usuarioId: "caro", hash: "hash:3333" },
    ]);
    await expect(identificador.identificar({ tx: TX, tenantId: TENANT }, { metodo: "PIN", pin: "1111" })).resolves.toEqual({ ok: false, motivo: "AMBIGUA" });
    expect(verifyPasswordMock).toHaveBeenCalledTimes(3);
  });

  it("only sees the candidates the source offers (S7 filtering is the source's job)", async () => {
    candidatos.mockResolvedValue([]);
    await expect(identificador.identificar({ tx: TX, tenantId: TENANT }, { metodo: "PIN", pin: "1111" })).resolves.toMatchObject({ ok: false });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it("accepts a code nobody else holds", async () => {
    hashesDeOtros.mockResolvedValue(["hash:1111"]);
    await expect(assertCodigoDisponible(fuente, TX, TENANT, "usuario", "2222", { mensaje: "no", campo: "pin" })).resolves.toBeUndefined();
    expect(hashesDeOtros).toHaveBeenCalledWith(TX, TENANT, "usuario");
  });

  it("rejects a code another usuario holds, on the given field, without naming them", async () => {
    hashesDeOtros.mockResolvedValue(["hash:1111", "hash:2222"]);
    const error = await assertCodigoDisponible(fuente, TX, TENANT, "usuario", "2222", { mensaje: "Ese código no se puede usar.", campo: "huella" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ message: "Ese código no se puede usar.", fields: ["huella"] });
  });
});
