/**
 * DP-03 (docs/specs/roles-personalizables.md): the role use cases
 * (crearRol / editarRol / eliminarRol) and the role-assignment escalation
 * rule in crearUsuario / cambiarRoles, run through the REAL defineCommand
 * pipeline with a stubbed transaction and mocked repositories (no DB --
 * the DB triggers INV-ROL-001..005 are covered by tests/db/roles-por-tenant.test.ts).
 * Also covers the session loader granting a `esAdministrador` role (locked
 * ADMINISTRADOR) every consulta/gestion permiso and never an operativo one,
 * and the ADMINISTRADOR's grant authority over operativo permisos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { AuthorizationError, DomainError, NotFoundError, StepUpRequiredError, ValidationError } from "@/shared/errors";
import {
  PERMISOS_ASIGNABLES_A_ROLES,
  PERMISOS_BASE_DE_ROL,
  PERMISOS_DE_ADMINISTRADOR,
  PERMISOS_FUERA_DE_ROLES,
  PERMISOS_OPERATIVOS,
  type Permiso,
} from "@/modules/auth/domain/permisos";
import { requireRecentReauth as realRequireRecentReauth } from "@/modules/auth/domain/step-up";

const auditRecordMock = vi.fn(async (...args: unknown[]): Promise<undefined> => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
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
  requireRecentReauth: (session: AuthenticatedSession, maxAgeMinutes: number, now?: Date) => realRequireRecentReauth(session, maxAgeMinutes, now),
}));

interface FakeRol {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  esAdministrador: boolean;
  permisos: Permiso[];
  cantidadUsuarios: number;
}

const roles = new Map<string, FakeRol>();
let rolesDelActor: string[] = [];
const insertRolMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return { id: "rol-nuevo" };
});
const reemplazarMock = vi.fn(async (...args: unknown[]) => {
  void args;
});
const updateDatosMock = vi.fn(async (...args: unknown[]) => {
  void args;
});
const deleteRolMock = vi.fn(async (...args: unknown[]) => {
  void args;
});

vi.mock("@/modules/usuarios/infrastructure/rol-repository", () => ({
  lockRol: vi.fn(async (_tx: unknown, _tenantId: string, id: string) => roles.has(id)),
  findRolById: vi.fn(async (_tx: unknown, _tenantId: string, id: string) => roles.get(id) ?? null),
  existeNombreDeRol: vi.fn(async (_tx: unknown, _tenantId: string, nombre: string, excludeId?: string) =>
    [...roles.values()].some((r) => r.nombre.toLowerCase() === nombre.toLowerCase() && r.id !== excludeId),
  ),
  listCodigosDeRol: vi.fn(async () => new Set([...roles.values()].map((r) => r.codigo))),
  insertRol: (...args: unknown[]) => insertRolMock(...args),
  reemplazarPermisosDeRol: (...args: unknown[]) => reemplazarMock(...args),
  updateDatosDeRol: (...args: unknown[]) => updateDatosMock(...args),
  deleteRol: (...args: unknown[]) => deleteRolMock(...args),
  codigosDeRolesDelUsuario: vi.fn(async () => rolesDelActor),
  findRolesPorCodigo: vi.fn(async (_tx: unknown, _tenantId: string, codigos: string[]) =>
    [...roles.values()].filter((r) => codigos.includes(r.codigo)).map(({ id, codigo, nombre, esAdministrador, permisos }) => ({ id, codigo, nombre, esAdministrador, permisos })),
  ),
  listCatalogoPermisos: vi.fn(async () => []),
  listRolesDelTenant: vi.fn(async () => [...roles.values()]),
  listRolesAsignables: vi.fn(async () => []),
}));

const insertUsuarioRolMock = vi.fn(async (...args: unknown[]) => {
  void args;
});
vi.mock("@/modules/usuarios/infrastructure/usuario-repository", () => ({
  existeEmail: vi.fn(async () => false),
  existeDni: vi.fn(async () => false),
  insertUsuario: vi.fn(async () => ({ id: "nuevo-usuario" })),
  insertUsuarioRol: (...args: unknown[]) => insertUsuarioRolMock(...args),
  deleteUsuarioRol: vi.fn(async () => undefined),
  insertCredencialActivacion: vi.fn(async () => undefined),
  loadUsuarioParaAccion: vi.fn(async () => ({ id: TARGET, estado: "ACTIVO", esTecnico: false, roles: ["SOLO_CONSULTA"] })),
  tieneDesignacionDtVigente: vi.fn(async () => false),
}));
vi.mock("@/modules/usuarios/infrastructure/admin-guard", () => ({
  lockUsuarioYAdministradoresActivos: vi.fn(async () => ({ targetLocked: true, idsAdminsActivos: ["admin-1"] })),
}));

const { crearRolCommand } = await import("@/modules/usuarios/application/crear-rol");
const { editarRolCommand } = await import("@/modules/usuarios/application/editar-rol");
const { eliminarRolCommand } = await import("@/modules/usuarios/application/eliminar-rol");
const { cambiarRolesCommand } = await import("@/modules/usuarios/application/cambiar-roles");
const { crearUsuarioCommand } = await import("@/modules/usuarios/application/crear-usuario");

const TARGET = "22222222-2222-4222-a222-222222222222";
const ID_ADMIN = "33333333-3333-4333-a333-333333333331";
const ID_DT = "33333333-3333-4333-a333-333333333332";
const ID_FAR = "33333333-3333-4333-a333-333333333333";
const ID_CADETE = "33333333-3333-4333-a333-333333333334";
const ID_SISTEMA = "33333333-3333-4333-a333-333333333335";

const TODOS = new Set<Permiso>(PERMISOS_ASIGNABLES_A_ROLES);

function session(permisos: Iterable<Permiso>, reautenticadaEn: Date | null = new Date()): AuthenticatedSession {
  return {
    usuario: { id: "actor-1", email: "a@example.com", nombre: "A", apellido: "B" },
    tenantId: "11111111-1111-1111-1111-111111111111",
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn,
  };
}

/** A non-admin "gestor de roles" holding roles.gestionar plus a few operational permisos. */
const GESTOR = session([...PERMISOS_BASE_DE_ROL, "roles.ver", "roles.gestionar", "stock.ver", "recetas.crear", "usuarios.crear", "usuarios.roles.modificar"]);

