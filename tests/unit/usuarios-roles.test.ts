/**
 * Unit tests for modules/usuarios/domain/roles.ts (DP-03 RESUELTA,
 * docs/specs/roles-personalizables.md): protected roles, escalation rules,
 * catalog validation of permisos, code generation, permiso grouping.
 * Roles are per-tenant DATA since migration 0054, so there is no hardcoded
 * role list to test any more -- only the rules.
 */
import { describe, it, expect } from "vitest";
import {
  PERMISO_CATALOGO,
  PERMISO_CODES,
  PERMISOS_ASIGNABLES_A_ROLES,
  PERMISOS_BASE_DE_ROL,
  PERMISOS_DE_ADMINISTRADOR,
  PERMISOS_FUERA_DE_ROLES,
  PERMISOS_OPERATIVOS,
  type Permiso,
} from "@/modules/auth/domain/permisos";
import {
  agruparPermisos,
  codigoRolAsignableSchema,
  CODIGO_ROL_REGEX,
  esRolAsignable,
  esRolEditable,
  esRolEliminable,
  generarCodigoRol,
  GRUPO_PERMISO_LABELS,
  grupoDePermiso,
  motivoNoEditable,
  motivoNoEliminable,
  motivoNoGestionable,
  permisosDeRolSchema,
  permisosFueraDeAlcance,
  permisosOtorgables,
  proteccionDeRol,
  resolverPermisosDeRol,
  ROL_ADMINISTRADOR,
  ROL_DIRECTOR_TECNICO,
  ROL_SISTEMA,
} from "@/modules/usuarios/domain/roles";

const ADMIN = { codigo: ROL_ADMINISTRADOR, esAdministrador: true };
const DT = { codigo: ROL_DIRECTOR_TECNICO, esAdministrador: false };
const SISTEMA = { codigo: ROL_SISTEMA, esAdministrador: false };
const FARMACEUTICO = { codigo: "FARMACEUTICO", esAdministrador: false };
const CUSTOM = { codigo: "CADETE", esAdministrador: false };

describe("protected roles", () => {
  it("ADMINISTRADOR is locked: not editable, not deletable", () => {
    expect(proteccionDeRol(ADMIN)).toBe("BLOQUEADO");
    expect(esRolEditable(ADMIN)).toBe(false);
    expect(esRolEliminable(ADMIN)).toBe(false);
    expect(motivoNoEditable(ADMIN)).toMatch(/Administrador/);
    expect(motivoNoEliminable(ADMIN, 0)).toMatch(/Administrador/);
  });

  it("SISTEMA is internal: not assignable, not editable, not deletable", () => {
    expect(proteccionDeRol(SISTEMA)).toBe("INTERNO");
    expect(esRolAsignable(SISTEMA)).toBe(false);
    expect(esRolEditable(SISTEMA)).toBe(false);
    expect(esRolEliminable(SISTEMA)).toBe(false);
  });

  it("DIRECTOR_TECNICO: permisos editable, never deletable (even unassigned)", () => {
    expect(proteccionDeRol(DT)).toBe("NO_ELIMINABLE");
    expect(esRolEditable(DT)).toBe(true);
    expect(motivoNoEditable(DT)).toBeNull();
    expect(motivoNoEliminable(DT, 0)).toMatch(/Director Técnico/);
  });

  it("default and custom roles are editable and deletable only while unassigned (message with the count)", () => {
    for (const rol of [FARMACEUTICO, CUSTOM]) {
      expect(proteccionDeRol(rol)).toBe("NINGUNA");
      expect(esRolAsignable(rol)).toBe(true);
      expect(motivoNoEditable(rol)).toBeNull();
      expect(motivoNoEliminable(rol, 0)).toBeNull();
      expect(motivoNoEliminable(rol, 1)).toMatch(/1 usuario tiene/);
      expect(motivoNoEliminable(rol, 3)).toMatch(/3 usuarios tienen/);
    }
  });

  it("a esAdministrador flag always means locked, whatever the code", () => {
    expect(proteccionDeRol({ codigo: "OTRO", esAdministrador: true })).toBe("BLOQUEADO");
  });
});

describe("escalation: nobody manages a role they hold", () => {
  it("rejects a role in the actor's own roles, allows any other", () => {
    expect(motivoNoGestionable("CADETE", ["FARMACEUTICO", "CADETE"])).not.toBeNull();
    expect(motivoNoGestionable("CADETE", ["FARMACEUTICO"])).toBeNull();
  });
});

