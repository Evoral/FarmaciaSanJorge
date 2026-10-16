/**
 * `crearUsuario` (M03, FASE 3 point 3.2, INV-U01/INV-U07). No
 * self-registration -- only an ADMINISTRADOR with `usuarios.crear` reaches
 * this. The new usuario starts `PENDIENTE_ACTIVACION` (schema default,
 * never set explicitly) with a one-use, 72h activation credential, shown
 * to the caller EXACTLY ONCE in this command's output -- never persisted
 * in plain text, never re-derivable, never included in the audit row
 * (INV-AU-001). Reuses the exact token generation/hashing
 * (`modules/auth/domain/token.ts`) and TTL (`AUTH_POLICY`) as
 * `scripts/create-tenant.ts`'s first-admin bootstrap, so every activation
 * credential in the system has the same shape regardless of how it was
 * issued.
 *
 * M1 (security review): plan §9 M03 historia 2 requires "auditoría `CREAR`
 * + `ASIGNAR_ROL`" -- one `ASIGNAR_ROL` row PER initial role, same
 * discipline `cambiar-roles.ts` already uses for role changes. That is why
 * `audit` is declared `{ skip: true, ... }` here (exactly like
 * `cambiarRoles`) and every audit row -- the one `CREAR` row plus one
 * `ASIGNAR_ROL` row per role in `input.roles` -- is written by hand via
 * `auditRecord`, inside this same transaction: `defineCommand`'s built-in
 * `audit` option can only write ONE row per invocation, which cannot
 * express "1 + N rows" on its own.
 *
 * M2 (security review): declares `requireRecentReauth` UNCONDITIONALLY,
 * same as every other sensitive usuarios command (suspender/reactivar/
 * baja/restablecerCredencial/cambiarRoles). Creating a user mints a brand
 * new credential (including, potentially, a new ADMINISTRADOR) -- without
 * this, a hijacked admin session (stolen cookie, XSS, left-open browser)
 * could mint itself a fresh ADMINISTRADOR account without ever having to
 * prove the password again, even though `cambiarRoles` already requires
 * exactly that step-up to grant the SAME role to an EXISTING user.
 *
 * DP-03 (migration 0054): `roles` are codes of the session's TENANT roles,
 * resolved and escalation-checked by `resolverRolesAAsignar` before the
 * usuario is inserted (see cambiar-roles.ts).
 *
 * `esSector` (migration 0077, docs/specs/cuentas-de-sector.md) creates a
 * cuenta de sector: one shared session per work area. It is decided HERE and
 * never changes (INV-SEC-002), and such an account never holds
 * ADMINISTRADOR nor DIRECTOR_TECNICO (checked below; INV-SEC-001 is the DB
 * backstop, also for later role changes). A cuenta de sector is a work area,
 * not a person: the form asks only its name and its email (the login
 * identifier); apellido and DNI are derived (`../domain/cuenta-de-sector.ts`)
 * and it has no matrícula.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { ValidationError } from "@/shared/errors";
import { email as emailSchema, nonEmptyString } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { generateOpaqueToken, hashToken } from "@/modules/auth/domain/token";
import { codigoRolAsignableSchema, ROLES_VEDADOS_A_SECTOR } from "../domain/roles";
import { identidadDeCuentaDeSector } from "../domain/cuenta-de-sector";
import { resolverRolesAAsignar } from "./roles-asignables";
import { existeEmail, existeDni, insertUsuario, insertUsuarioRol, insertCredencialActivacion } from "../infrastructure/usuario-repository";

const textoOpcional = z.string().trim().optional();

const crearUsuarioInput = z
  .object({
    /** A person's first name, or the NAME OF THE SECTOR for a cuenta de sector ("Laboratorio"). */
    nombre: nonEmptyString,
    /** Required for a person. Ignored for a cuenta de sector (derived, see `identidadDeCuentaDeSector`). */
    apellido: textoOpcional,
    /** Also the login identifier, so a cuenta de sector needs one too (no mail is ever sent to it). */
    email: emailSchema,
    /** Required for a person. Ignored for a cuenta de sector (derived). */
    dni: textoOpcional,
    numeroMatricula: z.string().trim().max(100).optional(),
    roles: z
      .array(codigoRolAsignableSchema)
      .min(1, "Elegí al menos un rol.")
      .max(50)
      .transform((roles) => [...new Set(roles)]),
    /** A cuenta de sector (shared session per work area) instead of a person's own account. */
    esSector: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.esSector) return;
    for (const campo of ["apellido", "dni"] as const) {
      if (!value[campo]) ctx.addIssue({ code: "custom", path: [campo], message: "Este campo no puede estar vacío." });
    }
  });