beforeEach(() => {
  roles.clear();
  const base = [...PERMISOS_BASE_DE_ROL] as Permiso[];
  roles.set(ID_ADMIN, { id: ID_ADMIN, codigo: "ADMINISTRADOR", nombre: "Administrador", descripcion: null, esAdministrador: true, permisos: [...PERMISOS_DE_ADMINISTRADOR].sort(), cantidadUsuarios: 1 });
  roles.set(ID_DT, { id: ID_DT, codigo: "DIRECTOR_TECNICO", nombre: "Director Técnico", descripcion: null, esAdministrador: false, permisos: [...base, "cierres.firmar"], cantidadUsuarios: 0 });
  roles.set(ID_FAR, { id: ID_FAR, codigo: "FARMACEUTICO", nombre: "Farmacéutico", descripcion: null, esAdministrador: false, permisos: [...base, "stock.ver", "cierres.ver"], cantidadUsuarios: 0 });
  roles.set(ID_CADETE, { id: ID_CADETE, codigo: "CADETE", nombre: "Cadete", descripcion: null, esAdministrador: false, permisos: [...base, "stock.ver"], cantidadUsuarios: 2 });
  roles.set(ID_SISTEMA, { id: ID_SISTEMA, codigo: "SISTEMA", nombre: "Sistema", descripcion: null, esAdministrador: false, permisos: [], cantidadUsuarios: 1 });
  rolesDelActor = [];
  for (const mock of [auditRecordMock, insertRolMock, reemplazarMock, updateDatosMock, deleteRolMock, insertUsuarioRolMock, withTenantTransactionMock]) mock.mockClear();
});