describe("escalation: resolverPermisosDeRol (nobody grants a permiso outside their grantable set)", () => {
  const actor = permisosOtorgables(new Set<Permiso>(["auth.login", "auth.logout", "auth.password.cambiar", "stock.ver", "recetas.crear"]), false);

  it("create: only the actor's permisos, plus the session basics always", () => {
    const r = resolverPermisosDeRol({ solicitados: ["stock.ver"], actuales: [], otorgables: actor });
    expect(r).toEqual({ ok: true, permisos: [...PERMISOS_BASE_DE_ROL, "stock.ver"].sort() });
  });

  it("create: a permiso the actor lacks is rejected and reported", () => {
    const r = resolverPermisosDeRol({ solicitados: ["stock.ver", "cierres.firmar", "usuarios.crear"], actuales: [], otorgables: actor });
    expect(r).toEqual({ ok: false, noOtorgables: ["cierres.firmar", "usuarios.crear"] });
  });

  it("edit: permisos of the role the actor lacks are kept, whether or not they are re-submitted", () => {
    const actuales: Permiso[] = ["auth.login", "cierres.firmar", "stock.ver"];
    const sinReenviar = resolverPermisosDeRol({ solicitados: ["recetas.crear"], actuales, otorgables: actor });
    const reenviado = resolverPermisosDeRol({ solicitados: ["recetas.crear", "cierres.firmar"], actuales, otorgables: actor });
    const esperado = [...PERMISOS_BASE_DE_ROL, "cierres.firmar", "recetas.crear"].sort();
    expect(sinReenviar).toEqual({ ok: true, permisos: esperado });
    expect(reenviado).toEqual({ ok: true, permisos: esperado });
  });

  it("edit: the actor can remove a permiso they hold", () => {
    const r = resolverPermisosDeRol({ solicitados: [], actuales: ["stock.ver", "recetas.crear"], otorgables: actor });
    expect(r).toEqual({ ok: true, permisos: [...PERMISOS_BASE_DE_ROL].sort() });
  });

  it("session basics never count as a grant, even for an actor lacking them", () => {
    const r = resolverPermisosDeRol({ solicitados: ["auth.logout"], actuales: [], otorgables: new Set<Permiso>(["stock.ver"]) });
    expect(r.ok).toBe(true);
  });

  it("grant authority exception: an ADMINISTRADOR (no operativo permiso held) can grant anything role-assignable, operativo included", () => {
    const otorgables = permisosOtorgables(new Set(PERMISOS_DE_ADMINISTRADOR), true);
    const r = resolverPermisosDeRol({ solicitados: [...PERMISOS_ASIGNABLES_A_ROLES], actuales: [], otorgables });
    expect(r).toEqual({ ok: true, permisos: [...PERMISOS_ASIGNABLES_A_ROLES].sort() });
  });

  it("a non-admin role manager keeps the strict rule: no operativo permiso they do not hold", () => {
    const otorgables = permisosOtorgables(new Set<Permiso>([...PERMISOS_BASE_DE_ROL, "roles.gestionar", "recetas.crear"]), false);
    expect(resolverPermisosDeRol({ solicitados: ["recetas.crear"], actuales: [], otorgables }).ok).toBe(true);
    expect(resolverPermisosDeRol({ solicitados: ["cierres.firmar"], actuales: [], otorgables })).toEqual({ ok: false, noOtorgables: ["cierres.firmar"] });
  });
});

describe("permisosOtorgables (grant authority)", () => {
  it("held permisos, plus every operativo permiso only when the actor holds ADMINISTRADOR", () => {
    const delActor = new Set<Permiso>(["stock.ver"]);
    expect([...permisosOtorgables(delActor, false)]).toEqual(["stock.ver"]);
    const admin = permisosOtorgables(delActor, true);
    for (const permiso of PERMISOS_OPERATIVOS) expect(admin.has(permiso)).toBe(true);
    for (const permiso of PERMISOS_FUERA_DE_ROLES) expect(admin.has(permiso)).toBe(false);
  });
});

