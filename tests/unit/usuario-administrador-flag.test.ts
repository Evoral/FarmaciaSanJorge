/**
 * Unit tests for Administrador flagging across formatting, DB helpers, and repositories (commit cb9a019):
 * - `shared/format/usuario.ts`: `nombreDeUsuario` (both orders, flagged only when esAdministrador).
 * - `shared/db/usuario-administrador.ts`: `SELECT_ROL_ADMINISTRADOR` and `esAdministradorDe`.
 * - Mapped in:
 *   - `modules/auditoria/infrastructure/auditoria-repository.ts` (listRegistroAuditoria, listUsuariosParaFiltro)
 *   - `modules/usuarios/application/list-usuario-auditoria.ts` (listUsuarioAuditoriaQuery)
 *   - `modules/operadores/infrastructure/operadores-repository.ts` (listOperadores)
 *   - `modules/directores-tecnicos/infrastructure/designacion-repository.ts` (listUsuariosElegibles)
 *   - `modules/stock/infrastructure/co-firma-repository.ts` (listDtVigentesParaCoFirma)
 *   - `modules/libro/infrastructure/co-firma-repository.ts` (listDtVigentesParaCoFirma)
 */
import { describe, it, expect, vi } from "vitest";
import { nombreDeUsuario, ETIQUETA_ADMINISTRADOR } from "@/shared/format/usuario";
import { SELECT_ROL_ADMINISTRADOR, esAdministradorDe } from "@/shared/db/usuario-administrador";

describe("shared/format/usuario.ts: nombreDeUsuario", () => {
  const persona = { nombre: "Roberto", apellido: "Juaire" };

  it("formats in 'nombre' order without Admin flag by default or when false", () => {
    expect(nombreDeUsuario(persona)).toBe("Roberto Juaire");
    expect(nombreDeUsuario({ ...persona, esAdministrador: false })).toBe("Roberto Juaire");
  });

  it("formats in 'nombre' order with '(Admin)' flag when esAdministrador is true", () => {
    expect(nombreDeUsuario({ ...persona, esAdministrador: true })).toBe(`Roberto Juaire (${ETIQUETA_ADMINISTRADOR})`);
  });

  it("formats in 'apellido' order without Admin flag when false or omitted", () => {
    expect(nombreDeUsuario(persona, "apellido")).toBe("Juaire, Roberto");
    expect(nombreDeUsuario({ ...persona, esAdministrador: false }, "apellido")).toBe("Juaire, Roberto");
  });

  it("formats in 'apellido' order with '(Admin)' flag when esAdministrador is true", () => {
    expect(nombreDeUsuario({ ...persona, esAdministrador: true }, "apellido")).toBe(`Juaire, Roberto (${ETIQUETA_ADMINISTRADOR})`);
  });
});

describe("shared/db/usuario-administrador.ts: SELECT_ROL_ADMINISTRADOR & esAdministradorDe", () => {
  it("SELECT_ROL_ADMINISTRADOR filters for rol.esAdministrador = true", () => {
    expect(SELECT_ROL_ADMINISTRADOR).toEqual({
      rolesAsignados: {
        where: { rol: { esAdministrador: true } },
        select: { rolId: true },
        take: 1,
      },
    });
  });

  it("esAdministradorDe returns true when rolesAsignados has at least one entry", () => {
    expect(esAdministradorDe({ rolesAsignados: [{ rolId: "r-admin" }] })).toBe(true);
  });

  it("esAdministradorDe returns false when rolesAsignados is empty", () => {
    expect(esAdministradorDe({ rolesAsignados: [] })).toBe(false);
  });
});

