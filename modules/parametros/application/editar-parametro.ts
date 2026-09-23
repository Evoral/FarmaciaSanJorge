/**
 * `editarParametro` (FASE 3 point 3.10b). Only the two claves the domain
 * registry knows about (`precision_balanza`, `exceso_pesada_porcentaje`) --
 * zod's `z.enum` rejects any other `clave` before the handler runs, so this
 * command cannot become a generic arbitrary-key writer. `valor` is
 * validated against that specific clave's rule (`PARAMETROS_REGISTRY[clave].validar`)
 * -- never a generic "any decimal" check.
 *
 * Sensitive action (changes a value that affects every ficha técnica
 * generated from now on) -- `requireRecentReauth` applies, same as
 * usuarios' suspender/reactivar/baja/restablecerCredencial.
 *
 * `entidadId` on the audit row must be a real UUID (fsj.registro_auditoria.entidad_id
 * is `@db.Uuid`), but `fsj.parametro` has no surrogate id (its PK is the
 * composite `(tenant_id, clave)`) -- `tenantId` is used as `entidadId`
 * (entidad = "parametro" scoped to this tenant) and the specific `clave`
 * is carried in `valorAnterior`/`valorNuevo` instead, so the audit trail
 * still unambiguously identifies which parameter changed.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { DomainError, NotFoundError } from "@/shared/errors";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { PARAMETRO_CLAVES, PARAMETROS_REGISTRY } from "../domain/parametros-registry";
import { getParametroTenant, updateParametroValor } from "../infrastructure/parametro-repository";

const editarParametroInput = z.object({
  clave: z.enum(PARAMETRO_CLAVES),
  valor: z.string().trim().min(1, "This field cannot be empty."),
});

export type EditarParametroInput = z.infer<typeof editarParametroInput>;

export const editarParametroCommand = defineCommand({
  name: "parametros.editar",
  permiso: "config.editar",
  input: editarParametroInput,
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  audit: { entidad: "parametro", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    const definicion = PARAMETROS_REGISTRY[input.clave];
    const validacion = definicion.validar(input.valor);
    if (!validacion.ok) {
      throw new DomainError(validacion.error);
    }
    const valorNormalizado = validacion.valor.toString();

    const actual = await getParametroTenant(tx, session.tenantId, input.clave);
    if (!actual) {
      // Defensive: post migration-0012/create-tenant.ts every tenant has
      // this row seeded already. If it is somehow missing there is nothing
      // to UPDATE -- surface a clear domain error instead of letting
      // Prisma's update() throw an opaque P2025 downstream.
      throw new NotFoundError(`El parámetro "${input.clave}" no existe todavía para esta farmacia.`);
    }

    await updateParametroValor(tx, { tenantId: session.tenantId, clave: input.clave, valor: valorNormalizado });

    return {
      output: { clave: input.clave, valor: valorNormalizado },
      audit: {
        entidadId: session.tenantId,
        valorAnterior: { clave: input.clave, valor: actual.valor },
        valorNuevo: { clave: input.clave, valor: valorNormalizado },
      },
    };
  },
});

export async function editarParametro(input: EditarParametroInput): Promise<{ clave: string; valor: string }> {
  return editarParametroCommand.execute(input);
}