describe("escalation: permisosFueraDeAlcance (assigning a role to a usuario)", () => {
  it("an ADMINISTRADOR may assign a role carrying operativo permisos; a non-admin may not", () => {
    const rolOperativo: Permiso[] = ["recetas.crear", "preparaciones.confirmar"];
    expect(permisosFueraDeAlcance(rolOperativo, permisosOtorgables(new Set(PERMISOS_DE_ADMINISTRADOR), true))).toEqual([]);
    expect(permisosFueraDeAlcance(rolOperativo, permisosOtorgables(new Set(PERMISOS_DE_ADMINISTRADOR), false))).toEqual(rolOperativo);
  });

  it("lists the role's permisos the actor lacks", () => {
    expect(permisosFueraDeAlcance(["stock.ver", "cierres.firmar"], new Set<Permiso>(["stock.ver"]))).toEqual(["cierres.firmar"]);
    expect(permisosFueraDeAlcance(["stock.ver"], new Set<Permiso>(["stock.ver", "recetas.crear"]))).toEqual([]);
  });
});

describe("catalog validation of permisos (zod, built from PERMISO_CODES)", () => {
  it("accepts every role-assignable catalog permiso", () => {
    expect(permisosDeRolSchema.safeParse([...PERMISOS_ASIGNABLES_A_ROLES]).success).toBe(true);
  });

  it("rejects an unknown code", () => {
    expect(permisosDeRolSchema.safeParse(["stock.ver", "stock.borrar_todo"]).success).toBe(false);
    expect(permisosDeRolSchema.safeParse([42]).success).toBe(false);
  });

  it("rejects the permisos that never belong to a role (auth.activar, tenants.*)", () => {
    for (const codigo of PERMISOS_FUERA_DE_ROLES) {
      expect(permisosDeRolSchema.safeParse([codigo]).success).toBe(false);
    }
  });

  it("roles.gestionar is in the catalog and role-assignable", () => {
    expect(PERMISO_CODES).toContain("roles.gestionar");
    expect(PERMISOS_ASIGNABLES_A_ROLES).toContain("roles.gestionar");
  });
});

describe("codigoRolAsignableSchema (usuarios forms)", () => {
  it("accepts a well-formed code and rejects SISTEMA and garbage", () => {
    expect(codigoRolAsignableSchema.safeParse("FARMACEUTICO").success).toBe(true);
    expect(codigoRolAsignableSchema.safeParse("CADETE_2").success).toBe(true);
    expect(codigoRolAsignableSchema.safeParse(ROL_SISTEMA).success).toBe(false);
    expect(codigoRolAsignableSchema.safeParse("x'; DROP TABLE").success).toBe(false);
    expect(codigoRolAsignableSchema.safeParse("").success).toBe(false);
  });
});

describe("generarCodigoRol", () => {
  it("slugs the nombre (accents removed, upper case, underscores)", () => {
    expect(generarCodigoRol("Cadete de mostrador", new Set())).toBe("CADETE_DE_MOSTRADOR");
    expect(generarCodigoRol("  Atención — Turno  Noche! ", new Set())).toBe("ATENCION_TURNO_NOCHE");
  });

  it("prefixes ROL_ when it would not start with a letter", () => {
    expect(generarCodigoRol("2do turno", new Set())).toBe("ROL_2DO_TURNO");
    expect(generarCodigoRol("¡¡!!", new Set())).toBe("ROL");
  });

  it("suffixes _2, _3... against the tenant's existing codes (protected codes included)", () => {
    expect(generarCodigoRol("Administrador", new Set([ROL_ADMINISTRADOR]))).toBe("ADMINISTRADOR_2");
    expect(generarCodigoRol("Sistema", new Set([ROL_SISTEMA, "SISTEMA_2"]))).toBe("SISTEMA_3");
  });

  it("always satisfies the DB format CHECK (rol_codigo_formato)", () => {
    for (const nombre of ["a", "Ñandú", "x".repeat(200), "123", "Rol con   espacios", "ü"]) {
      expect(generarCodigoRol(nombre, new Set())).toMatch(CODIGO_ROL_REGEX);
    }
  });
});