/** Pre-default wire shape: `esSector` may be omitted (= false). */
export type CrearUsuarioInput = z.input<typeof crearUsuarioInput>;

export interface CrearUsuarioResult {
  usuarioId: string;
  /** Shown ONCE -- the caller (UI) must never persist or re-request this value. */
  credencial: string;
  credencialVenceEn: Date;
}

export const crearUsuarioCommand = defineCommand({
  name: "usuarios.crear",
  permiso: "usuarios.crear",
  input: crearUsuarioInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { skip: true, reason: "Audits one CREAR row plus one ASIGNAR_ROL row per initial role via manual auditRecord calls below (plan §9 M03 historia 2), not a single command-level entry." },
  handler: async ({ tx, session, input }) => {
    // Field-level duplicate errors (task requirement), without leaking
    // WHICH tenant already owns a conflicting email -- the message never
    // names another tenant, only "ya existe". The DB's own UNIQUE
    // constraints (usuario_email_key, usuario_tenant_dni_key) remain the
    // final backstop for the race between this check and the INSERT below.
    // A cuenta de sector is a work area, not a person: only its name is asked (domain/cuenta-de-sector.ts).
    const identidad = input.esSector ? identidadDeCuentaDeSector(input.nombre) : { nombre: input.nombre, apellido: input.apellido ?? "", dni: input.dni ?? "" };
    if (!identidad) {
      throw new ValidationError("El nombre del sector debe tener al menos una letra o un número.", { fields: ["nombre"] });
    }
    const numeroMatricula = input.esSector ? null : (input.numeroMatricula ?? null);

    if (await existeEmail(tx, input.email)) {
      throw new ValidationError("Ya existe un usuario con ese email.");
    }
    if (await existeDni(tx, session.tenantId, identidad.dni)) {
      throw new ValidationError(input.esSector ? "Ya existe una cuenta de sector con ese nombre." : "Ya existe un usuario con ese DNI en esta farmacia.", {
        fields: [input.esSector ? "nombre" : "dni"],
      });
    }

    if (input.esSector && input.roles.some((rol) => ROLES_VEDADOS_A_SECTOR.includes(rol))) {
      throw new ValidationError("Una cuenta de sector no puede tener el rol Administrador ni el de Director Técnico.", { fields: ["roles"] });
    }

    await resolverRolesAAsignar(tx, session, input.roles);

    const nuevo = await insertUsuario(tx, {
      tenantId: session.tenantId,
      nombre: identidad.nombre,
      apellido: identidad.apellido,
      email: input.email,
      dni: identidad.dni,
      numeroMatricula,
      esSector: input.esSector,
      creadoPorId: session.usuario.id,
    });

    for (const rolCodigo of input.roles) {
      await insertUsuarioRol(tx, {
        tenantId: session.tenantId,
        usuarioId: nuevo.id,
        rolCodigo,
        asignadoPorId: session.usuario.id,
      });
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const venceEn = new Date(Date.now() + AUTH_POLICY.activationCredentialTtlHours * 60 * 60 * 1000);

    await insertCredencialActivacion(tx, {
      tenantId: session.tenantId,
      usuarioId: nuevo.id,
      tokenHash,
      emitidaPorId: session.usuario.id,
      venceEn,
      motivoEmision: "ALTA",
    });

    // M1: CREAR + one ASIGNAR_ROL per initial role (plan §9 M03 historia 2),
    // all inside this same transaction -- if it rolls back, every audit row
    // rolls back with it (INV-A01).
    await auditRecord(tx, {
      tenantId: session.tenantId,
      usuarioId: session.usuario.id,
      entidad: "usuario",
      entidadId: nuevo.id,
      accion: TipoAccion.CREAR,
      // Never the credential/hash -- only the non-secret fields (plan §14 audit rule).
      valorNuevo: { nombre: identidad.nombre, apellido: identidad.apellido, email: input.email, dni: identidad.dni, roles: input.roles, ...(input.esSector ? { esSector: true } : {}) },
    });
    for (const rolCodigo of input.roles) {
      await auditRecord(tx, {
        tenantId: session.tenantId,
        usuarioId: session.usuario.id,
        entidad: "usuario",
        entidadId: nuevo.id,
        accion: TipoAccion.ASIGNAR_ROL,
        valorNuevo: { rol: rolCodigo },
      });
    }

    return {
      output: { usuarioId: nuevo.id, credencial: rawToken, credencialVenceEn: venceEn },
    };
  },
});

export async function crearUsuario(input: CrearUsuarioInput): Promise<CrearUsuarioResult> {
  return crearUsuarioCommand.execute(input);
}
