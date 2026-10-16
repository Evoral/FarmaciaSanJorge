/**
 * Authorization matrix test for modules/costos-proveedor (docs/specs/costos-proveedor.md R35, R36, CP19):
 *   - consulting the vigentes, the history and the imported lists: `stock.valorizado.ver` (ADMINISTRADOR, DIRECTOR_TECNICO, FARMACEUTICO);
 *   - registering costos by hand, reading and importing a supplier list, and dando de baja: `costos.proveedor.gestionar`
 *     (categoría `gestion`: ADMINISTRADOR holds it by default; any other role only through the role editor).
 * Same structure/mocking as tests/unit/precios-authorization-matrix.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError } from "@/shared/errors";
import type { Permiso } from "@/modules/auth/domain/permisos";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

await import("@/modules/costos-proveedor/application/listar-costos-vigentes");
await import("@/modules/costos-proveedor/application/get-historial-costo");
await import("@/modules/costos-proveedor/application/registrar-costos-proveedor");
await import("@/modules/costos-proveedor/application/dar-de-baja-costo-proveedor");
await import("@/modules/costos-proveedor/application/leer-lista-precios");
await import("@/modules/costos-proveedor/application/importar-lista-precios");
await import("@/modules/costos-proveedor/application/listar-listas-precio");

const { listRegisteredUseCasesForTests } = await import("@/shared/usecase");

const ROLES = ["ADMINISTRADOR", "DIRECTOR_TECNICO", "FARMACEUTICO", "ATENCION_PUBLICO", "SOLO_CONSULTA"] as const;
type Rol = (typeof ROLES)[number];

/** The default grants (migrations 0054 / 0079): the money-reading roles read; only ADMINISTRADOR writes. */
const SEED_GRANTS: Record<Rol, readonly Permiso[]> = {
  ADMINISTRADOR: ["stock.valorizado.ver", "costos.proveedor.gestionar"],
  DIRECTOR_TECNICO: ["stock.valorizado.ver"],
  FARMACEUTICO: ["stock.valorizado.ver"],
  ATENCION_PUBLICO: [],
  SOLO_CONSULTA: [],
};

const ID_1 = "33333333-3333-4333-a333-333333333333";
const ID_2 = "44444444-4444-4444-a444-444444444444";
const ID_3 = "55555555-5555-4555-a555-555555555555";

const CASES: ReadonlyArray<{ name: string; permiso: Permiso; input: unknown }> = [
  { name: "costos-proveedor.listar-vigentes", permiso: "stock.valorizado.ver", input: {} },
  { name: "costos-proveedor.historial", permiso: "stock.valorizado.ver", input: { drogaId: ID_1, proveedorId: ID_2 } },
  {
    name: "costos-proveedor.registrar",
    permiso: "costos.proveedor.gestionar",
    input: { proveedorId: ID_2, filas: [{ drogaId: ID_1, precioInformado: "40898", unidadPrecioId: ID_3, fechaPrecio: "2026-10-01", vigenteEsperadoId: null }] },
  },
  { name: "costos-proveedor.baja", permiso: "costos.proveedor.gestionar", input: { costoProveedorId: ID_1, motivo: "Ya no lo vende" } },
  // The list import (E4): reading it (no file in this input: a role that passes authorize() fails on the file check, not on a denial),
  // confirming it, and consulting the imported lists.
  { name: "costos-proveedor.leer-lista", permiso: "costos.proveedor.gestionar", input: { proveedorId: ID_2, fechaLista: "2026-10-01" } },
  {
    name: "costos-proveedor.importar-lista",
    permiso: "costos.proveedor.gestionar",
    input: {
      proveedorId: ID_2,
      fechaLista: "2026-10-01",
      nombreArchivo: "lista.xlsx",
      hashSha256: "a".repeat(64),
      formato: "XLSX",
      filasLeidas: 10,
      filas: [{ drogaId: ID_1, precioInformado: "40898", unidadPrecioId: ID_3, vigenteEsperadoId: null }],
    },
  },
  { name: "costos-proveedor.listar-listas", permiso: "stock.valorizado.ver", input: {} },
];

function sessionForRol(rol: Rol): AuthenticatedSession {
  return {
    usuario: { id: `u-${rol}`, email: `${rol}@example.com`, nombre: "N", apellido: "A" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(SEED_GRANTS[rol]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("costos de proveedor authorization matrix -- every use case's DECLARED permiso matches the spec (R35, R36)", () => {
  for (const { name, permiso } of CASES) {
    it(`the use case registered as "${name}" declares permiso "${permiso}"`, () => {
      const entry = listRegisteredUseCasesForTests().find((e) => e.name === name);
      expect(entry, `no registered use case named "${name}"`).toBeDefined();
      expect(entry!.permiso, `use case "${name}" is declared with the WRONG permiso`).toBe(permiso);
    });
  }
});

describe("costos de proveedor authorization matrix -- role x permiso, exercised through the REAL execute() path (CP19)", () => {
  for (const rol of ROLES) {
    for (const { name, permiso, input } of CASES) {
      const expectedAllowed = SEED_GRANTS[rol].includes(permiso);

      it(`${rol} ${expectedAllowed ? "IS" : "is NOT"} allowed to execute "${name}"`, async () => {
        const entry = listRegisteredUseCasesForTests().find((e) => e.name === name)!;
        const session = sessionForRol(rol);

        let rejectedWith: unknown;
        try {
          await entry.execute(input, { session });
        } catch (error) {
          rejectedWith = error;
        }

        if (expectedAllowed) {
          // It passes authorize() and zod and then fails on the fake transaction: anything but a denial.
          expect(rejectedWith, `"${name}" unexpectedly denied ${rol}`).not.toBeInstanceOf(AuthorizationError);
        } else {
          expect(rejectedWith, `"${name}" did not deny ${rol}`).toBeInstanceOf(AuthorizationError);
        }
      });
    }
  }
});