describe("pipeline: permiso, step-up, catalog validation", () => {
  it("every role write requires roles.gestionar (roles.ver is not enough)", async () => {
    const soloVer = session([...PERMISOS_BASE_DE_ROL, "roles.ver"]);
    await expect(crearRolCommand.execute({ nombre: "X", permisos: [] }, { session: soloVer })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(editarRolCommand.execute({ rolId: ID_FAR, nombre: "X", permisos: [] }, { session: soloVer })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(eliminarRolCommand.execute({ rolId: ID_FAR }, { session: soloVer })).rejects.toBeInstanceOf(AuthorizationError);
    expect(crearRolCommand.permiso).toBe("roles.gestionar");
    expect(editarRolCommand.permiso).toBe("roles.gestionar");
    expect(eliminarRolCommand.permiso).toBe("roles.gestionar");
  });

  it("every role write requires a recent re-authentication", async () => {
    const sinReauth = session(TODOS, null);
    await expect(crearRolCommand.execute({ nombre: "X", permisos: [] }, { session: sinReauth })).rejects.toBeInstanceOf(StepUpRequiredError);
    await expect(editarRolCommand.execute({ rolId: ID_FAR, nombre: "X", permisos: [] }, { session: sinReauth })).rejects.toBeInstanceOf(StepUpRequiredError);
    await expect(eliminarRolCommand.execute({ rolId: ID_FAR }, { session: sinReauth })).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it("an unknown permiso code is rejected by zod before any transaction opens", async () => {
    await expect(crearRolCommand.execute({ nombre: "X", permisos: ["stock.ver", "stock.inventado"] }, { session: session(TODOS) })).rejects.toBeInstanceOf(ValidationError);
    await expect(editarRolCommand.execute({ rolId: ID_FAR, nombre: "X", permisos: ["no.existe"] }, { session: session(TODOS) })).rejects.toBeInstanceOf(ValidationError);
    expect(withTenantTransactionMock).not.toHaveBeenCalled();
  });

  it("permisos that never belong to a role (auth.activar, tenants.*) are rejected", async () => {
    for (const codigo of PERMISOS_FUERA_DE_ROLES) {
      await expect(crearRolCommand.execute({ nombre: "X", permisos: [codigo] }, { session: session(TODOS) })).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe("crearRol", () => {
  it("creates with a generated code, the session basics, and audits CREAR_ROL with the sorted permiso list", async () => {
    const result = await crearRolCommand.execute({ nombre: "Cadete de mostrador", descripcion: "Mostrador", permisos: ["stock.ver"] }, { session: GESTOR });
    expect(result).toEqual({ rolId: "rol-nuevo", codigo: "CADETE_DE_MOSTRADOR" });
    const esperados = [...PERMISOS_BASE_DE_ROL, "stock.ver"].sort();
    expect(reemplazarMock).toHaveBeenCalledWith(expect.anything(), GESTOR.tenantId, "rol-nuevo", esperados);
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({
      entidad: "rol",
      entidadId: "rol-nuevo",
      accion: "CREAR_ROL",
      valorNuevo: { codigo: "CADETE_DE_MOSTRADOR", nombre: "Cadete de mostrador", descripcion: "Mostrador", permisos: esperados },
    });
  });

  it("escalation: rejects a permiso the actor does not hold, writing nothing", async () => {
    await expect(crearRolCommand.execute({ nombre: "Firmante", permisos: ["cierres.firmar"] }, { session: GESTOR })).rejects.toBeInstanceOf(DomainError);
    expect(insertRolMock).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("rejects a duplicated nombre (case-insensitive)", async () => {
    await expect(crearRolCommand.execute({ nombre: "cadete", permisos: [] }, { session: GESTOR })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a name colliding with a protected code gets a suffixed code, never the protected one", async () => {
    const result = await crearRolCommand.execute({ nombre: "Administrador.", permisos: [] }, { session: session(TODOS) });
    expect(result.codigo).toBe("ADMINISTRADOR_2");
  });
});

describe("editarRol", () => {
  it("ADMINISTRADOR is locked (even for an actor holding every permiso)", async () => {
    await expect(editarRolCommand.execute({ rolId: ID_ADMIN, nombre: "Admin", permisos: [] }, { session: session(TODOS) })).rejects.toBeInstanceOf(DomainError);
    expect(updateDatosMock).not.toHaveBeenCalled();
  });

  it("SISTEMA is reported as not found (never exposed)", async () => {
    await expect(editarRolCommand.execute({ rolId: ID_SISTEMA, nombre: "S", permisos: [] }, { session: session(TODOS) })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the actor cannot edit a role they hold", async () => {
    rolesDelActor = ["CADETE"];
    await expect(editarRolCommand.execute({ rolId: ID_CADETE, nombre: "Cadete", permisos: ["stock.ver", "recetas.crear"] }, { session: GESTOR })).rejects.toThrow(
      /rol que tenés asignado/,
    );
  });

  it("escalation: cannot add a permiso the actor lacks; lacking permisos already in the role are kept", async () => {
    // FARMACEUTICO has cierres.ver, which GESTOR lacks: it survives an edit that does not (cannot) submit it.
    await editarRolCommand.execute({ rolId: ID_FAR, nombre: "Farmacéutico", permisos: ["recetas.crear"] }, { session: GESTOR });
    expect(reemplazarMock).toHaveBeenCalledWith(expect.anything(), GESTOR.tenantId, ID_FAR, [...PERMISOS_BASE_DE_ROL, "cierres.ver", "recetas.crear"].sort());

    await expect(
      editarRolCommand.execute({ rolId: ID_FAR, nombre: "Farmacéutico", permisos: ["preparaciones.confirmar"] }, { session: GESTOR }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("DIRECTOR_TECNICO's permisos are editable; audit EDITAR_ROL has before/after", async () => {
    await editarRolCommand.execute({ rolId: ID_DT, nombre: "Director Técnico", permisos: ["cierres.firmar", "stock.ver"] }, { session: session(TODOS) });
    const audit = auditRecordMock.mock.calls[0]![1] as Record<string, { permisos: string[] }>;
    expect(audit).toMatchObject({ entidad: "rol", entidadId: ID_DT, accion: "EDITAR_ROL" });
    expect(audit.valorAnterior!.permisos).toEqual([...PERMISOS_BASE_DE_ROL, "cierres.firmar"].sort());
    expect(audit.valorNuevo!.permisos).toEqual([...PERMISOS_BASE_DE_ROL, "cierres.firmar", "stock.ver"].sort());
  });

  it("an edit with no changes is rejected", async () => {
    await expect(editarRolCommand.execute({ rolId: ID_CADETE, nombre: "Cadete", permisos: ["stock.ver"] }, { session: session(TODOS) })).rejects.toThrow(/No hay cambios/);
  });
});

describe("eliminarRol", () => {
  it("ADMINISTRADOR and DIRECTOR_TECNICO can never be deleted", async () => {
    await expect(eliminarRolCommand.execute({ rolId: ID_ADMIN }, { session: session(TODOS) })).rejects.toBeInstanceOf(DomainError);
    await expect(eliminarRolCommand.execute({ rolId: ID_DT }, { session: session(TODOS) })).rejects.toThrow(/Director Técnico/);
    expect(deleteRolMock).not.toHaveBeenCalled();
  });

  it("an assigned role cannot be deleted -- the message says how many usuarios hold it", async () => {
    await expect(eliminarRolCommand.execute({ rolId: ID_CADETE }, { session: session(TODOS) })).rejects.toThrow(/2 usuarios tienen este rol/);
    expect(deleteRolMock).not.toHaveBeenCalled();
  });

  it("deletes an unassigned default role and audits ELIMINAR_ROL", async () => {
    await eliminarRolCommand.execute({ rolId: ID_FAR }, { session: session(TODOS) });
    expect(deleteRolMock).toHaveBeenCalledWith(expect.anything(), expect.any(String), ID_FAR);
    expect(auditRecordMock.mock.calls[0]![1]).toMatchObject({ entidad: "rol", entidadId: ID_FAR, accion: "ELIMINAR_ROL", valorAnterior: { codigo: "FARMACEUTICO" } });
  });

  it("SISTEMA is reported as not found", async () => {
    await expect(eliminarRolCommand.execute({ rolId: ID_SISTEMA }, { session: session(TODOS) })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("assigning roles (crearUsuario / cambiarRoles) is limited to the tenant's roles and the actor's own permisos", () => {
  it("an unknown role code is a validation error", async () => {
    await expect(cambiarRolesCommand.execute({ usuarioId: TARGET, roles: ["NO_EXISTE"] }, { session: GESTOR })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      crearUsuarioCommand.execute({ nombre: "A", apellido: "B", email: "a@b.com", dni: "1", roles: ["NO_EXISTE"] }, { session: GESTOR }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("SISTEMA is rejected by zod", async () => {
    await expect(cambiarRolesCommand.execute({ usuarioId: TARGET, roles: ["SISTEMA"] }, { session: session(TODOS) })).rejects.toBeInstanceOf(ValidationError);
  });

  it("escalation: a non-admin cannot assign ADMINISTRADOR (or any role exceeding their permisos)", async () => {
    await expect(cambiarRolesCommand.execute({ usuarioId: TARGET, roles: ["ADMINISTRADOR"] }, { session: GESTOR })).rejects.toThrow(/No podés asignar el rol "Administrador"/);
    await expect(
      crearUsuarioCommand.execute({ nombre: "A", apellido: "B", email: "a@b.com", dni: "1", roles: ["FARMACEUTICO"] }, { session: GESTOR }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(insertUsuarioRolMock).not.toHaveBeenCalled();
  });

  it("a role within the actor's permisos can be assigned; an ADMINISTRADOR can assign any", async () => {
    await cambiarRolesCommand.execute({ usuarioId: TARGET, roles: ["SOLO_CONSULTA", "CADETE"] }, { session: GESTOR });
    expect(insertUsuarioRolMock).toHaveBeenCalledTimes(1);
    insertUsuarioRolMock.mockClear();
    await cambiarRolesCommand.execute({ usuarioId: TARGET, roles: ["ADMINISTRADOR"] }, { session: session(TODOS) });
    expect(insertUsuarioRolMock).toHaveBeenCalledTimes(1);
  });
});

describe("session loader: a esAdministrador role (locked ADMINISTRADOR) grants every consulta/gestion permiso, never an operativo one", () => {
  it("includes roles.gestionar; excludes every operativo permiso and auth.activar / tenants.*", async () => {
    const { loadUsuarioConPermisos } = await import("@/modules/auth/infrastructure/session-repository");
    const fakeTx = {
      usuario: {
        findUnique: async () => ({
          id: "u",
          email: "u@example.com",
          nombre: "N",
          apellido: "A",
          estado: "ACTIVO",
          rolesAsignados: [{ rol: { esAdministrador: true, permisos: [] } }],
        }),
      },
    };
    const usuario = await loadUsuarioConPermisos(fakeTx as never, "u");
    expect([...usuario!.permisos].sort()).toEqual([...PERMISOS_DE_ADMINISTRADOR].sort());
    expect(usuario!.permisos.has("roles.gestionar")).toBe(true);
    for (const codigo of PERMISOS_OPERATIVOS) expect(usuario!.permisos.has(codigo)).toBe(false);
    for (const codigo of PERMISOS_FUERA_DE_ROLES) expect(usuario!.permisos.has(codigo)).toBe(false);
  });

  it("an administrator who also holds an operational role (pharmacist-owner) gets that role's operativo permisos on top", async () => {
    const { loadUsuarioConPermisos } = await import("@/modules/auth/infrastructure/session-repository");
    const fakeTx = {
      usuario: {
        findUnique: async () => ({
          id: "u",
          email: "u@example.com",
          nombre: "N",
          apellido: "A",
          estado: "ACTIVO",
          rolesAsignados: [
            { rol: { esAdministrador: true, permisos: [] } },
            { rol: { esAdministrador: false, permisos: [{ permiso: { codigo: "preparaciones.confirmar" } }] } },
          ],
        }),
      },
    };
    const usuario = await loadUsuarioConPermisos(fakeTx as never, "u");
    expect(usuario!.permisos.has("preparaciones.confirmar")).toBe(true);
    expect(usuario!.permisos.has("cierres.firmar")).toBe(false);
  });

  it("other roles contribute exactly their rol_permiso rows (union across roles)", async () => {
    const { loadUsuarioConPermisos } = await import("@/modules/auth/infrastructure/session-repository");
    const fakeTx = {
      usuario: {
        findUnique: async () => ({
          id: "u",
          email: "u@example.com",
          nombre: "N",
          apellido: "A",
          estado: "ACTIVO",
          rolesAsignados: [
            { rol: { esAdministrador: false, permisos: [{ permiso: { codigo: "stock.ver" } }] } },
            { rol: { esAdministrador: false, permisos: [{ permiso: { codigo: "recetas.crear" } }, { permiso: { codigo: "codigo.desconocido" } }] } },
          ],
        }),
      },
    };
    const usuario = await loadUsuarioConPermisos(fakeTx as never, "u");
    expect([...usuario!.permisos].sort()).toEqual(["recetas.crear", "stock.ver"]);
  });
});

describe("grant authority: an ADMINISTRADOR grants operativo permisos it does not exercise; other managers cannot", () => {
  /** A real locked-admin session: consulta/gestion only, holding the ADMINISTRADOR role. */
  const ADMIN = session(PERMISOS_DE_ADMINISTRADOR);

  it("an ADMINISTRADOR can create a role with operativo permisos", async () => {
    rolesDelActor = ["ADMINISTRADOR"];
    await crearRolCommand.execute({ nombre: "Firmante", permisos: ["cierres.firmar", "preparaciones.confirmar"] }, { session: ADMIN });
    expect(reemplazarMock).toHaveBeenCalledWith(
      expect.anything(),
      ADMIN.tenantId,
      "rol-nuevo",
      [...PERMISOS_BASE_DE_ROL, "cierres.firmar", "preparaciones.confirmar"].sort(),
    );
  });

  it("an ADMINISTRADOR can add AND remove operativo permisos of an existing role", async () => {
    rolesDelActor = ["ADMINISTRADOR"];
    await editarRolCommand.execute({ rolId: ID_DT, nombre: "Director Técnico", permisos: ["stock.ajuste.autorizar"] }, { session: ADMIN });
    // cierres.firmar was in the role and was NOT re-submitted: the admin can grant it, so it is removed.
    expect(reemplazarMock).toHaveBeenCalledWith(expect.anything(), ADMIN.tenantId, ID_DT, [...PERMISOS_BASE_DE_ROL, "stock.ajuste.autorizar"].sort());
  });

  it("an ADMINISTRADOR can assign a role carrying operativo permisos (e.g. a pharmacist-owner to themself is not restricted beyond existing rules)", async () => {
    rolesDelActor = ["ADMINISTRADOR"];
    await cambiarRolesCommand.execute({ usuarioId: TARGET, roles: ["SOLO_CONSULTA", "DIRECTOR_TECNICO"] }, { session: ADMIN });
    expect(insertUsuarioRolMock).toHaveBeenCalledTimes(1);
  });

  it("the same permisos WITHOUT the ADMINISTRADOR role keep the strict rule", async () => {
    rolesDelActor = ["GERENTE"];
    await expect(crearRolCommand.execute({ nombre: "Firmante", permisos: ["cierres.firmar"] }, { session: ADMIN })).rejects.toBeInstanceOf(DomainError);
    await expect(cambiarRolesCommand.execute({ usuarioId: TARGET, roles: ["SOLO_CONSULTA", "DIRECTOR_TECNICO"] }, { session: ADMIN })).rejects.toThrow(
      /No podés asignar el rol "Director Técnico"/,
    );
  });

  it("PERMISOS_ASIGNABLES_A_ROLES = admin set + operativo (sanity of the catalog split)", () => {
    expect([...PERMISOS_ASIGNABLES_A_ROLES].sort()).toEqual([...PERMISOS_DE_ADMINISTRADOR, ...PERMISOS_OPERATIVOS].sort());
  });
});
