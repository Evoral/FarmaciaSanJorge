/**
 * Unit tests for cuentas de sector password policy and flag assignments (commit 9b2d5db):
 * - `modules/usuarios/application/password-temporal.ts`:
 *   `erroresDePasswordAsignada` switches between validatePassword (for sector)
 *   and validateTemporaryPassword (for persons).
 * - `modules/usuarios/infrastructure/usuario-repository.ts`:
 *   `insertUsuario` sets `debeCambiarPassword = !input.esSector`.
 *   `restablecerPasswordTemporal` sets `debeCambiarPassword = debeCambiarPassword`.
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { erroresDePasswordAsignada, refinarPasswordTemporal } from "@/modules/usuarios/application/password-temporal";
import { insertUsuario, restablecerPasswordTemporal } from "@/modules/usuarios/infrastructure/usuario-repository";
import { z } from "zod";

describe("erroresDePasswordAsignada & refinarPasswordTemporal", () => {
  it("for a person (esSector = false), applies temporary password policy (6 chars minimum, no uppercase required)", () => {
    // "abc123" meets the temporary password policy (6 chars)
    expect(erroresDePasswordAsignada("abc123", false)).toEqual([]);

    // 5 chars violates temporary policy
    expect(erroresDePasswordAsignada("abc12", false)).toContain("Debe tener al menos 6 caracteres.");
  });

  it("for a cuenta de sector (esSector = true), applies FULL password policy (8 chars, uppercase, lowercase, numbers)", () => {
    // "abc123" fails full policy because it has only 6 chars and lacks uppercase
    const errores = erroresDePasswordAsignada("abc123", true);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores).toContain("Debe tener al menos 8 caracteres.");
    expect(errores).toContain("Debe tener al menos una letra mayúscula.");

    // A password meeting full policy passes
    expect(erroresDePasswordAsignada("ClaveSegura2026!", true)).toEqual([]);
  });

  it("refinarPasswordTemporal adds issues according to esSector flag", () => {
    const schema = (esSector: boolean) =>
      z
        .object({
          passwordTemporal: z.string(),
          passwordTemporalRepeat: z.string(),
        })
        .superRefine((val, ctx) => refinarPasswordTemporal(val, ctx, esSector));

    // Valid temporary password for person
    const personResult = schema(false).safeParse({ passwordTemporal: "abc123", passwordTemporalRepeat: "abc123" });
    expect(personResult.success).toBe(true);

    // Same password for sector fails validation
    const sectorResult = schema(true).safeParse({ passwordTemporal: "abc123", passwordTemporalRepeat: "abc123" });
    expect(sectorResult.success).toBe(false);
    if (!sectorResult.success) {
      const paths = sectorResult.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("passwordTemporal");
    }
  });
});

describe("usuario-repository debeCambiarPassword flag", () => {
  it("insertUsuario sets debeCambiarPassword = false for a cuenta de sector", async () => {
    const createMock = vi.fn().mockResolvedValue({ id: "u-sector" });
    const fakeTx = { usuario: { create: createMock } } as unknown as Prisma.TransactionClient;

    await insertUsuario(fakeTx, {
      tenantId: "11111111-1111-1111-1111-111111111111",
      nombre: "Laboratorio",
      apellido: "(Sector)",
      email: "lab@farmacia.local",
      dni: "SECTOR-LABORATORIO",
      numeroMatricula: null,
      esSector: true,
      passwordHash: "hash-definitivo",
      creadoPorId: "u-admin",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          esSector: true,
          debeCambiarPassword: false,
          estado: "ACTIVO",
        }),
      }),
    );
  });

  it("insertUsuario sets debeCambiarPassword = true for a person", async () => {
    const createMock = vi.fn().mockResolvedValue({ id: "u-person" });
    const fakeTx = { usuario: { create: createMock } } as unknown as Prisma.TransactionClient;

    await insertUsuario(fakeTx, {
      tenantId: "11111111-1111-1111-1111-111111111111",
      nombre: "Juan",
      apellido: "Pérez",
      email: "juan@example.com",
      dni: "12345678",
      numeroMatricula: null,
      esSector: false,
      passwordHash: "hash-temporal",
      creadoPorId: "u-admin",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          esSector: false,
          debeCambiarPassword: true,
          estado: "ACTIVO",
        }),
      }),
    );
  });

  it("restablecerPasswordTemporal passes debeCambiarPassword flag to tx.usuario.update", async () => {
    const updateMock = vi.fn().mockResolvedValue({ id: "u-target" });
    const fakeTx = { usuario: { update: updateMock } } as unknown as Prisma.TransactionClient;

    // For sector: false
    await restablecerPasswordTemporal(fakeTx, "u-target", "new-hash", false);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-target" },
        data: expect.objectContaining({
          passwordHash: "new-hash",
          debeCambiarPassword: false,
        }),
      }),
    );

    // For person: true (default)
    await restablecerPasswordTemporal(fakeTx, "u-target", "new-hash", true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-target" },
        data: expect.objectContaining({
          passwordHash: "new-hash",
          debeCambiarPassword: true,
        }),
      }),
    );
  });
});
