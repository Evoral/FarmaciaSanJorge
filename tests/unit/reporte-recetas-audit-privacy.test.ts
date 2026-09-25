/**
 * FASE 13 point 13.4 hard rule: export audit payloads must NEVER contain
 * patient/médico text, only a filter summary (estado + fecha_ingreso
 * range) + row count + truncated flag. This test feeds the export path
 * rows that DO carry patient names (as the real DB would) and asserts the
 * captured `audit.record` call contains none of that text anywhere in its
 * payload -- same "own small copy per module" audit shape as
 * `modules/libro/application/exportar-libro.ts`'s D6 pattern.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";

const recordMock = vi.fn(async (tx: unknown, input: Record<string, unknown>) => {
  void tx;
  void input;
});
vi.mock("@/shared/audit", () => ({
  record: recordMock,
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));

const SESSION: AuthenticatedSession = {
  usuario: { id: "u1", email: "dt@example.com", nombre: "N", apellido: "A" },
  tenantId: "11111111-1111-1111-1111-111111111111",
  sesionId: "s1",
  permisos: new Set(["reportes.ver"]) as AuthenticatedSession["permisos"],
  reautenticadaEn: new Date(),
};

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => SESSION),
  requireRecentReauth: vi.fn(),
}));

const PACIENTE_NOMBRE = "Juana";
const PACIENTE_APELLIDO = "Sensiblenko";
const MEDICO_NOMBRE = "Carlos";
const MEDICO_APELLIDO = "Confidencialini";

vi.mock("@/modules/recetas/infrastructure/receta-repository", () => ({
  countRecetasPorEstado: vi.fn(async () => []),
  listRecetasPorEstado: vi.fn(async () => ({
    items: [
      {
        id: "r1",
        numeroInterno: "1",
        pacienteNombre: PACIENTE_NOMBRE,
        pacienteApellido: PACIENTE_APELLIDO,
        medicoNombre: MEDICO_NOMBRE,
        medicoApellido: MEDICO_APELLIDO,
        fechaPrescripcion: new Date("2026-01-01"),
        fechaIngreso: new Date("2026-01-02"),
        origen: "SISTEMA",
        estado: "ENTREGADA",
        recetaFisicaRecibida: true,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 5001,
  })),
}));

const { exportarRecetasCsv } = await import("@/modules/recetas/application/reporte-recetas");

describe("exportarRecetasCsv -- audit payload never carries patient/médico text", () => {
  it("the row DOES carry patient text (sanity check the fixture is meaningful)", async () => {
    const resultado = await exportarRecetasCsv({ estado: "ENTREGADA" });
    expect(resultado.items[0]?.pacienteNombre).toBe(PACIENTE_NOMBRE);
  });

  it("audit.record is called, and its payload contains NONE of the patient/médico text", async () => {
    recordMock.mockClear();
    await exportarRecetasCsv({ estado: "ENTREGADA" });

    expect(recordMock).toHaveBeenCalledTimes(1);
    // `record(tx, input)` -- see shared/audit/index.ts; the audit payload is the SECOND argument.
    const auditInput = recordMock.mock.calls[0]![1] as Record<string, unknown>;
    const serialized = JSON.stringify(auditInput);

    for (const forbidden of [PACIENTE_NOMBRE, PACIENTE_APELLIDO, MEDICO_NOMBRE, MEDICO_APELLIDO]) {
      expect(serialized, `audit payload leaked "${forbidden}"`).not.toContain(forbidden);
    }
    // Sanity: the payload is still meaningful (filter summary + count), not silently empty.
    expect(serialized).toContain("ENTREGADA");
    expect(auditInput.entidad).toBe("receta_reporte");
  });
});
