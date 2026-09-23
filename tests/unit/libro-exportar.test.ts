/**
 * Unit tests for `modules/libro/application/exportar-libro.ts` (D6,
 * 2026-09-23): every CSV/PDF export writes an EXPORTAR audit row via
 * `registrarExportacionLibroCommand` AFTER the read resolves but BEFORE
 * `exportarLibroDatos` returns anything to its caller -- and if that audit
 * write fails, the export is BLOCKED (the caller never receives data).
 * Uses the REAL `defineCommand`/`defineQuery` pipeline (not mocked) so the
 * "audit runs inside the same commit as the read" framework guarantee is
 * actually exercised; only session/transaction/audit/repository are
 * mocked, same convention as tests/unit/libro-anular-asiento.test.ts.
 * `exportarLibroDatos` takes no `ExecuteOptions` passthrough, so the
 * session is injected via a mocked `requireSession()` instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const session: AuthenticatedSession = {
  usuario: { id: "u-far", email: "far@example.com", nombre: "N", apellido: "A" },
  tenantId: TENANT_ID,
  sesionId: "s1",
  permisos: new Set(["libro.exportar"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

const auditRecordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => session),
  requireRecentReauth: vi.fn(),
}));

const ITEM = {
  id: "asiento-1",
  numeroCorrelativo: "1",
  fechaAsiento: "2026-09-01",
  origen: "SISTEMA",
  estado: "VIGENTE",
  pacienteTexto: "P",
  medicoTexto: "M",
  formulaTexto: "F",
  cierreFirmado: false,
  anulacion: null,
  rectificativoNumeroCorrelativo: null,
  asientoOriginalNumeroCorrelativo: null,
};

const iterarAsientosParaExportarMock = vi.fn();
vi.mock("@/modules/libro/infrastructure/asiento-repository", () => ({
  iterarAsientosParaExportar: (...args: unknown[]) => iterarAsientosParaExportarMock(...args),
}));

vi.mock("@/modules/libro/infrastructure/libro-pdf", () => ({
  buildLibroPdf: vi.fn(() => Buffer.from("pdf")),
}));

const { exportarLibroDatos } = await import("@/modules/libro/application/exportar-libro");

async function* singlePage() {
  yield [ITEM];
}

function exportar(formato: "CSV" | "PDF" = "CSV") {
  return exportarLibroDatos({}, formato);
}

describe("exportarLibroDatos (D6: audit every export, blocks on audit failure)", () => {
  beforeEach(() => {
    auditRecordMock.mockClear().mockResolvedValue(undefined);
    iterarAsientosParaExportarMock.mockReset().mockImplementation(() => singlePage());
  });

  it("writes ONE EXPORTAR audit row (entidad libro_recetario) with the row count, AFTER the read resolves, then returns the data", async () => {
    const result = await exportar("CSV");

    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        entidad: "libro_recetario",
        entidadId: TENANT_ID,
      }),
    );
    const auditCall = auditRecordMock.mock.calls[0]![1] as { valorNuevo: { formato: string; cantidadFilas: number } };
    expect(auditCall.valorNuevo.formato).toBe("CSV");
    expect(auditCall.valorNuevo.cantidadFilas).toBe(1);
  });

  it("PDF export audits formato PDF the same way", async () => {
    await exportar("PDF");
    const auditCall = auditRecordMock.mock.calls[0]![1] as { valorNuevo: { formato: string } };
    expect(auditCall.valorNuevo.formato).toBe("PDF");
  });

  it("D6: if the audit write fails, the export is BLOCKED -- exportarLibroDatos rejects and never hands data back to the caller", async () => {
    auditRecordMock.mockRejectedValue(new Error("audit table unavailable"));

    await expect(exportar("CSV")).rejects.toThrow("audit table unavailable");
  });
});
