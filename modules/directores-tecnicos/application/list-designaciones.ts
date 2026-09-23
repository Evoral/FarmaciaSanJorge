/**
 * `listDesignaciones` (M04, FASE 3 point 3.9). Read-only: current +
 * historical designations, paginated, optionally filtered to only-vigente
 * or only-historical.
 *
 * Gated on `dt.designar` rather than a separate `dt.ver` -- plan §7's
 * permission matrix for this module only defines `dt.designar`/`dt.cesar`
 * (both ADMINISTRADOR-only per migration 0002's rol_permiso seed), with no
 * dedicated read permission. Reusing `dt.designar` for read access keeps
 * this consistent with that matrix instead of inventing a permission the
 * plan/seed does not have (mirrors how `usuarios.roles.modificar` implies
 * being able to see roles in that module's UI).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listDesignaciones as listDesignacionesRepo } from "../infrastructure/designacion-repository";
import type { ListDesignacionesResult } from "../infrastructure/designacion-repository";

const listDesignacionesInput = z.object({
  soloVigentes: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ListDesignacionesInput = z.infer<typeof listDesignacionesInput>;

export const listDesignacionesQuery = defineQuery({
  name: "dt.listar",
  permiso: "dt.designar",
  input: listDesignacionesInput,
  handler: async ({ tx, session, input }) => {
    return listDesignacionesRepo(tx, {
      tenantId: session.tenantId,
      soloVigentes: input.soloVigentes,
      page: input.page,
      pageSize: input.pageSize,
    });
  },
});

export async function listDesignaciones(input: ListDesignacionesInput): Promise<ListDesignacionesResult> {
  return listDesignacionesQuery.execute(input);
}
