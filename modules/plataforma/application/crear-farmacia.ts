/**
 * Alta of a pharmacy from the panel (openspec/changes/plataforma-superadmin P10, P10a). One transaction through
 * fsj.plataforma_crear_tenant -> fsj.crear_tenant_interno, the same function scripts/create-tenant.ts calls.
 *
 * Field errors first (CUIT shape and check digit, CUIT / admin email already in use), so the form marks the field; the
 * unique constraints stay the backstop for the race between that check and the insert. The temporary password is
 * hashed in `prepare`, before the transaction (argon2id is slow), and never logged, audited or returned.
 */
import { z } from "zod";
import { email, nonEmptyString, textoOpcional } from "@/shared/validation";
import { digitoVerificadorAfipValido } from "@/shared/validation/digito-verificador";
import { dniValido, normalizarDni, MENSAJE_DNI_INVALIDO } from "@/shared/validation/dni";
import { validateTemporaryPassword } from "@/shared/auth/policy";
import { hashPassword } from "@/modules/auth/domain/password";
import { ETIQUETA_TAMANO_PREDETERMINADO, ETIQUETA_TAMANO_PREDETERMINADO_NOMBRE } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { HOJA_PREDETERMINADA } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { ValidationError } from "@/shared/errors";
import { definePlataforma } from "./define-plataforma";
import { contactoInput } from "./editar-contacto-farmacia";
import { RAZON_SOCIAL_MAX, soloDigitos } from "../domain/farmacia";
import { campoDeConflictoDeAlta, conflictosDeAlta, crearFarmacia as crearFarmaciaDb } from "../infrastructure/plataforma-repository";

export const altaFarmaciaInput = z.object({
  razonSocial: nonEmptyString.max(RAZON_SOCIAL_MAX),
  cuit: nonEmptyString
    .max(20)
    .refine((v) => /^[0-9\-\s]+$/.test(v) && digitoVerificadorAfipValido(soloDigitos(v)), "El CUIT no es válido: revisá los 11 dígitos."),
  nombreFantasia: textoOpcional(RAZON_SOCIAL_MAX),
  domicilio: textoOpcional(300),
  matriculaFarmacia: textoOpcional(100),
  zonaHoraria: z.string().trim().min(1).default("America/Argentina/Mendoza"),
  ...contactoInput,
  adminEmail: email,
  adminNombre: nonEmptyString.max(100),
  adminApellido: nonEmptyString.max(100),
  adminDni: z.string().transform(normalizarDni).refine(dniValido, MENSAJE_DNI_INVALIDO),
  adminPasswordTemporal: z.string().superRefine((value, ctx) => {
    for (const violacion of validateTemporaryPassword(value)) ctx.addIssue({ code: "custom", message: violacion });
  }),
});

type AltaInput = z.infer<typeof altaFarmaciaInput> & { adminPasswordHash?: string };

export const crearFarmaciaCommand = definePlataforma<AltaInput, { tenantId: string }>({
  name: "plataforma.farmacias.crear",
  input: altaFarmaciaInput,
  // The plaintext is dropped here: from now on only the hash travels.
  prepare: async (alta) => ({ ...alta, adminPasswordTemporal: "", adminPasswordHash: await hashPassword(alta.adminPasswordTemporal) }),
  handler: async ({ tx, actor, input: alta, meta }) => {
    const conflictos = await conflictosDeAlta(tx, actor.tokenHash, alta.cuit, alta.adminEmail);
    if (conflictos.cuit) throw new ValidationError("Ya hay una farmacia con ese CUIT.", { fields: ["cuit"] });
    if (conflictos.email) throw new ValidationError("Ese email ya pertenece a otra cuenta.", { fields: ["adminEmail"] });

    try {
      return await crearFarmaciaDb(
        tx,
        actor.tokenHash,
        {
          razonSocial: alta.razonSocial,
          cuit: alta.cuit,
          nombreFantasia: alta.nombreFantasia,
          domicilio: alta.domicilio,
          matriculaFarmacia: alta.matriculaFarmacia,
          zonaHoraria: alta.zonaHoraria,
          contactoNombre: alta.contactoNombre,
          contactoEmail: alta.contactoEmail,
          contactoTelefono: alta.contactoTelefono,
          adminEmail: alta.adminEmail,
          adminNombre: alta.adminNombre,
          adminApellido: alta.adminApellido,
          adminDni: alta.adminDni,
          adminPasswordHash: alta.adminPasswordHash!,
          etiqueta: { nombre: ETIQUETA_TAMANO_PREDETERMINADO_NOMBRE, ...ETIQUETA_TAMANO_PREDETERMINADO },
          hoja: HOJA_PREDETERMINADA,
        },
        meta,
      );
    } catch (error) {
      const campo = campoDeConflictoDeAlta(error);
      if (campo) throw new ValidationError("Ese dato se acaba de usar en otra alta. Revisá el campo marcado.", { cause: error, fields: [campo] });
      throw error;
    }
  },
});

export function crearFarmacia(raw: Record<string, unknown>) {
  return crearFarmaciaCommand.execute(raw);
}
