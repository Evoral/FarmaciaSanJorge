/**
 * `listParametros` (FASE 3 point 3.10b): the tenant's current values for
 * every known parameter, joined with the domain registry's metadata
 * (label, description, validation rule reference). `config.ver` is granted
 * to ALL FIVE roles (migration 0002).
 *
 * Defensive fallback: if a known clave's row does not exist yet for this
 * tenant (should not happen post migration-0012/create-tenant.ts seeding,
 * but this function does not assume the seed always ran), the registry's
 * `valorPorDefecto` is shown instead, with `actualizadoEn: null` so the UI
 * can distinguish "this is the seeded default, never saved" from "this was
 * actually saved with this value".
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { PARAMETRO_CLAVES, PARAMETROS_REGISTRY } from "../domain/parametros-registry";
import { listParametrosTenant } from "../infrastructure/parametro-repository";

const listParametrosInput = z.object({});

export interface ParametroListItem {
  clave: string;
  label: string;
  descripcion: string;
  valor: string;
  actualizadoEn: Date | null;
}

export const listParametrosQuery = defineQuery({
  name: "parametros.list",
  permiso: "config.ver",
  input: listParametrosInput,
  handler: async ({ tx, session }) => {
    const rows = await listParametrosTenant(tx, session.tenantId, PARAMETRO_CLAVES);
    const porClave = new Map(rows.map((row) => [row.clave, row]));

    return PARAMETRO_CLAVES.map((clave): ParametroListItem => {
      const definicion = PARAMETROS_REGISTRY[clave];
      const row = porClave.get(clave);
      return {
        clave,
        label: definicion.label,
        descripcion: definicion.descripcion,
        valor: row?.valor ?? definicion.valorPorDefecto,
        actualizadoEn: row?.actualizadoEn ?? null,
      };
    });
  },
});

export async function listParametros(): Promise<ParametroListItem[]> {
  return listParametrosQuery.execute({});
}