describe("auditoria-repository: listRegistroAuditoria & listUsuariosParaFiltro", () => {
  it("listRegistroAuditoria maps esAdministrador on usuario and autorizadoPor", async () => {
    const { listRegistroAuditoria } = await import("@/modules/auditoria/infrastructure/auditoria-repository");

    const fakeRows = [
      {
        id: "a-1",
        tenantId: "t-1",
        usuarioId: "u-1",
        autorizadoPorId: "u-2",
        entidad: "receta",
        entidadId: "r-1",
        accion: "CREAR",
        valorAnterior: null,
        valorNuevo: null,
        motivo: null,
        ip: null,
        contexto: null,
        ocurridoEn: new Date(),
        usuario: { id: "u-1", nombre: "Ana", apellido: "Gómez", rolesAsignados: [{ rolId: "r-admin" }] },
        autorizadoPor: { nombre: "Carlos", apellido: "López", rolesAsignados: [] },
      },
      {
        id: "a-2",
        tenantId: "t-1",
        usuarioId: "u-3",
        autorizadoPorId: null,
        entidad: "stock",
        entidadId: "s-1",
        accion: "MODIFICAR",
        valorAnterior: null,
        valorNuevo: null,
        motivo: null,
        ip: null,
        contexto: null,
        ocurridoEn: new Date(),
        usuario: { id: "u-3", nombre: "Pedro", apellido: "Sosa", rolesAsignados: [] },
        autorizadoPor: null,
      },
    ];

    const fakeTx = {
      registroAuditoria: {
        findMany: vi.fn().mockResolvedValue(fakeRows),
      },
    } as any;

    const result = await listRegistroAuditoria(fakeTx, { tenantId: "t-1", pageSize: 10 });

    expect(result.items).toHaveLength(2);

    expect(result.items[0].usuario.esAdministrador).toBe(true);
    expect(result.items[0].autorizadoPor).toEqual({
      nombre: "Carlos",
      apellido: "López",
      esAdministrador: false,
    });

    expect(result.items[1].usuario.esAdministrador).toBe(false);
    expect(result.items[1].autorizadoPor).toBeNull();
  });

  it("listUsuariosParaFiltro maps esAdministrador on every returned option", async () => {
    const { listUsuariosParaFiltro } = await import("@/modules/auditoria/infrastructure/auditoria-repository");

    const fakeRows = [
      { id: "u-1", nombre: "Ana", apellido: "Gómez", rolesAsignados: [{ rolId: "r-admin" }] },
      { id: "u-2", nombre: "Carlos", apellido: "López", rolesAsignados: [] },
    ];

    const fakeTx = {
      usuario: {
        findMany: vi.fn().mockResolvedValue(fakeRows),
      },
    } as any;

    const options = await listUsuariosParaFiltro(fakeTx, "t-1");

    expect(options).toEqual([
      { id: "u-1", nombre: "Ana", apellido: "Gómez", esAdministrador: true },
      { id: "u-2", nombre: "Carlos", apellido: "López", esAdministrador: false },
    ]);
  });
});

describe("listUsuarioAuditoriaQuery", () => {
  it("maps esAdministrador on the usuario of each audit row", async () => {
    const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
    vi.doMock("@/shared/db/transaction", () => ({
      withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
    }));

    vi.doMock("@/shared/auth/session", () => ({
      requireSession: vi.fn(async () => {
        throw new Error("requireSession() unexpectedly called");
      }),
      requireRecentReauth: vi.fn(),
    }));

    const fakeRows = [
      {
        id: "aud-1",
        accion: "MODIFICAR",
        valorAnterior: { estado: "ACTIVO" },
        valorNuevo: { estado: "SUSPENDIDO" },
        motivo: "Suspensión temporal",
        ocurridoEn: new Date(),
        usuario: { id: "u-admin", nombre: "Admin", apellido: "General", rolesAsignados: [{ rolId: "r-admin" }] },
      },
    ];

    const fakeTx = {
      registroAuditoria: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue(fakeRows),
      },
      tenant: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ zonaHoraria: "America/Argentina/Buenos_Aires" }),
      },
    } as any;

    withTenantTransactionMock.mockImplementation(async (_tenantId, fn) => fn(fakeTx));

    const { listUsuarioAuditoriaQuery } = await import("@/modules/usuarios/application/list-usuario-auditoria");

    const session = {
      usuario: { id: "u-admin", email: "admin@example.com", nombre: "Admin", apellido: "General" },
      tenantId: "11111111-1111-1111-1111-111111111111",
      sesionId: "s1",
      permisos: new Set(["usuarios.auditoria.ver"]),
      reautenticadaEn: new Date(),
    } as any;

    const result = await listUsuarioAuditoriaQuery.execute(
      { usuarioId: "22222222-2222-4222-a222-222222222222" },
      { session },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].usuario.esAdministrador).toBe(true);
  });
});

