/**
 * `crearUsuario` (M03, FASE 3 point 3.2, INV-U01/INV-U07). No
 * self-registration -- only an ADMINISTRADOR with `usuarios.crear` reaches
 * this. The caller types a TEMPORARY password (docs/specs/contrasena-temporal.md):
 * the usuario is created `ACTIVO` with that password's argon2id hash and
 * `debeCambiarPassword`, so at first login they must replace it and set a PIN
 * (no activation credential is generated any more). INV-U07 ("starts
 * `PENDIENTE_ACTIVACION`") is superseded by the spec for this flow. The
 * plaintext is hashed here and never persisted, returned nor audited
 * (INV-AU-001); the caller hands it over in person.
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
 * M2 (security review) declared `requireRecentReauth` here because creating a
 * user mints a brand new credential. User decision 2026-10-21: no usuarios
 * command asks for password re-authentication any more (the session identifies
 * who acts); the escalation checks below remain.
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
import { hashPassword } from "@/modules/auth/domain/password";
import { passwordTemporalFields, refinarPasswordTemporal } from "./password-temporal";
import { codigoRolAsignableSchema, ROLES_VEDADOS_A_SECTOR } from "../domain/roles";
import { identidadDeCuentaDeSector } from "../domain/cuenta-de-sector";
import { resolverRolesAAsignar } from "./roles-asignables";
import { existeEmail, existeDni, insertUsuario, insertUsuarioRol } from "../infrastructure/usuario-repository";

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
    /** The temporary password the Administrador hands over in person (replaced by the usuario at first login). */
    ...passwordTemporalFields,
  })
  .superRefine((value, ctx) => {
    refinarPasswordTemporal(value, ctx);
    // A cuenta de sector is not a person: apellido and DNI are derived, not asked.
    if (!value.esSector) {
      for (const campo of ["apellido", "dni"] as const) {
        if (!value[campo]) ctx.addIssue({ code: "custom", path: [campo], message: "Este campo no puede estar vacío." });
      }
    }
  });

/** Pre-default wire shape: `esSector` may be omitted (= false). */
export type CrearUsuarioInput = z.input<typeof crearUsuarioInput>;

export interface CrearUsuarioResult {
  usuarioId: string;
}

export const crearUsuarioCommand = defineCommand({
  name: "usuarios.crear",
  permiso: "usuarios.crear",
  input: crearUsuarioInput,
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

    const passwordHash = await hashPassword(input.passwordTemporal);
    const nuevo = await insertUsuario(tx, {
      tenantId: session.tenantId,
      nombre: identidad.nombre,
      apellido: identidad.apellido,
      email: input.email,
      dni: identidad.dni,
      numeroMatricula,
      esSector: input.esSector,
      passwordHash,
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

    // M1: CREAR + one ASIGNAR_ROL per initial role (plan §9 M03 historia 2),
    // all inside this same transaction -- if it rolls back, every audit row
    // rolls back with it (INV-A01).
    await auditRecord(tx, {
      tenantId: session.tenantId,
      usuarioId: session.usuario.id,
      entidad: "usuario",
      entidadId: nuevo.id,
      accion: TipoAccion.CREAR,
      // Never the password nor its hash -- only the non-secret fields (plan §14 audit rule).
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
      output: { usuarioId: nuevo.id },
    };
  },
});

export async function crearUsuario(input: CrearUsuarioInput): Promise<CrearUsuarioResult> {
  return crearUsuarioCommand.execute(input);
}
