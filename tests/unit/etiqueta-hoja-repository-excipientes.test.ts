/**
 * Unit tests for etiqueta-hoja-repository functions introduced by migration 0117:
 * - getIncluirExcipientes: reads switch, defaults to false on missing row.
 * - upsertIncluirExcipientes: updates existing row or inserts with default sheet.
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { HOJA_PREDETERMINADA } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import {
  getIncluirExcipientes,
  upsertIncluirExcipientes,
} from "@/modules/etiqueta-tamanos/infrastructure/etiqueta-hoja-repository";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

describe("etiqueta-hoja-repository: getIncluirExcipientes and upsertIncluirExcipientes", () => {
  it("getIncluirExcipientes: returns true, false, or false when row is missing", async () => {
    const fakeTxRowTrue = {
      etiquetaHoja: {
        findFirst: vi.fn(async () => ({ incluirExcipientes: true })),
      },
    };
    expect(await getIncluirExcipientes(fakeTxRowTrue as unknown as Prisma.TransactionClient, TENANT_ID)).toBe(true);

    const fakeTxRowFalse = {
      etiquetaHoja: {
        findFirst: vi.fn(async () => ({ incluirExcipientes: false })),
      },
    };
    expect(await getIncluirExcipientes(fakeTxRowFalse as unknown as Prisma.TransactionClient, TENANT_ID)).toBe(false);

    const fakeTxMissing = {
      etiquetaHoja: {
        findFirst: vi.fn(async () => null),
      },
    };
    expect(await getIncluirExcipientes(fakeTxMissing as unknown as Prisma.TransactionClient, TENANT_ID)).toBe(false);
  });

  it("upsertIncluirExcipientes: updates when row exists without calling create", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const create = vi.fn(async () => ({}));
    const fakeTx = { etiquetaHoja: { updateMany, create } };

    await upsertIncluirExcipientes(fakeTx as unknown as Prisma.TransactionClient, TENANT_ID, true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
      data: expect.objectContaining({ incluirExcipientes: true }),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("upsertIncluirExcipientes: inserts with default sheet when no row exists", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const create = vi.fn(async () => ({}));
    const fakeTx = { etiquetaHoja: { updateMany, create } };

    await upsertIncluirExcipientes(fakeTx as unknown as Prisma.TransactionClient, TENANT_ID, true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
      data: expect.objectContaining({ incluirExcipientes: true }),
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        anchoMm: HOJA_PREDETERMINADA.anchoMm.toFixed(1),
        altoMm: HOJA_PREDETERMINADA.altoMm.toFixed(1),
        margenMm: HOJA_PREDETERMINADA.margenMm.toFixed(1),
        incluirExcipientes: true,
      },
    });
  });
});