describe("operadores-repository: listOperadores", () => {
  it("listOperadores maps esAdministrador on each operador option", async () => {
    const { listOperadores } = await import("@/modules/operadores/infrastructure/operadores-repository");

    const fakeRows = [
      { id: "op-1", nombre: "Marcos", apellido: "Díaz", rolesAsignados: [{ rolId: "r-admin" }] },
      { id: "op-2", nombre: "Laura", apellido: "Paz", rolesAsignados: [] },
    ];

    const fakeTx = {
      usuario: {
        findMany: vi.fn().mockResolvedValue(fakeRows),
      },
    } as any;

    const result = await listOperadores(fakeTx, "t-1");

    expect(result).toEqual([
      { id: "op-1", nombre: "Marcos", apellido: "Díaz", esAdministrador: true },
      { id: "op-2", nombre: "Laura", apellido: "Paz", esAdministrador: false },
    ]);
  });
});

describe("directores-tecnicos: listUsuariosElegibles", () => {
  it("listUsuariosElegibles maps esAdministrador on eligible usuarios", async () => {
    const { listUsuariosElegibles } = await import("@/modules/directores-tecnicos/infrastructure/designacion-repository");

    const fakeRows = [
      { id: "u-1", nombre: "Mariana", apellido: "Silva", dni: "30111222", rolesAsignados: [{ rolId: "r-admin" }] },
      { id: "u-2", nombre: "Federico", apellido: "Vargas", dni: "32333444", rolesAsignados: [] },
    ];

    const fakeTx = {
      usuario: {
        findMany: vi.fn().mockResolvedValue(fakeRows),
      },
    } as any;

    const result = await listUsuariosElegibles(fakeTx, "t-1");

    expect(result).toEqual([
      { id: "u-1", nombre: "Mariana", apellido: "Silva", dni: "30111222", esAdministrador: true },
      { id: "u-2", nombre: "Federico", apellido: "Vargas", dni: "32333444", esAdministrador: false },
    ]);
  });
});

describe("co-firma-repository (stock & libro): listDtVigentesParaCoFirma", () => {
  it("stock co-firma repository maps esAdministrador from es_administrador raw query column", async () => {
    const { listDtVigentesParaCoFirma: listStockDt } = await import("@/modules/stock/infrastructure/co-firma-repository");

    const fakeRows = [
      { usuario_id: "u-dt-1", nombre: "Roberto", apellido: "Juaire", es_administrador: true },
      { usuario_id: "u-dt-2", nombre: "Clara", apellido: "Méndez", es_administrador: false },
    ];

    let executedQuery = "";
    const fakeTx = {
      $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => {
        executedQuery = strings.join("");
        return Promise.resolve(fakeRows);
      }),
    } as any;

    const result = await listStockDt(fakeTx, "11111111-1111-1111-1111-111111111111");

    expect(executedQuery).toContain("es_administrador");
    expect(result).toEqual([
      { usuarioId: "u-dt-1", nombre: "Roberto", apellido: "Juaire", esAdministrador: true },
      { usuarioId: "u-dt-2", nombre: "Clara", apellido: "Méndez", esAdministrador: false },
    ]);
  });

  it("libro co-firma repository maps esAdministrador from es_administrador raw query column", async () => {
    const { listDtVigentesParaCoFirma: listLibroDt } = await import("@/modules/libro/infrastructure/co-firma-repository");

    const fakeRows = [
      { usuario_id: "u-dt-1", nombre: "Roberto", apellido: "Juaire", es_administrador: true },
    ];

    let executedQuery = "";
    const fakeTx = {
      $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray) => {
        executedQuery = strings.join("");
        return Promise.resolve(fakeRows);
      }),
    } as any;

    const result = await listLibroDt(fakeTx, "11111111-1111-1111-1111-111111111111");

    expect(executedQuery).toContain("es_administrador");
    expect(result).toEqual([
      { usuarioId: "u-dt-1", nombre: "Roberto", apellido: "Juaire", esAdministrador: true },
    ]);
  });
});