describe("permiso grouping (role editor)", () => {
  it("groups by the prefix before the first dot, in catalog order", () => {
    expect(grupoDePermiso("stock.ajuste.registrar")).toBe("stock");
    const grupos = agruparPermisos([
      { codigo: "stock.ver", descripcion: "Ver stock", categoria: "consulta" },
      { codigo: "recetas.crear", descripcion: "Crear recetas", categoria: "operativo" },
      { codigo: "stock.ajuste.registrar", descripcion: "Registrar ajustes", categoria: "operativo" },
    ]);
    expect(grupos.map((g) => g.grupo)).toEqual(["stock", "recetas"]);
    expect(grupos[0]!.permisos.map((p) => p.codigo)).toEqual(["stock.ver", "stock.ajuste.registrar"]);
  });

  it("every role-assignable permiso group has a Spanish label", () => {
    const sinEtiqueta = [...new Set(PERMISOS_ASIGNABLES_A_ROLES.map(grupoDePermiso))].filter((g) => !(g in GRUPO_PERMISO_LABELS));
    expect(sinEtiqueta).toEqual([]);
  });
});

/**
 * Permiso categories (DP-03 revision, user decision 2026-10-01): the
 * classification below is the approved one -- a change to it is a product
 * decision, so this test pins it explicitly.
 */
const OPERATIVOS_APROBADOS: Permiso[] = [
  "stock.partida.ingresar",
  "stock.ajuste.registrar",
  "stock.ajuste.autorizar",
  "recetas.crear",
  "recetas.editar",
  "recetas.anular",
  "fichas.generar",
  "cotizaciones.calcular",
  "preparaciones.iniciar",
  "preparaciones.descartar",
  "preparaciones.confirmar",
  "etiquetas.generar",
  "libro.anulacion.solicitar",
  "libro.anulacion.autorizar",
  "libro.historico.digitalizar",
  "cierres.firmar",
  "cierres.folio.corregir",
  "libros.crear",
  "libros.cerrar",
  "entregas.registrar",
  "entregas.firma.confirmar",
  "archivo.lotes.gestionar",
  "archivo.destruccion.gestionar",
];

/** ADMINISTRADOR's permisos BEFORE DP-03 (migrations 0002/0043/0046): none may become operativo (no regression for admins). */
const ADMINISTRADOR_ANTES: Permiso[] = [
  "auditoria.ver", "auth.login", "auth.logout", "auth.password.cambiar", "config.editar", "config.ver", "dt.cesar", "dt.designar",
  "drogas.baja", "drogas.crear", "drogas.editar", "drogas.reactivar", "precios.reglas.editar", "proveedores.gestionar",
  "reportes.auditoria", "reportes.usuarios", "roles.ver", "stock.partida.costo.corregir", "stock.valorizado.ver", "stock.ver",
  "unidades.baja", "unidades.crear", "unidades.editar", "usuarios.auditoria.ver", "usuarios.baja", "usuarios.credencial.restablecer",
  "usuarios.crear", "usuarios.editar", "usuarios.listar", "usuarios.reactivar", "usuarios.roles.modificar", "usuarios.suspender", "usuarios.ver",
];

describe("permiso categories (modules/auth/domain/permisos.ts#PERMISO_CATALOGO)", () => {
  it("operativo is exactly the approved list", () => {
    expect([...PERMISOS_OPERATIVOS].sort()).toEqual([...OPERATIVOS_APROBADOS].sort());
  });

  it("sistema is exactly auth.activar and tenants.*, never assignable", () => {
    expect([...PERMISOS_FUERA_DE_ROLES].sort()).toEqual(["auth.activar", "tenants.baja", "tenants.crear", "tenants.editar"]);
  });

  it("ADMINISTRADOR's effective set = every consulta/gestion permiso: no operativo, no sistema, roles.gestionar included", () => {
    expect([...PERMISOS_DE_ADMINISTRADOR].sort()).toEqual(
      PERMISO_CODES.filter((c) => PERMISO_CATALOGO[c] === "consulta" || PERMISO_CATALOGO[c] === "gestion").sort(),
    );
    for (const permiso of PERMISOS_DE_ADMINISTRADOR) expect(["consulta", "gestion"]).toContain(PERMISO_CATALOGO[permiso]);
    expect(PERMISOS_DE_ADMINISTRADOR).toContain("roles.gestionar");
  });

  it("no permiso ADMINISTRADOR held before DP-03 is operativo (admins lose nothing)", () => {
    const perdidos = ADMINISTRADOR_ANTES.filter((permiso) => !PERMISOS_DE_ADMINISTRADOR.includes(permiso));
    expect(perdidos).toEqual([]);
  });

  it("the session basics are consulta (so the locked ADMINISTRADOR has them)", () => {
    for (const permiso of PERMISOS_BASE_DE_ROL) expect(PERMISO_CATALOGO[permiso]).toBe("consulta");
  });
});
