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
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { record as auditRecord } from "@/shared/audit";
import { ValidationError } from "@/shared/errors";
import { email as emailSchema, nonEmptyString } from "@/shared/validation";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { generateOpaqueToken, hashToken } from "@/modules/auth/domain/token";
import { ROLES_ASIGNABLES } from "../domain/roles";
import { existeEmail, existeDni, insertUsuario, insertUsuarioRol, insertCredencialActivacion } from "../infrastructure/usuario-repository";

const crearUsuarioInput = z.object({
  nombre: nonEmptyString,
  apellido: nonEmptyString,
  email: emailSchema,
  dni: nonEmptyString,
  numeroMatricula: z.string().trim().max(100).optional(),
  roles: z.array(z.enum(ROLES_ASIGNABLES)).min(1, "Elegí al menos un rol."),
});

export type CrearUsuarioInput = z.infer<typeof crearUsuarioInput>;

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
    if (await existeEmail(tx, input.email)) {
      throw new ValidationError("Ya existe un usuario con ese email.");
    }
    if (await existeDni(tx, session.tenantId, input.dni)) {
      throw new ValidationError("Ya existe un usuario con ese DNI en esta farmacia.");
    }

    const nuevo = await insertUsuario(tx, {
      tenantId: session.tenantId,
      nombre: input.nombre,
      apellido: input.apellido,
      email: input.email,
      dni: input.dni,
      numeroMatricula: input.numeroMatricula ?? null,
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
      valorNuevo: { nombre: input.nombre, apellido: input.apellido, email: input.email, dni: input.dni, roles: input.roles },
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
