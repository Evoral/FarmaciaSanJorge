/**
 * Unit tests for roles table improvements (commit 8d4777b):
 * - `modules/usuarios/infrastructure/rol-repository.ts`:
 *   `cantidadUsuariosDeSector` counted from `asignaciones.usuario.esSector`.
 * - `modules/usuarios/application/list-roles-con-permisos.ts`:
 *   `soloPersonal` flag computed via `ROLES_VEDADOS_A_SECTOR.includes(rol.codigo)`.
 */
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { ROL_ADMINISTRADOR, ROL_DIRECTOR_TECNICO, ROLES_VEDADOS_A_SECTOR } from "@/modules/usuarios/domain/roles";

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

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function fakeSession(permisos: string[] = ["roles.ver"]): AuthenticatedSession {
  return {
    usuario: { id: "u-admin", email: "admin@example.com", nombre: "Admin", apellido: "General" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

describe("listRolesDelTenant (rol-repository)", () => {
  it("counts cantidadUsuarios and cantidadUsuariosDeSector correctly across personal and sector assignments", async () => {
    const { listRolesDelTenant } = await import("@/modules/usuarios/infrastructure/rol-repository");

    const fakePrismaRows = [
      {
        id: "rol-1",
        codigo: "FARMACEUTICO",
        nombre: "Farmacéutico",
        descripcion: "Farmacéutico de turno",
        esAdministrador: false,
        permisos: [{ permiso: { codigo: "recetas.crear" } }],
        asignaciones: [
          { usuario: { esSector: false } },
          { usuario: { esSector: true } },
          { usuario: { esSector: true } },
        ],
      },
      {
        id: "rol-2",
        codigo: "AUXILIAR",
        nombre: "Auxiliar",
        descripcion: null,
        esAdministrador: false,
        permisos: [],
        asignaciones: [
          { usuario: { esSector: false } },
          { usuario: { esSector: false } },
        ],
      },
      {
        id: "rol-3",
        codigo: "SECTOR_SOLO",
        nombre: "Sector Solo",
        descripcion: null,
        esAdministrador: false,
        permisos: [],
        asignaciones: [
          { usuario: { esSector: true } },
        ],
      },
      {
        id: "rol-4",
        codigo: "VACIO",
        nombre: "Rol sin asignar",
        descripcion: null,
        esAdministrador: false,
        permisos: [],
        asignaciones: [],
      },
    ];

    const findManyMock = vi.fn().mockResolvedValue(fakePrismaRows);
    const fakeTx = { rol: { findMany: findManyMock } } as unknown as Prisma.TransactionClient;

    const result = await listRolesDelTenant(fakeTx, TENANT_ID);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_ID, codigo: { not: "SISTEMA" } },
        select: expect.objectContaining({
          asignaciones: { select: { usuario: { select: { esSector: true } } } },
        }),
      }),
    );

    expect(result).toHaveLength(4);

    // rol-1: mixed 3 total (1 personal, 2 sector)
    expect(result[0].cantidadUsuarios).toBe(3);
    expect(result[0].cantidadUsuariosDeSector).toBe(2);

    // rol-2: 2 personal, 0 sector
    expect(result[1].cantidadUsuarios).toBe(2);
    expect(result[1].cantidadUsuariosDeSector).toBe(0);

    // rol-3: 1 sector, 1 total
    expect(result[2].cantidadUsuarios).toBe(1);
    expect(result[2].cantidadUsuariosDeSector).toBe(1);

    // rol-4: 0 total, 0 sector
    expect(result[3].cantidadUsuarios).toBe(0);
    expect(result[3].cantidadUsuariosDeSector).toBe(0);
  });
});

describe("listRolesConPermisosQuery", () => {
  it("marks soloPersonal = true for ROLES_VEDADOS_A_SECTOR and false for other roles", async () => {
    const listRolesDelTenantMock = vi.fn().mockResolvedValue([
      {
        id: "r-admin",
        codigo: ROL_ADMINISTRADOR,
        nombre: "Administrador",
        descripcion: "Admin",
        esAdministrador: true,
        permisos: [],
        cantidadUsuarios: 1,
        cantidadUsuariosDeSector: 0,
      },
      {
        id: "r-dt",
        codigo: ROL_DIRECTOR_TECNICO,
        nombre: "Director Técnico",
        descripcion: "DT",
        esAdministrador: false,
        permisos: ["cierres.firmar"],
        cantidadUsuarios: 2,
        cantidadUsuariosDeSector: 0,
      },
      {
        id: "r-far",
        codigo: "FARMACEUTICO",
        nombre: "Farmacéutico",
        descripcion: "Farmacia",
        esAdministrador: false,
        permisos: ["recetas.crear"],
        cantidadUsuarios: 4,
        cantidadUsuariosDeSector: 2,
      },
      {
        id: "r-custom",
        codigo: "ATENCION",
        nombre: "Atención al público",
        descripcion: "Mostrador",
        esAdministrador: false,
        permisos: [],
        cantidadUsuarios: 3,
        cantidadUsuariosDeSector: 3,
      },
    ]);

    vi.doMock("@/modules/usuarios/infrastructure/rol-repository", () => ({
      listRolesDelTenant: listRolesDelTenantMock,
    }));

    const { listRolesConPermisosQuery } = await import("@/modules/usuarios/application/list-roles-con-permisos");

    const result = await listRolesConPermisosQuery.execute({}, { session: fakeSession() });

    expect(result).toHaveLength(4);

    const admin = result.find((r) => r.codigo === ROL_ADMINISTRADOR)!;
    expect(admin.soloPersonal).toBe(true);
    expect(admin.proteccion).toBe("BLOQUEADO");

    const dt = result.find((r) => r.codigo === ROL_DIRECTOR_TECNICO)!;
    expect(dt.soloPersonal).toBe(true);
    expect(dt.proteccion).toBe("NO_ELIMINABLE");

    const far = result.find((r) => r.codigo === "FARMACEUTICO")!;
    expect(far.soloPersonal).toBe(false);
    expect(far.proteccion).toBe("NINGUNA");

    const custom = result.find((r) => r.codigo === "ATENCION")!;
    expect(custom.soloPersonal).toBe(false);
    expect(custom.proteccion).toBe("NINGUNA");

    // All roles in ROLES_VEDADOS_A_SECTOR must have soloPersonal = true
    for (const vedado of ROLES_VEDADOS_A_SECTOR) {
      const match = result.find((r) => r.codigo === vedado);
      if (match) {
        expect(match.soloPersonal).toBe(true);
      }
    }
  });
});
